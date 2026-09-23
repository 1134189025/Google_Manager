const DEFAULT_COUNTRY_CODE = '86';
const CHINA_MAINLAND_MOBILE_REGEX = /^1[3-9]\d{9}$/;
const MIN_LOCAL_LENGTH = 6;
const MAX_LOCAL_LENGTH = 14;

export const COUNTRY_DIALING_CODES = [
    '1', '7', '20', '27', '30', '31', '32', '33', '34', '36', '39',
    '40', '41', '43', '44', '45', '46', '47', '48', '49',
    '51', '52', '53', '54', '55', '56', '57', '58',
    '60', '61', '62', '63', '64', '65', '66',
    '81', '82', '84', '86', '90', '91', '92', '93', '94', '95', '98',
    '212', '213', '216', '218', '220', '221', '222', '223', '224', '225', '226', '227', '228', '229',
    '230', '231', '232', '233', '234', '235', '236', '237', '238', '239',
    '240', '241', '242', '243', '244', '245', '246', '248', '249',
    '250', '251', '252', '253', '254', '255', '256', '257', '258',
    '260', '261', '262', '263', '264', '265', '266', '267', '268', '269',
    '290', '291', '297', '298', '299',
    '350', '351', '352', '353', '354', '355', '356', '357', '358', '359',
    '370', '371', '372', '373', '374', '375', '376', '377', '378', '380',
    '381', '382', '383', '385', '386', '387', '389',
    '420', '421', '423',
    '500', '501', '502', '503', '504', '505', '506', '507', '508', '509',
    '591', '592', '593', '594', '595', '596', '597', '598', '599',
    '670', '672', '673', '674', '675', '676', '677', '678', '679', '680', '681', '682', '683', '685', '686', '687', '688', '689', '690', '691', '692',
    '850', '852', '853', '855', '856', '880', '886',
    '960', '961', '962', '963', '964', '965', '966', '967', '968', '970', '971', '972', '973', '974', '975', '976', '977',
].sort((a, b) => b.length - a.length);

const COUNTRY_DIALING_CODE_SET = new Set(COUNTRY_DIALING_CODES);

export const COUNTRY_META_BY_CODE = {
    '+1': { abbr: 'US', zh: '美国' },
    '+7': { abbr: 'RU', zh: '俄罗斯' },
    '+33': { abbr: 'FR', zh: '法国' },
    '+34': { abbr: 'ES', zh: '西班牙' },
    '+39': { abbr: 'IT', zh: '意大利' },
    '+44': { abbr: 'UK', zh: '英国' },
    '+49': { abbr: 'DE', zh: '德国' },
    '+52': { abbr: 'MX', zh: '墨西哥' },
    '+55': { abbr: 'BR', zh: '巴西' },
    '+60': { abbr: 'MY', zh: '马来西亚' },
    '+61': { abbr: 'AU', zh: '澳大利亚' },
    '+62': { abbr: 'ID', zh: '印度尼西亚' },
    '+63': { abbr: 'PH', zh: '菲律宾' },
    '+64': { abbr: 'NZ', zh: '新西兰' },
    '+65': { abbr: 'SG', zh: '新加坡' },
    '+66': { abbr: 'TH', zh: '泰国' },
    '+81': { abbr: 'JP', zh: '日本' },
    '+82': { abbr: 'KR', zh: '韩国' },
    '+84': { abbr: 'VN', zh: '越南' },
    '+86': { abbr: 'CN', zh: '中国' },
    '+91': { abbr: 'IN', zh: '印度' },
};

const COUNTRY_HINT_TO_CODE = {
    cn: '86',
    china: '86',
    中国: '86',
    us: '1',
    usa: '1',
    unitedstates: '1',
    美国: '1',
    uk: '44',
    gb: '44',
    britain: '44',
    england: '44',
    英国: '44',
    jp: '81',
    japan: '81',
    日本: '81',
    kr: '82',
    korea: '82',
    韩国: '82',
    vn: '84',
    vietnam: '84',
    越南: '84',
    in: '91',
    india: '91',
    印度: '91',
    ru: '7',
    russia: '7',
    俄罗斯: '7',
    de: '49',
    germany: '49',
    德国: '49',
    fr: '33',
    france: '33',
    法国: '33',
    br: '55',
    brazil: '55',
    巴西: '55',
    mx: '52',
    mexico: '52',
    墨西哥: '52',
    sg: '65',
    singapore: '65',
    新加坡: '65',
    my: '60',
    malaysia: '60',
    马来西亚: '60',
    id: '62',
    indonesia: '62',
    印度尼西亚: '62',
    ph: '63',
    philippines: '63',
    菲律宾: '63',
    th: '66',
    thailand: '66',
    泰国: '66',
    hk: '852',
    hongkong: '852',
    香港: '852',
    tw: '886',
    taiwan: '886',
    台湾: '886',
    mo: '853',
    macao: '853',
    macau: '853',
    澳门: '853',
    ca: '1',
    canada: '1',
    加拿大: '1',
    au: '61',
    australia: '61',
    澳大利亚: '61',
    nz: '64',
    newzealand: '64',
    新西兰: '64',
};

