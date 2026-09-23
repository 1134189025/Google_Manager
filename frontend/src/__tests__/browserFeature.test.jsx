import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mockApi from './mocks/api';
import AccountTable from '../components/AccountTable';
import AccountListView from '../components/AccountListView';
import BrowserSettingsDialog from '../components/BrowserSettingsDialog';
import App from '../App';
import { formatBytes, describeClearCacheResult } from '../utils/browserUtils';

vi.mock('../services/api', () => ({ default: mockApi }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn(), open: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeTextFile: vi.fn() }));
vi.mock('../components/HistoryDrawer', () => ({ default: () => null }));

const buildAccount = (id, overrides = {}) => ({
    id,
    email: `user${id}@gmail.com`,
    password: `pw${id}`,
    recovery: null,
    phone: null,
    secret: null,
    smsUrl: null,
    regYear: null,
    country: null,
    groupName: null,
    remark: null,
    status: 'inactive',
    createdAt: '2024-01-01 00:00:00',
    updatedAt: '2024-01-01 00:00:00',
    ...overrides,
});

const settingsData = (overrides = {}) => ({
    browserPath: null,
    detectedBrowserPath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    effectiveBrowserPath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    profilesRoot: 'E:\\GoogleManagerProfiles',
    defaultProfilesRoot: 'C:\\Users\\me\\AppData\\Local\\googlemanager\\profiles',
    effectiveProfilesRoot: 'E:\\GoogleManagerProfiles',
    configured: true,
    ...overrides,
});

const browserButtonOf = (email) => {
    const row = screen.getByText(email).closest('tr');
    return within(row).getByRole('button', { name: /打开浏览器/ });
};

beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getBrowserStatuses.mockResolvedValue({ success: true, data: {} });
    mockApi.getBrowserSettings.mockResolvedValue({ success: true, data: settingsData() });
    mockApi.openAccountBrowser.mockResolvedValue({ success: true, data: { action: 'launched', firstLaunch: false } });
    mockApi.saveBrowserSettings.mockResolvedValue({ success: true, data: settingsData() });
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('AccountTable 浏览器按钮', () => {
    const renderTable = (props = {}) => render(
        <AccountTable
            paginatedData={[buildAccount(1), buildAccount(2), buildAccount(3)]}
            pagination={{ currentPage: 1, pageSize: 100 }}
            loading={false}
            sortConfig={{ key: null, direction: null }}
            onSortChange={vi.fn()}
            selectedIds={new Set()}
            onToggleSelectAll={vi.fn()}
            onToggleCheckbox={vi.fn()}
            onRowMouseDown={vi.fn()}
            onRowMouseEnter={vi.fn()}
            editingCell={null}
            onCellClick={vi.fn()}
            onCellDoubleClick={vi.fn()}
            twoFACodes={{}}
            smsCodes={{}}
            browserStatuses={{ 'user1@gmail.com': 'running', 'user2@gmail.com': 'created' }}
            openingBrowserIds={new Set([3])}
            onOpenBrowser={vi.fn()}
            {...props}
        />
    );

    it('按状态显示：运行中 / 已创建 / 未创建，打开中的按钮禁用', () => {
        renderTable();
        expect(browserButtonOf('user1@gmail.com')).toHaveAttribute('data-status', 'running');
        expect(browserButtonOf('user1@gmail.com')).toHaveAccessibleName('打开浏览器（运行中）');
        expect(browserButtonOf('user2@gmail.com')).toHaveAttribute('data-status', 'created');
        expect(browserButtonOf('user3@gmail.com')).toHaveAttribute('data-status', 'none');
        expect(browserButtonOf('user3@gmail.com')).toBeDisabled();
        expect(browserButtonOf('user1@gmail.com')).not.toBeDisabled();
    });

    it('点击把整个账号交给 onOpenBrowser', () => {
        const onOpenBrowser = vi.fn();
        renderTable({ onOpenBrowser });
        fireEvent.click(browserButtonOf('user2@gmail.com'));
        expect(onOpenBrowser).toHaveBeenCalledWith(expect.objectContaining({ id: 2, email: 'user2@gmail.com' }));
    });

    it('未提供 onOpenBrowser 时不渲染按钮', () => {
        renderTable({ onOpenBrowser: undefined });
        const row = screen.getByText('user1@gmail.com').closest('tr');
        expect(within(row).queryByRole('button', { name: /打开浏览器/ })).toBeNull();
    });
});

