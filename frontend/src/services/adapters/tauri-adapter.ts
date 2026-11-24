// frontend/src/services/adapters/tauri-adapter.ts
import { invoke } from '@tauri-apps/api/core';
import type {
  ApiAdapter,
  Account,
  AccountInput,
  BatchImportResult,
  TotpResult,
  SmsCodeResult,
  ExportConfig,
  BackupInfo,
  BrowserStatus,
  BrowserStatusMap,
  OpenBrowserResult,
  BrowserSettings,
  BrowserSettingsInput,
  ClearBrowserCacheResult,
  DeleteBrowserProfilesResult,
  BrowserUsage,
  ExportFileResult,
  WorkspaceOverview,
  RenewalsSummary,
  Reminder,
  ReminderInput,
  VaultFolder,
  VaultFolderInput,
  VaultItem,
  VaultItemInput,
  VaultBatchImportResult,
  PaymentCard,
  PaymentCardInput,
  DomainItem,
  DomainInput,
  CloudflareConnectionView,
  CloudflareConnectionInput,
  CloudflareZone,
  CloudflareDnsRecord,
  DnsRecordInput,
  AiSubscription,
  AiSubscriptionInput,
  AiOAuthProviderId,
  OAuthStartInfo,
  OAuthStatusInfo,
  AntigravityQuotaResult,
  ServerItem,
  ServerInput,
  AppMonitorSettings,
  SshSessionInfo,
  SftpDirListing,
  AgentSettingsView,
  AgentSettingsInput,
  AgentConnectionTestResult,
  AgentMessageItem,
} from '../types';
import { snakeToCamel, camelToSnake } from '../utils';

/**
 * 将嵌套载荷（对象/数组值）转换为 snake_case，但保持顶层参数名为 camelCase。
 *
 * Tauri 2 的 #[tauri::command] 默认按 camelCase 匹配 Rust 参数名
 * （例如 `account_ids` 必须传 `accountIds`），
 * 而命令内部的 SERDE 结构体字段（AccountInput / ExportConfig 等）
 * 仍按 Rust 侧的 snake_case 反序列化。
 */
function prepareInvokeArgs(args?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!args) {
    return undefined;
  }

  const prepared: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value === null || typeof value !== 'object') {
      prepared[key] = value;
    } else {
      prepared[key] = camelToSnake(value as Record<string, unknown>);
    }
  }
  return prepared;
}