const normalizeRawPhoneInput = (value) => String(value || '')
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFF10 + 48))
    .replace(/＋/g, '+')
    .trim();

const normalizeCountryHintKey = (text) => String(text || '').toLowerCase().replace(/[\s._-]/g, '');

const getCountryCodeFromHint = (raw) => {
    const tokens = String(raw || '').match(/[A-Za-z\u4e00-\u9fff]+/g) || [];
    for (const token of tokens) {
        const code = COUNTRY_HINT_TO_CODE[normalizeCountryHintKey(token)];
        if (code) return code;
    }

    const normalizedLetters = normalizeCountryHintKey(String(raw || '').replace(/[^A-Za-z\u4e00-\u9fff]/g, ''));
    if (!normalizedLetters) return '';
    for (const [hint, code] of Object.entries(COUNTRY_HINT_TO_CODE)) {
        if (hint && normalizedLetters.includes(hint)) return code;
    }
    return '';
};

const getCountryCodeFromLeadingDigits = (digits) => {
    for (const code of COUNTRY_DIALING_CODES) {
        if (!digits.startsWith(code)) continue;
        const localLen = digits.length - code.length;
        if (localLen >= MIN_LOCAL_LENGTH && localLen <= MAX_LOCAL_LENGTH) {
            return code;
        }
    }
    return '';
};

const normalizeWithSegmentedCountryCode = (raw) => {
    const tokens = String(raw || '').match(/\d+/g) || [];
    if (tokens.length < 2) return '';

    let code = tokens[0];
    if (code.startsWith('00') && code.length > 2) code = code.slice(2);
    if (code.startsWith('011') && code.length > 3) code = code.slice(3);
    if (!code || !COUNTRY_DIALING_CODE_SET.has(code)) return '';

    const localDigits = tokens.slice(1).join('');
    if (localDigits.length < MIN_LOCAL_LENGTH || localDigits.length > MAX_LOCAL_LENGTH) return '';
    return `+${code}${localDigits}`;
};

export const normalizePhoneNumber = (value) => {
    if (!value) return '';
    const raw = normalizeRawPhoneInput(value);
    if (!raw) return '';

    const digits = raw.replace(/[^\d]/g, '');
    if (!digits) return '';

    // 显式国家码：+86xxxx / +1xxxx（允许在文本中出现）
    if (/(?:^|[^\d])\+\s*\d{1,4}/.test(raw)) return `+${digits}`;

    const compact = raw.replace(/[^\d+]/g, '');
    // 00 前缀国际格式：0086xxxx / 001xxxx
    if (compact.startsWith('00') && digits.length > 2) return `+${digits.slice(2)}`;
    // 北美常见国际前缀：011xx...
    if (compact.startsWith('011') && digits.length > 3) return `+${digits.slice(3)}`;

    // 明确国家提示词（CN/US/中国/美国 等）+ 本地号码
    const hintedCode = getCountryCodeFromHint(raw);
    if (hintedCode) {
        if (digits.startsWith(hintedCode) && digits.length - hintedCode.length >= MIN_LOCAL_LENGTH) {
            return `+${digits}`;
        }
        return `+${hintedCode}${digits}`;
    }

    // 分段输入：1 2192731268 / 44-7700-900123 / 86 13812345678
    const segmented = normalizeWithSegmentedCountryCode(raw);
    if (segmented) return segmented;

    // 中国大陆本地手机号优先视为 +86，避免误判为 +1
    if (CHINA_MAINLAND_MOBILE_REGEX.test(digits)) {
        return `+${DEFAULT_COUNTRY_CODE}${digits}`;
    }

    // 已含有效国家码（无 +）
    const leadingCode = getCountryCodeFromLeadingDigits(digits);
    if (leadingCode) return `+${digits}`;

    // 已含默认国家码（无 +）
    if (digits.startsWith(DEFAULT_COUNTRY_CODE) && digits.length >= 10) {
        return `+${digits}`;
    }

    // 未提供国家码时，默认 +86
    return `+${DEFAULT_COUNTRY_CODE}${digits}`;
};

export const splitPhoneParts = (phone) => {
    const normalized = normalizePhoneNumber(phone);
    if (!normalized || !normalized.startsWith('+')) {
        return { countryCode: '', localNumber: '', normalized: '' };
    }

    const digits = normalized.slice(1);
    if (!digits) return { countryCode: '', localNumber: '', normalized };

    for (const code of COUNTRY_DIALING_CODES) {
        if (digits.startsWith(code) && digits.length > code.length) {
            return {
                countryCode: `+${code}`,
                localNumber: digits.slice(code.length),
                normalized,
            };
        }
    }

    return {
        countryCode: `+${DEFAULT_COUNTRY_CODE}`,
        localNumber: digits,
        normalized,
    };
};

export const formatCountryDisplay = (countryCode) => {
    const code = countryCode || `+${DEFAULT_COUNTRY_CODE}`;
    const meta = COUNTRY_META_BY_CODE[code];
    if (meta) return `${meta.abbr} ${meta.zh} (${code})`;
    return `INTL 国际 (${code})`;
};
