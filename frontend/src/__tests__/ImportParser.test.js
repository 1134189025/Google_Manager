import { describe, it, expect } from 'vitest';
import {
    isEmail,
    isPhoneNumber,
    normalizePhoneNumber,
    isYear,
    isCountry,
    extractSecret,
    extractGroup,
    extractTags,
    cleanTags,
    shouldSkipLine,
    detectAndSplit,
    parseImportText,
} from '../utils/importParser';

describe('isEmail', () => {
    it('识别有效邮箱', () => {
        expect(isEmail('test@gmail.com')).toBe(true);
        expect(isEmail('user.name@example.co.uk')).toBe(true);
        expect(isEmail('a@b.c')).toBe(true);
    });

    it('拒绝无效邮箱', () => {
        expect(isEmail('notanemail')).toBeFalsy();
        expect(isEmail('@gmail.com')).toBeFalsy();
        expect(isEmail('')).toBeFalsy();
        expect(isEmail(null)).toBeFalsy();
        expect(isEmail(undefined)).toBeFalsy();
    });
});

describe('isPhoneNumber', () => {
    it('识别中国手机号', () => {
        expect(isPhoneNumber('13812345678')).toBe(true);
        expect(isPhoneNumber('15900001111')).toBe(true);
    });

    it('识别国际格式手机号', () => {
        expect(isPhoneNumber('+8613812345678')).toBe(true);
        expect(isPhoneNumber('+1234567890')).toBe(true);
    });

    it('拒绝无效手机号', () => {
        expect(isPhoneNumber('12345')).toBe(false);
        expect(isPhoneNumber('abcdefghijk')).toBe(false);
        expect(isPhoneNumber('')).toBe(false);
        expect(isPhoneNumber(null)).toBe(false);
    });
});

describe('normalizePhoneNumber', () => {
    it('默认补 +86', () => {
        expect(normalizePhoneNumber('13812345678')).toBe('+8613812345678');
        expect(normalizePhoneNumber(' 13800138000 ')).toBe('+8613800138000');
    });

    it('保留显式国家码', () => {
        expect(normalizePhoneNumber('+1 2192731268')).toBe('+12192731268');
        expect(normalizePhoneNumber('008613812345678')).toBe('+8613812345678');
    });

    it('识别分段国家码 + 本地号', () => {
        expect(normalizePhoneNumber('1 2192731268')).toBe('+12192731268');
        expect(normalizePhoneNumber('44-7700-900123')).toBe('+447700900123');
        expect(normalizePhoneNumber('86 13812345678')).toBe('+8613812345678');
    });

    it('识别国家提示词 + 号码组合', () => {
        expect(normalizePhoneNumber('US 2192731268')).toBe('+12192731268');
        expect(normalizePhoneNumber('CN 13812345678')).toBe('+8613812345678');
        expect(normalizePhoneNumber('中国 13812345678')).toBe('+8613812345678');
        expect(normalizePhoneNumber('CN 中国 (+86) 13812345678')).toBe('+8613812345678');
    });

    it('识别 011 国际前缀', () => {
        expect(normalizePhoneNumber('011442070313000')).toBe('+442070313000');
    });
});

describe('isYear', () => {
    it('识别有效年份 (2015-2030)', () => {
        expect(isYear('2015')).toBe(true);
        expect(isYear('2021')).toBe(true);
        expect(isYear('2030')).toBe(true);
    });

    it('拒绝无效年份', () => {
        expect(isYear('2014')).toBe(false);
        expect(isYear('2031')).toBe(false);
        expect(isYear('abcd')).toBe(false);
        expect(isYear('20')).toBe(false);
        expect(isYear('')).toBe(false);
        expect(isYear(null)).toBe(false);
    });
});

