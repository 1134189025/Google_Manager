export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
export const APP_BUILD_TIME = typeof __APP_BUILD_TIME__ !== 'undefined' ? __APP_BUILD_TIME__ : '';
export const APP_COMMIT_SHA = typeof __APP_COMMIT_SHA__ !== 'undefined' ? __APP_COMMIT_SHA__ : '';

export const buildVersionLabel = APP_COMMIT_SHA
    ? `v${APP_VERSION} (${APP_COMMIT_SHA})`
    : `v${APP_VERSION}`;

export const formatBuildTime = (value) => {
    if (!value) return '未知';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).format(parsed).replace(/\//g, '-');
};
