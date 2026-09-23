// frontend/src/__tests__/adapters.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getAdapter, resetAdapter, setAdapter, TauriAdapter } from '../services/adapters/index';
import { prepareInvokeArgs } from '../services/adapters/tauri-adapter';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe('getAdapter 工厂', () => {
  beforeEach(() => {
    resetAdapter();
    vi.clearAllMocks();
  });

  it('自用桌面版始终返回 TauriAdapter', () => {
    const adapter = getAdapter();
    expect(adapter).toBeInstanceOf(TauriAdapter);
  });

  it('多次调用返回同一个单例', () => {
    const first = getAdapter();
    const second = getAdapter();
    expect(first).toBe(second);
  });

  it('resetAdapter 后重新创建实例', () => {
    const first = getAdapter();
    resetAdapter();
    const second = getAdapter();
    expect(first).not.toBe(second);
  });

  it('setAdapter 可以注入自定义适配器（测试用）', () => {
    const mockAdapter: any = { getAccounts: vi.fn() };
    setAdapter(mockAdapter);
    expect(getAdapter()).toBe(mockAdapter);
  });
});

/**
 * 验收标准 18：Tauri 适配器必须对顶层 invoke 参数使用 camelCase、
 * 对嵌套载荷使用 snake_case。这是桌面端命令能真正被 Rust 侧解析的前提。
 */
describe('prepareInvokeArgs 参数命名（顶层 camelCase / 嵌套 snake_case）', () => {
  it('顶层多词参数保持 camelCase', () => {
    const prepared = prepareInvokeArgs({ accountIds: [1, 2], accountId: 7, backupName: 'x.db' })!;
    expect(Object.keys(prepared).sort()).toEqual(['accountId', 'accountIds', 'backupName']);
  });

  it('顶层键不会被转成 snake_case', () => {
    const prepared = prepareInvokeArgs({ accountIds: [1] })!;
    expect(prepared).not.toHaveProperty('account_ids');
    expect(prepared).toHaveProperty('accountIds', [1]);
  });

  it('嵌套对象的键被转成 snake_case', () => {
    const prepared = prepareInvokeArgs({
      account: { regYear: '2021', groupName: 'A', isActive: true },
    })!;
    expect(prepared.account).toEqual({
      reg_year: '2021',
      group_name: 'A',
      is_active: true,
    });
  });

  it('嵌套数组内对象同样转成 snake_case', () => {
    const prepared = prepareInvokeArgs({
      accounts: [{ regYear: '2020' }, { groupName: 'B' }],
    })!;
    expect(prepared.accounts).toEqual([{ reg_year: '2020' }, { group_name: 'B' }]);
  });

  it('标量与 null 原样保留', () => {
    const prepared = prepareInvokeArgs({ id: 3, search: null, flag: true })!;
    expect(prepared).toEqual({ id: 3, search: null, flag: true });
  });

  it('未传参数时返回 undefined', () => {
    expect(prepareInvokeArgs()).toBeUndefined();
  });

  it('端到端：getAccounts 通过 invoke 发送 camelCase 的 search', async () => {
    mockedInvoke.mockClear();
    mockedInvoke.mockResolvedValue([] as never);
    const adapter = new TauriAdapter();
    await adapter.getAccounts('alice');

    expect(mockedInvoke).toHaveBeenCalledWith('get_accounts', {
      search: 'alice',
    });
  });

  it('端到端：exportAccountsText 顶层 camelCase、嵌套 config snake_case', async () => {
    mockedInvoke.mockClear();
    mockedInvoke.mockResolvedValue('' as never);
    const adapter = new TauriAdapter();
    await adapter.exportAccountsText([1, 2], null, {
      separator: '----',
      fields: ['email'],
      includeStats: false,
      accountOrder: { field: 'created_at', direction: 'desc' },
      categorySort: { field: '', direction: 'asc' },
      categoryLabelTemplate: '',
    });

    const [, args] = mockedInvoke.mock.calls[0] as [string, any];
    expect(args).toHaveProperty('accountIds');
    expect(args).not.toHaveProperty('account_ids');
    expect(args).not.toHaveProperty('soldStatus');
    expect(args.config).toHaveProperty('include_stats');
    expect(args.config.account_order).toEqual({ field: 'created_at', direction: 'desc' });
  });

  it('端到端：restoreBackup 发送 camelCase 的 backupName', async () => {
    mockedInvoke.mockResolvedValue(undefined as never);
    const adapter = new TauriAdapter();
    await adapter.restoreBackup('data_1.db');

    expect(mockedInvoke).toHaveBeenCalledWith('restore_backup', { backupName: 'data_1.db' });
  });

  it('端到端：返回值被转换成 camelCase', async () => {
    mockedInvoke.mockResolvedValue([
      {
        id: 1,
        email: 'a@b.com',
        password: 'p',
        reg_year: '2021',
        group_name: 'G',
        group_name: 'G',
        status: 'inactive',
        created_at: '2024-01-01 00:00:00',
        updated_at: '2024-01-01 00:00:00',
      },
    ] as never);
    const adapter = new TauriAdapter();
    const result = await adapter.getAccounts();

    expect(result[0]).toMatchObject({
      regYear: '2021',
      groupName: 'G',
      groupName: 'G',
    });
  });
});

