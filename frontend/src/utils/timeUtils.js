/**
 * 数据库时间戳工具
 *
 * created_at / updated_at / deleted_at / changed_at 都由 SQLite 的 CURRENT_TIMESTAMP 写入，
 * 是 UTC 的 `YYYY-MM-DD HH:MM:SS`（不带时区）。界面显示前要换算成本机时间，
 * 否则在东八区会比实际早 8 小时。
 */

const DB_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

const pad = (value) => String(value).padStart(2, '0');

/**
 * 把数据库 UTC 时间戳格式化为本机时间 `YYYY-MM-DD HH:MM:SS`
 * 空值返回 ''；不是数据库时间戳格式（例如只有日期）时原样返回
 * @param {unknown} value
 * @returns {string}
 */
export const formatDbTimestamp = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return '';

    const match = raw.match(DB_TIMESTAMP_PATTERN);
    if (!match) return raw;

    const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    if (Number.isNaN(date.getTime())) return raw;

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
        + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};
