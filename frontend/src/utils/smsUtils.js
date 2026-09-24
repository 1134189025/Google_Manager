/**
 * 手机接码地址工具模块（纯函数，无副作用，可被单元测试直接 import）
 *
 * 约定（与后端 `fetch_sms_code` 契约一致）：
 * - 接码地址必须是 https 链接，形如
 *   https://sms6688.com/api/sms/recordText?token=<令牌>&tpl=1
 * - URL 的查询参数（token、tpl 等）必须原样保留，不能被截断；
 *   这段文本也不能参与手机号 / 注册年份 / 2FA 密钥的猜测；
 * - 表格、预览等界面只暴露 host，绝不返回 token 或完整地址；
 * - 仅日志 / 错误提示使用脱敏后的地址（maskSmsUrl）。
 */

import { normalizePhoneNumber } from './phoneUtils';

// URL 中允许出现的字符：RFC 3986 的 unreserved + reserved + 百分号编码。
// 不含 `|`：竖线既是导入格式的分隔符，也可能出现在查询串里，
// 因此单列一条「查询参数续段」规则 —— 只有 `|key=value` 形式才并进 URL，
// 这样 `...?b=1|c=2` 不会被截断，而 `...|India` / `...|2019` 仍按分隔符处理。
const URL_BASE_CHAR_CLASS = 'A-Za-z0-9\\-._~:/?#\\[\\]@!$&*+,;=%';
const URL_PIPE_SEGMENT_SOURCE = '\\|[A-Za-z0-9_.\\-\\[\\]]+=[^|&#\\s]*';
const URL_TOKEN_SOURCE = `https?:\\/\\/[${URL_BASE_CHAR_CLASS}]+(?:${URL_PIPE_SEGMENT_SOURCE})*`;

// 紧贴在 URL 前的字段分隔符（用于把 `号码|URL` 识别成一个整体字段）
const SEPARATOR_TAIL_PATTERN = /(?:\s*(?:\||----|——|---|--)\s*)$/;

// URL 占位符：拆分 / 字段识别期间用它替换真实 URL，避免 token、`|`、数字干扰解析
const URL_PLACEHOLDER_PREFIX = '\u0000URL';
const URL_PLACEHOLDER_SUFFIX = '\u0000';
const URL_PLACEHOLDER_FULL_SOURCE = '\\u0000URL(\\d+)\\u0000';
const URL_PLACEHOLDER_PREFIX_SOURCE = '\\u0000URL(\\d+)';

// 包裹在 URL 外的引号 / 尖括号（含中文引号），粘贴时常见
const WRAPPING_CHARS = ['"', '\'', '`', '<', '>', '“', '”', '‘', '’', '「', '」', '『', '』'];
// 粘贴时常见的中文 / 英文句读后缀
const TRAILING_PUNCTUATION = ['。', '，', '；', ',', ';'];

// 需要脱敏的查询参数名（小写比较）
const SENSITIVE_QUERY_NAMES = new Set([
    'token',
    'access_token',
    'accesstoken',
    'api_key',
    'apikey',
    'key',
    'secret',
    'password',
    'passwd',
    'pwd',
    'auth',
    'authorization',
    'refresh_token',
    'sign',
    'signature',
    'session',
    'sid',
]);

/**
 * 通用 URL 正则（含查询串），用于在任意文本中提取 / 保护 http(s) 链接。
 * 注意：带 g 标志，调用方请使用 String.match / String.replace，不要长期复用 lastIndex。
 */
export const SMS_URL_PATTERN = new RegExp(URL_TOKEN_SOURCE, 'gi');

// 已知接码服务特征：host 含 sms6688，或路径像 /api/sms/recordText
export const SMS_URL_HINT_PATTERN = /(sms6688|api\/sms\/recordtext|\/sms\/)/i;

const toRawString = (value) => String(value === null || value === undefined ? '' : value);

const normalizePhoneNumberSafe = (value) => {
    try {
        return normalizePhoneNumber(value) || '';
    } catch {
        return '';
    }
};

/** 去掉包裹 URL 的引号 / 尖括号与结尾句读 */
const stripWrapping = (value) => {
    let result = toRawString(value).trim();
    if (!result) return '';

    let changed = true;
    while (changed && result) {
        changed = false;
        for (const char of WRAPPING_CHARS) {
            if (result.startsWith(char) && result.length > char.length) {
                result = result.slice(char.length).trim();
                changed = true;
            }
            if (result.endsWith(char) && result.length > char.length) {
                result = result.slice(0, result.length - char.length).trim();
                changed = true;
            }
        }
    }

    for (const char of TRAILING_PUNCTUATION) {
        while (result.endsWith(char) && result.length > char.length) {
            result = result.slice(0, result.length - char.length).trim();
        }
    }

    return result;
};

