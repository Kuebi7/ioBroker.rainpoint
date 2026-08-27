import type { DecodedSensor, DecodedValve, DecodedValveZone } from './types';
import { fahrenheitTenthsToCelsius } from './devices';

const TYPE_WIDTHS: Record<number, number> = {
    0xd8: 1,
    0xdc: 1,
    0xad: 2,
    0x20: 2,
    0xe1: 2,
    0xb7: 4,
    0x9f: 4,
    0xc4: 1,
    0xc5: 1,
    0xc6: 1,
};

const BATTERY_MAP: Record<number, number> = {
    0x0fff: 100,
    0x0ffe: 90,
    0x0ffd: 80,
    0x0ffc: 70,
    0x0ffb: 60,
    0x0ffa: 50,
    0x0ff9: 40,
    0x0ff8: 30,
    0x0ff7: 20,
    0x0ff6: 10,
};

const HUB_STATE_DP = 0x18;
const ZONE_DURATION_DP_BASE = 0x24;
const MAX_ZONES = 8;

const MOISTURE_SIMPLE_MODELS = new Set(['HCS026FRF', 'HCS005FRF', 'HCS003FRF']);
const MOISTURE_FULL_MODELS = new Set([
    'HCS021FRF',
    'HCS024FRF-V1',
    'HCS666FRF',
    'HCS666RFR-P',
    'HCS999FRF',
    'HCS999FRF-P',
    'HCS666FRF-X',
    'HCS044FRF',
]);

interface TlvEntry {
    type: number;
    value: number;
}

function emptySensor(): DecodedSensor {
    return {
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
    };
}

function hexToBytes(hex: string): number[] {
    const out: number[] = [];
    for (let i = 0; i < hex.length; i += 2) {
        out.push(parseInt(hex.substring(i, i + 2), 16));
    }
    return out;
}

function parsePayloadBytes(raw: string): number[] {
    const idx = raw.indexOf('#');
    if (idx < 0) {
        throw new Error(`Payload missing '#' separator: ${raw}`);
    }
    return hexToBytes(raw.substring(idx + 1));
}

function parseDpMap(bytes: number[]): Map<number, TlvEntry> {
    const map = new Map<number, TlvEntry>();
    let i = 0;
    while (i < bytes.length - 1) {
        const dpId = bytes[i];
        const typeByte = bytes[i + 1];
        const width = TYPE_WIDTHS[typeByte];
        if (width === undefined) {
            i += 1;
            continue;
        }
        if (i + 2 + width > bytes.length) {
            break;
        }
        let value = 0;
        if (typeByte === 0xad) {
            for (let k = 0; k < width; k++) {
                value |= bytes[i + 2 + k] << (8 * k);
            }
        } else {
            for (let k = 0; k < width; k++) {
                value = (value << 8) | bytes[i + 2 + k];
            }
        }
        map.set(dpId, { type: typeByte, value });
        i += 2 + width;
    }
    return map;
}

function le16(bytes: number[], offset: number): number {
    return (bytes[offset] | (bytes[offset + 1] << 8)) & 0xffff;
}

function signed8(bytes: number[], offset: number): number {
    const value = bytes[offset];
    return value < 128 ? value : value - 256;
}

function statusCodeAt(bytes: number[], off: number, off2: number): number {
    return (bytes[off] | (bytes[off2] << 8)) & 0xffff;
}

function batteryFromStatus(code: number): number | null {
    return code in BATTERY_MAP ? BATTERY_MAP[code] : null;
}

function isHexPayload(raw: string): boolean {
    return raw.startsWith('10#') || raw.startsWith('11#');
}

function isAsciiPayload(raw: string): boolean {
    return raw.includes(',') && (raw.includes(';') || raw.includes('|') || raw.includes('='));
}

function parseRssiFromAscii(raw: string): number | null {
    const semi = raw.indexOf(';');
    if (semi < 0) {
        return null;
    }
    const general = raw.substring(0, semi).split(',');
    if (general.length < 2) {
        return null;
    }
    const rssi = parseInt(general[1], 10);
    return Number.isNaN(rssi) ? null : rssi;
}

