/**
 * 全量导入集成测试
 *
 * 测试目标：
 * 1. 从零开始导入全量测试数据，验证解析正确性
 * 2. 反复导入（幂等性）：清空后重新导入，结果一致
 * 3. 导入后逐条验证数据字段正确性
 *
 * 注意：不涉及 UI 清理按钮，纯测试层验证
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseImportText } from '../utils/importParser';
import {
  FULL_TEST_DATA,
  EXPECTED_ACCOUNTS,
  EXPECTED_TOTAL_COUNT,
  FULL_FIELDS_DASH4,
  FULL_FIELDS_CN_DASH,
  PIPE_SEPARATED,
  DASH3_SEPARATED,
  DASH2_SEPARATED,
  SPECIAL_FORMAT,
  WITH_NOISE,
  WITH_GROUPS_AND_TAGS,
  WITH_YEAR_COUNTRY,
  WITH_2FA_URL,
  MINIMAL_FIELDS,
} from './fixtures/import-test-data';

// Mock API 层
const mockDeleteAllAccounts = vi.fn();
const mockBatchImport = vi.fn();
const mockGetAccounts = vi.fn();

vi.mock('../services/api', () => ({
  default: {
    deleteAllAccounts: (...args) => mockDeleteAllAccounts(...args),
    batchImport: (...args) => mockBatchImport(...args),
    getAccounts: (...args) => mockGetAccounts(...args),
  },
}));

/**
 * 模拟"清空并导入"流程：
 * 1. 调用 deleteAllAccounts 清空数据库
 * 2. 解析导入文本
 * 3. 调用 batchImport 导入解析结果
 * 4. 调用 getAccounts 查询导入后的数据
 */
async function clearAndImport(importText) {
  // 清空
  const deleteResult = await (await import('../services/api')).default.deleteAllAccounts();
  if (!deleteResult.success) throw new Error('清空失败: ' + deleteResult.message);

  // 解析
  const { parsed } = parseImportText(importText);
  if (parsed.length === 0) throw new Error('解析结果为空');

  // 导入
  const importResult = await (await import('../services/api')).default.batchImport(parsed);
  if (!importResult.success) throw new Error('导入失败: ' + importResult.message);

  // 查询
  const accounts = await (await import('../services/api')).default.getAccounts();
  return { parsed, importResult, accounts };
}