describe('手机接码地址（smsUrl）契约', () => {
  it('更新其他字段时会保留已有的接码地址（防止数据丢失）', async () => {
    mockedInvoke.mockClear();
    mockedInvoke.mockImplementation((async (command: string) => {
      if (command === 'get_account_by_id') {
        return {
          id: 1,
          email: 'a@b.com',
          password: 'p',
          recovery: null,
          phone: '+12025550123',
          secret: null,
          sms_url: 'https://sms6688.com/api/sms/recordText?token=abc&tpl=1',
          status: 'inactive',
        };
      }
      return { id: 1, email: 'a@b.com', password: 'p' };
    }) as never);

    const adapter = new TauriAdapter();
    await adapter.updateAccount(1, { remark: '只改备注' });

    const updateCall = mockedInvoke.mock.calls.find(([cmd]) => cmd === 'update_account')!;
    const payload = (updateCall[1] as any).account;
    expect(payload).toHaveProperty('sms_url', 'https://sms6688.com/api/sms/recordText?token=abc&tpl=1');
    expect(payload).toHaveProperty('remark', '只改备注');
  });

  it('主动传空串时会清空接码地址，而不是回退旧值', async () => {
    mockedInvoke.mockClear();
    mockedInvoke.mockImplementation((async (command: string) => {
      if (command === 'get_account_by_id') {
        return {
          id: 1,
          email: 'a@b.com',
          password: 'p',
          sms_url: 'https://sms6688.com/api/sms/recordText?token=abc&tpl=1',
        };
      }
      return { id: 1 };
    }) as never);

    const adapter = new TauriAdapter();
    await adapter.updateAccount(1, { smsUrl: '' });

    const updateCall = mockedInvoke.mock.calls.find(([cmd]) => cmd === 'update_account')!;
    expect((updateCall[1] as any).account.sms_url).toBe('');
  });

  it('fetchSmsCode 传 camelCase 的 accountId，并把结果转成前端契约', async () => {
    mockedInvoke.mockClear();
    mockedInvoke.mockResolvedValue({
      status: 'success',
      code: '821371',
      message: null,
      error: null,
      retry_after_seconds: null,
      fetched_at: '2024-01-01T00:00:00Z',
    } as never);

    const adapter = new TauriAdapter();
    const result = await adapter.fetchSmsCode(42);

    expect(mockedInvoke).toHaveBeenCalledWith('fetch_sms_code', { accountId: 42 });
    expect(result).toMatchObject({
      status: 'success',
      code: '821371',
      retryAfterSeconds: null,
      fetchedAt: '2024-01-01T00:00:00Z',
    });
  });

  it('未知状态回退为 error，success 但缺验证码视为无法识别', async () => {
    mockedInvoke.mockClear();
    mockedInvoke.mockResolvedValue({ status: 'weird', code: null } as never);
    const adapter = new TauriAdapter();
    expect((await adapter.fetchSmsCode(1)).status).toBe('error');

    mockedInvoke.mockResolvedValue({ status: 'success', code: null } as never);
    expect((await adapter.fetchSmsCode(1)).status).toBe('unparsable');
  });
});

