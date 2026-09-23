/**
 * 导入文本解析模块
 * 从 ImportView 中提取的纯逻辑函数
 *
 * 接码地址处理约定：
 * 解析前先把「接码类」URL 换成占位符再拆分，避免 URL 内的 `|`、
 * token、tpl 数字干扰字段识别；识别到的接码地址写入 `sms_url`，
 * 且该段文本不再参与手机号 / 年份 / 2FA 密钥的猜测。
 * `2fa.live` 等 2FA 链接保持原样，交给既有提取逻辑处理。
 */

import { normalizePhoneNumber } from './phoneUtils';
import {
    protectSmsUrls,
    detachSmsUrl,
    removeProtectedUrls,
    isSmsCodeUrl,
} from './smsUtils';

export { normalizePhoneNumber } from './phoneUtils';

const COUNTRIES = ['india', 'france', 'brazil', 'laos', 'china', 'usa', 'germany', 'japan', 'korea', 'vietnam', 'thailand', 'indonesia', 'malaysia', 'singapore', 'philippines', 'russia', 'uk', 'canada', 'australia', 'mexico', 'spain', 'italy', 'netherlands', 'belgium', 'switzerland', 'austria', 'poland', 'turkey', 'egypt', 'nigeria', 'south africa', 'argentina', 'chile', 'colombia', 'peru'];
const SECRET_MIN_LENGTH = 16;

const extractYearAndPhone = (str) => {
    if (!str) return { year: '', phone: '' };

    let year = '';
    const yearMatch = str.match(/\b20\d{2}\b/g);
    if (yearMatch) {
        const validYear = yearMatch.find(isYear);
        if (validYear) year = validYear;
    }

    let phone = '';
    const phonePatterns = [
        /\+\d[\d\s\-]{6,}\d/g,
        /\b1[3-9]\d{9}\b/g,
        /\b\d{10,15}\b/g,
    ];

    for (const pattern of phonePatterns) {
        const matches = str.match(pattern) || [];
        for (const candidate of matches) {
            const normalized = normalizePhoneNumber(candidate);
            if (isPhoneNumber(normalized)) {
                phone = normalized;
                break;
            }
        }
        if (phone) break;
    }

    return { year, phone };
};

const parseTailFields = (fields, target, urls = []) => {
    for (const rawField of fields) {
        const field = rawField.trim();
        if (!field) continue;

        // 「手机号|接码地址」字段：先摘出地址，避免 URL 里的数字污染号码解析。
        // 行级已做过 protectSmsUrls，这里能识别到占位符并还原成真实地址。
        const { smsUrl, rest } = detachSmsUrl(field, urls);
        if (smsUrl && !target.sms_url) {
            target.sms_url = smsUrl;
        }

        // 只剔除「接码地址」类 URL：号码 / 年份 / 2FA 只从剩余文本里猜，
        // 而 2fa.live 等 2FA 链接必须保留，否则会破坏既有的密钥提取
        const remainder = removeProtectedUrls(protectSmsUrls(rest, isSmsCodeUrl).text).trim();
        if (!remainder) continue;

        if (!target.recovery && isEmail(remainder)) {
            target.recovery = remainder;
            continue;
        }

        const { year, phone } = extractYearAndPhone(remainder);
        if (year && !target.reg_year) target.reg_year = year;
        if (phone && !target.phone) target.phone = phone;

        const extractedSecret = extractSecret(remainder);
        if (extractedSecret && !target.secret) {
            target.secret = extractedSecret;
        }

        if (!target.country && isCountry(remainder)) {
            target.country = remainder;
        }
    }
};

/**
 * 标准行解析
 * @param {string} line 已做 URL 保护的文本
 * @param {string[]} urls protectSmsUrls 返回的地址列表
 */
const parseStandardLine = (line, group, remark, urls = []) => {
    const { parts: rawParts, separator } = smartSplit(line);
    const parts = rawParts.map(p => p.trim()).filter(p => p);
    const emailIndex = parts.findIndex(isEmail);

    if (emailIndex < 0) {
        return { account: null, separator };
    }

    const email = parts[emailIndex];
    const passwordCandidate = parts[emailIndex + 1] || '';
    const password = !isEmail(passwordCandidate) ? passwordCandidate.trim() : '';

    if (!password) {
        return { account: null, separator };
    }

    const account = {
        email,
        password,
        recovery: '',
        phone: '',
        secret: '',
        sms_url: '',
        reg_year: '',
        country: '',
        group_name: group,
        remark,
    };

    parseTailFields(parts.slice(emailIndex + 2), account, urls);
    return { account, separator };
};

/**
 * 「卡号：xxx密码：xxx」特殊格式解析
 * @param {string} line 已做 URL 保护的文本
 * @param {string[]} urls protectSmsUrls 返回的地址列表
 */