function parseStatsValue(token: string): [number, number, number, number] | null {
    const match = /^(\d+)\((\d+)\/(\d+)\/(\d+)\)/.exec(token.trim());
    if (!match) {
        return null;
    }
    return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
}

export function decodeValve(raw: string): DecodedValve {
    try {
        if (isHexPayload(raw)) {
            const bytes = parsePayloadBytes(raw);
            const dpMap = parseDpMap(bytes);
            const hubEntry = dpMap.get(HUB_STATE_DP);
            let hubOnline: boolean | null = null;
            if (hubEntry && hubEntry.type === 0xdc) {
                hubOnline = hubEntry.value === 0x01;
            }
            const zones = new Map<number, DecodedValveZone>();
            for (let n = 1; n <= MAX_ZONES; n++) {
                const stateEntry = dpMap.get(HUB_STATE_DP + n);
                if (!stateEntry || stateEntry.type !== 0xd8) {
                    continue;
                }
                const open = (stateEntry.value & 0x01) === 0x01;
                let durationSeconds = 0;
                const durEntry = dpMap.get(ZONE_DURATION_DP_BASE + n);
                if (durEntry && durEntry.type === 0xad) {
                    durationSeconds = durEntry.value;
                }
                zones.set(n, { open, durationSeconds });
            }
            return { hubOnline, zones };
        }
        if (isAsciiPayload(raw)) {
            return decodeValveAscii(raw);
        }
    } catch {
        // fall through
    }
    return { hubOnline: null, zones: new Map() };
}

function decodeValveAscii(raw: string): DecodedValve {
    const zones = new Map<number, DecodedValveZone>();
    const semi = raw.indexOf(';');
    if (semi < 0) {
        return { hubOnline: true, zones };
    }
    const zonePart = raw.substring(semi + 1);
    let n = 1;
    for (const section of zonePart.split('|')) {
        const parts = section.split(',');
        if (parts.length < 1) {
            continue;
        }
        const wkRaw = parseInt(parts[0], 10);
        if (Number.isNaN(wkRaw)) {
            continue;
        }
        const workMode = wkRaw & 0x0f;
        const open = workMode !== 0;
        let durationSeconds = 0;
        if (parts.length > 1 && open) {
            const durationMin = parseInt(parts[1], 10);
            if (!Number.isNaN(durationMin)) {
                durationSeconds = durationMin * 60;
            }
        }
        zones.set(n, { open, durationSeconds });
        n++;
    }
    return { hubOnline: true, zones };
}

function decodeMoistureSimple(raw: string): DecodedSensor {
    const result = emptySensor();
    const bytes = parsePayloadBytes(raw);
    if (bytes.length < 9) {
        return result;
    }
    result.moisture = bytes[6]!;
    result.battery = batteryFromStatus(statusCodeAt(bytes, 7, 8));
    result.rssi = bytes.length > 1 ? signed8(bytes, 1) : null;
    return result;
}

function decodeMoistureFull(raw: string): DecodedSensor {
    const result = emptySensor();
    const bytes = parsePayloadBytes(raw);
    if (bytes.length < 16) {
        return decodeMoistureSimple(raw);
    }
    result.temperature = fahrenheitTenthsToCelsius(le16(bytes, 6));
    result.moisture = bytes[9]!;
    result.illuminance = Math.round(le16(bytes, 11) * 0.1 * 10) / 10;
    result.battery = batteryFromStatus(statusCodeAt(bytes, 14, 15));
    result.rssi = signed8(bytes, 1);
    return result;
}

function decodeRainHex(raw: string): DecodedSensor {
    const result = emptySensor();
    const bytes = parsePayloadBytes(raw);
    if (bytes.length >= 24) {
        result.battery = batteryFromStatus(statusCodeAt(bytes, 22, 23));
    }
    return result;
}