describe('AccountListView 打开浏览器与删除配置', () => {
    const baseProps = () => ({
        accounts: [buildAccount(1), buildAccount(2)],
        search: '',
        setSearch: vi.fn(),
        groupFilter: null,
        setGroupFilter: vi.fn(),
        allGroups: [],
        copyToClipboard: vi.fn().mockResolvedValue(undefined),
        twoFACodes: {},
        toggleStatus: vi.fn(),
        onEdit: vi.fn(),
        onDelete: vi.fn(),
        onBatchDelete: vi.fn(),
        onInlineEdit: vi.fn(),
        loading: false,
        onSearchChange: vi.fn(),
        onNotify: vi.fn(),
        openBrowserSettings: vi.fn().mockResolvedValue(true),
    });

    it('当前页状态来自批量查询并反映到按钮上', async () => {
        mockApi.getBrowserStatuses.mockResolvedValue({ success: true, data: { 'user1@gmail.com': 'running' } });
        render(<AccountListView {...baseProps()} />);

        await waitFor(() => expect(browserButtonOf('user1@gmail.com')).toHaveAttribute('data-status', 'running'));
        expect(mockApi.getBrowserStatuses).toHaveBeenCalledWith(['user1@gmail.com', 'user2@gmail.com']);
        expect(browserButtonOf('user2@gmail.com')).toHaveAttribute('data-status', 'none');
    });

    it('首次打开某账号：复制邮箱并提示', async () => {
        mockApi.openAccountBrowser.mockResolvedValue({ success: true, data: { action: 'launched', firstLaunch: true } });
        const props = baseProps();
        render(<AccountListView {...props} />);

        fireEvent.click(browserButtonOf('user1@gmail.com'));

        await waitFor(() => expect(mockApi.openAccountBrowser).toHaveBeenCalledWith(1));
        await waitFor(() => expect(props.copyToClipboard).toHaveBeenCalledWith('user1@gmail.com', '邮箱'));
        expect(props.onNotify).toHaveBeenCalledWith(expect.stringContaining('登录页'));
        expect(props.openBrowserSettings).not.toHaveBeenCalled();
    });

    it('非首次打开不复制邮箱', async () => {
        const props = baseProps();
        render(<AccountListView {...props} />);
        fireEvent.click(browserButtonOf('user2@gmail.com'));
        await waitFor(() => expect(mockApi.openAccountBrowser).toHaveBeenCalledWith(2));
        expect(props.copyToClipboard).not.toHaveBeenCalled();
    });

    it('未确认过配置目录：先弹设置，取消则不打开', async () => {
        mockApi.getBrowserSettings.mockResolvedValue({ success: true, data: settingsData({ configured: false, profilesRoot: null }) });
        const props = { ...baseProps(), openBrowserSettings: vi.fn().mockResolvedValue(false) };
        render(<AccountListView {...props} />);

        fireEvent.click(browserButtonOf('user1@gmail.com'));

        await waitFor(() => expect(props.openBrowserSettings).toHaveBeenCalledWith({ firstRun: true }));
        await waitFor(() => expect(browserButtonOf('user1@gmail.com')).not.toBeDisabled());
        expect(mockApi.openAccountBrowser).not.toHaveBeenCalled();
    });

    it('未确认过配置目录：保存设置后继续打开', async () => {
        mockApi.getBrowserSettings.mockResolvedValue({ success: true, data: settingsData({ configured: false, profilesRoot: null }) });
        const props = baseProps();
        render(<AccountListView {...props} />);

        fireEvent.click(browserButtonOf('user1@gmail.com'));

        await waitFor(() => expect(mockApi.openAccountBrowser).toHaveBeenCalledWith(1));
        expect(props.openBrowserSettings).toHaveBeenCalledWith({ firstRun: true });
    });

    it('打开失败时提示后端给出的原因', async () => {
        mockApi.openAccountBrowser.mockResolvedValue({ success: false, message: '未找到 Chrome 或 Edge' });
        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
        render(<AccountListView {...baseProps()} />);

        fireEvent.click(browserButtonOf('user1@gmail.com'));
        await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('未找到 Chrome 或 Edge'));
    });

    describe('回收站彻底删除', () => {
        const deleted = { ...buildAccount(9, { email: 'gone@gmail.com' }), deletedAt: '2024-02-01 00:00:00' };

        beforeEach(() => {
            mockApi.getDeletedAccounts = vi.fn().mockResolvedValue({ success: true, data: [deleted] });
            mockApi.purgeAccount = vi.fn().mockResolvedValue({ success: true });
            mockApi.purgeAllDeleted = vi.fn().mockResolvedValue({ success: true, data: 1 });
        });

        const openRecycleBin = async () => {
            fireEvent.click(screen.getByTitle('查看回收站账号'));
            await screen.findByText('gone@gmail.com');
        };

        it('有配置目录时追加询问，确认后在删除账号之后删除配置', async () => {
            mockApi.getBrowserStatuses.mockImplementation(async (emails) => ({
                success: true,
                data: Object.fromEntries(emails.map(email => [email, email === 'gone@gmail.com' ? 'created' : 'none'])),
            }));
            mockApi.deleteBrowserProfiles.mockResolvedValue({ success: true, data: { deleted: 1, skipped: 0 } });
            const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
            const props = baseProps();
            render(<AccountListView {...props} />);
            await openRecycleBin();

            fireEvent.click(screen.getByRole('button', { name: '永久删除' }));

            await waitFor(() => expect(mockApi.deleteBrowserProfiles).toHaveBeenCalledWith(['gone@gmail.com']));
            expect(confirmSpy).toHaveBeenCalledTimes(2);
            expect(confirmSpy.mock.calls[1][0]).toContain('浏览器配置');
            expect(mockApi.purgeAccount).toHaveBeenCalledWith(9);
            expect(mockApi.purgeAccount.mock.invocationCallOrder[0])
                .toBeLessThan(mockApi.deleteBrowserProfiles.mock.invocationCallOrder[0]);
            expect(props.onNotify).toHaveBeenCalledWith('已删除 1 个浏览器配置');
        });

        it('选择保留配置时只删除账号', async () => {
            mockApi.getBrowserStatuses.mockResolvedValue({ success: true, data: { 'gone@gmail.com': 'created' } });
            vi.spyOn(window, 'confirm').mockReturnValueOnce(true).mockReturnValueOnce(false);
            render(<AccountListView {...baseProps()} />);
            await openRecycleBin();

            fireEvent.click(screen.getByRole('button', { name: '永久删除' }));

            await waitFor(() => expect(mockApi.purgeAccount).toHaveBeenCalledWith(9));
            expect(mockApi.deleteBrowserProfiles).not.toHaveBeenCalled();
        });

        it('没有配置目录时不追加询问', async () => {
            const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
            render(<AccountListView {...baseProps()} />);
            await openRecycleBin();

            fireEvent.click(screen.getByRole('button', { name: '永久删除' }));

            await waitFor(() => expect(mockApi.purgeAccount).toHaveBeenCalledWith(9));
            expect(confirmSpy).toHaveBeenCalledTimes(1);
            expect(mockApi.deleteBrowserProfiles).not.toHaveBeenCalled();
        });

        it('清空回收站时一次询问，保留被跳过的配置并提示', async () => {
            mockApi.getBrowserStatuses.mockImplementation(async (emails) => ({
                success: true,
                data: Object.fromEntries(emails.map(email => [email, 'created'])),
            }));
            mockApi.deleteBrowserProfiles.mockResolvedValue({ success: true, data: { deleted: 0, skipped: 1 } });
            const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
            const props = baseProps();
            render(<AccountListView {...props} />);
            await openRecycleBin();

            fireEvent.click(screen.getByRole('button', { name: '清空回收站' }));

            await waitFor(() => expect(mockApi.deleteBrowserProfiles).toHaveBeenCalledWith(['gone@gmail.com']));
            expect(confirmSpy).toHaveBeenCalledTimes(2);
            expect(mockApi.purgeAllDeleted).toHaveBeenCalled();
            expect(props.onNotify).toHaveBeenCalledWith(expect.stringContaining('1 个因正在运行或仍被其他账号使用而保留'));
        });
    });
});

