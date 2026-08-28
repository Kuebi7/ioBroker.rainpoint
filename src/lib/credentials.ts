import type { AppType } from './types';

export function normalizeEmail(value: string): string {
    return String(value || '')
        .trim()
        .toLowerCase();
}

export function normalizePassword(value: string): string {
    return String(value || '').trim();
}

export function normalizeAreaCode(value: string): string {
    let code = String(value || '49').trim();
    if (code.startsWith('+')) {
        code = code.slice(1);
    }
    if (code.startsWith('00')) {
        code = code.slice(2);
    }
    code = code.replace(/\D/g, '');
    return code || '49';
}

export function appCodeForType(appType: AppType): string {
    return appType === 'homgar' ? '1' : '2';
}

export function looksEncrypted(password: string): boolean {
    return password.startsWith('$/') || password.startsWith('$/secret') || /aes-\d+-cbc/i.test(password);
}