describe('isCountry', () => {
    it('识别常见国家名', () => {
        expect(isCountry('China')).toBe(true);
        expect(isCountry('india')).toBe(true);
        expect(isCountry('USA')).toBe(true);
        expect(isCountry('Japan')).toBe(true);
    });

    it('拒绝非国家名', () => {
        expect(isCountry('password123')).toBe(false);
        expect(isCountry('')).toBe(false);
        expect(isCountry(null)).toBe(false);
    });
});

describe('extractSecret', () => {
    it('提取有效的 Base32 密钥', () => {
        expect(extractSecret('JBSWY3DPEHPK3PXP')).toBe('JBSWY3DPEHPK3PXP');
        expect(extractSecret('5AMG4HOE2ZBVS2R5')).toBe('5AMG4HOE2ZBVS2R5');
    });

    it('从 2fa.live URL 提取密钥', () => {
        expect(extractSecret('https://2fa.live/tok/jbswy3dpehpk3pxp')).toBe('JBSWY3DPEHPK3PXP');
        expect(extractSecret('https://2fa.live/ok/jbswy3dpehpk3pxp')).toBe('JBSWY3DPEHPK3PXP');
    });

    it('清理密钥中的空格', () => {
        expect(extractSecret('JBSW Y3DP EHPK 3PXP')).toBe('JBSWY3DPEHPK3PXP');
    });

    it('拒绝无效密钥', () => {
        expect(extractSecret('short')).toBe('');
        expect(extractSecret('password123')).toBe('');
        expect(extractSecret('')).toBe('');
        expect(extractSecret(null)).toBe('');
    });
});

describe('extractGroup', () => {
    it('提取分组前缀', () => {
        expect(extractGroup('主号：test@gmail.com')).toEqual({ group: '主号', rest: 'test@gmail.com' });
        expect(extractGroup('成员1：test@gmail.com')).toEqual({ group: '成员1', rest: 'test@gmail.com' });
    });

    it('无分组前缀返回空', () => {
        expect(extractGroup('test@gmail.com----pass')).toEqual({ group: '', rest: 'test@gmail.com----pass' });
    });
});

describe('extractTags / cleanTags', () => {
    it('提取标注', () => {
        expect(extractTags('test <VIP> <重要>')).toBe('VIP 重要');
        expect(extractTags('no tags here')).toBe('');
    });

    it('清理标注', () => {
        expect(cleanTags('test <VIP> content')).toBe('test  content');
        expect(cleanTags('no tags')).toBe('no tags');
    });
});

describe('shouldSkipLine', () => {
    it('跳过空行', () => {
        expect(shouldSkipLine('')).toBe(true);
        expect(shouldSkipLine('   ')).toBe(true);
    });

    it('跳过注释行', () => {
        expect(shouldSkipLine('# 这是注释')).toBe(true);
        expect(shouldSkipLine('// 这也是注释')).toBe(true);
    });

    it('跳过 URL 行', () => {
        expect(shouldSkipLine('https://example.com')).toBe(true);
        expect(shouldSkipLine('http://example.com')).toBe(true);
    });

    it('跳过分组标题行', () => {
        expect(shouldSkipLine('第1组')).toBe(true);
        expect(shouldSkipLine('第二组')).toBe(true);
        expect(shouldSkipLine('待加入')).toBe(true);
    });

    it('跳过纯分隔线', () => {
        expect(shouldSkipLine('--------')).toBe(true);
        expect(shouldSkipLine('=========')).toBe(true);
    });

    it('跳过代码块标记行', () => {
        expect(shouldSkipLine('```')).toBe(true);
    });

    it('不跳过有效数据行', () => {
        expect(shouldSkipLine('test@gmail.com----password')).toBe(false);
    });
});

