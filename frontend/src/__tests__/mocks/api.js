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
  // 账号独立浏览器：默认全部「未创建」，避免测试真的启动浏览器
  getBrowserStatuses: vi.fn().mockResolvedValue({ success: true, data: {} }),
  openAccountBrowser: vi.fn().mockResolvedValue({
    success: true,
    data: { action: 'launched', firstLaunch: false },
  }),
  getBrowserSettings: vi.fn().mockResolvedValue({
    success: true,
    data: {
      browserPath: null,
      detectedBrowserPath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      effectiveBrowserPath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      profilesRoot: 'E:\\GoogleManagerProfiles',
      defaultProfilesRoot: 'C:\\Users\\me\\AppData\\Local\\googlemanager\\profiles',
      effectiveProfilesRoot: 'E:\\GoogleManagerProfiles',
      configured: true,
    },
  }),
  saveBrowserSettings: vi.fn(),
  clearBrowserCache: vi.fn().mockResolvedValue({
    success: true,
    data: { cleared: 0, skippedRunning: 0, freedBytes: 0 },
  }),
  deleteBrowserProfiles: vi.fn().mockResolvedValue({
    success: true,
    data: { deleted: 0, skipped: 0 },
  }),
  getBrowserUsage: vi.fn().mockResolvedValue({
    success: true,
    data: { profiles: 0, totalBytes: 0 },
  }),
  openBrowserProfileDir: vi.fn().mockResolvedValue({ success: true }),
};

export default mockApi;