describe('全量导入集成测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteAllAccounts.mockResolvedValue({ success: true, data: 0 });
    mockBatchImport.mockImplementation((accounts) =>
      Promise.resolve({ success: true, successCount: accounts.length, failCount: 0 })
    );
    mockGetAccounts.mockImplementation(() => Promise.resolve([]));
  });

  describe('解析正确性：全量数据', () => {
    it('全量数据解析出正确的总条数', () => {
      const { parsed } = parseImportText(FULL_TEST_DATA);
      expect(parsed).toHaveLength(EXPECTED_TOTAL_COUNT);
    });

    it('全量数据逐条字段验证', () => {
      const { parsed } = parseImportText(FULL_TEST_DATA);
      for (let i = 0; i < EXPECTED_ACCOUNTS.length; i++) {
        const actual = parsed[i];
        const expected = EXPECTED_ACCOUNTS[i];
        expect(actual, `第 ${i + 1} 条 (${expected.email}) 不匹配`).toMatchObject(expected);
      }
    });

    it('所有邮箱唯一，无重复', () => {
      const { parsed } = parseImportText(FULL_TEST_DATA);
      const emails = parsed.map((a) => a.email);
      expect(new Set(emails).size).toBe(emails.length);
    });
  });

  describe('分格式解析验证', () => {
    it('---- 分隔符解析正确', () => {
      const { parsed } = parseImportText(FULL_FIELDS_DASH4);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].email).toBe('alice@gmail.com');
      expect(parsed[0].secret).toBe('JBSWY3DPEHPK3PXP');
      expect(parsed[1].reg_year).toBe('2021');
      expect(parsed[1].country).toBe('India');
    });

    it('—— 分隔符 + 手机号解析正确', () => {
      const { parsed } = parseImportText(FULL_FIELDS_CN_DASH);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].phone).toBe('+8613812345678');
      expect(parsed[1].phone).toBe('+8615900001111');
    });

    it('| 分隔符解析正确（含可选字段缺失）', () => {
      const { parsed } = parseImportText(PIPE_SEPARATED);
      expect(parsed).toHaveLength(4);
      expect(parsed[2].recovery).toBe('rec_grace@gmail.com');
      expect(parsed[2].secret).toBe('');
      expect(parsed[3].recovery).toBe('');
      expect(parsed[3].secret).toBe('MFZWQ5DJNZTSA3TP');
    });

    it('--- 分隔符解析正确', () => {
      const { parsed } = parseImportText(DASH3_SEPARATED);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].secret).toBe('GEZDGNBVGY3TQOJQ');
      expect(parsed[1].secret).toBe('');
    });

    it('-- 分隔符解析正确', () => {
      const { parsed } = parseImportText(DASH2_SEPARATED);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].email).toBe('kate@gmail.com');
      expect(parsed[1].recovery).toBe('');
    });

    it('特殊格式（卡号：密码：）解析正确', () => {
      const { parsed } = parseImportText(SPECIAL_FORMAT);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].email).toBe('special1@gmail.com');
      expect(parsed[0].password).toBe('sp8c1@l01');
      expect(parsed[0].secret).toBe('JBSWY3DPEHPK3PXP');
    });

    it('噪声行被正确过滤', () => {
      const { parsed } = parseImportText(WITH_NOISE);
      expect(parsed).toHaveLength(3);
      expect(parsed.map((a) => a.email)).toEqual([
        'noise1@gmail.com',
        'noise2@gmail.com',
        'noise3@gmail.com',
      ]);
    });

    it('分组前缀和标注解析正确', () => {
      const { parsed } = parseImportText(WITH_GROUPS_AND_TAGS);
      expect(parsed).toHaveLength(3);
      expect(parsed[0].group_name).toBe('主号');
      expect(parsed[0].remark).toBe('VIP');
      expect(parsed[1].group_name).toBe('成员1');
      expect(parsed[1].remark).toBe('重要');
      expect(parsed[2].group_name).toBe('成员2');
      expect(parsed[2].secret).toBe('GEZDGNBVGY3TQOJQ');
    });

    it('年份和国家解析正确', () => {
      const { parsed } = parseImportText(WITH_YEAR_COUNTRY);
      expect(parsed).toHaveLength(3);
      expect(parsed[0].reg_year).toBe('2020');
      expect(parsed[0].country).toBe('China');
      expect(parsed[2].reg_year).toBe('2019');
      expect(parsed[2].country).toBe('India');
    });

    it('2fa.live URL 密钥提取正确', () => {
      const { parsed } = parseImportText(WITH_2FA_URL);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].secret).toBe('JBSWY3DPEHPK3PXP');
      expect(parsed[1].secret).toBe('NFXHA5DFMRWGK3TD');
    });

    it('最小字段（仅邮箱+密码）各分隔符均正确', () => {
      const { parsed } = parseImportText(MINIMAL_FIELDS);
      expect(parsed).toHaveLength(5);
      parsed.forEach((account) => {
        expect(account.email).toMatch(/@gmail\.com$/);
        expect(account.password).toBeTruthy();
        expect(account.recovery).toBe('');
        expect(account.secret).toBe('');
      });
    });
  });

  describe('清空并导入流程', () => {
    it('从零导入全量数据，API 调用正确', async () => {
      const { parsed } = parseImportText(FULL_TEST_DATA);
      mockGetAccounts.mockResolvedValue(parsed);

      const result = await clearAndImport(FULL_TEST_DATA);

      expect(mockDeleteAllAccounts).toHaveBeenCalledTimes(1);
      expect(mockBatchImport).toHaveBeenCalledTimes(1);
      expect(mockBatchImport).toHaveBeenCalledWith(parsed);
      expect(result.importResult.successCount).toBe(EXPECTED_TOTAL_COUNT);
      expect(result.importResult.failCount).toBe(0);
    });

    it('导入后查询返回的数据与解析结果一致', async () => {
      const { parsed } = parseImportText(FULL_TEST_DATA);
      mockGetAccounts.mockResolvedValue(parsed);

      const result = await clearAndImport(FULL_TEST_DATA);

      expect(result.accounts).toHaveLength(EXPECTED_TOTAL_COUNT);
      for (let i = 0; i < EXPECTED_ACCOUNTS.length; i++) {
        expect(result.accounts[i]).toMatchObject(EXPECTED_ACCOUNTS[i]);
      }
    });
  });

  describe('幂等性：反复清空并导入', () => {
    it('连续 3 次清空并导入，每次结果一致', async () => {
      const { parsed } = parseImportText(FULL_TEST_DATA);

      for (let round = 1; round <= 3; round++) {
        vi.clearAllMocks();
        mockDeleteAllAccounts.mockResolvedValue({ success: true, data: round === 1 ? 0 : EXPECTED_TOTAL_COUNT });
        mockBatchImport.mockImplementation((accounts) =>
          Promise.resolve({ success: true, successCount: accounts.length, failCount: 0 })
        );
        mockGetAccounts.mockResolvedValue(parsed);

        const result = await clearAndImport(FULL_TEST_DATA);

        expect(result.importResult.successCount, `第 ${round} 轮导入数量不一致`).toBe(EXPECTED_TOTAL_COUNT);
        expect(result.accounts, `第 ${round} 轮查询数量不一致`).toHaveLength(EXPECTED_TOTAL_COUNT);

        // 逐条验证
        for (let i = 0; i < EXPECTED_ACCOUNTS.length; i++) {
          expect(result.accounts[i], `第 ${round} 轮第 ${i + 1} 条不匹配`).toMatchObject(EXPECTED_ACCOUNTS[i]);
        }
      }
    });

    it('解析函数本身是幂等的（多次调用结果相同）', () => {
      const result1 = parseImportText(FULL_TEST_DATA);
      const result2 = parseImportText(FULL_TEST_DATA);
      const result3 = parseImportText(FULL_TEST_DATA);

      expect(result1.parsed).toEqual(result2.parsed);
      expect(result2.parsed).toEqual(result3.parsed);
      expect(result1.parsed).toHaveLength(EXPECTED_TOTAL_COUNT);
    });
  });

  describe('边界情况', () => {
    it('空文本导入应抛出错误', async () => {
      await expect(clearAndImport('')).rejects.toThrow('解析结果为空');
    });

    it('纯噪声文本（无有效数据）应抛出错误', async () => {
      const noiseOnly = '# 注释\n// 注释\nhttps://example.com\n--------\n';
      await expect(clearAndImport(noiseOnly)).rejects.toThrow('解析结果为空');
    });

    it('deleteAllAccounts 失败时应抛出错误', async () => {
      mockDeleteAllAccounts.mockResolvedValue({ success: false, message: '数据库锁定' });
      await expect(clearAndImport(FULL_TEST_DATA)).rejects.toThrow('清空失败');
    });

    it('batchImport 失败时应抛出错误', async () => {
      mockBatchImport.mockResolvedValue({ success: false, message: '导入异常' });
      await expect(clearAndImport(FULL_TEST_DATA)).rejects.toThrow('导入失败');
    });
  });
});
