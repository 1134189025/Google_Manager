/**
 * 账号独立浏览器相关的展示工具
 */

/** 字节数转为易读文本（B / KB / MB / GB） */
export const formatBytes = (bytes) => {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    const scaled = value / 1024 ** exponent;
    const digits = exponent === 0 || scaled >= 100 ? 0 : 1;
    return `${scaled.toFixed(digits)} ${units[exponent]}`;
};

/** 清理缓存结果的提示文案 */
export const describeClearCacheResult = (result) => {
    const cleared = Number(result?.cleared) || 0;
    const skipped = Number(result?.skippedRunning) || 0;
    if (cleared === 0 && skipped === 0) return '没有可清理的浏览器配置';

    const parts = [];
    if (cleared > 0) parts.push(`已清理 ${cleared} 个配置，释放 ${formatBytes(result?.freedBytes)}`);
    if (skipped > 0) parts.push(`跳过运行中 ${skipped} 个`);
    return parts.join('，');
};
