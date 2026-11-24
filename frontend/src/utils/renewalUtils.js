/**
 * 费用与续费 / 备忘提醒工具函数
 *
 * 日历日统一使用本地 YYYY-MM-DD 字符串，避免 UTC 换算跨天偏移。
 */

const pad = (n) => String(n).padStart(2, '0');

export function localTodayDay(now = new Date()) {
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function calendarDay(value) {
    if (typeof value !== 'string' || !value.trim()) return '';
    const text = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        const ms = Date.parse(`${text}T00:00:00Z`);
        return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === text ? text : '';
    }
    const ms = Date.parse(text);
    if (!Number.isFinite(ms)) return '';
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function daysUntilDay(day, now = new Date()) {
    const normalized = calendarDay(day);
    if (!normalized) return null;
    const [y, m, d] = normalized.split('-').map(Number);
    const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((Date.UTC(y, m - 1, d) - todayUtc) / 86_400_000);
}

export function shiftDay(day, repeat) {
    const normalized = calendarDay(day);
    if (!normalized) return '';
    const [y, m, d] = normalized.split('-').map(Number);
    if (repeat === 'week') {
        const dt = new Date(Date.UTC(y, m - 1, d + 7));
        return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
    }
    const months = repeat === 'year' ? 12 : 1;
    const idx = y * 12 + (m - 1) + months;
    const ny = Math.floor(idx / 12);
    const nm = idx % 12;
    const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
    return `${ny}-${pad(nm + 1)}-${pad(Math.min(d, lastDay))}`;
}

export function formatMoney(amount, currency = 'USD') {
    if (typeof amount !== 'number' || !Number.isFinite(amount)) return '-';
    const symbol = currency === 'CNY' ? '¥' : '$';
    return `${symbol}${amount.toFixed(2)}`;
}

export function formatCycleLabel(cycle) {
    if (cycle === 'month') return '月付';
    if (cycle === 'year') return '年付';
    if (cycle === 'once') return '一次性';
    return cycle || '-';
}

export function formatRepeatLabel(repeat) {
    if (repeat === 'week') return '每周';
    if (repeat === 'month') return '每月';
    if (repeat === 'year') return '每年';
    return '不重复';
}

export function formatKindLabel(kind) {
    switch (kind) {
        case 'server':
            return '服务器';
        case 'domain':
            return '域名';
        case 'ai_subscription':
            return 'AI 订阅';
        case 'payment_card':
            return '支付卡';
        default:
            return '资产';
    }
}

export function formatDaysBadge(days) {
    if (typeof days !== 'number' || !Number.isFinite(days)) return { text: '-', tone: 'muted' };
    if (days < 0) return { text: `已过期 ${Math.abs(days)} 天`, tone: 'danger' };
    if (days === 0) return { text: '今天到期', tone: 'danger' };
    if (days <= 7) return { text: `${days} 天后`, tone: 'warning' };
    if (days <= 30) return { text: `${days} 天后`, tone: 'accent' };
    return { text: `${days} 天后`, tone: 'muted' };
}

function escapeIcsText(value) {
    return String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r?\n/g, '\\n');
}

function nextIcsDay(day) {
    const [y, m, d] = day.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + 1));
    return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}`;
}

/**
 * 生成标准 RFC 5545 .ics 日历文件（全天事件，包含资产续费与未完成备忘）
 */
export function buildRenewalsIcs(timeline = [], reminders = [], now = new Date()) {
    const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//GoogleManager//Renewals//ZH',
        'CALSCALE:GREGORIAN',
    ];

    for (const item of timeline) {
        const day = calendarDay(item?.date);
        if (!day) continue;
        const start = day.replace(/-/g, '');
        const end = nextIcsDay(day);
        const price = typeof item.billingAmount === 'number'
            ? ` (${formatMoney(item.billingAmount, item.billingCurrency)}/${formatCycleLabel(item.billingCycle)})`
            : '';
        lines.push(
            'BEGIN:VEVENT',
            `UID:gm-renewal-${item.kind}-${item.id}-${start}@googlemanager.local`,
            `DTSTAMP:${stamp}`,
            `DTSTART;VALUE=DATE:${start}`,
            `DTEND;VALUE=DATE:${end}`,
            `SUMMARY:${escapeIcsText(`[${formatKindLabel(item.kind)}] ${item.name}${price}`)}`,
            ...(item.subtitle ? [`DESCRIPTION:${escapeIcsText(item.subtitle)}`] : []),
            'END:VEVENT',
        );
    }

    for (const rem of reminders) {
        if (rem?.done) continue;
        const day = calendarDay(rem?.dueAt);
        if (!day) continue;
        const start = day.replace(/-/g, '');
        const end = nextIcsDay(day);
        lines.push(
            'BEGIN:VEVENT',
            `UID:gm-reminder-${rem.id}-${start}@googlemanager.local`,
            `DTSTAMP:${stamp}`,
            `DTSTART;VALUE=DATE:${start}`,
            `DTEND;VALUE=DATE:${end}`,
            `SUMMARY:${escapeIcsText(`[备忘] ${rem.title}`)}`,
            ...(rem.note ? [`DESCRIPTION:${escapeIcsText(rem.note)}`] : []),
            'END:VEVENT',
        );
    }

    lines.push('END:VCALENDAR');
    return `${lines.join('\r\n')}\r\n`;
}
