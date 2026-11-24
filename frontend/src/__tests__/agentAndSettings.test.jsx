import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AgentView from '../components/AgentView';
import SystemSettingsDialog from '../components/SystemSettingsDialog';

const { mockApi } = vi.hoisted(() => ({
    mockApi: {
        getAgentSettings: vi.fn(),
        saveAgentSettings: vi.fn(),
        testAgentConnection: vi.fn(),
        getAgentMessages: vi.fn(),
        clearAgentMessages: vi.fn(),
        sendAgentMessage: vi.fn(),
        cancelAgentStream: vi.fn(),
        applyAgentProposal: vi.fn(),
        rejectAgentProposal: vi.fn(),
        getAppMonitorSettings: vi.fn(),
        saveAppMonitorSettings: vi.fn(),
        listBackups: vi.fn(),
        createBackup: vi.fn(),
        restoreBackup: vi.fn(),
    },
}));

vi.mock('../services/api', () => ({
    default: mockApi,
}));

vi.mock('../utils/dialogs', () => ({
    confirmDialog: vi.fn().mockResolvedValue(true),
}));

const INITIAL_ASSISTANT_MSG = {
    id: 2,
    sessionId: 'default',
    role: 'assistant',
    content: '已为你生成两条待确认提案，请核对后决定是否写入。',
    createdAt: '2026-11-24 12:00:00',
    proposals: [
        {
            id: 'prop-1',
            kind: 'create_reminder',
            targetLabel: '备忘提醒：服务器续费检查',
            reason: '即将到期',
            status: 'pending',
            payload: { title: '服务器续费检查', due_at: '2026-12-01' },
            diffs: [
                { field: 'title', label: '提醒标题', before: null, after: '服务器续费检查' },
                { field: 'due_at', label: '提醒日期', before: null, after: '2026-12-01' },
            ],
        },
        {
            id: 'prop-2',
            kind: 'update_asset',
            targetLabel: '服务器：Tokyo-VPS',
            reason: '调价记录',
            status: 'pending',
            payload: { asset_kind: 'server', asset_id: 1, patch: { billing_amount: 8 } },
            diffs: [
                { field: 'billing_amount', label: '费用金额', before: 5, after: 8 },
            ],
        },
    ],
};

