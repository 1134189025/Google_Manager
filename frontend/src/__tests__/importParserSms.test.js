import { describe, it, expect } from 'vitest';
import { parseImportText } from '../utils/importParser';

/**
 * 真实格式回归：`手机号|完整接码地址` 混在批量导入行里时，
 * 号码解析不能被 URL 里的 token / tpl 数字污染，URL 也不能被分隔符截断。
 */
const URL = 'https://sms6688.com/api/sms/recordText?token=a1b2c3d4e5f60718293a4b5c6d7e8f90&tpl=1';

describe('接码地址混入批量导入', () => {
    it('---- 分隔：号码与接码地址各归其位', () => {
        const { parsed } = parseImportText(`a1@gmail.com----pw1----12025550123|${URL}`);
        const account = parsed[0];

        expect(account.email).toBe('a1@gmail.com');
        expect(account.sms_url).toBe(URL);
        expect(account.phone).toBe('+12025550123');
        // token 是 32 位十六进制，绝不能被当成 2FA 密钥或号码
        expect(String(account.phone)).not.toContain('242a9021');
        expect(account.secret).toBe('');
    });

    it('| 分隔：URL 的查询参数不会被截断', () => {
        const { parsed } = parseImportText(`a2@gmail.com|pw2|12025550123|${URL}`);
        const account = parsed[0];

        expect(account.sms_url).toBe(URL);
        expect(account.phone).toBe('+12025550123');
        expect(account.secret).toBe('');
    });

    it('尾字段形式：年份与国家仍能识别，且号码正确', () => {
        const { parsed } = parseImportText(`a3@gmail.com----pw3----+1 2025550123----2021----USA----${URL}`);
        const account = parsed[0];

        expect(account.phone).toBe('+12025550123');
        expect(account.reg_year).toBe('2021');
        expect(account.country.toLowerCase()).toBe('usa');
        expect(account.sms_url).toBe(URL);
    });

    it('没有接码地址时行为不变（原有格式不回归）', () => {
        const { parsed } = parseImportText('b1@gmail.com----pw1----backup@gmail.com----JBSWY3DPEHPK3PXP');
        const account = parsed[0];

        expect(account.recovery).toBe('backup@gmail.com');
        expect(account.secret).toBe('JBSWY3DPEHPK3PXP');
        expect(account.sms_url || '').toBe('');
    });
});
