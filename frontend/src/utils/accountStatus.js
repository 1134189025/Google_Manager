/**
 * 谷歌账号等级 / 状态统一定义
 * - inactive   -> 普通
 * - pro        -> Pro
 * - ultra_lite -> Ultra Lite
 * - ultra      -> Ultra
 */

export const ACCOUNT_STATUS_OPTIONS = [
    { value: 'inactive', label: '普通', rank: 0 },
    { value: 'pro', label: 'Pro', rank: 1 },
    { value: 'ultra_lite', label: 'Ultra Lite', rank: 2 },
    { value: 'ultra', label: 'Ultra', rank: 3 },
];

export const ACCOUNT_STATUS_RANK = {
    inactive: 0,
    pro: 1,
    ultra_lite: 2,
    ultra: 3,
};

const STATUS_META = {
    inactive: {
        value: 'inactive',
        label: '普通',
        rank: 0,
        isPaid: false,
        badgeClass: 'gm-badge-off',
        signalClass: '',
        chipTone: '',
    },
    pro: {
        value: 'pro',
        label: 'Pro',
        rank: 1,
        isPaid: true,
        badgeClass: 'gm-badge-on on',
        signalClass: 'is-pro pro',
        chipTone: 'accent',
    },
    ultra_lite: {
        value: 'ultra_lite',
        label: 'Ultra Lite',
        rank: 2,
        isPaid: true,
        badgeClass: 'gm-badge-ultra-lite',
        signalClass: 'is-ultra-lite ultra-lite',
        chipTone: 'ultra-lite',
    },
    ultra: {
        value: 'ultra',
        label: 'Ultra',
        rank: 3,
        isPaid: true,
        badgeClass: 'gm-badge-ultra',
        signalClass: 'is-ultra ultra',
        chipTone: 'ultra',
    },
};

export function normalizeAccountStatus(status) {
    const raw = String(status || '').trim().toLowerCase();
    if (raw === 'pro') return 'pro';
    if (raw === 'ultra_lite' || raw === 'ultralite' || raw === 'ultra lite' || raw === 'ultra-lite') {
        return 'ultra_lite';
    }
    if (raw === 'ultra') return 'ultra';
    return 'inactive';
}

export function getAccountStatusMeta(status) {
    return STATUS_META[normalizeAccountStatus(status)] || STATUS_META.inactive;
}

export function formatAccountStatusLabel(status) {
    if (status == null || status === '') return status;
    const raw = String(status).trim().toLowerCase();
    if (raw === 'inactive' || raw === 'pro' || raw === 'ultra_lite' || raw === 'ultra') {
        return STATUS_META[raw].label;
    }
    return status;
}

export function getNextAccountStatus(status) {
    const current = normalizeAccountStatus(status);
    const idx = ACCOUNT_STATUS_OPTIONS.findIndex(item => item.value === current);
    const next = ACCOUNT_STATUS_OPTIONS[(idx + 1) % ACCOUNT_STATUS_OPTIONS.length];
    return next.value;
}

export function isPaidAccountStatus(status) {
    return getAccountStatusMeta(status).isPaid;
}
