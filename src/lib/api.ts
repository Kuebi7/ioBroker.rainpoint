import crypto from 'node:crypto';
import https from 'node:https';
import type { ApiConfig, DeviceInfo, DeviceStatus, HomeInfo, ZoneStatus } from './types';
import { HomgarApiError } from './types';
import { decodeSensor, decodeValve } from './decoder';
import { getDeviceKind, isValveKind, parseZoneNames } from './devices';

const API_VERSION = '1.16.1065';
const SCENE_TYPE = '1';
const CONTROL_MODE_CLOSE = 0;
const CONTROL_MODE_OPEN = 1;
const REAUTH_CODES = new Set([1001, 1004]);

interface BaseResponse<T> {
    code: number;
    msg: string;
    data: T;
    ts: number;
}

interface LoginData {
    token: string;
    refreshToken: string;
    tokenExpired: number;
}

interface HomeRaw {
    hid: string | number;
    homeName: string;
}

interface DeviceRaw {
    mid: string | number;
    sid?: string | number;
    did?: string | number;
    name: string;
    model: string;
    productKey?: string;
    deviceName?: string;
    enabled?: number;
    portNumber?: number;
    portDescribe?: string;
    addr?: number;
    softVer?: string;
    subDevices?: DeviceRaw[];
}

interface StatusParam {
    id: string;
    value: string;
}

interface DeviceStatusRaw {
    state?: string;
    connected?: string;
    subDeviceStatus?: StatusParam[];
}

interface MultipleDeviceStatusRaw {
    mid: string;
    status: StatusParam[];
}

interface HubStatus {
    online: boolean;
    byAddr: Map<number, string>;
    state: string | null;
}

interface HubRequestEntry {
    mid: string;
    deviceName: string;
    productKey: string;
}

function md5(input: string): string {
    return crypto.createHash('md5').update(input, 'utf8').digest('hex');
}

function asString(value: string | number | undefined): string {
    return value == null ? '' : String(value);
}

function parseGatewayState(state: string | null): { battery: number | null; rssi: number | null } {
    if (!state || state.includes('#') || state.includes(';') || state.includes('=')) {
        return { battery: null, rssi: null };
    }
    const parts = state.split(',');
    if (parts.length < 2) {
        return { battery: null, rssi: null };
    }
    const battery = parseInt(parts[0], 10);
    const rssi = parseInt(parts[1], 10);
    return {
        battery: Number.isNaN(battery) ? null : battery,
        rssi: Number.isNaN(rssi) ? null : rssi,
    };
}

export class HomgarClient {
    private token = '';
    private refreshTokenValue = '';
    private tokenExpired = 0;
    private hid = '';
    private readonly baseUrl: string;
    private readonly appCode: string;
    private readonly deviceCache = new Map<string, DeviceInfo>();

    public constructor(
        private readonly config: ApiConfig,
        private readonly log: ioBroker.Logger,
    ) {
        this.baseUrl = `https://region${config.region || '3'}.homgarus.com:1443`;
        this.appCode = config.appType === 'homgar' ? '1' : '2';
    }

    public async login(): Promise<void> {
        const areaCode = this.config.areaCode || '49';
        const deviceId = md5(`${this.config.email}${areaCode}`);
        const response = await this.request<LoginData>(
            'POST',
            '/auth/basic/app/login',
            {
                areaCode,
                phoneOrEmail: this.config.email,
                password: md5(this.config.password),
                deviceId,
            },
            false,
        );
        this.token = response.data.token;
        this.refreshTokenValue = response.data.refreshToken;
        this.tokenExpired = response.ts + response.data.tokenExpired * 1000;
        this.log.info(`Logged in to HomGar/RainPoint cloud as ${this.config.email}`);
    }

    public setHome(homeId: string): void {
        this.hid = homeId;
    }

