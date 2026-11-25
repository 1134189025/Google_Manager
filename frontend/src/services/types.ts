// frontend/src/services/types.ts

export type AccountStatus = 'inactive' | 'pro' | 'ultra_lite' | 'ultra';

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
  status: AccountStatus;
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
  status?: AccountStatus;
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
  /** 运行平台：'windows' | 'macos' | 'linux'（Rust `std::env::consts::OS`） */
  platform?: string;
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

/** 导出到文件的结果 */
export interface ExportFileResult {
  path: string;
  count: number;
}

export type BillingCurrency = 'CNY' | 'USD';
export type BillingCycle = 'month' | 'year' | 'once';

export interface Reminder {
  id: number;
  title: string;
  note: string | null;
  dueAt: string;
  repeat: 'none' | 'week' | 'month' | 'year';
  leadDays: number;
  done: boolean;
  doneAt: string | null;
  refKind: string | null;
  refId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderInput {
  title: string;
  note?: string | null;
  dueAt: string;
  repeat?: 'none' | 'week' | 'month' | 'year';
  leadDays?: number;
  refKind?: string | null;
  refId?: number | null;
}

export interface RenewalItem {
  kind: 'server' | 'domain' | 'ai_subscription' | 'payment_card' | string;
  id: number;
  name: string;
  subtitle: string | null;
  date: string;
  days: number;
  billingAmount: number | null;
  billingCurrency: BillingCurrency;
  billingCycle: BillingCycle;
  fixedExpiry: boolean;
}

export interface SpendCurrencyTotals {
  monthly: number;
  yearly: number;
  once: number;
  count: number;
}

export interface SpendSummary {
  cny: SpendCurrencyTotals;
  usd: SpendCurrencyTotals;
  unpriced: number;
}

export interface RenewalsSummary {
  timeline: RenewalItem[];
  spend: SpendSummary;
}

export interface WorkspaceOverview {
  googleAccountsCount: number;
  paymentCardsCount: number;
  aiSubscriptionsCount: number;
  serversCount: number;
  serversOnlineCount: number;
  domainsCount: number;
  pendingRemindersCount: number;
  upcomingRenewals: RenewalItem[];
  dueReminders: Reminder[];
  spend: SpendSummary;
}

export interface ExchangeRateInfo {
  rate: number;
  updatedAt: string;
  source: string;
  isFallback: boolean;
}

export interface PaymentCard {
  id: number;
  name: string;
  issuer: string | null;
  bankCode: string | null;
  network: string | null;
  funding: string | null;
  formFactor: string | null;
  region: string | null;
  regionGroup: 'mainland' | 'hmt' | 'overseas' | 'global' | 'unknown';
  last4: string | null;
  expiryMonth: string | null;
  cardNumber: string | null;
  cvv: string | null;
  cardholder: string | null;
  billingAddress: string | null;
  billingAmount: number | null;
  billingCurrency: BillingCurrency;
  billingCycle: BillingCycle;
  expiresAt: string | null;
  tags: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentCardInput {
  name: string;
  issuer?: string | null;
  bankCode?: string | null;
  network?: string | null;
  funding?: string | null;
  formFactor?: string | null;
  region?: string | null;
  regionGroup?: string | null;
  last4?: string | null;
  expiryMonth?: string | null;
  cardNumber?: string | null;
  cvv?: string | null;
  cardholder?: string | null;
  billingAddress?: string | null;
  billingAmount?: number | null;
  billingCurrency?: BillingCurrency;
  billingCycle?: BillingCycle;
  expiresAt?: string | null;
  tags?: string | null;
  notes?: string | null;
}

export interface CloudflareConnectionView {
  id: number;
  name: string;
  tokenHint: string;
  accountSummary: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CloudflareConnectionInput {
  name: string;
  apiToken?: string | null;
}

export interface CloudflareZone {
  zoneId: string;
  accountId: string | null;
  name: string;
  status: string;
  nameServers: string[];
  registrar: string | null;
  expiresAt: string | null;
  autoRenew: boolean | null;
}

export interface CloudflareDnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied?: boolean | null;
  priority?: number | null;
  comment?: string | null;
  modifiedOn?: string | null;
}

export interface DnsRecordInput {
  type: 'A' | 'AAAA' | 'CNAME' | 'TXT' | 'MX' | 'NS' | string;
  name: string;
  content: string;
  ttl: number;
  proxied?: boolean;
  priority?: number;
  comment?: string;
}

export interface DomainItem {
  id: number;
  name: string;
  registrar: string | null;
  nameservers: string[];
  statuses: string[];
  autoRenew: boolean;
  billingAmount: number | null;
  billingCurrency: BillingCurrency;
  billingCycle: BillingCycle;
  expiresAt: string | null;
  cfConnectionId: number | null;
  cfZoneId: string | null;
  serverId: number | null;
  probedAt: string | null;
  probeError: string | null;
  tags: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DomainInput {
  name: string;
  registrar?: string | null;
  nameservers?: string[] | null;
  statuses?: string[] | null;
  autoRenew?: boolean;
  billingAmount?: number | null;
  billingCurrency?: BillingCurrency;
  billingCycle?: BillingCycle;
  expiresAt?: string | null;
  cfConnectionId?: number | null;
  cfZoneId?: string | null;
  serverId?: number | null;
  tags?: string | null;
  notes?: string | null;
}

export type AiOAuthProviderId = 'openai' | 'claude' | 'grok' | 'gemini';

export interface QuotaWindow {
  label: string;
  usedPercent: number | null;
  remaining: number | null;
  used: number | null;
  limit: number | null;
  unit: string | null;
  model: string | null;
  resetsAt: string | null;
  windowSeconds: number | null;
  stale: boolean;
}

export interface NormalizedUsage {
  source: string;
  scope: string;
  scopeNote: string;
  plan: string | null;
  status: 'available' | 'unavailable' | 'stale';
  unavailableReason: string | null;
  checkedAt: string;
  windows: QuotaWindow[];
}

export interface AiSubscription {
  id: number;
  name: string;
  provider: string;
  plan: string | null;
  accountEmail: string | null;
  keyHint: string | null;
  billingAmount: number | null;
  billingCurrency: BillingCurrency;
  billingCycle: BillingCycle;
  renewsAt: string | null;
  googleAccountId: number | null;
  googleAccountEmail: string | null;
  paymentCardId: number | null;
  paymentCardName: string | null;
  oauthProvider: AiOAuthProviderId | string | null;
  oauthAccountId: string | null;
  oauthConnected: boolean;
  usage: NormalizedUsage | null;
  usageCheckedAt: string | null;
  usageError: string | null;
  tags: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiSubscriptionInput {
  name: string;
  provider: string;
  plan?: string | null;
  accountEmail?: string | null;
  keyHint?: string | null;
  billingAmount?: number | null;
  billingCurrency?: BillingCurrency;
  billingCycle?: BillingCycle;
  renewsAt?: string | null;
  googleAccountId?: number | null;
  paymentCardId?: number | null;
  oauthProvider?: string | null;
  tags?: string | null;
  notes?: string | null;
}

export interface OAuthStartInfo {
  sessionId: string;
  mode: 'loopback' | 'code';
  authorizeUrl: string;
  redirectUri: string;
  manualCallback: boolean;
}

export interface OAuthStatusInfo {
  status: 'pending' | 'exchanging' | 'connected' | 'error' | 'cancelled' | 'expired';
  error: string;
  subscriptionId: number;
}

export interface AntigravityQuotaResult {
  checkedAt: string;
  windows: QuotaWindow[];
}

export interface GeminiOAuthConfigView {
  configured: boolean;
  source: string;
  clientIdHint: string | null;
  hasClientSecret: boolean;
}

export interface GeminiOAuthConfigInput {
  clientId?: string | null;
  clientSecret?: string | null;
  rawJson?: string | null;
  clear?: boolean;
}

export interface ServerListeningPort {
  proto: 'tcp' | 'udp';
  port: number;
  exposure: 'public' | 'private' | 'local';
  address: string;
  process: string | null;
  pid: number | null;
}

export interface ServerContainerPort {
  containerPort: number;
  proto: 'tcp' | 'udp';
  hostPort: number | null;
  hostIp: string | null;
}

export interface ServerContainerInfo {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  restartCount: number | null;
  health: string | null;
  exitCode: number | null;
  oomKilled: boolean | null;
  startedAt: string | null;
  cpu: number | null;
  memoryPct: number | null;
  memoryUsage: string | null;
  ports: ServerContainerPort[];
}

export interface ServerServicesSnapshot {
  ports: ServerListeningPort[];
  dockerAvailable: boolean;
  dockerReason: string | null;
  containers: ServerContainerInfo[];
}

export interface ServerItem {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  authKind: 'password' | 'key';
  credential: string | null;
  passphrase: string | null;
  region: string | null;
  os: string | null;
  kernel: string | null;
  collectEnabled: boolean;
  billingAmount: number | null;
  billingCurrency: BillingCurrency;
  billingCycle: BillingCycle;
  expiresAt: string | null;
  status: 'unknown' | 'online' | 'offline';
  cpu: number | null;
  memory: number | null;
  disk: number | null;
  memTotalKb: number | null;
  diskTotalKb: number | null;
  loadavg: string | null;
  uptime: string | null;
  servicesJson: string | null;
  hostFingerprint: string | null;
  probedAt: string | null;
  probeError: string | null;
  tags: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ServerInput {
  name: string;
  host: string;
  port?: number;
  username?: string;
  authKind?: 'password' | 'key';
  credential?: string | null;
  passphrase?: string | null;
  region?: string | null;
  os?: string | null;
  kernel?: string | null;
  collectEnabled?: boolean;
  billingAmount?: number | null;
  billingCurrency?: BillingCurrency;
  billingCycle?: BillingCycle;
  expiresAt?: string | null;
  tags?: string | null;
  notes?: string | null;
}

export interface AppMonitorSettings {
  serverMonitorMinutes: number;
}

export type WindowCloseBehavior = 'ask' | 'minimize' | 'quit';

export interface WindowCloseSettings {
  closeBehavior: WindowCloseBehavior;
}

export interface AccountCategory {
  id: number;
  name: string;
  color: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface AccountCategoryInput {
  name: string;
  color?: string | null;
  sortOrder?: number | null;
}

export interface SshSessionInfo {
  sessionId: string;
  serverId: number;
  serverName: string;
  host: string;
  port: number;
}

export interface SftpEntry {
  name: string;
  size: number;
  modified: number | null;
  isDir: boolean;
  isSymlink: boolean;
}

export interface SftpDirListing {
  path: string;
  entries: SftpEntry[];
  truncated: boolean;
}

export interface AgentSettingsView {
  baseUrl: string;
  model: string;
  maxTokens: number;
  hasApiKey: boolean;
  apiKeyHint: string | null;
  contextWindow: number;
  temperature: number;
  autoCompact: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
  memoryEnabled: boolean;
  customSystemPrompt: string;
}

export interface AgentSettingsInput {
  baseUrl: string;
  apiKey?: string | null;
  clearApiKey?: boolean;
  model: string;
  maxTokens?: number;
  contextWindow?: number;
  temperature?: number;
  autoCompact?: boolean;
  reserveTokens?: number;
  keepRecentTokens?: number;
  memoryEnabled?: boolean;
  customSystemPrompt?: string;
}

export interface AgentModelInfo {
  id: string;
  ownedBy: string | null;
  contextWindow: number | null;
  maxOutputTokens: number | null;
}

export interface AgentModelListResult {
  models: AgentModelInfo[];
  sourceUrl: string;
  fetchedCount: number;
}

export interface AgentCompactionItem {
  id: number;
  sessionId: string;
  summary: string;
  firstKeptMessageId: number;
  compactedMessageCount: number;
  tokensBefore: number;
  tokensAfter: number;
  customInstructions: string | null;
  createdAt: string;
}

export interface AgentContextStatus {
  estimatedTokens: number;
  contextWindow: number;
  reserveTokens: number;
  keepRecentTokens: number;
  thresholdTokens: number;
  usagePercent: number;
  activeMessageCount: number;
  totalMessageCount: number;
  compactedMessageCount: number;
  autoCompact: boolean;
  needsCompaction: boolean;
  latestCompaction: AgentCompactionItem | null;
}

export interface AgentCompactionResult {
  compaction: AgentCompactionItem;
  status: AgentContextStatus;
}

export type AgentMemoryTarget = 'user' | 'memory';

export interface AgentMemoryEntry {
  id: number;
  target: AgentMemoryTarget | string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentMemorySnapshot {
  memoryEnabled: boolean;
  memoryDir: string;
  userBudget: number;
  memoryBudget: number;
  userUsedChars: number;
  memoryUsedChars: number;
  userEntries: AgentMemoryEntry[];
  memoryEntries: AgentMemoryEntry[];
  userMarkdown: string;
  memoryMarkdown: string;
}

export interface AgentConnectionTestResult {
  ok: boolean;
  model: string;
  latencyMs: number;
  message: string;
}

export interface AgentProposalDiffRow {
  field: string;
  label: string;
  before: any;
  after: any;
}

export interface AgentProposal {
  id: string;
  kind: 'create_reminder' | 'update_asset' | string;
  targetLabel: string;
  reason: string;
  status: 'pending' | 'applied' | 'rejected' | string;
  payload: Record<string, any>;
  diffs: AgentProposalDiffRow[];
}

export interface AgentMessageItem {
  id: number;
  sessionId: string;
  role: 'user' | 'assistant' | string;
  content: string;
  proposals: AgentProposal[];
  createdAt: string;
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
  toggleStatus(id: number, status?: AccountStatus): Promise<Account>;
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
  exportAccountsToFile(
    accountIds: number[] | null,
    search: string | null,
    config: ExportConfig,
    path: string,
  ): Promise<ExportFileResult>;
  openAccountBrowser(accountId: number): Promise<OpenBrowserResult>;
  getBrowserStatuses(emails: string[]): Promise<BrowserStatusMap>;
  clearBrowserCache(accountIds: number[] | null): Promise<ClearBrowserCacheResult>;
  deleteBrowserProfiles(emails: string[]): Promise<DeleteBrowserProfilesResult>;
  getBrowserSettings(): Promise<BrowserSettings>;
  saveBrowserSettings(settings: BrowserSettingsInput): Promise<BrowserSettings>;
  getBrowserUsage(): Promise<BrowserUsage>;
  openBrowserProfileDir(accountId: number): Promise<void>;
  getWorkspaceOverview(): Promise<WorkspaceOverview>;
  getUsdCnyRate(forceRefresh?: boolean): Promise<ExchangeRateInfo>;
  getRenewalsSummary(withinDays?: number): Promise<RenewalsSummary>;
  advanceRenewal(kind: string, id: number): Promise<string>;
  getReminders(): Promise<Reminder[]>;
  createReminder(reminder: ReminderInput): Promise<Reminder>;
  updateReminder(id: number, reminder: ReminderInput): Promise<Reminder>;
  deleteReminder(id: number): Promise<void>;
  completeReminder(id: number): Promise<Reminder>;
  writeTextFile(path: string, content: string): Promise<string>;
  readTextFile(path: string): Promise<string>;
  openExternalUrl(url: string): Promise<void>;
  getPaymentCards(): Promise<PaymentCard[]>;
  createPaymentCard(card: PaymentCardInput): Promise<PaymentCard>;
  updatePaymentCard(id: number, card: PaymentCardInput): Promise<PaymentCard>;
  deletePaymentCard(id: number): Promise<void>;
  getDomains(): Promise<DomainItem[]>;
  createDomain(domain: DomainInput): Promise<DomainItem>;
  updateDomain(id: number, domain: DomainInput): Promise<DomainItem>;
  deleteDomain(id: number): Promise<void>;
  probeDomain(id: number): Promise<DomainItem>;
  getCloudflareConnections(): Promise<CloudflareConnectionView[]>;
  saveCloudflareConnection(id: number | null, connection: CloudflareConnectionInput): Promise<CloudflareConnectionView>;
  deleteCloudflareConnection(id: number): Promise<void>;
  listCloudflareZones(connectionId: number): Promise<CloudflareZone[]>;
  importCloudflareZones(connectionId: number, zones: CloudflareZone[]): Promise<number>;
  listDomainDnsRecords(domainId: number): Promise<CloudflareDnsRecord[]>;
  applyDomainDnsRecord(
    domainId: number,
    action: 'create' | 'update' | 'delete',
    recordId?: string | null,
    record?: DnsRecordInput | null,
  ): Promise<CloudflareDnsRecord | null>;
  getAiSubscriptions(): Promise<AiSubscription[]>;
  createAiSubscription(subscription: AiSubscriptionInput): Promise<AiSubscription>;
  updateAiSubscription(id: number, subscription: AiSubscriptionInput): Promise<AiSubscription>;
  deleteAiSubscription(id: number): Promise<void>;
  getGeminiOauthConfig(): Promise<GeminiOAuthConfigView>;
  saveGeminiOauthConfig(config: GeminiOAuthConfigInput): Promise<GeminiOAuthConfigView>;
  startAiOauth(provider: AiOAuthProviderId, subscriptionId: number): Promise<OAuthStartInfo>;
  getAiOauthStatus(sessionId: string): Promise<OAuthStatusInfo>;
  completeAiOauth(sessionId: string, callbackInput: string): Promise<AiSubscription>;
  cancelAiOauth(sessionId: string): Promise<void>;
  disconnectAiOauth(id: number): Promise<AiSubscription>;
  refreshAiSubscriptionQuota(id: number): Promise<AiSubscription>;
  readAntigravityCliQuota(): Promise<AntigravityQuotaResult>;
  getServers(search?: string): Promise<ServerItem[]>;
  createServer(server: ServerInput): Promise<ServerItem>;
  updateServer(id: number, server: ServerInput): Promise<ServerItem>;
  deleteServer(id: number): Promise<void>;
  probeServer(id: number): Promise<ServerItem>;
  resetServerHostFingerprint(id: number): Promise<ServerItem>;
  getAppMonitorSettings(): Promise<AppMonitorSettings>;
  saveAppMonitorSettings(serverMonitorMinutes: number): Promise<AppMonitorSettings>;
  sshOpenSession(serverId: number, cols?: number, rows?: number): Promise<SshSessionInfo>;
  sshWriteSession(sessionId: string, data: string): Promise<void>;
  sshResizeSession(sessionId: string, cols: number, rows: number): Promise<void>;
  sshCloseSession(sessionId: string): Promise<void>;
  sshListSessions(): Promise<SshSessionInfo[]>;
  sftpListDir(serverId: number, path?: string): Promise<SftpDirListing>;
  sftpDownloadFile(serverId: number, remotePath: string, localPath: string): Promise<number>;
  sftpUploadFile(serverId: number, localPath: string, remotePath: string): Promise<number>;
  sftpMkdir(serverId: number, remotePath: string): Promise<void>;
  sftpRemove(serverId: number, remotePath: string, isDir: boolean): Promise<void>;
  getAgentSettings(): Promise<AgentSettingsView>;
  saveAgentSettings(settings: AgentSettingsInput): Promise<AgentSettingsView>;
  testAgentConnection(baseUrl?: string | null, apiKey?: string | null, model?: string | null): Promise<AgentConnectionTestResult>;
  fetchAgentModels(baseUrl?: string | null, apiKey?: string | null): Promise<AgentModelListResult>;
  getAgentContextStatus(): Promise<AgentContextStatus>;
  compactAgentContext(instructions?: string | null): Promise<AgentCompactionResult>;
  getAgentMemory(): Promise<AgentMemorySnapshot>;
  addAgentMemoryEntry(target: AgentMemoryTarget | string, content: string): Promise<AgentMemorySnapshot>;
  updateAgentMemoryEntry(id: number, content: string): Promise<AgentMemorySnapshot>;
  deleteAgentMemoryEntry(id: number): Promise<AgentMemorySnapshot>;
  clearAgentMemory(target?: AgentMemoryTarget | string | null): Promise<AgentMemorySnapshot>;
  openAgentMemoryDir(): Promise<void>;
  getAgentMessages(): Promise<AgentMessageItem[]>;
  clearAgentMessages(): Promise<void>;
  sendAgentMessage(message: string): Promise<AgentMessageItem[]>;
  cancelAgentStream(streamId?: string | null): Promise<boolean>;
  applyAgentProposal(messageId: number, proposalId: string): Promise<AgentMessageItem>;
  rejectAgentProposal(messageId: number, proposalId: string): Promise<AgentMessageItem>;
  getWindowCloseSettings(): Promise<WindowCloseSettings>;
  saveWindowCloseSettings(closeBehavior: WindowCloseBehavior): Promise<WindowCloseSettings>;
  handleWindowClose(action: 'minimize' | 'quit', remember: boolean): Promise<void>;
  getAccountCategories(): Promise<AccountCategory[]>;
  createAccountCategory(category: AccountCategoryInput): Promise<AccountCategory>;
  updateAccountCategory(id: number, category: AccountCategoryInput): Promise<AccountCategory>;
  deleteAccountCategory(id: number): Promise<void>;
}