describe('Phase 5: AgentView & SystemSettingsDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockApi.getAgentSettings.mockResolvedValue({
            success: true,
            data: {
                baseUrl: 'https://api.openai.com/v1',
                model: 'gpt-4o-mini',
                maxTokens: 2048,
                hasApiKey: true,
                apiKeyHint: 'sk-1***9999',
            },
        });
        mockApi.saveAgentSettings.mockResolvedValue({
            success: true,
            data: {
                baseUrl: 'http://127.0.0.1:11434/v1',
                model: 'qwen2.5:14b',
                maxTokens: 4096,
                hasApiKey: false,
                apiKeyHint: null,
            },
        });
        mockApi.testAgentConnection.mockResolvedValue({
            success: true,
            data: { ok: true, model: 'qwen2.5:14b', latencyMs: 42, message: '连接成功（耗时 42 ms）' },
        });
        mockApi.getAgentMessages.mockResolvedValue({ success: true, data: [] });
        mockApi.sendAgentMessage.mockResolvedValue({
            success: true,
            data: [
                {
                    id: 1,
                    sessionId: 'default',
                    role: 'user',
                    content: '帮我安排续费提醒',
                    proposals: [],
                    createdAt: '2026-11-24 12:00:00',
                },
                INITIAL_ASSISTANT_MSG,
            ],
        });
        mockApi.cancelAgentStream.mockResolvedValue({ success: true, data: true });
        mockApi.applyAgentProposal.mockResolvedValue({
            success: true,
            data: {
                ...INITIAL_ASSISTANT_MSG,
                proposals: [
                    { ...INITIAL_ASSISTANT_MSG.proposals[0], status: 'applied' },
                    INITIAL_ASSISTANT_MSG.proposals[1],
                ],
            },
        });
        mockApi.rejectAgentProposal.mockResolvedValue({
            success: true,
            data: {
                ...INITIAL_ASSISTANT_MSG,
                proposals: [
                    { ...INITIAL_ASSISTANT_MSG.proposals[0], status: 'applied' },
                    { ...INITIAL_ASSISTANT_MSG.proposals[1], status: 'rejected' },
                ],
            },
        });
        mockApi.getAppMonitorSettings.mockResolvedValue({
            success: true,
            data: { serverMonitorMinutes: 5 },
        });
        mockApi.saveAppMonitorSettings.mockResolvedValue({
            success: true,
            data: { serverMonitorMinutes: 15 },
        });
        mockApi.listBackups.mockResolvedValue({
            success: true,
            data: [{ name: 'manual_2026-11-24.db', size: 102400, createdAt: '2026-11-24 10:00:00' }],
        });
        mockApi.createBackup.mockResolvedValue({ success: true, data: '/backups/manual.db' });
        mockApi.restoreBackup.mockResolvedValue({ success: true });
    });

    it('renders privacy boundary, sends prompt, and applies/rejects proposal cards', async () => {
        const user = userEvent.setup();
        const onOverviewChanged = vi.fn();

        render(
            <AgentView
                onNotify={vi.fn()}
                onOpenSystemSettings={vi.fn()}
                onOverviewChanged={onOverviewChanged}
            />,
        );

        expect(await screen.findByText(/隐私保护已启用/)).toBeInTheDocument();

        const textarea = screen.getByPlaceholderText(/输入问题或让助手生成提醒/);
        await user.type(textarea, '帮我安排续费提醒');
        await user.click(screen.getByRole('button', { name: /发送/ }));

        expect(mockApi.sendAgentMessage).toHaveBeenCalledWith('帮我安排续费提醒');
        expect(await screen.findByText('备忘提醒：服务器续费检查')).toBeInTheDocument();
        expect(screen.getByText('服务器：Tokyo-VPS')).toBeInTheDocument();

        // 确认写入第一条提案
        const applyBtns = screen.getAllByRole('button', { name: /确认写入/ });
        await user.click(applyBtns[0]);

        await waitFor(() => {
            expect(mockApi.applyAgentProposal).toHaveBeenCalledWith(2, 'prop-1');
            expect(onOverviewChanged).toHaveBeenCalled();
        });
        expect(await screen.findByText('已写入本地数据库')).toBeInTheDocument();

        // 忽略第二条提案
        const rejectBtn = screen.getByRole('button', { name: /忽略/ });
        await user.click(rejectBtn);
        await waitFor(() => {
            expect(mockApi.rejectAgentProposal).toHaveBeenCalledWith(2, 'prop-2');
        });
        expect(await screen.findByText('已忽略')).toBeInTheDocument();
    });

    it('switches SystemSettingsDialog tabs to configure AI, monitor interval, and backups', async () => {
        const user = userEvent.setup();

        render(
            <SystemSettingsDialog
                isOpen={true}
                initialTab="ai"
                onClose={vi.fn()}
                onNotify={vi.fn()}
                onBackupRestored={vi.fn()}
            />,
        );

        const dialog = await screen.findByRole('dialog', { name: '系统设置' });
        expect(within(dialog).getByDisplayValue('https://api.openai.com/v1')).toBeInTheDocument();

        // 测试 AI 连接与保存
        await user.click(within(dialog).getByRole('button', { name: /测试连接/ }));
        expect(await within(dialog).findByText('连接成功（耗时 42 ms）')).toBeInTheDocument();

        await user.click(within(dialog).getByRole('button', { name: /保存 AI 设置/ }));
        expect(mockApi.saveAgentSettings).toHaveBeenCalled();

        // 切换到服务器监控 Tab
        await user.click(within(dialog).getByRole('button', { name: /服务器监控/ }));
        const select = within(dialog).getByRole('combobox');
        await user.selectOptions(select, '15');
        await user.click(within(dialog).getByRole('button', { name: /保存采集设置/ }));
        expect(mockApi.saveAppMonitorSettings).toHaveBeenCalledWith(15);

        // 切换到数据备份与恢复 Tab
        await user.click(within(dialog).getByRole('button', { name: /数据备份与恢复/ }));
        expect(await within(dialog).findByText('manual_2026-11-24.db')).toBeInTheDocument();
        await user.click(within(dialog).getByRole('button', { name: /创建备份/ }));
        expect(mockApi.createBackup).toHaveBeenCalledWith('manual');
    });

    it('发送消息后立即上屏并展示流式停止按钮，系统设置支持 128K 最大输出 Token', async () => {
        const user = userEvent.setup();
        let resolveSend;
        mockApi.sendAgentMessage.mockImplementationOnce(
            () => new Promise(resolve => { resolveSend = resolve; }),
        );

        render(
            <AgentView
                onNotify={vi.fn()}
                onOpenSystemSettings={vi.fn()}
                onOverviewChanged={vi.fn()}
            />,
        );
        await screen.findByText(/隐私保护已启用/);

        const textarea = screen.getByPlaceholderText(/输入问题或让助手生成提醒/);
        await user.type(textarea, '立刻查看我的支出');
        await user.click(screen.getByRole('button', { name: /发送/ }));

        // 在后端尚未返回前，用户自己发出的消息必须立刻显示，且出现停止生成按钮
        expect(screen.getByText('立刻查看我的支出')).toBeInTheDocument();
        expect(screen.getByText(/等待模型首字响应/)).toBeInTheDocument();
        const stopBtn = screen.getByRole('button', { name: '停止生成' });
        await user.click(stopBtn);
        expect(mockApi.cancelAgentStream).toHaveBeenCalledTimes(1);

        resolveSend({
            success: true,
            data: [
                { id: 1, sessionId: 'default', role: 'user', content: '立刻查看我的支出', proposals: [] },
                { id: 2, sessionId: 'default', role: 'assistant', content: '已停止生成。', proposals: [] },
            ],
        });
        expect(await screen.findByText('已停止生成。')).toBeInTheDocument();

        // 验证系统设置允许输入并保存 128000（不再受 16384 限制）
        render(
            <SystemSettingsDialog
                isOpen={true}
                initialTab="ai"
                onClose={vi.fn()}
                onNotify={vi.fn()}
                onBackupRestored={vi.fn()}
            />,
        );
        const dialog = await screen.findByRole('dialog', { name: '系统设置' });
        await user.click(within(dialog).getByRole('button', { name: '128K' }));
        await user.click(within(dialog).getByRole('button', { name: /保存 AI 设置/ }));
        expect(mockApi.saveAgentSettings).toHaveBeenCalledWith(
            expect.objectContaining({ maxTokens: 128000 }),
        );
    });

    it('美观格式化 AI 助手回复，自动消除 ***** 原始分隔符并渲染原生标题、引用卡与数据表', async () => {
        mockApi.getAgentMessages.mockResolvedValueOnce({
            success: true,
            data: [
                {
                    id: 10,
                    sessionId: 'default',
                    role: 'assistant',
                    content: [
                        '> 本月固定支出合计 **¥205.00**',
                        '*****',
                        '## 服务器明细',
                        '| 名称 | 费用 |',
                        '| --- | --- |',
                        '| `讯猫` | **¥35.00/月** |',
                    ].join('\n'),
                    proposals: [],
                    createdAt: '2026-11-24 20:55:00',
                },
            ],
        });

        const { container } = render(
            <AgentView
                onNotify={vi.fn()}
                onOpenSystemSettings={vi.fn()}
                onOverviewChanged={vi.fn()}
            />,
        );

        expect(await screen.findByText('服务器明细')).toBeInTheDocument();
        expect(screen.queryByText('*****')).not.toBeInTheDocument();
        expect(container.querySelector('.gm-md-callout')).toHaveTextContent('本月固定支出合计 ¥205.00');
        expect(container.querySelector('.gm-md-table')).toHaveTextContent('讯猫');
        expect(container.querySelector('.gm-md-hr')).not.toBeNull();
    });
});