describe('账号独立浏览器命令契约', () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it('openAccountBrowser 传 camelCase 的 accountId，结果转成前端契约', async () => {
    mockedInvoke.mockResolvedValue({ action: 'launched', first_launch: true } as never);
    const result = await new TauriAdapter().openAccountBrowser(7);

    expect(mockedInvoke).toHaveBeenCalledWith('open_account_browser', { accountId: 7 });
    expect(result).toEqual({ action: 'launched', firstLaunch: true });
  });

  it('openAccountBrowser 未知 action 回退为 launched', async () => {
    mockedInvoke.mockResolvedValue({ action: 'weird' } as never);
    const result = await new TauriAdapter().openAccountBrowser(1);
    expect(result).toEqual({ action: 'launched', firstLaunch: false });
  });

  it('getBrowserStatuses 保留邮箱原样作为键（含下划线），非法状态回退为 none', async () => {
    mockedInvoke.mockResolvedValue({
      'rec_user@gmail.com': 'running',
      'Plain@Gmail.com': 'created',
      'x@gmail.com': 'bogus',
    } as never);
    const emails = ['rec_user@gmail.com', 'Plain@Gmail.com', 'x@gmail.com'];
    const result = await new TauriAdapter().getBrowserStatuses(emails);

    expect(mockedInvoke).toHaveBeenCalledWith('get_browser_statuses', { emails });
    expect(result).toEqual({
      'rec_user@gmail.com': 'running',
      'Plain@Gmail.com': 'created',
      'x@gmail.com': 'none',
    });
  });

  it('getBrowserStatuses 空列表不发起调用', async () => {
    expect(await new TauriAdapter().getBrowserStatuses([])).toEqual({});
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it('clearBrowserCache 顶层 accountIds 为 camelCase，null 表示全部', async () => {
    mockedInvoke.mockResolvedValue({ cleared: 2, skipped_running: 1, freed_bytes: 2048 } as never);
    const adapter = new TauriAdapter();

    const result = await adapter.clearBrowserCache([1, 2]);
    expect(mockedInvoke).toHaveBeenCalledWith('clear_browser_cache', { accountIds: [1, 2] });
    expect(result).toEqual({ cleared: 2, skippedRunning: 1, freedBytes: 2048 });

    await adapter.clearBrowserCache(null);
    expect(mockedInvoke).toHaveBeenLastCalledWith('clear_browser_cache', { accountIds: null });
  });

  it('saveBrowserSettings 顶层 settings、嵌套字段为 snake_case，空串转 null', async () => {
    mockedInvoke.mockResolvedValue({
      browser_path: null,
      detected_browser_path: 'C:\\chrome.exe',
      effective_browser_path: 'C:\\chrome.exe',
      profiles_root: 'E:\\GoogleManagerProfiles',
      default_profiles_root: 'C:\\Local\\googlemanager\\profiles',
      effective_profiles_root: 'E:\\GoogleManagerProfiles',
      configured: true,
    } as never);

    const result = await new TauriAdapter().saveBrowserSettings({
      browserPath: '',
      profilesRoot: 'E:\\GoogleManagerProfiles',
    });

    expect(mockedInvoke).toHaveBeenCalledWith('save_browser_settings', {
      settings: { browser_path: null, profiles_root: 'E:\\GoogleManagerProfiles' },
    });
    expect(result).toMatchObject({
      detectedBrowserPath: 'C:\\chrome.exe',
      effectiveProfilesRoot: 'E:\\GoogleManagerProfiles',
      configured: true,
    });
  });

  it('deleteBrowserProfiles / getBrowserUsage / openBrowserProfileDir 参数与结果转换', async () => {
    const adapter = new TauriAdapter();

    mockedInvoke.mockResolvedValue({ deleted: 1, skipped: 1 } as never);
    expect(await adapter.deleteBrowserProfiles(['a@gmail.com'])).toEqual({ deleted: 1, skipped: 1 });
    expect(mockedInvoke).toHaveBeenLastCalledWith('delete_browser_profiles', { emails: ['a@gmail.com'] });

    mockedInvoke.mockResolvedValue({ profiles: 3, total_bytes: 1024 } as never);
    expect(await adapter.getBrowserUsage()).toEqual({ profiles: 3, totalBytes: 1024 });

    mockedInvoke.mockResolvedValue(undefined as never);
    await adapter.openBrowserProfileDir(9);
    expect(mockedInvoke).toHaveBeenLastCalledWith('open_browser_profile_dir', { accountId: 9 });
  });
});