export class TauriAdapter implements ApiAdapter {
  private async invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    return await invoke<T>(command, prepareInvokeArgs(args));
  }

  private async buildCompleteAccountPayload(
    id: number,
    account: Partial<AccountInput>,
  ): Promise<Record<string, unknown>> {
    const raw = await this.invokeCommand<any>('get_account_by_id', { id });
    const currentAccount = snakeToCamel<Account>(raw);

    if (!currentAccount) {
      throw new Error('账号 ' + id + ' 不存在，无法补全更新数据');
    }

    return {
      id,
      email: account.email ?? currentAccount.email,
      password: account.password ?? currentAccount.password,
      recovery: account.recovery ?? currentAccount.recovery ?? null,
      phone: account.phone ?? currentAccount.phone ?? null,
      secret: account.secret ?? currentAccount.secret ?? null,
      smsUrl: account.smsUrl ?? currentAccount.smsUrl ?? null,
      regYear: account.regYear ?? currentAccount.regYear ?? null,
      country: account.country ?? currentAccount.country ?? null,
      groupName: account.groupName ?? currentAccount.groupName ?? null,
      remark: account.remark ?? currentAccount.remark ?? null,
      status: currentAccount.status,
      createdAt: currentAccount.createdAt,
      updatedAt: currentAccount.updatedAt,
    };
  }

  async getAccounts(search?: string): Promise<Account[]> {
    const accounts = await this.invokeCommand<any[]>('get_accounts', {
      search: search || null,
    });
    const accountList = Array.isArray(accounts) ? accounts : [];
    return accountList.map(item => snakeToCamel<Account>(item));
  }

  async createAccount(account: AccountInput): Promise<Account> {
    const result = await this.invokeCommand<any>('create_account', { account });
    return snakeToCamel<Account>(result);
  }

  async updateAccount(id: number, account: Partial<AccountInput>): Promise<Account> {
    const completeAccount = await this.buildCompleteAccountPayload(id, account);
    const result = await this.invokeCommand<any>('update_account', { id, account: completeAccount });
    return snakeToCamel<Account>(result);
  }

  async deleteAccount(id: number): Promise<void> {
    await this.invokeCommand('delete_account', { id });
  }

  async toggleStatus(id: number): Promise<Account> {
    const result = await this.invokeCommand<any>('toggle_status', { id });
    return snakeToCamel<Account>(result);
  }

  async batchImport(accounts: AccountInput[]): Promise<BatchImportResult> {
    const result = await this.invokeCommand<any>('batch_import', { accounts });
    const data = snakeToCamel<Record<string, unknown>>((result || {}) as Record<string, unknown>);

    const successCount = Number(data.successCount ?? 0);
    const failCount = Number(data.failCount ?? data.failedCount ?? 0);

    return {
      successCount: Number.isFinite(successCount) ? successCount : 0,
      failCount: Number.isFinite(failCount) ? failCount : 0,
    };
  }

  /**
   * 查询手机短信验证码
   *
   * 后端只看账号自己的 sms_url，请求期间的网络等待不会持有数据库锁。
   * 这里把 snake_case 结果转成前端契约，非法 status 回退为 error。
   */
  async fetchSmsCode(accountId: number): Promise<SmsCodeResult> {
    const result = await this.invokeCommand<any>('fetch_sms_code', { accountId });
    const data = snakeToCamel<Record<string, unknown>>((result || {}) as Record<string, unknown>);
    const allowed = ['success', 'empty', 'invalid_link', 'unparsable', 'no_config', 'error'];
    const rawStatus = String(data.status ?? 'error');
    const status = (allowed.includes(rawStatus) ? rawStatus : 'error') as SmsCodeResult['status'];
    const retryAfter = Number(data.retryAfterSeconds);
    const code = data.code === null || data.code === undefined ? null : String(data.code);

    return {
      status: status === 'success' && !code ? 'unparsable' : status,
      code,
      message: data.message === null || data.message === undefined ? null : String(data.message),
      error: data.error === null || data.error === undefined ? null : String(data.error),
      retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
      fetchedAt: data.fetchedAt ? String(data.fetchedAt) : new Date().toISOString(),
    };
  }
  async generateTotp(secret: string): Promise<TotpResult> {
    const result = await this.invokeCommand<any>('generate_totp', { secret });
    const data = snakeToCamel<Record<string, unknown>>((result || {}) as Record<string, unknown>);
    return {
      code: String(data.code ?? ''),
      remaining: Number(data.remaining ?? 0),
    };
  }

  async getAccountHistory(accountId: number): Promise<any[]> {
    const history = await this.invokeCommand<any[]>('get_account_history', { accountId });
    const historyList = Array.isArray(history) ? history : [];
    return historyList.map(item => snakeToCamel(item));
  }

  async exportAccountsText(
    accountIds: number[] | null,
    search: string | null,
    config: ExportConfig,
  ): Promise<string> {
    return await this.invokeCommand<string>('export_accounts_text', {
      accountIds: accountIds || null,
      search: search || null,
      config,
    });
  }

  async exportAccountsToFile(
    accountIds: number[] | null,
    search: string | null,
    config: ExportConfig,
    path: string,
  ): Promise<ExportFileResult> {
    const result = await this.invokeCommand<any>('export_accounts_to_file', {
      accountIds: accountIds || null,
      search: search || null,
      config,
      path,
    });
    return {
      path: String(result?.path ?? path),
      count: Number(result?.count ?? 0),
    };
  }

  async deleteAllAccounts(): Promise<number> {
    return await this.invokeCommand<number>('delete_all_accounts');
  }

  async getDeletedAccounts(): Promise<Account[]> {
    const accounts = await this.invokeCommand<any[]>('get_deleted_accounts');
    const accountList = Array.isArray(accounts) ? accounts : [];
    return accountList.map(item => snakeToCamel<Account>(item));
  }

  async restoreAccount(id: number): Promise<Account> {
    const result = await this.invokeCommand<any>('restore_account', { id });
    return snakeToCamel<Account>(result);
  }

  async purgeAccount(id: number): Promise<void> {
    await this.invokeCommand('purge_account', { id });
  }

  async purgeAllDeleted(): Promise<number> {
    return await this.invokeCommand<number>('purge_all_deleted');
  }

  async createBackup(reason?: string): Promise<string> {
    return await this.invokeCommand<string>('create_backup', {
      reason: reason || null,
    });
  }

  async listBackups(): Promise<BackupInfo[]> {
    const list = await this.invokeCommand<any[]>('list_backups');
    const backups = Array.isArray(list) ? list : [];
    return backups.map(item => snakeToCamel<BackupInfo>(item));
  }

  async restoreBackup(backupName: string): Promise<void> {
    await this.invokeCommand('restore_backup', { backupName });
  }

  // ─── 账号独立浏览器 ───────────────────────────────────────────────

  async openAccountBrowser(accountId: number): Promise<OpenBrowserResult> {
    const result = await this.invokeCommand<any>('open_account_browser', { accountId });
    const data = snakeToCamel<Record<string, unknown>>((result || {}) as Record<string, unknown>);
    const allowed = ['launched', 'focused', 'new_window'];
    const action = String(data.action ?? 'launched');
    return {
      action: (allowed.includes(action) ? action : 'launched') as OpenBrowserResult['action'],
      firstLaunch: data.firstLaunch === true,
    };
  }

  /**
   * 状态表以原始邮箱为键：邮箱里可能有下划线，
   * 因此这里不能用 snakeToCamel，只校验值。
   */
  async getBrowserStatuses(emails: string[]): Promise<BrowserStatusMap> {
    if (emails.length === 0) return {};
    const result = await this.invokeCommand<Record<string, unknown>>('get_browser_statuses', { emails });
    const allowed: BrowserStatus[] = ['none', 'created', 'running'];
    const statuses: BrowserStatusMap = {};
    for (const [email, value] of Object.entries(result || {})) {
      const status = String(value) as BrowserStatus;
      statuses[email] = allowed.includes(status) ? status : 'none';
    }
    return statuses;
  }

  async clearBrowserCache(accountIds: number[] | null): Promise<ClearBrowserCacheResult> {
    const result = await this.invokeCommand<any>('clear_browser_cache', {
      accountIds: accountIds || null,
    });
    const data = snakeToCamel<Record<string, unknown>>((result || {}) as Record<string, unknown>);
    return {
      cleared: Number(data.cleared ?? 0),
      skippedRunning: Number(data.skippedRunning ?? 0),
      freedBytes: Number(data.freedBytes ?? 0),
    };
  }

  async deleteBrowserProfiles(emails: string[]): Promise<DeleteBrowserProfilesResult> {
    if (emails.length === 0) return { deleted: 0, skipped: 0 };
    const result = await this.invokeCommand<any>('delete_browser_profiles', { emails });
    const data = snakeToCamel<Record<string, unknown>>((result || {}) as Record<string, unknown>);
    return {
      deleted: Number(data.deleted ?? 0),
      skipped: Number(data.skipped ?? 0),
    };
  }

  async getBrowserSettings(): Promise<BrowserSettings> {
    const result = await this.invokeCommand<any>('get_browser_settings');
    return snakeToCamel<BrowserSettings>(result || {});
  }

  async saveBrowserSettings(settings: BrowserSettingsInput): Promise<BrowserSettings> {
    const result = await this.invokeCommand<any>('save_browser_settings', {
      settings: {
        browserPath: settings.browserPath || null,
        profilesRoot: settings.profilesRoot || null,
      },
    });
    return snakeToCamel<BrowserSettings>(result || {});
  }

  async getBrowserUsage(): Promise<BrowserUsage> {
    const result = await this.invokeCommand<any>('get_browser_usage');
    const data = snakeToCamel<Record<string, unknown>>((result || {}) as Record<string, unknown>);
    return {
      profiles: Number(data.profiles ?? 0),
      totalBytes: Number(data.totalBytes ?? 0),
    };
  }

  async openBrowserProfileDir(accountId: number): Promise<void> {
    await this.invokeCommand('open_browser_profile_dir', { accountId });
  }

  // ─── 工作区概览 / 续费 / 备忘提醒 ──────────────────────────────

  async getWorkspaceOverview(): Promise<WorkspaceOverview> {
    const result = await this.invokeCommand<any>('get_workspace_overview');
    return snakeToCamel<WorkspaceOverview>(result || {});
  }

  async getRenewalsSummary(withinDays?: number): Promise<RenewalsSummary> {
    const result = await this.invokeCommand<any>('get_renewals_summary', {
      withinDays: withinDays ?? null,
    });
    return snakeToCamel<RenewalsSummary>(result || { timeline: [], spend: {} });
  }

  async advanceRenewal(kind: string, id: number): Promise<string> {
    return await this.invokeCommand<string>('advance_renewal', { kind, id });
  }

  async getReminders(): Promise<Reminder[]> {
    const list = await this.invokeCommand<any[]>('get_reminders');
    return (Array.isArray(list) ? list : []).map(item => snakeToCamel<Reminder>(item));
  }

  async createReminder(reminder: ReminderInput): Promise<Reminder> {
    const result = await this.invokeCommand<any>('create_reminder', { reminder });
    return snakeToCamel<Reminder>(result);
  }

  async updateReminder(id: number, reminder: ReminderInput): Promise<Reminder> {
    const result = await this.invokeCommand<any>('update_reminder', { id, reminder });
    return snakeToCamel<Reminder>(result);
  }

  async deleteReminder(id: number): Promise<void> {
    await this.invokeCommand('delete_reminder', { id });
  }

  async completeReminder(id: number): Promise<Reminder> {
    const result = await this.invokeCommand<any>('complete_reminder', { id });
    return snakeToCamel<Reminder>(result);
  }

  async writeTextFile(path: string, content: string): Promise<string> {
    return await this.invokeCommand<string>('write_text_file', { path, content });
  }

  async readTextFile(path: string): Promise<string> {
    return await this.invokeCommand<string>('read_text_file', { path });
  }

  async openExternalUrl(url: string): Promise<void> {
    await this.invokeCommand('open_external_url', { url });
  }

  // ─── 账号与密钥库 ─────────────────────────────────────────────

  async getVaultFolders(): Promise<VaultFolder[]> {
    const list = await this.invokeCommand<any[]>('get_vault_folders');
    return (Array.isArray(list) ? list : []).map(item => snakeToCamel<VaultFolder>(item));
  }

  async createVaultFolder(folder: VaultFolderInput): Promise<VaultFolder> {
    const result = await this.invokeCommand<any>('create_vault_folder', { folder });
    return snakeToCamel<VaultFolder>(result);
  }

  async updateVaultFolder(id: number, folder: VaultFolderInput): Promise<VaultFolder> {
    const result = await this.invokeCommand<any>('update_vault_folder', { id, folder });
    return snakeToCamel<VaultFolder>(result);
  }

  async deleteVaultFolder(id: number): Promise<void> {
    await this.invokeCommand('delete_vault_folder', { id });
  }

  async getVaultItems(search?: string): Promise<VaultItem[]> {
    const list = await this.invokeCommand<any[]>('get_vault_items', { search: search || null });
    return (Array.isArray(list) ? list : []).map(item => snakeToCamel<VaultItem>(item));
  }

  async createVaultItem(item: VaultItemInput): Promise<VaultItem> {
    const result = await this.invokeCommand<any>('create_vault_item', { item });
    return snakeToCamel<VaultItem>(result);
  }

  async updateVaultItem(id: number, item: VaultItemInput): Promise<VaultItem> {
    const result = await this.invokeCommand<any>('update_vault_item', { id, item });
    return snakeToCamel<VaultItem>(result);
  }

  async deleteVaultItem(id: number): Promise<void> {
    await this.invokeCommand('delete_vault_item', { id });
  }

  async batchImportVaultItems(items: VaultItemInput[]): Promise<VaultBatchImportResult> {
    const result = await this.invokeCommand<any>('batch_import_vault_items', { items });
    const data = snakeToCamel<Record<string, unknown>>((result || {}) as Record<string, unknown>);
    return {
      createdCount: Number(data.createdCount ?? 0),
      skippedCount: Number(data.skippedCount ?? 0),
    };
  }

  // ─── U 卡与支付卡 ─────────────────────────────────────────────

  async getPaymentCards(): Promise<PaymentCard[]> {
    const list = await this.invokeCommand<any[]>('get_payment_cards');
    return (Array.isArray(list) ? list : []).map(item => snakeToCamel<PaymentCard>(item));
  }

  async createPaymentCard(card: PaymentCardInput): Promise<PaymentCard> {
    const result = await this.invokeCommand<any>('create_payment_card', { card });
    return snakeToCamel<PaymentCard>(result);
  }

  async updatePaymentCard(id: number, card: PaymentCardInput): Promise<PaymentCard> {
    const result = await this.invokeCommand<any>('update_payment_card', { id, card });
    return snakeToCamel<PaymentCard>(result);
  }

  async deletePaymentCard(id: number): Promise<void> {
    await this.invokeCommand('delete_payment_card', { id });
  }

  // ─── 域名管理与 Cloudflare DNS ─────────────────────────────────

  async getDomains(): Promise<DomainItem[]> {
    const list = await this.invokeCommand<any[]>('get_domains');
    return (Array.isArray(list) ? list : []).map(item => snakeToCamel<DomainItem>(item));
  }

  async createDomain(domain: DomainInput): Promise<DomainItem> {
    const result = await this.invokeCommand<any>('create_domain', { domain });
    return snakeToCamel<DomainItem>(result);
  }

  async updateDomain(id: number, domain: DomainInput): Promise<DomainItem> {
    const result = await this.invokeCommand<any>('update_domain', { id, domain });
    return snakeToCamel<DomainItem>(result);
  }

  async deleteDomain(id: number): Promise<void> {
    await this.invokeCommand('delete_domain', { id });
  }

  async probeDomain(id: number): Promise<DomainItem> {
    const result = await this.invokeCommand<any>('probe_domain', { id });
    return snakeToCamel<DomainItem>(result);
  }

  async getCloudflareConnections(): Promise<CloudflareConnectionView[]> {
    const list = await this.invokeCommand<any[]>('get_cloudflare_connections');
    return (Array.isArray(list) ? list : []).map(item => snakeToCamel<CloudflareConnectionView>(item));
  }

  async saveCloudflareConnection(
    id: number | null,
    connection: CloudflareConnectionInput,
  ): Promise<CloudflareConnectionView> {
    const result = await this.invokeCommand<any>('save_cloudflare_connection', {
      id: id ?? null,
      connection,
    });
    return snakeToCamel<CloudflareConnectionView>(result);
  }

  async deleteCloudflareConnection(id: number): Promise<void> {
    await this.invokeCommand('delete_cloudflare_connection', { id });
  }

  async listCloudflareZones(connectionId: number): Promise<CloudflareZone[]> {
    const list = await this.invokeCommand<any[]>('list_cloudflare_zones', { connectionId });
    return (Array.isArray(list) ? list : []).map(item => snakeToCamel<CloudflareZone>(item));
  }

  async importCloudflareZones(connectionId: number, zones: CloudflareZone[]): Promise<number> {
    return await this.invokeCommand<number>('import_cloudflare_zones', { connectionId, zones });
  }

  async listDomainDnsRecords(domainId: number): Promise<CloudflareDnsRecord[]> {
    const list = await this.invokeCommand<any[]>('list_domain_dns_records', { domainId });
    return (Array.isArray(list) ? list : []).map(item => snakeToCamel<CloudflareDnsRecord>(item));
  }

  async applyDomainDnsRecord(
    domainId: number,
    action: 'create' | 'update' | 'delete',
    recordId?: string | null,
    record?: DnsRecordInput | null,
  ): Promise<CloudflareDnsRecord | null> {
    const result = await this.invokeCommand<any>('apply_domain_dns_record', {
      domainId,
      action,
      recordId: recordId ?? null,
      record: record ?? null,
    });
    return result ? snakeToCamel<CloudflareDnsRecord>(result) : null;
  }

  // ─── AI 订阅与 OAuth / CLI 额度 ──────────────────────────────

  async getAiSubscriptions(): Promise<AiSubscription[]> {
    const list = await this.invokeCommand<any[]>('get_ai_subscriptions');
    return (Array.isArray(list) ? list : []).map(item => snakeToCamel<AiSubscription>(item));
  }

  async createAiSubscription(subscription: AiSubscriptionInput): Promise<AiSubscription> {
    const result = await this.invokeCommand<any>('create_ai_subscription', { subscription });
    return snakeToCamel<AiSubscription>(result);
  }

  async updateAiSubscription(id: number, subscription: AiSubscriptionInput): Promise<AiSubscription> {
    const result = await this.invokeCommand<any>('update_ai_subscription', { id, subscription });
    return snakeToCamel<AiSubscription>(result);
  }

  async deleteAiSubscription(id: number): Promise<void> {
    await this.invokeCommand('delete_ai_subscription', { id });
  }

  async startAiOauth(provider: AiOAuthProviderId, subscriptionId: number): Promise<OAuthStartInfo> {
    const result = await this.invokeCommand<any>('start_ai_oauth', { provider, subscriptionId });
    return snakeToCamel<OAuthStartInfo>(result);
  }

  async getAiOauthStatus(sessionId: string): Promise<OAuthStatusInfo> {
    const result = await this.invokeCommand<any>('get_ai_oauth_status', { sessionId });
    return snakeToCamel<OAuthStatusInfo>(result);
  }

  async completeAiOauth(sessionId: string, callbackInput: string): Promise<AiSubscription> {
    const result = await this.invokeCommand<any>('complete_ai_oauth', { sessionId, callbackInput });
    return snakeToCamel<AiSubscription>(result);
  }

  async cancelAiOauth(sessionId: string): Promise<void> {
    await this.invokeCommand('cancel_ai_oauth', { sessionId });
  }

  async disconnectAiOauth(id: number): Promise<AiSubscription> {
    const result = await this.invokeCommand<any>('disconnect_ai_oauth', { id });
    return snakeToCamel<AiSubscription>(result);
  }

  async refreshAiSubscriptionQuota(id: number): Promise<AiSubscription> {
    const result = await this.invokeCommand<any>('refresh_ai_subscription_quota', { id });
    return snakeToCamel<AiSubscription>(result);
  }

  async readAntigravityCliQuota(): Promise<AntigravityQuotaResult> {
    const result = await this.invokeCommand<any>('read_antigravity_cli_quota');
    return snakeToCamel<AntigravityQuotaResult>(result);
  }

  // ─── 服务器台账、SSH 终端与 SFTP ───────────────────────────────

  async getServers(search?: string): Promise<ServerItem[]> {
    const list = await this.invokeCommand<any[]>('get_servers', { search: search ?? '' });
    return (Array.isArray(list) ? list : []).map(item => snakeToCamel<ServerItem>(item));
  }

  async createServer(server: ServerInput): Promise<ServerItem> {
    const result = await this.invokeCommand<any>('create_server', { server });
    return snakeToCamel<ServerItem>(result);
  }

  async updateServer(id: number, server: ServerInput): Promise<ServerItem> {
    const result = await this.invokeCommand<any>('update_server', { id, server });
    return snakeToCamel<ServerItem>(result);
  }

  async deleteServer(id: number): Promise<void> {
    await this.invokeCommand('delete_server', { id });
  }

  async probeServer(id: number): Promise<ServerItem> {
    const result = await this.invokeCommand<any>('probe_server', { id });
    return snakeToCamel<ServerItem>(result);
  }

  async resetServerHostFingerprint(id: number): Promise<ServerItem> {
    const result = await this.invokeCommand<any>('reset_server_host_fingerprint', { id });
    return snakeToCamel<ServerItem>(result);
  }

  async getAppMonitorSettings(): Promise<AppMonitorSettings> {
    const result = await this.invokeCommand<any>('get_app_monitor_settings');
    return snakeToCamel<AppMonitorSettings>(result);
  }

  async saveAppMonitorSettings(serverMonitorMinutes: number): Promise<AppMonitorSettings> {
    const result = await this.invokeCommand<any>('save_app_monitor_settings', {
      serverMonitorMinutes,
    });
    return snakeToCamel<AppMonitorSettings>(result);
  }

  async sshOpenSession(serverId: number, cols?: number, rows?: number): Promise<SshSessionInfo> {
    const result = await this.invokeCommand<any>('ssh_open_session', {
      serverId,
      cols: cols ?? 100,
      rows: rows ?? 30,
    });
    return snakeToCamel<SshSessionInfo>(result);
  }

  async sshWriteSession(sessionId: string, data: string): Promise<void> {
    await this.invokeCommand('ssh_write_session', { sessionId, data });
  }

  async sshResizeSession(sessionId: string, cols: number, rows: number): Promise<void> {
    await this.invokeCommand('ssh_resize_session', { sessionId, cols, rows });
  }

  async sshCloseSession(sessionId: string): Promise<void> {
    await this.invokeCommand('ssh_close_session', { sessionId });
  }

  async sshListSessions(): Promise<SshSessionInfo[]> {
    const list = await this.invokeCommand<any[]>('ssh_list_sessions');
    return (Array.isArray(list) ? list : []).map(item => snakeToCamel<SshSessionInfo>(item));
  }

  async sftpListDir(serverId: number, path?: string): Promise<SftpDirListing> {
    const result = await this.invokeCommand<any>('sftp_list_dir', {
      serverId,
      path: path ?? '.',
    });
    return snakeToCamel<SftpDirListing>(result);
  }

  async sftpDownloadFile(serverId: number, remotePath: string, localPath: string): Promise<number> {
    return await this.invokeCommand<number>('sftp_download_file', {
      serverId,
      remotePath,
      localPath,
    });
  }

  async sftpUploadFile(serverId: number, localPath: string, remotePath: string): Promise<number> {
    return await this.invokeCommand<number>('sftp_upload_file', {
      serverId,
      localPath,
      remotePath,
    });
  }

  async sftpMkdir(serverId: number, remotePath: string): Promise<void> {
    await this.invokeCommand('sftp_mkdir', { serverId, remotePath });
  }

  async sftpRemove(serverId: number, remotePath: string, isDir: boolean): Promise<void> {
    await this.invokeCommand('sftp_remove', { serverId, remotePath, isDir });
  }

  // ─── AI 助手 ───────────────────────────────────────────────────

  async getAgentSettings(): Promise<AgentSettingsView> {
    const result = await this.invokeCommand<any>('get_agent_settings');
    return snakeToCamel<AgentSettingsView>(result);
  }

  async saveAgentSettings(settings: AgentSettingsInput): Promise<AgentSettingsView> {
    const result = await this.invokeCommand<any>('save_agent_settings', { settings });
    return snakeToCamel<AgentSettingsView>(result);
  }

  async testAgentConnection(
    baseUrl?: string | null,
    apiKey?: string | null,
    model?: string | null,
  ): Promise<AgentConnectionTestResult> {
    const result = await this.invokeCommand<any>('test_agent_connection', {
      baseUrl: baseUrl ?? null,
      apiKey: apiKey ?? null,
      model: model ?? null,
    });
    return snakeToCamel<AgentConnectionTestResult>(result);
  }

  async getAgentMessages(): Promise<AgentMessageItem[]> {
    const list = await this.invokeCommand<any[]>('get_agent_messages');
    return (Array.isArray(list) ? list : []).map(item => snakeToCamel<AgentMessageItem>(item));
  }

  async clearAgentMessages(): Promise<void> {
    await this.invokeCommand('clear_agent_messages');
  }

  async sendAgentMessage(message: string): Promise<AgentMessageItem[]> {
    const list = await this.invokeCommand<any[]>('send_agent_message', { message });
    return (Array.isArray(list) ? list : []).map(item => snakeToCamel<AgentMessageItem>(item));
  }

  async applyAgentProposal(messageId: number, proposalId: string): Promise<AgentMessageItem> {
    const result = await this.invokeCommand<any>('apply_agent_proposal', { messageId, proposalId });
    return snakeToCamel<AgentMessageItem>(result);
  }

  async rejectAgentProposal(messageId: number, proposalId: string): Promise<AgentMessageItem> {
    const result = await this.invokeCommand<any>('reject_agent_proposal', { messageId, proposalId });
    return snakeToCamel<AgentMessageItem>(result);
  }
}

export { prepareInvokeArgs };
