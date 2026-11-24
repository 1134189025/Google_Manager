import { CHINA_BANK_BINS } from './cardBankBins';
import { resolveBrandIconUrl } from './brandIcons';

/**
 * 支付卡与 U 卡工具函数（从 zhiyu card-issuers / card-identity 移植）
 */
export const CHINA_BANKS = [
    ['ICBC', '中国工商银行', '工行|工商银行', 'ruby', 'rings'],
    ['CCB', '中国建设银行', '建行|建设银行', 'cobalt', 'facets'],
    ['ABC', '中国农业银行', '农行|农业银行', 'jade', 'contours'],
    ['BOC', '中国银行', '中行|Bank of China', 'garnet', 'rings'],
    ['COMM', '交通银行', '交行|Bank of Communications', 'cobalt', 'facets'],
    ['PSBC', '中国邮政储蓄银行', '邮储|邮政储蓄|邮政银行', 'forest', 'contours'],
    ['CMB', '招商银行', '招行|China Merchants Bank', 'garnet', 'orbits'],
    ['CITIC', '中信银行', '中信|China CITIC Bank', 'ruby', 'facets'],
    ['CEB', '中国光大银行', '光大银行|光大', 'amethyst', 'orbits'],
    ['HXBANK', '华夏银行', '华夏', 'ruby', 'contours'],
    ['CMBC', '中国民生银行', '民生银行|民生', 'jade', 'facets'],
    ['SPABANK', '平安银行', '平安|Ping An Bank', 'copper', 'facets'],
    ['CIB', '兴业银行', '兴业|Industrial Bank', 'navy', 'orbits'],
    ['SPDB', '上海浦东发展银行', '浦发银行|浦发|浦东发展银行', 'navy', 'contours'],
    ['GDB', '广发银行', '广发|广东发展银行', 'ruby', 'orbits'],
    ['CZBANK', '浙商银行', '浙商', 'garnet', 'facets'],
    ['BOHAIB', '渤海银行', '渤海', 'navy', 'contours'],
    ['EGBANK', '恒丰银行', '恒丰', 'copper', 'orbits'],
    ['BJBANK', '北京银行', '北京银行', 'ruby', 'facets'],
    ['SHBANK', '上海银行', '上海银行', 'cobalt', 'orbits'],
    ['JSBANK', '江苏银行', '江苏银行', 'cobalt', 'contours'],
    ['NJCB', '南京银行', '南京银行', 'ruby', 'rings'],
    ['NBBANK', '宁波银行', '宁波银行', 'copper', 'facets'],
    ['HZCB', '杭州银行', '杭州银行', 'cobalt', 'contours'],
    ['CDCB', '成都银行', '成都银行', 'copper', 'rings'],
    ['CSCB', '长沙银行', '长沙银行', 'garnet', 'orbits'],
    ['CQBANK', '重庆银行', '重庆银行', 'ruby', 'facets'],
    ['GCB', '广州银行', '广州银行', 'ruby', 'orbits'],
    ['HSBANK', '徽商银行', '徽商', 'garnet', 'contours'],
    ['DLB', '大连银行', '大连银行', 'cobalt', 'rings'],
];

export const CARD_REGION_GROUPS = [
    { id: 'all', label: '全部' },
    { id: 'mainland', label: '中国大陆' },
    { id: 'hmt', label: '港澳台' },
    { id: 'overseas', label: '海外' },
    { id: 'global', label: '全球' },
];

export const CARD_REGIONS = [
    '中国大陆',
    '中国香港',
    '中国澳门',
    '中国台湾',
    '新加坡',
    '美国',
    '英国',
    '日本',
    '加拿大',
    '澳大利亚',
    '德国',
    '欧洲',
    '全球 / 多地区',
];

export const CARD_NETWORKS = ['Visa', 'Mastercard', 'UnionPay', 'American Express', 'JCB', 'Discover'];

export const CARD_PALETTES = {
    ruby: 'linear-gradient(135deg, #4f1d2d 0%, #27131d 60%, #161822 100%)',
    garnet: 'linear-gradient(135deg, #5d1b2c 0%, #2b1421 60%, #171923 100%)',
    cobalt: 'linear-gradient(135deg, #1d3a6d 0%, #17243f 60%, #131823 100%)',
    navy: 'linear-gradient(135deg, #192d52 0%, #151f36 60%, #12151f 100%)',
    jade: 'linear-gradient(135deg, #144d43 0%, #132d2b 60%, #131920 100%)',
    forest: 'linear-gradient(135deg, #1b4d31 0%, #152b21 60%, #13181f 100%)',
    copper: 'linear-gradient(135deg, #5c331c 0%, #2e1d16 60%, #171922 100%)',
    amethyst: 'linear-gradient(135deg, #3e255d 0%, #231838 60%, #151722 100%)',
    graphite: 'linear-gradient(135deg, #2b3242 0%, #1e2330 60%, #151822 100%)',
};