function decodeRainAscii(raw: string): DecodedSensor {
    const result = emptySensor();
    result.rssi = parseRssiFromAscii(raw);
    const semi = raw.indexOf(';');
    const body = semi >= 0 ? raw.substring(semi + 1) : raw;
    const rainToken = body
        .split(',')
        .map(part => part.trim())
        .find(part => part.startsWith('R='));
    if (!rainToken) {
        return result;
    }
    const stats = parseStatsValue(rainToken.substring(2));
    if (!stats) {
        return result;
    }
    result.rainTotalMm = stats[0] / 10;
    result.rainHourMm = stats[1] / 10;
    result.rainDailyMm = stats[2] / 10;
    result.rainWeekMm = stats[3] / 10;
    return result;
}

function decodeDisplayHub(raw: string): DecodedSensor {
    const result = emptySensor();
    result.rssi = parseRssiFromAscii(raw);
    const semi = raw.indexOf(';');
    if (semi < 0) {
        return result;
    }
    for (const item of raw.substring(semi + 1).split(',')) {
        const token = item.trim();
        if (!token) {
            continue;
        }
        const head = token.split('(')[0].trim();
        if (head.startsWith('P=')) {
            const pressure = parseInt(head.substring(2), 10);
            if (!Number.isNaN(pressure)) {
                result.pressure = pressure;
            }
            continue;
        }
        if (result.temperature === null) {
            const tempF10 = parseInt(head, 10);
            if (!Number.isNaN(tempF10)) {
                result.temperature = fahrenheitTenthsToCelsius(tempF10);
            }
        } else if (result.humidity === null) {
            const humidity = parseInt(head, 10);
            if (!Number.isNaN(humidity)) {
                result.humidity = humidity;
            }
        }
    }
    return result;
}

function decodeMoistureFullAscii(raw: string): DecodedSensor {
    const result = emptySensor();
    result.rssi = parseRssiFromAscii(raw);
    const semi = raw.indexOf(';');
    if (semi < 0) {
        return result;
    }
    const parts = raw.substring(semi + 1).split(',');
    if (parts.length < 2) {
        return result;
    }
    const tempRawF10 = parseInt(parts[0], 10);
    const moisture = parseInt(parts[1], 10);
    result.temperature = Number.isNaN(tempRawF10) ? null : fahrenheitTenthsToCelsius(tempRawF10);
    result.moisture = Number.isNaN(moisture) ? null : moisture;
    const light = parts.find(part => part.trim().startsWith('G='));
    if (light) {
        const luxTenths = parseInt(light.trim().substring(2), 10);
        if (!Number.isNaN(luxTenths)) {
            result.illuminance = Math.round(luxTenths) / 10;
        }
    }
    return result;
}

export function decodeSensor(raw: string, model: string): DecodedSensor {
    try {
        if (model === 'HCS012ARF' || model.startsWith('HCS012')) {
            if (isAsciiPayload(raw)) {
                return decodeRainAscii(raw);
            }
            return decodeRainHex(raw);
        }
        if (model.startsWith('HWS') && isAsciiPayload(raw)) {
            return decodeDisplayHub(raw);
        }
        if (MOISTURE_SIMPLE_MODELS.has(model) && isHexPayload(raw)) {
            return decodeMoistureSimple(raw);
        }
        if (MOISTURE_FULL_MODELS.has(model) && isHexPayload(raw)) {
            return decodeMoistureFull(raw);
        }
        if (isHexPayload(raw)) {
            const full = decodeMoistureFull(raw);
            if (full.moisture !== null || full.temperature !== null || full.battery !== null) {
                return full;
            }
            return decodeMoistureSimple(raw);
        }
        if (isAsciiPayload(raw)) {
            if (raw.includes('R=')) {
                return decodeRainAscii(raw);
            }
            if (raw.includes('P=')) {
                return decodeDisplayHub(raw);
            }
            return decodeMoistureFullAscii(raw);
        }
    } catch {
        // fall through
    }
    return emptySensor();
}
