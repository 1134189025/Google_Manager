/**
 * 费用与续费 / 备忘提醒工具函数
 *
 * 日历日统一使用本地 YYYY-MM-DD 字符串，避免 UTC 换算跨天偏移。
 */

const pad = (n) => String(n).padStart(2, '0');

export const DATE_INPUT_MIN = '1970-01-01';
export const DATE_INPUT_MAX = '2099-12-31';
export const DEFAULT_USD_CNY_RATE = 7.25;

/**
 * 约束原生 <input type="date"> 返回值：截断 Chromium/WebView2 允许输入的 5~6 位年份为 4 位，
 * 并将年份限制在 1970..2099 合理区间内，避免出现 202612-12-04 这类异常年份。
 */
export function clampDateInputValue(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    const match = trimmed.match(/^(\d+)-(\d{2})-(\d{2})$/);
    if (!match) return trimmed;
    let yearStr = match[1];
    if (yearStr.length > 4) {
        yearStr = yearStr.slice(0, 4);
    }
    const yearNum = Number(yearStr);
    if (!Number.isFinite(yearNum)) return '';
    const clampedYear = yearStr.length === 4 ? Math.min(2099, Math.max(1970, yearNum)) : yearNum;
    return `${String(clampedYear).padStart(4, '0')}-${match[2]}-${match[3]}`;
}

export function normalizeFxRate(rate) {
    const n = Number(rate);
    if (!Number.isFinite(n) || n < 4 || n > 15) return DEFAULT_USD_CNY_RATE;
    return Math.round(n * 10000) / 10000;
}

export function convertToCny(amount, currency = 'USD', usdCnyRate = DEFAULT_USD_CNY_RATE) {
    const num = Number(amount);
    if (!Number.isFinite(num)) return null;
    if (String(currency || 'USD').toUpperCase() === 'CNY') {
        return Math.round(num * 100) / 100;
    }
    const rate = normalizeFxRate(usdCnyRate);
    return Math.round(num * rate * 100) / 100;
}

export function formatCnyAmount(amount) {
    if (typeof amount !== 'number' || !Number.isFinite(amount)) return '-';
    return `¥${amount.toFixed(2)}`;
}

/**
 * 将后端返回的 USD + CNY 双币种汇总统一折算为单人民币结算指标
 */
export function computeUnifiedCnySpend(spend, usdCnyRate = DEFAULT_USD_CNY_RATE) {
    const rate = normalizeFxRate(usdCnyRate);
    const cny = spend?.cny || { monthly: 0, yearly: 0, once: 0, count: 0 };
    const usd = spend?.usd || { monthly: 0, yearly: 0, once: 0, count: 0 };
    const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

    const cnyMonthly = round2(cny.monthly);
    const cnyYearly = round2(cny.yearly);
    const cnyOnce = round2(cny.once);

    const usdMonthly = round2(usd.monthly);
    const usdYearly = round2(usd.yearly);
    const usdOnce = round2(usd.once);

    const usdMonthlyInCny = round2(usdMonthly * rate);
    const usdYearlyInCny = round2(usdYearly * rate);
    const usdOnceInCny = round2(usdOnce * rate);

    return {
        rate,
        monthlyCny: round2(cnyMonthly + usdMonthlyInCny),
        yearlyCny: round2(cnyYearly + usdYearlyInCny),
        onceCny: round2(cnyOnce + usdOnceInCny),
        cnyMonthly,
        cnyYearly,
        cnyOnce,
        cnyCount: Number(cny.count || 0),
        usdMonthly,
        usdYearly,
        usdOnce,
        usdMonthlyInCny,
        usdYearlyInCny,
        usdCount: Number(usd.count || 0),
        totalPricedCount: Number(cny.count || 0) + Number(usd.count || 0),
        unpricedCount: Number(spend?.unpriced || 0),
    };
}

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
