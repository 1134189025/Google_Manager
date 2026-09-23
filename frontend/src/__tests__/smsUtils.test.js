import { describe, it, expect } from 'vitest';
import {
    SMS_URL_PATTERN,
    isSmsUrl,
    isSmsCodeUrl,
    extractSmsUrl,
    extractPhoneAndSmsUrl,
    describeSmsUrl,
    maskSmsUrl,
    formatSmsCountdown,
    normalizeSmsUrlInput,
    protectSmsUrls,
    restoreSmsUrls,
    removeProtectedUrls,
    detachSmsUrl,
    extractProtectedUrls,
} from '../utils/smsUtils';
import { extractSecret } from '../utils/importParser';

// 用户实测的接码地址形态（token 为脱敏占位值）
const SAMPLE_URL = 'https://sms6688.com/api/sms/recordText?token=a1b2c3d4e5f60718293a4b5c6d7e8f90&tpl=1';
const SAMPLE_INPUT = `12025550123|${SAMPLE_URL}`;

describe('normalizeSmsUrlInput / isSmsUrl', () => {
    it('接受合法 https 地址并完整保留查询串', () => {
        expect(normalizeSmsUrlInput(`  ${SAMPLE_URL}  `)).toBe(SAMPLE_URL);
        expect(isSmsUrl(SAMPLE_URL)).toBe(true);
    });

    it('允许其它同类接码服务的 https 地址（通用判断：https + 有 host）', () => {
        expect(normalizeSmsUrlInput('https://sms.example.com/get?x=1')).toBe('https://sms.example.com/get?x=1');
        expect(isSmsUrl('https://a.b')).toBe(true);
    });

    it('去掉包裹的引号 / 尖括号', () => {
        expect(normalizeSmsUrlInput(`"${SAMPLE_URL}"`)).toBe(SAMPLE_URL);
        expect(normalizeSmsUrlInput(`'${SAMPLE_URL}'`)).toBe(SAMPLE_URL);
        expect(normalizeSmsUrlInput(`<${SAMPLE_URL}>`)).toBe(SAMPLE_URL);
        expect(normalizeSmsUrlInput(`“${SAMPLE_URL}”`)).toBe(SAMPLE_URL);
    });

    it('非法输入返回空串', () => {
        expect(normalizeSmsUrlInput('')).toBe('');
        expect(normalizeSmsUrlInput(null)).toBe('');
        expect(normalizeSmsUrlInput(undefined)).toBe('');
        expect(normalizeSmsUrlInput('http://sms6688.com/x?t=1')).toBe('');
        expect(normalizeSmsUrlInput('sms6688.com/x')).toBe('');
        expect(normalizeSmsUrlInput('https://')).toBe('');
        expect(normalizeSmsUrlInput('not a url')).toBe('');
        expect(isSmsUrl('ftp://sms6688.com')).toBe(false);
    });
});

describe('extractSmsUrl', () => {
    it('从整串输入中提取完整地址（含 &tpl=1）', () => {
        expect(extractSmsUrl(SAMPLE_INPUT)).toBe(SAMPLE_URL);
    });

    it('无 URL 返回空串', () => {
        expect(extractSmsUrl('12025550123')).toBe('');
        expect(extractSmsUrl('')).toBe('');
        expect(extractSmsUrl(null)).toBe('');
    });

    it('只保留 https 地址，跳过 http 链接', () => {
        expect(extractSmsUrl('http://plain.example.com/a 然后 https://sms6688.com/x?t=1'))
            .toBe('https://sms6688.com/x?t=1');
    });
});

describe('protectSmsUrls / restoreSmsUrls', () => {
    it('URL 内含 | 时也不被截断', () => {
        const { text, urls } = protectSmsUrls('12025550123|https://x.com/a?b=1|c=2');
        expect(urls).toEqual(['https://x.com/a?b=1|c=2']);
        expect(text).not.toContain('https://');
        expect(text).toContain('12025550123|');
        expect(restoreSmsUrls(text, urls)).toBe('12025550123|https://x.com/a?b=1|c=2');
    });

    it('URL 后紧跟字段分隔符时不会被吞掉', () => {
        const { urls } = protectSmsUrls('a@gmail.com|p|https://sms6688.com/api/sms/recordText?token=t&tpl=1|2019|India');
        expect(urls).toEqual(['https://sms6688.com/api/sms/recordText?token=t&tpl=1']);
    });

    it('普通 ---- 分隔的 2fa.live 链接保持完整', () => {
        const { urls } = protectSmsUrls('a@gmail.com----p----https://2fa.live/tok/jbswy3dpehpk3pxp');
        expect(urls).toEqual(['https://2fa.live/tok/jbswy3dpehpk3pxp']);
    });

    it('removeProtectedUrls 能把地址整段剥离，token 不残留', () => {
        const { text, urls } = protectSmsUrls(SAMPLE_INPUT);
        const stripped = removeProtectedUrls(text);
        expect(stripped).not.toContain('a1b2c3d4e5f60718293a4b5c6d7e8f90');
        expect(stripped).not.toContain('tpl');
        expect(urls).toHaveLength(1);
    });

    it('extractProtectedUrls 按出现顺序还原', () => {
        const { text, urls } = protectSmsUrls('https://a.b/1 与 https://c.d/2');
        expect(extractProtectedUrls(text, urls)).toEqual(['https://a.b/1', 'https://c.d/2']);
    });
});