const parseSpecialLine = (line, group, remark, urls = []) => {
    const specialMatch = line.match(/卡号[：:]\s*(.+?)\s*密码[：:]\s*(.+?)(?:\s*(----|\||——|---|--)\s*(.*))?$/);
    if (!specialMatch) return null;

    const email = (specialMatch[1] || '').trim();
    const password = (specialMatch[2] || '').trim();
    const separator = specialMatch[3] || '无分隔符';
    const rest = (specialMatch[4] || '').trim();

    if (!isEmail(email) || !password) {
        return { account: null, separator };
    }

    const account = {
        email,
        password,
        recovery: '',
        phone: '',
        secret: '',
        sms_url: '',
        reg_year: '',
        country: '',
        group_name: group,
        remark,
    };

    if (rest) {
        const { parts: rawParts } = smartSplit(rest);
        const parts = rawParts.map(p => p.trim()).filter(p => p);
        parseTailFields(parts, account, urls);
    }

    return { account, separator };
};

// 判断是否为邮箱
export const isEmail = (str) => {
    return str && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
};

// 判断是否为手机号
export const isPhoneNumber = (str) => {
    if (!str) return false;
    const cleaned = normalizePhoneNumber(str);
    if (!cleaned) return false;
    // E.164 常见号码长度范围
    return /^\+\d{8,18}$/.test(cleaned);
};

// 判断是否为年份 (2015-2030)
export const isYear = (str) => {
    if (!str) return false;
    const num = parseInt(str.trim(), 10);
    return /^\d{4}$/.test(str.trim()) && num >= 2015 && num <= 2030;
};

// 判断是否为国家
export const isCountry = (str) => {
    if (!str) return false;
    return COUNTRIES.includes(str.trim().toLowerCase());
};

// 提取 2FA 密钥（优先 URL，其次匹配足够长度的 Base32 token）
export const extractSecret = (str) => {
    if (!str) return '';
    const raw = String(str).trim();
    if (!raw) return '';

    // 从 2fa.live URL 提取（支持 /tok/ 和 /ok/ 路径）
    const urlMatch = raw.match(/2fa\.live\/(?:tok|ok)\/([a-z2-7]{16,})/i);
    if (urlMatch) return urlMatch[1].toUpperCase();

    // 允许空格分组形式（如: XXXX XXXX XXXX）
    const compact = raw.replace(/\s+/g, '').toUpperCase();
    if (compact.length >= SECRET_MIN_LENGTH && /^[A-Z2-7]+$/.test(compact)) {
        return compact;
    }

    // 处理带后缀说明的场景（如：SECRET --<备注>）
    const tokenMatch = raw.toUpperCase().match(/[A-Z2-7]{16,}/);
    if (tokenMatch) return tokenMatch[0];

    return '';
};

// 提取分组前缀
export const extractGroup = (line) => {
    const match = line.match(/^(主号|成员\d+)[：:]\s*/);
    if (match) return { group: match[1], rest: line.substring(match[0].length) };
    return { group: '', rest: line };
};

// 分隔符候选：从最具体到最宽松
const SEPARATOR_CANDIDATES = ['----', '——', '---', '--', '|'];

// 提取标注
export const extractTags = (str) => {
    const tags = [];
    const tagRegex = /<([^>]+)>/g;
    let match;
    while ((match = tagRegex.exec(str)) !== null) {
        tags.push(match[1]);
    }
    return tags.join(' ');
};


// 清理标注
export const cleanTags = (str) => {
    return str.replace(/<[^>]+>/g, '').trim();
};

// 判断是否应该跳过该行
export const shouldSkipLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    if (trimmed.startsWith('```')) return true;
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) return true;
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return true;
    if (/^第(?:\d+|[一二三四五六七八九十百千万]+)组/.test(trimmed)) return true;
    if (/^待加入/.test(trimmed)) return true;
    if (/^账号集\d+/.test(trimmed)) return true;
    if (/^[-—=]+$/.test(trimmed)) return true;
    return false;
};

// 智能识别分隔符并分割
export const detectAndSplit = (line) => {
    // 优先检查最具体的分隔符，避免被更通用的匹配覆盖
    // 管道符 | 至少需要 2 段（email|pass），允许多段
    const pipeCount = (line.match(/\|/g) || []).length;
    if (pipeCount >= 1) {
        // 拒绝边界情况：以 | 开头或结尾
        if (line.startsWith('|') || line.endsWith('|')) {
            return { parts: [line], separator: '无分隔符' };
        }
        // 检查是否有连续管道符（会产生空字段）
        const parts = line.split('|');
        const hasEmptyPart = parts.some(p => p.trim() === '');
        if (hasEmptyPart) {
            return { parts: [line], separator: '无分隔符' };
        }
        // 至少需要 2 个有效字段
        if (parts.length >= 2) {
            return { parts, separator: '|' };
        }
    }
    if (line.includes('----')) return { parts: line.split('----'), separator: '----' };
    if (line.includes('——')) return { parts: line.split('——'), separator: '——' };
    if (line.includes('---')) return { parts: line.split('---'), separator: '---' };
    if (line.includes('--')) return { parts: line.split('--'), separator: '--' };
    return { parts: [line], separator: '无分隔符' };
};

