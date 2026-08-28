export type AppType = 'rainpoint' | 'homgar';

export interface ApiConfig {
    email: string;
    password: string;
    areaCode: string;
    region: string;
    appType: AppType;
}

export interface HomeInfo {
    id: string;
    name: string;
}

export type DeviceKind = 'valve' | 'sensor' | 'hub' | 'gateway' | 'unknown';

export interface DeviceInfo {
    id: string;
    name: string;
    model: string;
    productKey: string;
    deviceName: string;
    online: boolean;
    portNumber: number;
    zoneNames: string[];
    kind: DeviceKind;
    isSubDevice: boolean;
    parentId?: string;
    addr: number;
    firmware?: string;
}

export interface ZoneStatus {
    port: number;
    name: string;
    isOn: boolean;
    remainingSeconds: number;
}

export interface DeviceStatus {
    deviceId: string;
    online: boolean;
    zones: ZoneStatus[];
    moisture: number | null;
    temperature: number | null;
    humidity: number | null;
    battery: number | null;
    illuminance: number | null;
    pressure: number | null;
    rssi: number | null;
    rainTotalMm: number | null;
    rainHourMm: number | null;
    rainDailyMm: number | null;
    rainWeekMm: number | null;
    rawPayload: string | null;
}

export interface DecodedValveZone {
    open: boolean;
    durationSeconds: number;
}

export interface DecodedValve {
    hubOnline: boolean | null;
    zones: Map<number, DecodedValveZone>;
}

export interface DecodedSensor {
    moisture: number | null;
    temperature: number | null;
    humidity: number | null;
    battery: number | null;
    illuminance: number | null;
    pressure: number | null;
    rssi: number | null;
    rainTotalMm: number | null;
    rainHourMm: number | null;
    rainDailyMm: number | null;
    rainWeekMm: number | null;
}

export class HomgarApiError extends Error {
    public readonly code: number;
    public readonly retryAfterSeconds?: number;

    public constructor(code: number, message: string, retryAfterSeconds?: number) {
        super(`API error ${code}: ${message}`);
        this.name = 'HomgarApiError';
        this.code = code;
        this.retryAfterSeconds = retryAfterSeconds;
    }
}
