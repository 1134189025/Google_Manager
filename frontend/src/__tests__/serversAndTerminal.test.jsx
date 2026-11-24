import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ServersView from '../components/ServersView';
import TerminalView from '../components/TerminalView';

const { mockApi, mockListeners, mockTerminalInstances } = vi.hoisted(() => ({
    mockApi: {
        getServers: vi.fn(),
        createServer: vi.fn(),
        updateServer: vi.fn(),
        deleteServer: vi.fn(),
        probeServer: vi.fn(),
        resetServerHostFingerprint: vi.fn(),
        getAppMonitorSettings: vi.fn(),
        sftpListDir: vi.fn(),
        sftpDownloadFile: vi.fn(),
        sftpUploadFile: vi.fn(),
        sftpMkdir: vi.fn(),
        sftpRemove: vi.fn(),
        sshOpenSession: vi.fn(),
        sshWriteSession: vi.fn(),
        sshResizeSession: vi.fn(),
        sshCloseSession: vi.fn(),
    },
    mockListeners: {},
    mockTerminalInstances: [],
}));

vi.mock('../services/api', () => ({
    default: mockApi,
}));

vi.mock('../utils/dialogs', () => ({
    confirmDialog: vi.fn().mockResolvedValue(true),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
    open: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(null),
}));

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(async (eventName, cb) => {
        mockListeners[eventName] = cb;
        return () => {
            delete mockListeners[eventName];
        };
    }),
}));

vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

vi.mock('@xterm/xterm', () => ({
    Terminal: vi.fn().mockImplementation(function MockTerminal() {
        const inst = {
            cols: 100,
            rows: 30,
            options: {},
            loadAddon: vi.fn(),
            open: vi.fn(),
            write: vi.fn(),
            clear: vi.fn(),
            focus: vi.fn(),
            dispose: vi.fn(),
            onData: vi.fn(() => ({ dispose: vi.fn() })),
        };
        mockTerminalInstances.push(inst);
        return inst;
    }),
}));

vi.mock('@xterm/addon-fit', () => ({
    FitAddon: vi.fn().mockImplementation(function MockFitAddon() {
        return { fit: vi.fn() };
    }),
}));

const SAMPLE_SERVER = {
    id: 1,
    name: 'Tokyo-Prod',
    host: '203.0.113.10',
    port: 22,
    username: 'root',
    authKind: 'password',
    credential: 'secret',
    passphrase: null,
    region: '日本东京',
    os: 'Ubuntu 24.04 LTS',
    kernel: '6.8.0',
    collectEnabled: true,
    billingAmount: 5.0,
    billingCurrency: 'USD',
    billingCycle: 'month',
    expiresAt: '2027-01-15',
    status: 'online',
    cpu: 24,
    memory: 58,
    disk: 41,
    memTotalKb: 4096000,
    diskTotalKb: 52428800,
    loadavg: '0.21 0.15 0.10',
    uptime: '3 天 2 小时',
    servicesJson: JSON.stringify({
        ports: [
            { proto: 'tcp', port: 22, exposure: 'public', address: '0.0.0.0', process: 'sshd', pid: 500 },
            { proto: 'tcp', port: 5432, exposure: 'local', address: '127.0.0.1', process: 'postgres', pid: 810 },
        ],
        dockerAvailable: true,
        dockerReason: null,
        containers: [
            {
                id: '0123456789ab',
                name: 'web-caddy',
                image: 'caddy:2',
                state: 'running',
                status: 'Up 3 days',
                restartCount: 0,
                health: 'healthy',
                cpu: 1.2,
                memoryUsage: '48MiB',
                ports: [{ containerPort: 80, proto: 'tcp', hostPort: 80, hostIp: '0.0.0.0' }],
            },
        ],
    }),
    hostFingerprint: 'SHA256:oldfp1234',
    probedAt: '2026-11-24 10:00:00',
    probeError: null,
    tags: 'prod',
    notes: null,
};

const SECOND_SERVER = {
    ...SAMPLE_SERVER,
    id: 2,
    name: 'SG-Backup',
    host: '198.51.100.20',
    port: 2222,
};