describe('BrowserSettingsDialog', () => {
    it('首次使用：配置目录预填默认值，保存后回调 onClose(true)', async () => {
        mockApi.getBrowserSettings.mockResolvedValue({ success: true, data: settingsData({ configured: false, profilesRoot: null }) });
        const onClose = vi.fn();
        const onNotify = vi.fn();
        render(<BrowserSettingsDialog isOpen firstRun onClose={onClose} onNotify={onNotify} />);

        expect(screen.getByText('首次使用：确认浏览器设置')).toBeInTheDocument();
        const rootInput = screen.getByLabelText('配置目录');
        await waitFor(() => expect(rootInput).toHaveValue('C:\\Users\\me\\AppData\\Local\\googlemanager\\profiles'));
        expect(screen.getByText(/自动检测到：.*chrome\.exe/)).toBeInTheDocument();

        fireEvent.change(rootInput, { target: { value: '  E:\\GoogleManagerProfiles  ' } });
        fireEvent.click(screen.getByRole('button', { name: '保存并打开浏览器' }));

        await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
        expect(mockApi.saveBrowserSettings).toHaveBeenCalledWith({
            browserPath: null,
            profilesRoot: 'E:\\GoogleManagerProfiles',
        });
        expect(onNotify).toHaveBeenCalledWith('浏览器设置已保存');
    });

    it('保存失败时显示原因且不关闭', async () => {
        mockApi.saveBrowserSettings.mockResolvedValue({ success: false, message: '浏览器程序不存在或不是 .exe 文件：x' });
        const onClose = vi.fn();
        render(<BrowserSettingsDialog isOpen onClose={onClose} />);

        await waitFor(() => expect(screen.getByLabelText('配置目录')).toHaveValue('E:\\GoogleManagerProfiles'));
        fireEvent.change(screen.getByLabelText('浏览器程序'), { target: { value: 'x' } });
        fireEvent.click(screen.getByRole('button', { name: '保存' }));

        expect(await screen.findByText(/浏览器程序不存在/)).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('取消时回调 onClose(false)', async () => {
        const onClose = vi.fn();
        render(<BrowserSettingsDialog isOpen onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: '取消' }));
        expect(onClose).toHaveBeenCalledWith(false);
    });

    it('计算占用与清理全部缓存', async () => {
        mockApi.getBrowserUsage.mockResolvedValue({ success: true, data: { profiles: 2, totalBytes: 1572864 } });
        mockApi.clearBrowserCache.mockResolvedValue({ success: true, data: { cleared: 2, skippedRunning: 1, freedBytes: 2048 } });
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const onNotify = vi.fn();
        render(<BrowserSettingsDialog isOpen onClose={vi.fn()} onNotify={onNotify} />);

        fireEvent.click(screen.getByRole('button', { name: '计算占用' }));
        expect(await screen.findByText('2 个配置，共 1.5 MB')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: '清理全部缓存' }));
        await waitFor(() => expect(mockApi.clearBrowserCache).toHaveBeenCalledWith(null));
        expect(onNotify).toHaveBeenCalledWith('已清理 2 个配置，释放 2.0 KB，跳过运行中 1 个');
    });

    it('关闭状态不渲染', () => {
        render(<BrowserSettingsDialog isOpen={false} onClose={vi.fn()} />);
        expect(screen.queryByText('账号浏览器设置')).toBeNull();
    });
});