describe('extractPhoneAndSmsUrl', () => {
    it('用户示例：整串准确拆成号码与完整地址', () => {
        expect(extractPhoneAndSmsUrl(SAMPLE_INPUT)).toEqual({
            phone: '+12025550123',
            smsUrl: SAMPLE_URL,
        });
    });

    it('必须先剥离 URL 再解析号码：token / tpl 的数字不混入手机号', () => {
        const { phone } = extractPhoneAndSmsUrl(SAMPLE_INPUT);
        expect(phone).toBe('+12025550123');
        expect(phone).not.toContain('242');
        expect(phone).not.toContain('9021');
        expect(phone.replace(/\D/g, '')).toBe('12025550123');
    });

    it('只给 URL 时号码为空，地址仍返回', () => {
        expect(extractPhoneAndSmsUrl(` ${SAMPLE_URL}`)).toEqual({ phone: '', smsUrl: SAMPLE_URL });
        expect(extractPhoneAndSmsUrl(`"${SAMPLE_URL}"`)).toEqual({ phone: '', smsUrl: SAMPLE_URL });
    });

    it('只给号码时地址为空，号码沿用既有规则', () => {
        expect(extractPhoneAndSmsUrl('13812345678')).toEqual({ phone: '+8613812345678', smsUrl: '' });
        expect(extractPhoneAndSmsUrl('+1 2192731268')).toEqual({ phone: '+12192731268', smsUrl: '' });
    });

    it('带分隔符前缀的整串同样可拆', () => {
        expect(extractPhoneAndSmsUrl(`13812345678|${SAMPLE_URL}`)).toEqual({
            phone: '+8613812345678',
            smsUrl: SAMPLE_URL,
        });
        expect(extractPhoneAndSmsUrl(`13812345678 || ${SAMPLE_URL}`)).toEqual({
            phone: '+8613812345678',
            smsUrl: SAMPLE_URL,
        });
    });

    it('空输入返回空结果', () => {
        expect(extractPhoneAndSmsUrl('')).toEqual({ phone: '', smsUrl: '' });
        expect(extractPhoneAndSmsUrl('   ')).toEqual({ phone: '', smsUrl: '' });
        expect(extractPhoneAndSmsUrl(null)).toEqual({ phone: '', smsUrl: '' });
    });

    it('非 https 地址不写入 smsUrl', () => {
        expect(extractPhoneAndSmsUrl('13812345678|http://sms6688.com/x?t=1')).toEqual({
            phone: '+8613812345678',
            smsUrl: '',
        });
    });
});

describe('detachSmsUrl', () => {
    it('从字段中剥离出地址与剩余号码文本', () => {
        const { text, urls } = protectSmsUrls(SAMPLE_INPUT);
        const detached = detachSmsUrl(text, urls);
        expect(detached.smsUrl).toBe(SAMPLE_URL);
        expect(detached.rest).toBe('12025550123');
        expect(detached.raw).toBe(SAMPLE_URL);
    });

    it('不含占位符的字段原样返回', () => {
        expect(detachSmsUrl('13812345678', [])).toEqual({
            smsUrl: '',
            rest: '13812345678',
            raw: '',
        });
    });

    it('字段内 URL 是 http 时视为未命中', () => {
        const { text, urls } = protectSmsUrls('13812345678|http://sms6688.com/x?t=1');
        const detached = detachSmsUrl(text, urls);
        expect(detached.smsUrl).toBe('');
        expect(detached.rest).toContain('http://sms6688.com/x?t=1');
    });
});

describe('describeSmsUrl', () => {
    it('只返回 host', () => {
        expect(describeSmsUrl(SAMPLE_URL)).toBe('sms6688.com');
        expect(describeSmsUrl(SAMPLE_URL)).not.toContain('token');
        expect(describeSmsUrl(SAMPLE_URL)).not.toContain('242a');
        expect(describeSmsUrl('https://sub.example.com/a?token=x')).toBe('sub.example.com');
    });

    it('无有效地址返回空串', () => {
        expect(describeSmsUrl('')).toBe('');
        expect(describeSmsUrl(null)).toBe('');
        expect(describeSmsUrl('not-a-url')).toBe('');
        expect(describeSmsUrl('http://sms6688.com/x')).toBe('');
    });

    it('永不返回 token 或完整 URL', () => {
        const described = describeSmsUrl(SAMPLE_URL);
        expect(SAMPLE_URL.includes(described)).toBe(true);
        expect(described.length).toBeLessThan(SAMPLE_URL.length);
        expect(described).not.toContain('/');
    });
});