describe('Phase 4: ServersView & TerminalView', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        for (const key of Object.keys(mockListeners)) delete mockListeners[key];
        mockTerminalInstances.length = 0;

        mockApi.getServers.mockResolvedValue({ success: true, data: [SAMPLE_SERVER, SECOND_SERVER] });
        mockApi.getAppMonitorSettings.mockResolvedValue({
            success: true,
            data: { serverMonitorMinutes: 5 },
        });
        mockApi.sftpListDir.mockResolvedValue({
            success: true,
            data: {
                path: '/root',
                entries: [
                    { name: 'logs', size: 0, modified: 1700000000, isDir: true, isSymlink: false },
                    { name: 'app.conf', size: 2048, modified: 1700000000, isDir: false, isSymlink: false },
                ],
                truncated: false,
            },
        });
        mockApi.sftpMkdir.mockResolvedValue({ success: true });
        mockApi.sftpRemove.mockResolvedValue({ success: true });
        mockApi.resetServerHostFingerprint.mockResolvedValue({
            success: true,
            data: { ...SAMPLE_SERVER, hostFingerprint: null, probeError: null },
        });
        let sessionSeq = 0;
        mockApi.sshOpenSession.mockImplementation(async (serverId) => {
            sessionSeq += 1;
            return {
                success: true,
                data: {
                    sessionId: `sess-${serverId}-${sessionSeq}`,
                    serverId,
                    serverName: serverId === 1 ? 'Tokyo-Prod' : 'SG-Backup',
                    host: '203.0.113.10',
                    port: 22,
                },
            };
        });
        mockApi.sshWriteSession.mockResolvedValue({ success: true });
        mockApi.sshResizeSession.mockResolvedValue({ success: true });
        mockApi.sshCloseSession.mockResolvedValue({ success: true });
    });

    it('renders server metrics, ports/Docker drawer, SFTP modal, and terminal action', async () => {
        const user = userEvent.setup();
        const onOpenTerminal = vi.fn();

        render(<ServersView onNotify={vi.fn()} onOpenTerminal={onOpenTerminal} />);

        expect(await screen.findByText('Tokyo-Prod')).toBeInTheDocument();
        expect(screen.getAllByText('24%').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('58%').length).toBeGreaterThanOrEqual(1);

        // 打开「端口与容器」只读详情抽屉
        const portButtons = screen.getAllByRole('button', { name: /端口与容器/ });
        await user.click(portButtons[0]);

        const drawer = await screen.findByRole('dialog', { name: '端口与容器详情' });
        expect(within(drawer).getByText('sshd (500)')).toBeInTheDocument();
        expect(within(drawer).getByText('公网')).toBeInTheDocument();
        expect(within(drawer).getByText('web-caddy')).toBeInTheDocument();
        expect(within(drawer).getByText('caddy:2')).toBeInTheDocument();
        await user.click(within(drawer).getAllByRole('button')[1]); // 关闭抽屉

        // 打开 SFTP 文件弹窗并新建目录 / 删除文件
        const sftpButtons = screen.getAllByRole('button', { name: /SFTP 文件/ });
        await user.click(sftpButtons[0]);

        const sftpDialog = await screen.findByRole('dialog', { name: 'SFTP 文件管理' });
        expect(within(sftpDialog).getByText('app.conf')).toBeInTheDocument();

        await user.click(within(sftpDialog).getByRole('button', { name: /新建目录/ }));
        const dirInput = within(sftpDialog).getByPlaceholderText('输入新目录名称...');
        await user.type(dirInput, 'backups');
        await user.click(within(sftpDialog).getByRole('button', { name: '创建' }));
        expect(mockApi.sftpMkdir).toHaveBeenCalledWith(1, '/root/backups');

        // 触发打开终端
        const openTermButtons = screen.getAllByRole('button', { name: /打开终端/ });
        await user.click(openTermButtons[0]);
        expect(onOpenTerminal).toHaveBeenCalledWith(expect.objectContaining({ id: 1, name: 'Tokyo-Prod' }));
    });

    it('requires exact host:port input before resetting changed SSH host fingerprint', async () => {
        const user = userEvent.setup();
        mockApi.probeServer
            .mockResolvedValueOnce({
                success: false,
                message: 'HOST_KEY_CHANGED:SHA256:oldfp1234:SHA256:newfp9999',
            })
            .mockResolvedValueOnce({
                success: true,
                data: { ...SAMPLE_SERVER, hostFingerprint: 'SHA256:newfp9999', probeError: null },
            });

        render(<ServersView onNotify={vi.fn()} />);
        await screen.findByText('Tokyo-Prod');

        const probeButtons = screen.getAllByRole('button', { name: /^探测$/ });
        await user.click(probeButtons[0]);

        const fpDialog = await screen.findByRole('dialog', { name: '重置服务器主机指纹' });
        const confirmBtn = within(fpDialog).getByRole('button', { name: '确认重置指纹' });
        expect(confirmBtn).toBeDisabled();

        const input = within(fpDialog).getByPlaceholderText('203.0.113.10:22');
        await user.type(input, '203.0.113.10:22');
        expect(confirmBtn).toBeEnabled();

        await user.click(confirmBtn);
        await waitFor(() => {
            expect(mockApi.resetServerHostFingerprint).toHaveBeenCalledWith(1);
        });
    });

    it('supports multi-tab xterm sessions, streams ssh-output events, and inserts snippets without Enter', async () => {
        const user = userEvent.setup();
        const { rerender } = render(
            <TerminalView
                servers={[SAMPLE_SERVER, SECOND_SERVER]}
                darkMode={true}
                isActiveView={true}
                pendingOpenServer={{ server: SAMPLE_SERVER, serverId: 1, seq: 1 }}
                onConsumePendingOpen={vi.fn()}
                onNotify={vi.fn()}
            />,
        );

        await waitFor(() => {
            expect(mockApi.sshOpenSession).toHaveBeenCalledWith(1, 100, 30);
        });

        // 通过「新建连接」开启第二个标签页
        await user.click(screen.getByRole('button', { name: /新建连接/ }));
        await user.click(screen.getByRole('button', { name: /SG-Backup/ }));
        await waitFor(() => {
            expect(mockApi.sshOpenSession).toHaveBeenCalledWith(2, 100, 30);
        });

        // 校验 ssh-output 事件写入终端实例
        mockListeners['ssh-output']?.({
            payload: { session_id: 'sess-2-2', data: 'Welcome Ubuntu\r\n' },
        });
        expect(mockTerminalInstances[1].write).toHaveBeenCalledWith('Welcome Ubuntu\r\n');

        // 点击快捷命令只插入文本、不发送回车
        await user.click(screen.getByRole('button', { name: '磁盘' }));
        expect(mockApi.sshWriteSession).toHaveBeenCalledWith('sess-2-2', 'df -h');
        const written = mockApi.sshWriteSession.mock.calls.at(-1)?.[1] ?? '';
        expect(written).not.toMatch(/[\r\n]/);

        // 关闭第二个标签页
        await user.click(screen.getByRole('button', { name: '关闭标签 SG-Backup' }));
        expect(mockApi.sshCloseSession).toHaveBeenCalledWith('sess-2-2');

        rerender(
            <TerminalView
                servers={[SAMPLE_SERVER, SECOND_SERVER]}
                darkMode={false}
                isActiveView={true}
                pendingOpenServer={null}
                onConsumePendingOpen={vi.fn()}
                onNotify={vi.fn()}
            />,
        );
        expect(screen.getByText('Tokyo-Prod')).toBeInTheDocument();
    });

    it('ServersView 限制到期日期为 4 位年份并在误贴 SSH 公钥时给出提醒', async () => {
        const user = userEvent.setup();
        render(<ServersView fxRate={7.2} onNotify={vi.fn()} />);
        await screen.findByText('Tokyo-Prod');

        await user.click(screen.getByRole('button', { name: /新增服务器/ }));
        const dialog = await screen.findByRole('dialog', { name: '新增服务器' });

        const dateInput = dialog.querySelector('input[type="date"]');
        expect(dateInput).toHaveAttribute('min', '1970-01-01');
        expect(dateInput).toHaveAttribute('max', '2099-12-31');
        fireEvent.change(dateInput, { target: { value: '202612-12-04' } });
        expect(dateInput).toHaveValue('2026-12-04');

        // 切换到 OpenSSH 私钥认证并粘贴公钥，应显示提醒
        const authSelect = within(dialog).getByDisplayValue('密码认证');
        await user.selectOptions(authSelect, 'key');
        const keyArea = within(dialog).getByPlaceholderText('-----BEGIN OPENSSH PRIVATE KEY-----');
        fireEvent.change(keyArea, { target: { value: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 user@host' } });
        expect(within(dialog).getByRole('alert')).toHaveTextContent(/SSH 公钥/);
    });
});