    public async getHomes(): Promise<HomeInfo[]> {
        const response = await this.request<HomeRaw[]>('GET', '/app/member/appHome/list');
        return (response.data || []).map(home => ({
            id: asString(home.hid),
            name: home.homeName,
        }));
    }

    public async getDevices(): Promise<DeviceInfo[]> {
        const response = await this.request<DeviceRaw[]>(
            'GET',
            `/app/device/getDeviceByHid?hid=${encodeURIComponent(this.hid)}`,
        );
        const devices: DeviceInfo[] = [];
        this.deviceCache.clear();

        for (const device of response.data || []) {
            const children = (device.subDevices || []).filter(sub => sub.addr !== 1);
            const main = this.normalize(device, 0, device.name, false, undefined, children.length > 0);
            devices.push(main);
            this.deviceCache.set(main.id, main);
            this.log.debug(
                `Device ${main.name} (${main.model}, ${main.kind}, mid=${main.id}) with ${children.length} sub-device(s)`,
            );
            for (const sub of children) {
                const subDevice = this.normalize(
                    sub,
                    sub.addr ?? 0,
                    sub.name || device.name,
                    true,
                    asString(device.mid),
                );
                devices.push(subDevice);
                this.deviceCache.set(subDevice.id, subDevice);
            }
        }

        this.log.debug(`Normalized ${devices.length} RainPoint device(s)`);
        return devices;
    }

    public async getDeviceStatuses(deviceIds: string[]): Promise<Map<string, DeviceStatus>> {
        const result = new Map<string, DeviceStatus>();
        if (deviceIds.length === 0) {
            return result;
        }
        if (this.deviceCache.size === 0) {
            await this.getDevices();
        }

        const hubEntries = new Map<string, HubRequestEntry>();
        for (const id of deviceIds) {
            const device = this.deviceCache.get(id);
            const hubId = device?.parentId ?? id;
            if (hubEntries.has(hubId)) {
                continue;
            }
            const hub = this.deviceCache.get(hubId);
            hubEntries.set(hubId, {
                mid: hubId,
                deviceName: hub?.deviceName ?? '',
                productKey: hub?.productKey ?? '',
            });
        }

        const hubStatuses = await this.fetchHubStatuses([...hubEntries.values()]);
        for (const id of deviceIds) {
            const device = this.deviceCache.get(id);
            if (!device) {
                result.set(id, this.emptyStatus(id, false));
                continue;
            }
            const hubId = device.parentId ?? id;
            const hubStatus = hubStatuses.get(hubId);
            const payload = device.isSubDevice
                ? (hubStatus?.byAddr.get(device.addr) ?? null)
                : (hubStatus?.state ?? null);
            result.set(id, this.decodeStatus(id, device, payload, hubStatus?.online ?? false));
        }
        return result;
    }

    public async turnZoneOn(deviceId: string, port: number, durationSeconds: number): Promise<void> {
        await this.controlWorkMode(deviceId, port, CONTROL_MODE_OPEN, durationSeconds);
    }

    public async turnZoneOff(deviceId: string, port: number): Promise<void> {
        await this.controlWorkMode(deviceId, port, CONTROL_MODE_CLOSE, 0);
    }

    private async controlWorkMode(deviceId: string, port: number, mode: number, duration: number): Promise<void> {
        const { hubId, hub, addr } = this.resolveControlTarget(deviceId);
        try {
            await this.request('POST', '/app/device/controlWorkMode', {
                mid: hubId,
                addr,
                deviceName: hub.deviceName,
                productKey: hub.productKey,
                port,
                mode,
                duration,
                hid: this.hid,
            });
        } catch (error) {
            if (error instanceof HomgarApiError && error.code === 4) {
                this.log.debug('controlWorkMode: device already in requested state');
                return;
            }
            throw error;
        }
    }