describe('App 串联：首次打开浏览器先确认设置', () => {
    it('侧栏设置按钮打开设置弹窗；首次打开时取消不启动、保存后启动', async () => {
        mockApi.getAccounts.mockResolvedValue([buildAccount(1)]);
        mockApi.getBrowserSettings.mockResolvedValue({ success: true, data: settingsData({ configured: false, profilesRoot: null }) });
        render(<App />);

        fireEvent.click(screen.getByTitle('账号浏览器设置'));
        expect(await screen.findByText('账号浏览器设置')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '取消' }));
        await waitFor(() => expect(screen.queryByText('账号浏览器设置')).toBeNull());

        await screen.findByText('user1@gmail.com');
        fireEvent.click(browserButtonOf('user1@gmail.com'));
        expect(await screen.findByText('首次使用：确认浏览器设置')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '取消' }));
        await waitFor(() => expect(browserButtonOf('user1@gmail.com')).not.toBeDisabled());
        expect(mockApi.openAccountBrowser).not.toHaveBeenCalled();

        fireEvent.click(browserButtonOf('user1@gmail.com'));
        await screen.findByText('首次使用：确认浏览器设置');
        await waitFor(() => expect(screen.getByLabelText('配置目录')).not.toHaveValue(''));
        fireEvent.click(screen.getByRole('button', { name: '保存并打开浏览器' }));
        await waitFor(() => expect(mockApi.openAccountBrowser).toHaveBeenCalledWith(1));
    });
});

describe('browserUtils', () => {
    it('formatBytes', () => {
        expect(formatBytes(0)).toBe('0 B');
        expect(formatBytes(undefined)).toBe('0 B');
        expect(formatBytes(512)).toBe('512 B');
        expect(formatBytes(1536)).toBe('1.5 KB');
        expect(formatBytes(75 * 1024 * 1024)).toBe('75.0 MB');
        expect(formatBytes(150 * 1024 * 1024)).toBe('150 MB');
        expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB');
    });

    it('describeClearCacheResult', () => {
        expect(describeClearCacheResult({ cleared: 0, skippedRunning: 0, freedBytes: 0 })).toBe('没有可清理的浏览器配置');
        expect(describeClearCacheResult({ cleared: 3, skippedRunning: 0, freedBytes: 1024 * 1024 })).toBe('已清理 3 个配置，释放 1.0 MB');
        expect(describeClearCacheResult({ cleared: 0, skippedRunning: 2, freedBytes: 0 })).toBe('跳过运行中 2 个');
    });
});
