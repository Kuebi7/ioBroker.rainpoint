import type { DeviceKind } from './types';

export function getModelPrefix(model: string): string {
    return model.replace(/[\d_]+.*/, '').toUpperCase();
}

export function getDeviceKind(model: string, hasSubDevices = false): DeviceKind {
    const prefix = getModelPrefix(model);
    if (prefix.startsWith('HWG')) {
        return 'gateway';
    }
    // HIS019 is the RainPoint WLAN hub; other HIS models can be standalone timers.
    if (prefix.startsWith('HIS') && hasSubDevices) {
        return 'gateway';
    }
    if (
        prefix.startsWith('HTV') ||
        prefix.startsWith('HCC') ||
        prefix.startsWith('HIS') ||
        prefix.startsWith('HIC') ||
        prefix.startsWith('HTP')
    ) {
        return 'valve';
    }
    if (prefix.startsWith('HCS')) {
        return 'sensor';
    }
    if (prefix.startsWith('HWS')) {
        return 'hub';
    }
    return 'unknown';
}

export function isValveKind(kind: DeviceKind): boolean {
    return kind === 'valve';
}

export function sanitizeId(value: string): string {
    const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, '_');
    return cleaned || 'device';
}

export function parseZoneNames(portDescribe: string | undefined, portNumber: number): string[] {
    const count = Math.max(portNumber || 1, 1);
    if (!portDescribe) {
        return Array.from({ length: count }, (_, i) => `Zone ${i + 1}`);
    }
    const parts = portDescribe.split('|');
    return Array.from({ length: count }, (_, i) => parts[i]?.trim() || `Zone ${i + 1}`);
}

export function fahrenheitTenthsToCelsius(value: number): number {
    return Math.round((((value / 10 - 32) * 5) / 9) * 10) / 10;
}