describe('detectAndSplit', () => {
    it('识别 ---- 分隔符', () => {
        const result = detectAndSplit('a----b----c');
        expect(result.separator).toBe('----');
        expect(result.parts).toEqual(['a', 'b', 'c']);
    });

    it('识别 —— 分隔符', () => {
        const result = detectAndSplit('a——b——c');
        expect(result.separator).toBe('——');
        expect(result.parts).toEqual(['a', 'b', 'c']);
    });

    it('识别 --- 分隔符', () => {
        const result = detectAndSplit('a---b---c');
        expect(result.separator).toBe('---');
        expect(result.parts).toEqual(['a', 'b', 'c']);
    });

    it('识别 | 分隔符', () => {
        const result = detectAndSplit('a|b|c');
        expect(result.separator).toBe('|');
        expect(result.parts).toEqual(['a', 'b', 'c']);
    });

    it('识别 -- 分隔符', () => {
        const result = detectAndSplit('a--b--c');
        expect(result.separator).toBe('--');
        expect(result.parts).toEqual(['a', 'b', 'c']);
    });

    it('无分隔符返回整行', () => {
        const result = detectAndSplit('test@gmail.com');
        expect(result.separator).toBe('无分隔符');
        expect(result.parts).toEqual(['test@gmail.com']);
    });

    it('分隔符优先级: ---- > ---', () => {
        const result = detectAndSplit('a----b---c');
        expect(result.separator).toBe('----');
    });
});

