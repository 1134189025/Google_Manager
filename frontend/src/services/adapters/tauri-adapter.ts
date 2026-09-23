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
}

export { prepareInvokeArgs };