/**
 * 规范化用户输入的接码地址
 * trim → 去掉包裹的引号 / 尖括号 → 校验必须是 https 且带 host；非法返回 ''
 * @param {unknown} value
 * @returns {string} 合法 https 地址（原样保留查询串），非法则为 ''
 */
export const normalizeSmsUrlInput = (value) => {
    const candidate = stripWrapping(value);
    if (!candidate) return '';
    if (!/^https:\/\//i.test(candidate)) return '';
    // 与后端校验一致：主机部分不能带用户名 / 密码（`@`），也不能含反斜杠；
    // 否则这里能保存，后端取码时却永远报「未配置」
    if (/^https:\/\/[^/?#]*[@\\]/i.test(candidate)) return '';

    try {
        const parsed = new URL(candidate);
        if (parsed.protocol !== 'https:') return '';
        if (!parsed.hostname) return '';
    } catch {
        return '';
    }

    return candidate;
};

/**
 * 是否为合法接码地址（通用判断：https + 有 host，允许其它同类接码服务）
 * @param {unknown} value
 * @returns {boolean}
 */
export const isSmsUrl = (value) => Boolean(normalizeSmsUrlInput(value));

/**
 * 是否命中已知接码服务特征（sms6688 / api/sms/recordText）
 * 批量导入时用它保守判断「这串 URL 是不是接码地址」，避免把普通链接存进 sms_url
 * @param {unknown} value
 * @returns {boolean}
 */
export const isSmsCodeUrl = (value) => {
    const normalized = normalizeSmsUrlInput(value);
    if (!normalized) return false;
    return SMS_URL_HINT_PATTERN.test(normalized);
};

/**
 * 把文本中的 URL 替换为占位符，返回替换后的文本与 URL 列表
 *
 * 目的：`12025550123|https://x.com/a?b=1|c=2` 这类输入先把地址保护起来，
 * 后续分隔符拆分 / 字段识别不会截断地址，也不会让参数里的数字污染手机号。
 *
 * 默认保护所有 http(s) URL；调用方可用 `shouldProtect` 排除特定链接
 * （例如批量导入时需要放行 `2fa.live`，否则会破坏既有的 2FA 密钥提取）。
 * @param {unknown} text
 * @param {(url: string) => boolean} [shouldProtect] 返回 true 才替换为占位符
 * @returns {{ text: string, urls: string[] }}
 */
export const protectSmsUrls = (text, shouldProtect) => {
    const raw = toRawString(text);
    const shouldReplace = typeof shouldProtect === 'function' ? shouldProtect : () => true;
    const urls = [];
    const protectedText = raw.replace(new RegExp(URL_TOKEN_SOURCE, 'gi'), (match) => {
        if (!shouldReplace(match)) {
            // 例如 2fa.live：保持原样，交给既有逻辑提取密钥
            return match;
        }
        urls.push(match);
        return `${URL_PLACEHOLDER_PREFIX}${urls.length - 1}${URL_PLACEHOLDER_SUFFIX}`;
    });

    return { text: protectedText, urls };
};

/**
 * 从任意文本中提取首个 https 接码地址（完整保留查询串，如 &tpl=1）
 * @param {unknown} text
 * @returns {string} 未找到返回 ''
 */
export const extractSmsUrl = (text) => {
    const { urls } = protectSmsUrls(text);
    for (const url of urls) {
        const normalized = normalizeSmsUrlInput(url);
        if (normalized) return normalized;
    }
    return '';
};

/**
 * 把占位符还原为真实 URL（未匹配到的占位符会被替换为空串）
 * @param {unknown} text
 * @param {string[]} urls protectSmsUrls 返回的列表
 * @returns {string}
 */
export const restoreSmsUrls = (text, urls = []) => {
    const raw = toRawString(text);
    if (!raw.includes(URL_PLACEHOLDER_PREFIX)) return raw;

    const list = Array.isArray(urls) ? urls : [];
    return raw.replace(new RegExp(URL_PLACEHOLDER_FULL_SOURCE, 'g'), (match, index) => {
        const resolved = list[Number(index)];
        return resolved === undefined ? '' : resolved;
    });
};

/**
 * 取出文本中所有 URL 占位符对应的真实地址（按出现顺序）
 * @param {unknown} text
 * @param {string[]} urls protectSmsUrls 返回的列表
 * @returns {string[]}
 */
export const extractProtectedUrls = (text, urls = []) => {
    const raw = toRawString(text);
    const list = Array.isArray(urls) ? urls : [];
    const resolved = [];
    const regex = new RegExp(URL_PLACEHOLDER_FULL_SOURCE, 'g');
    let match = regex.exec(raw);
    while (match !== null) {
        const value = list[Number(match[1])];
        if (value !== undefined) resolved.push(value);
        match = regex.exec(raw);
    }
    return resolved;
};

/**
 * 移除文本中的所有 URL 占位符（用于剥离地址后再解析手机号 / 年份）
 * @param {unknown} text
 * @returns {string}
 */
export const removeProtectedUrls = (text) => toRawString(text).replace(
    new RegExp(URL_PLACEHOLDER_FULL_SOURCE, 'g'),
    ' ',
);

/**
 * 从「分隔符 + URL 占位符」的字段中剥离出真实 URL
 *
 * 批量导入时遇到 `999|https://sms6688.com/...` 这种字段，
 * 需要把它拆成手机号 + 接码地址两部分再分别处理。
 * @param {unknown} field 单个字段原文（允许内嵌占位符）
 * @param {string[]} urls protectSmsUrls 返回的列表
 * @returns {{ smsUrl: string, rest: string, raw: string }}
 *   smsUrl 为命中的完整地址（未命中为空串）；
 *   rest 为剥离地址与前置分隔符后的剩余文本（用于手机号解析）。
 */
export const detachSmsUrl = (field, urls = []) => {
    const raw = toRawString(field);
    const list = Array.isArray(urls) ? urls : [];
    // 必须匹配「前缀 + 编号 + 后缀」的完整占位符，否则会在剩余文本里残留 \u0000
    const regex = new RegExp(URL_PLACEHOLDER_FULL_SOURCE, 'g');

    let match = regex.exec(raw);
    while (match !== null) {
        const candidate = list[Number(match[1])];
        const normalized = normalizeSmsUrlInput(candidate);
        if (normalized) {
            // 连前缀分隔符一起剥离，避免残留的 `|` 影响后续号码解析
            const before = raw.slice(0, match.index).replace(SEPARATOR_TAIL_PATTERN, '');
            const after = raw.slice(match.index + match[0].length);
            return {
                smsUrl: normalized,
                rest: restoreSmsUrls(`${before} ${after}`, list).trim(),
                raw: candidate,
            };
        }
        match = regex.exec(raw);
    }

    // 没有可用接码地址时还原原文，保证 http 地址等仍能被其它解析逻辑看到
    return { smsUrl: '', rest: restoreSmsUrls(raw, list), raw: '' };
};

/**
 * 拆分「手机号|接码地址」整串输入
 *
 * 示例：`12025550123|https://sms6688.com/api/sms/recordText?token=xxx&tpl=1`
 * → `{ phone: '+12025550123', smsUrl: 'https://...完整地址' }`
 *
 * 必须先剥离 URL 再解析号码，否则 URL 里的 token / tpl 数字会被拼进手机号。
 * @param {unknown} text
 * @returns {{ phone: string, smsUrl: string }}
 */
export const extractPhoneAndSmsUrl = (text) => {
    const raw = toRawString(text);
    if (!raw.trim()) return { phone: '', smsUrl: '' };

    const { text: protectedText, urls } = protectSmsUrls(raw);

    const detached = detachSmsUrl(protectedText, urls);
    // detachSmsUrl 会把未命中的 URL 还原成真实地址，
    // 因此解析号码前必须再保护一次并剔除，避免 token / tpl 的数字混进手机号
    const phoneSource = removeProtectedUrls(protectSmsUrls(detached.rest).text).trim();
    const phone = phoneSource ? normalizePhoneNumberSafe(phoneSource) : '';

    return { phone, smsUrl: detached.smsUrl };
};

/**
 * 表格展示用的简短标识（只返回 host，绝不返回 token 或完整地址）
 * @param {unknown} url
 * @returns {string} 无有效 host 时返回 ''
 */
export const describeSmsUrl = (url) => {
    const normalized = normalizeSmsUrlInput(url);
    if (!normalized) return '';
    try {
        return new URL(normalized).hostname || '';
    } catch {
        return '';
    }
};

/**
 * 日志 / 错误提示用脱敏：把 token 等敏感参数值替换为 ***
 * 即使地址不是合法 URL，也会对 `name=value` 形式做脱敏
 * @param {unknown} url
 * @returns {string}
 */
export const maskSmsUrl = (url) => {
    const raw = toRawString(url).trim();
    if (!raw) return '';

    return raw.replace(
        /([?&#;]|^)([A-Za-z0-9_.\-[\]]+)=([^&#\s]*)/g,
        (match, prefix, name, value) => {
            const key = String(name).toLowerCase().replace(/\[\]$/, '');
            if (!SENSITIVE_QUERY_NAMES.has(key)) return match;
            if (value === '***') return match;
            return `${prefix}${name}=***`;
        },
    );
};

/**
 * 倒计时文案（界面用），例如 5 → '5s'
 * 非正数 / 非数字返回 ''
 * @param {unknown} seconds
 * @returns {string}
 */
export const formatSmsCountdown = (seconds) => {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value <= 0) return '';
    return `${Math.ceil(value)}s`;
};