    private resolveControlTarget(deviceId: string): { hubId: string; hub: DeviceInfo; addr: number } {
        const device = this.deviceCache.get(deviceId);
        if (!device) {
            throw new Error(`Device ${deviceId} not found`);
        }
        const hubId = device.parentId ?? deviceId;
        const hub = this.deviceCache.get(hubId);
        if (!hub) {
            throw new Error(`Hub ${hubId} not found for device ${deviceId}`);
        }
        return {
            hubId,
            hub,
            addr: device.isSubDevice ? device.addr : 0,
        };
    }

    private normalize(
        device: DeviceRaw,
        addr: number,
        name: string,
        isSubDevice: boolean,
        parentId?: string,
        hasSubDevices = false,
    ): DeviceInfo {
        const portNumber = device.portNumber || 1;
        return {
            id: asString(isSubDevice ? (device.sid ?? device.mid) : device.mid),
            name,
            model: device.model,
            productKey: device.productKey ?? '',
            deviceName: device.deviceName ?? '',
            online: device.enabled !== 0,
            portNumber,
            zoneNames: parseZoneNames(device.portDescribe, portNumber),
            kind: getDeviceKind(device.model, hasSubDevices),
            isSubDevice,
            parentId,
            addr,
            firmware: device.softVer,
        };
    }

    private emptyStatus(deviceId: string, online: boolean): DeviceStatus {
        return {
            deviceId,
            online,
            zones: [],
            moisture: null,
            temperature: null,
            humidity: null,
            battery: null,
            illuminance: null,
            pressure: null,
            rssi: null,
            rainTotalMm: null,
            rainHourMm: null,
            rainDailyMm: null,
            rainWeekMm: null,
            rawPayload: null,
        };
    }

    private decodeStatus(
        deviceId: string,
        device: DeviceInfo,
        payload: string | null,
        fallbackOnline: boolean,
    ): DeviceStatus {
        if (device.kind === 'gateway') {
            const hub = parseGatewayState(payload);
            return {
                ...this.emptyStatus(deviceId, fallbackOnline),
                battery: hub.battery,
                rssi: hub.rssi,
                rawPayload: payload,
            };
        }
        if (!payload) {
            return this.emptyStatus(deviceId, fallbackOnline);
        }
        if (isValveKind(device.kind)) {
            const decoded = decodeValve(payload);
            const zones: ZoneStatus[] = [];
            for (let port = 1; port <= device.portNumber; port++) {
                const zone = decoded.zones.get(port);
                zones.push({
                    port,
                    name: device.zoneNames[port - 1] ?? `Zone ${port}`,
                    isOn: zone?.open ?? false,
                    remainingSeconds: zone?.durationSeconds ?? 0,
                });
            }
            return {
                ...this.emptyStatus(deviceId, decoded.hubOnline ?? fallbackOnline),
                zones,
                rawPayload: payload,
            };
        }

        const decoded = decodeSensor(payload, device.model);
        return {
            ...this.emptyStatus(deviceId, true),
            ...decoded,
            rawPayload: payload,
        };
    }

    private async fetchHubStatuses(hubs: HubRequestEntry[]): Promise<Map<string, HubStatus>> {
        const result = new Map<string, HubStatus>();
        if (hubs.length === 0) {
            return result;
        }
        if (hubs.length === 1) {
            const data = await this.getDeviceStatus(hubs[0].mid);
            result.set(hubs[0].mid, this.extractSingleHubStatus(data));
            return result;
        }

        const response = await this.request<MultipleDeviceStatusRaw[]>('POST', '/app/device/multipleDeviceStatus', {
            devices: hubs,
        });
        for (const multi of response.data || []) {
            result.set(asString(multi.mid), this.extractParams(multi.status || [], null, true));
        }
        return result;
    }

    private extractSingleHubStatus(data: DeviceStatusRaw): HubStatus {
        return this.extractParams(data.subDeviceStatus || [], data.state || null, data.connected !== '0');
    }

