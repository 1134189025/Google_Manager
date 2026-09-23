// frontend/src/services/types.ts

export interface Account {
  id: number;
  email: string;
  password: string;
  recovery: string | null;
  phone: string | null;
  secret: string | null;
  smsUrl: string | null;
  regYear: string | null;
  country: string | null;
  groupName: string | null;
  remark: string | null;
  status: 'pro' | 'inactive';
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface AccountInput {
  email: string;
  password: string;
  recovery?: string;
  phone?: string;
  secret?: string;
  smsUrl?: string;
  regYear?: string;
  country?: string;
  groupName?: string;
  remark?: string;
}

export interface BatchImportResult {
  successCount: number;
  failCount: number;
}

export interface TotpResult {
  code: string;
  remaining: number;
}

/**
 * 手机短信验证码查询结果（与 Rust `SmsFetchResult` 契约一致）
 * status:
 * - success      取到验证码
 * - empty        暂无短信（继续等待）
 * - invalid_link 接码链接已失效（暂停自动重试）
 * - unparsable   响应无法识别出验证码
 * - no_config    未配置接码地址
 * - error        网络/服务异常
 */
export interface SmsCodeResult {
  status: 'success' | 'empty' | 'invalid_link' | 'unparsable' | 'no_config' | 'error';
  code: string | null;
  message: string | null;
  error: string | null;
  retryAfterSeconds: number | null;
  fetchedAt: string;
}

export interface BackupInfo {
  name: string;
  sizeBytes: number;
  createdAt: string;
  checksum?: string | null;
}

/**
 * 账号独立浏览器的配置目录状态：
 * - none     还没有配置目录（从未打开过）
 * - created  有配置目录，浏览器未运行
 * - running  浏览器正在运行
 */
export type BrowserStatus = 'none' | 'created' | 'running';

/** 以邮箱为键的状态表（键是原始邮箱，不能做大小写/命名转换） */
export type BrowserStatusMap = Record<string, BrowserStatus>;

export interface OpenBrowserResult {
  action: 'launched' | 'focused' | 'new_window';
  firstLaunch: boolean;
}

export interface BrowserSettings {
  browserPath: string | null;
  detectedBrowserPath: string | null;
  effectiveBrowserPath: string | null;
  profilesRoot: string | null;
  defaultProfilesRoot: string;
  effectiveProfilesRoot: string;
  configured: boolean;
}

export interface BrowserSettingsInput {
  browserPath: string | null;
  profilesRoot: string | null;
}

export interface ClearBrowserCacheResult {
  cleared: number;
  skippedRunning: number;
  freedBytes: number;
}

export interface DeleteBrowserProfilesResult {
  deleted: number;
  skipped: number;
}

export interface BrowserUsage {
  profiles: number;
  totalBytes: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
}

export type ExportDataField =
  | 'email'
  | 'password'
  | 'recovery'
  | 'phone'
  | 'secret'
  | 'sms_url'
  | 'reg_year'
  | 'country'
  | 'group_name'
  | 'remark'
  | 'status';

export type ExportSortDirection = 'asc' | 'desc';

export type ExportAccountOrderField =
  | 'id'
  | 'email'
  | 'recovery'
  | 'phone'
  | 'reg_year'
  | 'country'
  | 'group_name'
  | 'status'
  | 'created_at'
  | 'updated_at';

export type ExportCategoryField =
  | ''
  | 'group_name'
  | 'country'
  | 'reg_year'
  | 'status';

export interface ExportAccountOrderConfig {
  field: ExportAccountOrderField;
  direction: ExportSortDirection;
}

export interface ExportCategorySortConfig {
  field: ExportCategoryField;
  direction: ExportSortDirection;
}

export interface ExportConfig {
  separator: string;
  fields: ExportDataField[];
  includeStats: boolean;
  accountOrder: ExportAccountOrderConfig;
  categorySort: ExportCategorySortConfig;
  categoryLabelTemplate: string;
}

export interface ApiAdapter {
  getAccounts(search?: string): Promise<Account[]>;
  getDeletedAccounts(): Promise<Account[]>;
  createAccount(account: AccountInput): Promise<Account>;
  updateAccount(id: number, account: Partial<AccountInput>): Promise<Account>;
  deleteAccount(id: number): Promise<void>;
  restoreAccount(id: number): Promise<Account>;
  purgeAccount(id: number): Promise<void>;
  purgeAllDeleted(): Promise<number>;
  deleteAllAccounts(): Promise<number>;
  toggleStatus(id: number): Promise<Account>;
  batchImport(accounts: AccountInput[]): Promise<BatchImportResult>;
  generateTotp(secret: string): Promise<TotpResult>;
  fetchSmsCode(accountId: number): Promise<SmsCodeResult>;
  getAccountHistory(accountId: number): Promise<any[]>;
  createBackup(reason?: string): Promise<string>;
  listBackups(): Promise<BackupInfo[]>;
  restoreBackup(backupName: string): Promise<void>;
  exportAccountsText(
    accountIds: number[] | null,
    search: string | null,
    config: ExportConfig,
  ): Promise<string>;
  openAccountBrowser(accountId: number): Promise<OpenBrowserResult>;
  getBrowserStatuses(emails: string[]): Promise<BrowserStatusMap>;
  clearBrowserCache(accountIds: number[] | null): Promise<ClearBrowserCacheResult>;
  deleteBrowserProfiles(emails: string[]): Promise<DeleteBrowserProfilesResult>;
  getBrowserSettings(): Promise<BrowserSettings>;
  saveBrowserSettings(settings: BrowserSettingsInput): Promise<BrowserSettings>;
  getBrowserUsage(): Promise<BrowserUsage>;
  openBrowserProfileDir(accountId: number): Promise<void>;
}