/**
 * 智能拆分：混合分隔符行（例如 `邮箱----密码----12025550123|接码地址`）
 * 如果按 `|` 优先拆会把 `----` 留在邮箱字段里，因此这里换一种策略：
 * 依次尝试各分隔符，选第一个能拆出「合法邮箱 + 紧随其后的密码」的方案。
 * 都不满足时回落到原有的 detectAndSplit，保持既有行为不变。
 */
function smartSplit(line) {
    for (const separator of SEPARATOR_CANDIDATES) {
        if (!line.includes(separator)) continue;

        const parts = line.split(separator).map(part => part.trim());
        if (parts.some(part => part === '')) continue;

        const emailIndex = parts.findIndex(isEmail);
        if (emailIndex < 0) continue;

        const password = parts[emailIndex + 1] || '';
        if (!password || isEmail(password)) continue;

        return { parts, separator };
    }

    return detectAndSplit(line);
}

/**
 * 解析导入文本，返回解析结果和格式统计
 * @param {string} text - 导入文本
 * @returns {{ parsed: Array, formatStats: Object, detectedFormats: string[] }}
 */
export const parseImportText = (text) => {
    if (!text || !text.trim()) {
        return { parsed: [], formatStats: null, detectedFormats: [] };
    }

    const lines = text.split('\n');
    const formatStats = {
        separators: new Set(),
        hasRecovery: 0,
        noRecovery: 0,
        hasSecret: 0,
        noSecret: 0,
        hasPhone: 0,
        noPhone: 0,
        specialFormat: 0,
        standardFormat: 0,
        invalidLines: 0,
    };

    const parsed = lines.map(line => {
        if (shouldSkipLine(line)) return null;

        // 提取分组前缀
        const { group, rest: lineWithoutGroup } = extractGroup(line);

        // 提取标注
        const remark = extractTags(lineWithoutGroup);
        const cleanedLine = cleanTags(lineWithoutGroup);

        // 先把接码地址保护起来：避免地址里的 `|` 被当分隔符截断，
        // 也避免 token / tpl 里的数字被当成手机号、年份或 2FA 密钥。
        // 2fa.live 等非接码链接保持原样，否则会破坏既有的密钥提取。
        const { text: protectedLine, urls } = protectSmsUrls(cleanedLine, isSmsCodeUrl);

        // 特殊格式：卡号：xxx密码：xxx + 可选尾字段
        const specialParsed = parseSpecialLine(protectedLine, group, remark || '', urls);
        if (specialParsed) {
            formatStats.specialFormat++;
            if (!specialParsed.account) {
                formatStats.invalidLines++;
                return null;
            }
            if (specialParsed.separator) {
                formatStats.separators.add(specialParsed.separator);
            }

            if (specialParsed.account.recovery) formatStats.hasRecovery++;
            else formatStats.noRecovery++;

            if (specialParsed.account.secret) formatStats.hasSecret++;
            else formatStats.noSecret++;

            if (specialParsed.account.phone) formatStats.hasPhone++;
            else formatStats.noPhone++;

            return specialParsed.account;
        }

        formatStats.standardFormat++;
        const standardParsed = parseStandardLine(protectedLine, group, remark || '', urls);
        if (!standardParsed.account) {
            formatStats.invalidLines++;
            return null;
        }
        if (standardParsed.separator) {
            formatStats.separators.add(standardParsed.separator);
        }

        // 统计字段存在情况
        if (standardParsed.account.recovery) formatStats.hasRecovery++;
        else formatStats.noRecovery++;

        if (standardParsed.account.secret) formatStats.hasSecret++;
        else formatStats.noSecret++;

        if (standardParsed.account.phone) formatStats.hasPhone++;
        else formatStats.noPhone++;

        return standardParsed.account;
    }).filter(item => item !== null);

    // 检测格式差异
    const detectedFormats = [];

    if (formatStats.separators.size > 1) {
        detectedFormats.push(`使用了 ${formatStats.separators.size} 种不同的分隔符: ${Array.from(formatStats.separators).join(', ')}`);
    }

    if (formatStats.specialFormat > 0 && formatStats.standardFormat > 0) {
        detectedFormats.push(`混合使用了"卡号:密码:"格式 (${formatStats.specialFormat}行) 和标准格式 (${formatStats.standardFormat}行)`);
    }

    if (formatStats.hasRecovery > 0 && formatStats.noRecovery > 0) {
        detectedFormats.push(`部分行有恢复邮箱 (${formatStats.hasRecovery}行)，部分行没有 (${formatStats.noRecovery}行)`);
    }

    if (formatStats.hasSecret > 0 && formatStats.noSecret > 0) {
        detectedFormats.push(`部分行有2FA密钥 (${formatStats.hasSecret}行)，部分行没有 (${formatStats.noSecret}行)`);
    }

    if (formatStats.hasPhone > 0 && formatStats.noPhone > 0) {
        detectedFormats.push(`部分行有手机号 (${formatStats.hasPhone}行)，部分行没有 (${formatStats.noPhone}行)`);
    }

    if (formatStats.invalidLines > 0) {
        detectedFormats.push(`有 ${formatStats.invalidLines} 行未导入（缺少邮箱/密码或格式无法识别）`);
    }

    return { parsed, formatStats, detectedFormats };
};
