import { vi } from 'vitest';

export const mockApi = {
  getAccounts: vi.fn().mockResolvedValue([]),
  batchImport: vi.fn().mockResolvedValue({ success: true, data: { success_count: 1, failed_count: 0, failed_emails: [] } }),
  updateAccount: vi.fn().mockResolvedValue({ success: true, data: {} }),
  deleteAccount: vi.fn().mockResolvedValue({ success: true }),
  toggleStatus: vi.fn().mockResolvedValue({ success: true, data: {} }),
  get2FACode: vi.fn().mockResolvedValue({ success: true, data: { code: '123456', expiry: 30 } }),
  // 手机短信验证码：默认返回一个固定验证码，避免测试真的联网
  fetchSmsCode: vi.fn().mockResolvedValue({
    success: true,
    data: {
      status: 'success',
      code: '821371',
      message: null,
      error: null,
      retryAfterSeconds: null,
      fetchedAt: new Date(0).toISOString(),
    },
  }),
};

export default mockApi;