describe('maskSmsUrl', () => {
    it('token 值被替换为 ***，其它参数保留', () => {
        const masked = maskSmsUrl(SAMPLE_URL);
        expect(masked).toBe('https://sms6688.com/api/sms/recordText?token=***&tpl=1');
        expect(masked).not.toContain('a1b2c3d4e5f60718293a4b5c6d7e8f90');
    });

    it('多个敏感参数都被脱敏', () => {
        expect(maskSmsUrl('https://a.b/c?token=abc&tpl=1&api_key=xyz'))
            .toBe('https://a.b/c?token=***&tpl=1&api_key=***');
        expect(maskSmsUrl('https://a.b/c?access_token=abc&refresh_token=def'))
            .toBe('https://a.b/c?access_token=***&refresh_token=***');
        expect(maskSmsUrl('/api/sms/recordText?token=abc&tpl=1'))
            .toBe('/api/sms/recordText?token=***&tpl=1');
    });

    it('已脱敏的地址保持稳定（幂等）', () => {
        const once = maskSmsUrl(SAMPLE_URL);
        expect(maskSmsUrl(once)).toBe(once);
    });

    it('空值返回空串', () => {
        expect(maskSmsUrl('')).toBe('');
        expect(maskSmsUrl(null)).toBe('');
        expect(maskSmsUrl(undefined)).toBe('');
    });
});

describe('formatSmsCountdown', () => {
    it('输出 5s 形式', () => {
        expect(formatSmsCountdown(5)).toBe('5s');
        expect(formatSmsCountdown('7')).toBe('7s');
        expect(formatSmsCountdown(3.2)).toBe('4s');
    });

    it('非正数 / 非数字返回空串', () => {
        expect(formatSmsCountdown(0)).toBe('');
        expect(formatSmsCountdown(-1)).toBe('');
        expect(formatSmsCountdown(null)).toBe('');
        expect(formatSmsCountdown(undefined)).toBe('');
        expect(formatSmsCountdown('abc')).toBe('');
        expect(formatSmsCountdown(NaN)).toBe('');
    });
});

describe('isSmsCodeUrl（已知接码服务特征）', () => {
    it('识别 sms6688 与 /api/sms/recordText', () => {
        expect(isSmsCodeUrl(SAMPLE_URL)).toBe(true);
        expect(isSmsCodeUrl('https://other.com/api/sms/recordText?token=t')).toBe(true);
        expect(isSmsCodeUrl('https://sms6688.com/anything')).toBe(true);
    });

    it('普通链接与 2fa.live 不误判', () => {
        expect(isSmsCodeUrl('https://example.com/should-be-skipped')).toBe(false);
        expect(isSmsCodeUrl('https://2fa.live/tok/jbswy3dpehpk3pxp')).toBe(false);
        expect(isSmsCodeUrl('http://sms6688.com/x')).toBe(false);
        expect(isSmsCodeUrl('')).toBe(false);
    });
});

describe('token 不会被当成 2FA 密钥', () => {
    it('URL 原文（含查询串）不会被 extractSecret 识别出密钥', () => {
        expect(extractSecret(SAMPLE_URL)).toBe('');
    });

    it('剥离地址后剩余文本无法供出 token', () => {
        const { text, urls } = protectSmsUrls(SAMPLE_INPUT);
        const stripped = removeProtectedUrls(detachSmsUrl(text, urls).rest);
        expect(extractSecret(stripped)).toBe('');
        expect(stripped).not.toContain('tpl');
    });

    it('全 base32 形态的 token 也不进入剥离后的文本', () => {
        const base32Token = 'https://sms6688.com/api/sms/recordText?token=ABCDEFGHIJKLMNOPQRSTUV&tpl=1';
        const { text, urls } = protectSmsUrls(`13812345678|${base32Token}`);
        const stripped = removeProtectedUrls(detachSmsUrl(text, urls).rest);
        expect(stripped).toBe('13812345678');
        expect(extractSecret(stripped)).toBe('');
    });
});

describe('SMS_URL_PATTERN', () => {
    it('是带 g 标志的 http(s) 正则', () => {
        expect(SMS_URL_PATTERN.flags).toContain('g');
        expect(SMS_URL_PATTERN.flags).toContain('i');
        expect('见 https://a.b/c?d=1'.match(SMS_URL_PATTERN)).toEqual(['https://a.b/c?d=1']);
    });
});