describe('parseImportText', () => {
    it('空文本返回空结果', () => {
        const result = parseImportText('');
        expect(result.parsed).toEqual([]);
        expect(result.detectedFormats).toEqual([]);
    });

    it('解析 ---- 分隔的基本格式', () => {
        const result = parseImportText('test@gmail.com----password123');
        expect(result.parsed).toHaveLength(1);
        expect(result.parsed[0].email).toBe('test@gmail.com');
        expect(result.parsed[0].password).toBe('password123');
    });

    it('解析多行批量导入', () => {
        const text = 'a@gmail.com----pass1\nb@gmail.com----pass2\nc@gmail.com----pass3';
        const result = parseImportText(text);
        expect(result.parsed).toHaveLength(3);
        expect(result.parsed[0].email).toBe('a@gmail.com');
        expect(result.parsed[2].email).toBe('c@gmail.com');
    });

    it('解析含恢复邮箱的格式', () => {
        const result = parseImportText('test@gmail.com----pass123----recovery@example.com');
        expect(result.parsed).toHaveLength(1);
        expect(result.parsed[0].email).toBe('test@gmail.com');
        expect(result.parsed[0].recovery).toBe('recovery@example.com');
    });

    it('解析含 2FA 密钥的格式', () => {
        const result = parseImportText('test@gmail.com----pass123----recovery@example.com----JBSWY3DPEHPK3PXP');
        expect(result.parsed).toHaveLength(1);
        expect(result.parsed[0].secret).toBe('JBSWY3DPEHPK3PXP');
    });

    it('解析含年份和国家的格式', () => {
        const result = parseImportText('test@gmail.com----pass123----2021----India');
        expect(result.parsed).toHaveLength(1);
        expect(result.parsed[0].reg_year).toBe('2021');
        expect(result.parsed[0].country).toBe('India');
    });

    it('解析含手机号的格式', () => {
        const result = parseImportText('test@gmail.com----pass123----13812345678');
        expect(result.parsed).toHaveLength(1);
        expect(result.parsed[0].phone).toBe('+8613812345678');
    });

    it('跳过注释行和空行', () => {
        const text = '# 这是注释\ntest@gmail.com----pass123\n\n// 另一个注释\nuser@gmail.com----pass456';
        const result = parseImportText(text);
        expect(result.parsed).toHaveLength(2);
    });

    it('解析 | 分隔符格式', () => {
        const result = parseImportText('test@gmail.com|pass123|recovery@example.com|JBSWY3DPEHPK3PXP');
        expect(result.parsed).toHaveLength(1);
        expect(result.parsed[0].email).toBe('test@gmail.com');
        expect(result.parsed[0].password).toBe('pass123');
        expect(result.parsed[0].recovery).toBe('recovery@example.com');
        expect(result.parsed[0].secret).toBe('JBSWY3DPEHPK3PXP');
    });

    it('密码即使是 base32 形态也不应被识别为 secret', () => {
        const line = 'demouser559@gmail.com|qwhtrmkpz|demouser55923433@example.site|abcdefghijklmnopqrstuvwxyz234567';
        const result = parseImportText(line);
        expect(result.parsed).toHaveLength(1);
        expect(result.parsed[0].password).toBe('qwhtrmkpz');
        expect(result.parsed[0].recovery).toBe('demouser55923433@example.site');
        expect(result.parsed[0].secret).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567');
    });

    it('解析特殊格式并提取恢复邮箱与2FA', () => {
        const line = '卡号：DemoCardUser68@gmail.com密码：Demo10@123456xb22 ----DemoCardUser6864647@example.site ----mfrggzdfmztwq2lknnwg23tpobyxe43u';
        const result = parseImportText(line);
        expect(result.parsed).toHaveLength(1);
        expect(result.parsed[0].email).toBe('DemoCardUser68@gmail.com');
        expect(result.parsed[0].password).toBe('Demo10@123456xb22');
        expect(result.parsed[0].recovery).toBe('DemoCardUser6864647@example.site');
        expect(result.parsed[0].secret).toBe('MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U');
    });

    it('解析组合字段中的年份与手机号', () => {
        const line = 'demouser666@gmail.com----5ab8xQWERTY----demorecovery@example.org----2021   -- 13800138000';
        const result = parseImportText(line);
        expect(result.parsed).toHaveLength(1);
        expect(result.parsed[0].reg_year).toBe('2021');
        expect(result.parsed[0].phone).toBe('+8613800138000');
    });

    it('检测混合分隔符并报告', () => {
        const text = 'a@gmail.com----pass1\nb@gmail.com|pass2';
        const result = parseImportText(text);
        expect(result.parsed).toHaveLength(2);
        expect(result.detectedFormats.length).toBeGreaterThan(0);
        expect(result.detectedFormats[0]).toContain('分隔符');
    });

    it('解析特殊格式: 卡号：xxx密码：xxx----2FA密钥', () => {
        const result = parseImportText('卡号：test@gmail.com密码：pass123----JBSWY3DPEHPK3PXP');
        expect(result.parsed).toHaveLength(1);
        expect(result.parsed[0].email).toBe('test@gmail.com');
        expect(result.parsed[0].password).toBe('pass123');
        expect(result.parsed[0].secret).toBe('JBSWY3DPEHPK3PXP');
    });

    it('从 2fa.live URL 提取密钥', () => {
        const result = parseImportText('test@gmail.com----pass123----https://2fa.live/tok/jbswy3dpehpk3pxp');
        expect(result.parsed).toHaveLength(1);
        expect(result.parsed[0].secret).toBe('JBSWY3DPEHPK3PXP');
    });

    it('跳过纯 URL 行', () => {
        const text = 'https://example.com\ntest@gmail.com----pass123';
        const result = parseImportText(text);
        expect(result.parsed).toHaveLength(1);
        expect(result.parsed[0].email).toBe('test@gmail.com');
    });

    it('跳过无邮箱的行', () => {
        const result = parseImportText('notanemail----password');
        expect(result.parsed).toHaveLength(0);
    });

    it('跳过缺少密码的行', () => {
        const result = parseImportText('only-email@gmail.com');
        expect(result.parsed).toHaveLength(0);
    });

    it('检测部分行有恢复邮箱部分没有', () => {
        const text = 'a@gmail.com----pass1----recovery@gmail.com\nb@gmail.com----pass2';
        const result = parseImportText(text);
        expect(result.parsed).toHaveLength(2);
        const hasRecoveryFormat = result.detectedFormats.find(f => f.includes('恢复邮箱'));
        expect(hasRecoveryFormat).toBeTruthy();
    });
});