export function findChinaBank(input) {
    const text = String(input ?? '').trim();
    if (!text) return undefined;
    return CHINA_BANKS.find(([code, name, aliases]) =>
        [code, name, ...aliases.split('|')].some(alias => alias.toLowerCase() === text.toLowerCase()),
    );
}

/**
 * 按 6/8 位或完整卡号匹配国内银行 BIN（最长匹配优先，歧义时不猜测）
 */
export function detectChinaBank(input, rows = CHINA_BANK_BINS) {
    const number = String(input ?? '').replace(/[\s-]/g, '');
    if (!/^(?:\d{6}|\d{8}|\d{12,19})$/.test(number)) return undefined;
    const full = number.length >= 12;
    const matches = rows.filter(
        ([bin, , length]) => number.startsWith(bin) && (!full || length === number.length),
    );
    const longest = Math.max(0, ...matches.map(([bin]) => bin.length));
    const codes = [
        ...new Set(matches.filter(([bin]) => bin.length === longest).map(([, code]) => code)),
    ];
    if (codes.length !== 1) return undefined;
    const bank = CHINA_BANKS.find(([code]) => code === codes[0]);
    if (!bank) return undefined;
    return {
        code: bank[0],
        issuer: bank[1],
        region: '中国大陆',
        regionGroup: 'mainland',
    };
}

export function detectCardNetwork(input) {
    const digits = String(input ?? '').replace(/[\s-]/g, '');
    if (!digits) return '';
    if (/^4/.test(digits)) return 'Visa';
    if (/^(?:5[1-5]|222[1-9]|22[3-9]\d|2[3-6]\d{2}|27[01]\d|2720)/.test(digits)) return 'Mastercard';
    if (/^62/.test(digits)) return 'UnionPay';
    if (/^3[47]/.test(digits)) return 'American Express';
    if (/^35(?:2[89]|[3-8]\d)/.test(digits)) return 'JCB';
    if (/^(?:6011|65|64[4-9])/.test(digits)) return 'Discover';
    return '';
}

export function inferRegionGroup(region, explicitGroup) {
    if (explicitGroup && ['mainland', 'hmt', 'overseas', 'global', 'unknown'].includes(explicitGroup)) {
        return explicitGroup;
    }
    const text = String(region ?? '').trim();
    if (!text) return 'unknown';
    if (/^(中国(大陆|内地)?|大陆|内地|中华人民共和国|CN|CHN|China|Mainland China)$/i.test(text)) {
        return 'mainland';
    }
    if (/^(中国)?(香港|澳门|台湾)(特别行政区|地区)?$|^(HK|MO|TW|Hong Kong|Macau|Macao|Taiwan)$/i.test(text)) {
        return 'hmt';
    }
    if (/全球|多地区|多国|global|worldwide|international/i.test(text)) {
        return 'global';
    }
    return 'overseas';
}

export function cardAppearance(issuer = '', network = '', bankCode = '') {
    const bank = findChinaBank(bankCode || issuer);
    if (bank) {
        return {
            mark: bank[0] === 'HXBANK' ? 'HXB' : bank[0] === 'SPABANK' ? 'PAB' : bank[0],
            palette: bank[3],
            background: CARD_PALETTES[bank[3]],
            issuerIconUrl: resolveBrandIconUrl([bank[0], bank[1]]),
            networkIconUrl: resolveBrandIconUrl([network]),
        };
    }
    const presets = {
        redotpay: ['R', 'ruby'],
        bybit: ['B', 'graphite'],
        wise: ['W', 'forest'],
        revolut: ['R', 'amethyst'],
        'crypto.com': ['C', 'navy'],
        nexo: ['N', 'cobalt'],
        paypal: ['P', 'cobalt'],
        dupays: ['D', 'amethyst'],
        onekey: ['O', 'jade'],
        pokepay: ['P', 'copper'],
    };
    const key = String(issuer || '').trim().toLowerCase();
    const known = presets[key];
    if (known) {
        return {
            mark: known[0],
            palette: known[1],
            background: CARD_PALETTES[known[1]],
            issuerIconUrl: resolveBrandIconUrl([issuer]),
            networkIconUrl: resolveBrandIconUrl([network]),
        };
    }
    const hash = [...(key || network || 'card')].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 0);
    const paletteNames = ['navy', 'jade', 'graphite', 'copper', 'amethyst'];
    const palette = paletteNames[hash % paletteNames.length];
    return {
        mark: String(issuer || network || 'C').trim().slice(0, 2).toUpperCase(),
        palette,
        background: CARD_PALETTES[palette],
        issuerIconUrl: resolveBrandIconUrl([issuer]),
        networkIconUrl: resolveBrandIconUrl([network]),
    };
}

export function formatCardNumberGroups(number) {
    const clean = String(number ?? '').replace(/\s+/g, '');
    if (!clean) return '';
    return clean.replace(/(.{4})/g, '$1 ').trim();
}