    private extractParams(status: StatusParam[], state: string | null, fallbackOnline: boolean): HubStatus {
        const byAddr = new Map<number, string>();
        let resolvedState = state;
        let online = fallbackOnline;
        for (const param of status) {
            if (param.id === 'state' || param.id === 'State') {
                resolvedState = param.value;
                continue;
            }
            if (param.id === 'connected') {
                online = param.value !== '0';
                continue;
            }
            if (param.id?.startsWith('D') && param.value) {
                const addr = parseInt(param.id.substring(1), 10);
                if (!Number.isNaN(addr)) {
                    byAddr.set(addr, param.value);
                }
            }
        }
        return {
            online: online || byAddr.size > 0 || resolvedState != null,
            byAddr,
            state: resolvedState,
        };
    }

    private async getDeviceStatus(mid: string): Promise<DeviceStatusRaw> {
        const response = await this.request<DeviceStatusRaw>(
            'GET',
            `/app/device/getDeviceStatus?mid=${encodeURIComponent(mid)}`,
        );
        return response.data;
    }

    private async ensureAuthenticated(): Promise<void> {
        if (Date.now() >= this.tokenExpired - 5 * 60 * 1000) {
            await this.refreshAccessToken();
        }
    }

    private async refreshAccessToken(): Promise<void> {
        try {
            const response = await this.request<LoginData>(
                'POST',
                '/app/refreshToken',
                { refreshToken: this.refreshTokenValue },
                false,
            );
            this.token = response.data.token;
            this.refreshTokenValue = response.data.refreshToken;
            this.tokenExpired = response.ts + response.data.tokenExpired * 1000;
            this.log.debug('Refreshed HomGar/RainPoint access token');
        } catch (error) {
            this.log.warn(`Token refresh failed (${(error as Error).message}), logging in again`);
            await this.login();
        }
    }

    private async request<T>(
        method: string,
        path: string,
        body?: unknown,
        requireAuth = true,
        retried = false,
    ): Promise<BaseResponse<T>> {
        if (requireAuth) {
            await this.ensureAuthenticated();
        }

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            lang: 'en',
            version: API_VERSION,
            appCode: this.appCode,
            sceneType: SCENE_TYPE,
        };
        if (requireAuth && this.token) {
            headers.auth = this.token;
        }

        const url = new URL(path, `${this.baseUrl}/`);
        const payload = body ? JSON.stringify(body) : undefined;
        this.log.debug(`${method} ${url.toString()}`);

        const parsed = await this.httpsJson<T>(method, url, headers, payload);
        if (parsed.code !== 0) {
            if (REAUTH_CODES.has(parsed.code) && requireAuth && !retried) {
                this.log.warn(`API returned ${parsed.code} (${parsed.msg}) — re-authenticating`);
                this.token = '';
                this.tokenExpired = 0;
                await this.login();
                return this.request<T>(method, path, body, requireAuth, true);
            }
            throw new HomgarApiError(parsed.code, parsed.msg);
        }
        return parsed;
    }

    private httpsJson<T>(
        method: string,
        url: URL,
        headers: Record<string, string>,
        payload?: string,
    ): Promise<BaseResponse<T>> {
        return new Promise((resolve, reject) => {
            const req = https.request(
                {
                    hostname: url.hostname,
                    port: url.port || 443,
                    path: `${url.pathname}${url.search}`,
                    method,
                    headers,
                    timeout: 20000,
                },
                res => {
                    const chunks: Buffer[] = [];
                    res.on('data', chunk => chunks.push(chunk as Buffer));
                    res.on('end', () => {
                        const data = Buffer.concat(chunks).toString('utf8');
                        try {
                            resolve(JSON.parse(data) as BaseResponse<T>);
                        } catch (error) {
                            reject(new Error(`Failed to parse API response: ${(error as Error).message}`));
                        }
                    });
                },
            );
            req.on('error', error => reject(new Error(`HTTP request failed: ${error.message}`)));
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timed out'));
            });
            if (payload) {
                req.write(payload);
            }
            req.end();
        });
    }
}
