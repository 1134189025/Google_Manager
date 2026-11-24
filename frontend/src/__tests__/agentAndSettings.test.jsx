import { render, screen, within, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AgentView from '../components/AgentView';
import AgentMemoryDialog from '../components/AgentMemoryDialog';
import SystemSettingsDialog from '../components/SystemSettingsDialog';
import CloseConfirmDialog from '../components/CloseConfirmDialog';
import TitleBar from '../components/TitleBar';
import { confirmDialog } from '../utils/dialogs';

const { mockApi, mockListen } = vi.hoisted(() => ({
    mockListen: vi.fn(),
    mockApi: {
        getAgentSettings: vi.fn(),
        saveAgentSettings: vi.fn(),
        testAgentConnection: vi.fn(),
        fetchAgentModels: vi.fn(),
        getAgentContextStatus: vi.fn(),
        compactAgentContext: vi.fn(),
        getAgentMemory: vi.fn(),
        addAgentMemoryEntry: vi.fn(),
        updateAgentMemoryEntry: vi.fn(),
        deleteAgentMemoryEntry: vi.fn(),
        clearAgentMemory: vi.fn(),
        openAgentMemoryDir: vi.fn(),
        getAgentMessages: vi.fn(),
        clearAgentMessages: vi.fn(),
        sendAgentMessage: vi.fn(),
        cancelAgentStream: vi.fn(),
        applyAgentProposal: vi.fn(),
        rejectAgentProposal: vi.fn(),
        getAppMonitorSettings: vi.fn(),
        saveAppMonitorSettings: vi.fn(),
        getWindowCloseSettings: vi.fn(),
        saveWindowCloseSettings: vi.fn(),
        handleWindowClose: vi.fn(),
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

vi.mock('@tauri-apps/api/event', () => ({
    listen: mockListen,
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
                contextWindow: 128000,
                temperature: 0.2,
                autoCompact: true,
                reserveTokens: 16384,
                keepRecentTokens: 20000,
                memoryEnabled: true,
                customSystemPrompt: '',
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
                contextWindow: 200000,
                temperature: 0.4,
                autoCompact: true,
                reserveTokens: 16384,
                keepRecentTokens: 20000,
                memoryEnabled: true,
                customSystemPrompt: '',
            },
        });
        mockApi.fetchAgentModels.mockResolvedValue({
            success: true,
            data: {
                sourceUrl: 'https://api.openai.com/v1/models',
                fetchedCount: 2,
                models: [
                    { id: 'claude-3.7-sonnet', ownedBy: 'anthropic', contextWindow: 200000, maxOutputTokens: 64000 },
                    { id: 'gpt-4o-mini', ownedBy: 'openai', contextWindow: 128000, maxOutputTokens: 16384 },
                ],
            },
        });
        mockApi.getAgentContextStatus.mockResolvedValue({
            success: true,
            data: {
                estimatedTokens: 14200,
                contextWindow: 128000,
                reserveTokens: 16384,
                keepRecentTokens: 20000,
                thresholdTokens: 111616,
                usagePercent: 11.1,
                activeMessageCount: 2,
                totalMessageCount: 2,
                compactedMessageCount: 0,
                autoCompact: true,
                needsCompaction: false,
                latestCompaction: null,
            },
        });
        mockApi.compactAgentContext.mockResolvedValue({
            success: true,
            data: {
                compaction: {
                    id: 1,
                    sessionId: 'default',
                    summary: '## 目标与关注点\n聚焦服务器费用与续费检查',
                    firstKeptMessageId: 3,
                    compactedMessageCount: 2,
                    tokensBefore: 18500,
                    tokensAfter: 2400,
                    customInstructions: '聚焦服务器费用',
                    createdAt: '2026-11-25 02:00:00',
                },
                status: {
                    estimatedTokens: 2400,
                    contextWindow: 128000,
                    reserveTokens: 16384,
                    keepRecentTokens: 20000,
                    thresholdTokens: 111616,
                    usagePercent: 1.9,
                    activeMessageCount: 2,
                    totalMessageCount: 4,
                    compactedMessageCount: 2,
                    autoCompact: true,
                    needsCompaction: false,
                    latestCompaction: {
                        id: 1,
                        sessionId: 'default',
                        summary: '## 目标与关注点\n聚焦服务器费用与续费检查',
                        firstKeptMessageId: 3,
                        compactedMessageCount: 2,
                        tokensBefore: 18500,
                        tokensAfter: 2400,
                        customInstructions: '聚焦服务器费用',
                        createdAt: '2026-11-25 02:00:00',
                    },
                },
            },
        });
        mockApi.getAgentMemory.mockResolvedValue({
            success: true,
            data: {
                memoryEnabled: true,
                memoryDir: 'C:/Users/test/AppData/Roaming/googlemanager/agent_memory',
                userBudget: 1500,
                memoryBudget: 2500,
                userUsedChars: 24,
                memoryUsedChars: 0,
                userEntries: [
                    { id: 1, target: 'user', content: '统一按人民币汇报月度账单', createdAt: '', updatedAt: '' },
                ],
                memoryEntries: [],
                userMarkdown: '# 用户偏好与档案 (USER.md)\n\n- 统一按人民币汇报月度账单\n',
                memoryMarkdown: '# 工作区关键笔记 (MEMORY.md)\n\n（暂无记忆条目）\n',
            },
        });
        mockApi.addAgentMemoryEntry.mockResolvedValue({
            success: true,
            data: {
                memoryEnabled: true,
                memoryDir: 'C:/Users/test/AppData/Roaming/googlemanager/agent_memory',
                userBudget: 1500,
                memoryBudget: 2500,
                userUsedChars: 42,
                memoryUsedChars: 0,
                userEntries: [
                    { id: 1, target: 'user', content: '统一按人民币汇报月度账单', createdAt: '', updatedAt: '' },
                    { id: 2, target: 'user', content: '称呼我为陈工，回答先给结论', createdAt: '', updatedAt: '' },
                ],
                memoryEntries: [],
                userMarkdown: '# 用户偏好与档案 (USER.md)\n\n- 统一按人民币汇报月度账单\n- 称呼我为陈工，回答先给结论\n',
                memoryMarkdown: '# 工作区关键笔记 (MEMORY.md)\n\n（暂无记忆条目）\n',
            },
        });
        mockApi.updateAgentMemoryEntry.mockResolvedValue({
            success: true,
            data: {
                memoryEnabled: true,
                memoryDir: 'C:/Users/test/AppData/Roaming/googlemanager/agent_memory',
                userBudget: 1500,
                memoryBudget: 2500,
                userUsedChars: 38,
                memoryUsedChars: 0,
                userEntries: [
                    { id: 1, target: 'user', content: '统一按人民币（CNY）汇报账单', createdAt: '', updatedAt: '' },
                    { id: 2, target: 'user', content: '称呼我为陈工，回答先给结论', createdAt: '', updatedAt: '' },
                ],
                memoryEntries: [],
                userMarkdown: '# 用户偏好与档案 (USER.md)\n\n- 统一按人民币（CNY）汇报账单\n- 称呼我为陈工，回答先给结论\n',
                memoryMarkdown: '# 工作区关键笔记 (MEMORY.md)\n\n（暂无记忆条目）\n',
            },
        });
        mockApi.deleteAgentMemoryEntry.mockResolvedValue({
            success: true,
            data: {
                memoryEnabled: true,
                memoryDir: 'C:/Users/test/AppData/Roaming/googlemanager/agent_memory',
                userBudget: 1500,
                memoryBudget: 2500,
                userUsedChars: 20,
                memoryUsedChars: 0,
                userEntries: [
                    { id: 2, target: 'user', content: '称呼我为陈工，回答先给结论', createdAt: '', updatedAt: '' },
                ],
                memoryEntries: [],
                userMarkdown: '# 用户偏好与档案 (USER.md)\n\n- 称呼我为陈工，回答先给结论\n',
                memoryMarkdown: '# 工作区关键笔记 (MEMORY.md)\n\n（暂无记忆条目）\n',
            },
        });
        mockApi.clearAgentMemory.mockResolvedValue({
            success: true,
            data: {
                memoryEnabled: true,
                memoryDir: 'C:/Users/test/AppData/Roaming/googlemanager/agent_memory',
                userBudget: 1500,
                memoryBudget: 2500,
                userUsedChars: 0,
                memoryUsedChars: 0,
                userEntries: [],
                memoryEntries: [],
                userMarkdown: '# 用户偏好与档案 (USER.md)\n\n（暂无记忆条目）\n',
                memoryMarkdown: '# 工作区关键笔记 (MEMORY.md)\n\n（暂无记忆条目）\n',
            },
        });
        mockApi.openAgentMemoryDir.mockResolvedValue({ success: true });
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
        mockApi.getWindowCloseSettings.mockResolvedValue({
            success: true,
            data: { closeBehavior: 'ask' },
        });
        mockApi.saveWindowCloseSettings.mockResolvedValue({
            success: true,
            data: { closeBehavior: 'minimize' },
        });
        mockApi.handleWindowClose.mockResolvedValue({ success: true });
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

    it('点击标题栏关闭按钮弹出最小化至托盘/直接退出选择窗，且支持在系统设置调整默认关闭行为', async () => {
        const user = userEvent.setup();
        const onRequestClose = vi.fn();
        render(<TitleBar view="home" onRequestClose={onRequestClose} />);
        await user.click(screen.getByRole('button', { name: '关闭窗口' }));
        await waitFor(() => {
            expect(onRequestClose).toHaveBeenCalledTimes(1);
        });

        const onClose = vi.fn();
        render(<CloseConfirmDialog isOpen={true} onClose={onClose} onNotify={vi.fn()} />);
        const closeDialog = await screen.findByRole('dialog', { name: '关闭窗口确认' });
        await user.click(within(closeDialog).getByRole('button', { name: /最小化至托盘/ }));
        await waitFor(() => {
            expect(mockApi.handleWindowClose).toHaveBeenCalledWith('minimize', false);
            expect(onClose).toHaveBeenCalled();
        });

        const onClose2 = vi.fn();
        render(<CloseConfirmDialog isOpen={true} onClose={onClose2} onNotify={vi.fn()} />);
        const dialogs = await screen.findAllByRole('dialog', { name: '关闭窗口确认' });
        const secondDialog = dialogs[dialogs.length - 1];
        await user.click(within(secondDialog).getByLabelText(/记住我的选择/));
        await user.click(within(secondDialog).getByRole('button', { name: /直接退出/ }));
        await waitFor(() => {
            expect(mockApi.handleWindowClose).toHaveBeenCalledWith('quit', true);
        });

        render(
            <SystemSettingsDialog
                isOpen={true}
                initialTab="general"
                onClose={vi.fn()}
                onNotify={vi.fn()}
                onBackupRestored={vi.fn()}
            />,
        );
        const sysDialog = await screen.findByRole('dialog', { name: '系统设置' });
        await user.click(within(sysDialog).getByLabelText(/最小化至系统托盘/));
        await user.click(within(sysDialog).getByRole('button', { name: /保存窗口设置/ }));
        await waitFor(() => {
            expect(mockApi.saveWindowCloseSettings).toHaveBeenCalledWith('minimize');
        });
    });

    it('AI 配置支持自动与手动拉取模型列表、自动同步上下文限制并保存压缩/记忆参数', async () => {
        const user = userEvent.setup();
        const onSaved = vi.fn();

        render(
            <SystemSettingsDialog
                isOpen={true}
                initialTab="ai"
                onClose={vi.fn()}
                onNotify={vi.fn()}
                onBackupRestored={vi.fn()}
                onAgentSettingsSaved={onSaved}
            />,
        );

        const dialog = await screen.findByRole('dialog', { name: '系统设置' });
        await waitFor(() => {
            expect(mockApi.fetchAgentModels).toHaveBeenCalledWith('https://api.openai.com/v1', null);
        });
        expect(await within(dialog).findByText('已拉取 2 个可用模型')).toBeInTheDocument();

        await user.click(within(dialog).getByRole('button', { name: '拉取模型' }));
        const searchBox = await within(dialog).findByPlaceholderText('搜索模型 ID 或提供方...');
        await user.type(searchBox, 'claude');
        await user.click(within(dialog).getByRole('button', { name: /claude-3\.7-sonnet/ }));

        // 自动同步了上下文窗口 200000 与最大输出 64000
        expect(within(dialog).getByText(/已自动同步上下文窗口 200K/)).toBeInTheDocument();

        // 展开并输入附加系统指令，同时保存全部扩展字段
        await user.click(within(dialog).getByRole('button', { name: /附加系统指令/ }));
        await user.type(within(dialog).getByPlaceholderText(/分析服务器时默认按区域分组/), '优先输出 CNY 总计');
        await user.click(within(dialog).getByRole('button', { name: /保存 AI 设置/ }));

        await waitFor(() => {
            expect(mockApi.saveAgentSettings).toHaveBeenCalledWith(
                expect.objectContaining({
                    model: 'claude-3.7-sonnet',
                    contextWindow: 200000,
                    maxTokens: 64000,
                    temperature: 0.2,
                    autoCompact: true,
                    reserveTokens: 16384,
                    keepRecentTokens: 20000,
                    memoryEnabled: true,
                    customSystemPrompt: '优先输出 CNY 总计',
                }),
            );
            expect(onSaved).toHaveBeenCalled();
        });
    });

    it('AgentView 展示上下文占用、支持 /compact 压缩折叠历史并支持 Hermes 本地记忆增改删与 Markdown 预览', async () => {
        const user = userEvent.setup();
        mockApi.getAgentMessages.mockResolvedValueOnce({
            success: true,
            data: [
                { id: 1, sessionId: 'default', role: 'user', content: '早先提问 1', proposals: [], createdAt: '' },
                { id: 2, sessionId: 'default', role: 'assistant', content: '早先回答 1', proposals: [], createdAt: '' },
                { id: 3, sessionId: 'default', role: 'user', content: '最新提问：查看服务器', proposals: [], createdAt: '' },
                { id: 4, sessionId: 'default', role: 'assistant', content: '最新回答：节点运行正常', proposals: [], createdAt: '' },
            ],
        });

        render(
            <AgentView
                onNotify={vi.fn()}
                onOpenSystemSettings={vi.fn()}
                onOverviewChanged={vi.fn()}
            />,
        );

        // 顶部展示上下文进度条与记忆计数
        expect(await screen.findByText(/上下文 14K \/ 128K \(11\.1%\)/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /本地记忆 \(1\)/ })).toBeInTheDocument();

        // 输入 /compact 聚焦服务器费用 并发送 -> 调用 compactAgentContext 而不当普通聊天发送
        const textarea = screen.getByPlaceholderText(/输入问题或让助手生成提醒/);
        await user.type(textarea, '/compact 聚焦服务器费用');
        await user.click(screen.getByRole('button', { name: /发送/ }));

        await waitFor(() => {
            expect(mockApi.compactAgentContext).toHaveBeenCalledWith('聚焦服务器费用');
        });
        expect(mockApi.sendAgentMessage).not.toHaveBeenCalled();

        // 验证已归档折叠区与 Pi Compaction 摘要卡渲染，点击可展开摘要和原始消息
        expect(await screen.findByText(/已归档 2 条较早原始对话/)).toBeInTheDocument();
        expect(screen.getByText(/上下文已压缩摘要 \(Pi Compaction\)/)).toBeInTheDocument();
        expect(screen.queryByText('早先提问 1')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: /已归档 2 条较早原始对话/ }));
        expect(screen.getByText('早先提问 1')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: /上下文已压缩摘要/ }));
        expect(screen.getByText('聚焦服务器费用与续费检查')).toBeInTheDocument();

        // 输入 /memory 打开 Hermes 本地记忆弹窗，执行添加、编辑、删除与 Markdown 预览
        await user.type(textarea, '/memory');
        await user.click(screen.getByRole('button', { name: /发送/ }));

        const memDialog = await screen.findByRole('dialog', { name: 'Hermes 本地长期记忆' });
        expect(within(memDialog).getByText('24 / 1500 字符 (2%)')).toBeInTheDocument();

        const addInput = within(memDialog).getByPlaceholderText(/偏好统一用人民币/);
        await user.type(addInput, '称呼我为陈工，回答先给结论');
        await user.click(within(memDialog).getByRole('button', { name: /添加记忆/ }));
        await waitFor(() => {
            expect(mockApi.addAgentMemoryEntry).toHaveBeenCalledWith('user', '称呼我为陈工，回答先给结论');
        });

        await user.click(within(memDialog).getByRole('button', { name: '编辑条目 #1' }));
        const editBox = within(memDialog).getByLabelText('编辑记忆 #1');
        await user.clear(editBox);
        await user.type(editBox, '统一按人民币（CNY）汇报账单');
        await user.click(within(memDialog).getByRole('button', { name: '保存记忆 #1' }));
        await waitFor(() => {
            expect(mockApi.updateAgentMemoryEntry).toHaveBeenCalledWith(1, '统一按人民币（CNY）汇报账单');
        });

        await user.click(within(memDialog).getByRole('button', { name: '删除条目 #1' }));
        await waitFor(() => {
            expect(mockApi.deleteAgentMemoryEntry).toHaveBeenCalledWith(1);
        });

        await user.click(within(memDialog).getByRole('button', { name: /Markdown 预览/ }));
        expect(within(memDialog).getByText(/# 用户偏好与档案 \(USER\.md\)/)).toBeInTheDocument();
    });

    it('流式 compacted 事件正确转换 snake_case 载荷，且流式期间 settingsVersion 更新不打断对话', async () => {
        const user = userEvent.setup();
        let streamHandler = null;
        const unlistenSpy = vi.fn();
        mockListen.mockImplementationOnce(async (_eventName, cb) => {
            streamHandler = cb;
            return unlistenSpy;
        });

        let resolveSend;
        mockApi.sendAgentMessage.mockImplementationOnce(
            () => new Promise(resolve => { resolveSend = resolve; }),
        );
        mockApi.getAgentMessages.mockResolvedValueOnce({
            success: true,
            data: [
                { id: 1, sessionId: 'default', role: 'user', content: '早先提问 A', proposals: [], createdAt: '' },
                { id: 2, sessionId: 'default', role: 'assistant', content: '早先回答 A', proposals: [], createdAt: '' },
                { id: 3, sessionId: 'default', role: 'user', content: '近期提问 B', proposals: [], createdAt: '' },
                { id: 4, sessionId: 'default', role: 'assistant', content: '近期回答 B', proposals: [], createdAt: '' },
            ],
        });

        window.__TAURI_INTERNALS__ = {};
        try {
            const onNotify = vi.fn();
            const onOpenSystemSettings = vi.fn();
            const onOverviewChanged = vi.fn();
            const { rerender, unmount } = render(
                <AgentView
                    onNotify={onNotify}
                    onOpenSystemSettings={onOpenSystemSettings}
                    onOverviewChanged={onOverviewChanged}
                    settingsVersion={0}
                    reloadVersion={0}
                />,
            );

            await screen.findByText(/上下文 14K \/ 128K \(11\.1%\)/);
            await waitFor(() => expect(streamHandler).toBeTypeOf('function'));

            const textarea = screen.getByPlaceholderText(/输入问题或让助手生成提醒/);
            await user.type(textarea, '继续巡检节点');
            await user.click(screen.getByRole('button', { name: /发送/ }));

            expect(screen.getByText('继续巡检节点')).toBeInTheDocument();

            // 模拟 Rust 后端直接发出 snake_case 的 compacting / compacted / memory_updated 事件
            act(() => {
                streamHandler({
                    payload: {
                        stream_id: 'stream-1',
                        type: 'compacting',
                        reason: 'auto',
                        tokens_before: 112000,
                    },
                });
            });
            expect(screen.getByText(/上下文接近上限，正在执行 Pi 自动压缩/)).toBeInTheDocument();

            act(() => {
                streamHandler({
                    payload: {
                        stream_id: 'stream-1',
                        type: 'compacted',
                        status: {
                            estimated_tokens: 3200,
                            context_window: 128000,
                            reserve_tokens: 16384,
                            keep_recent_tokens: 20000,
                            threshold_tokens: 111616,
                            usage_percent: 2.5,
                            active_message_count: 2,
                            total_message_count: 4,
                            compacted_message_count: 2,
                            auto_compact: true,
                            needs_compaction: false,
                            latest_compaction: {
                                id: 9,
                                session_id: 'default',
                                summary: '## 目标与关注点\n自动压缩交接摘要',
                                first_kept_message_id: 3,
                                compacted_message_count: 2,
                                tokens_before: 112000,
                                tokens_after: 3200,
                                custom_instructions: null,
                                created_at: '2026-11-25 04:00:00',
                            },
                        },
                    },
                });
            });

            expect(screen.getByText(/上下文 3\.2K \/ 128K \(2\.5%\)/)).toBeInTheDocument();
            expect(screen.queryByText(/undefined%/)).not.toBeInTheDocument();
            expect(screen.getByText(/已归档 2 条较早原始对话/)).toBeInTheDocument();
            expect(screen.getByText(/上下文已压缩摘要 \(Pi Compaction\)/)).toBeInTheDocument();

            // 流式期间保存 AI 设置（settingsVersion 递增）应静默更新配置，不出现全屏 loading 也不抹掉乐观气泡
            const msgCallsBefore = mockApi.getAgentMessages.mock.calls.length;
            mockApi.getAgentSettings.mockResolvedValueOnce({
                success: true,
                data: {
                    baseUrl: 'https://api.openai.com/v1',
                    model: 'gpt-4.1',
                    maxTokens: 0,
                    hasApiKey: true,
                    apiKeyHint: 'sk-1***9999',
                    contextWindow: 128000,
                    temperature: 0.2,
                    autoCompact: true,
                    reserveTokens: 16384,
                    keepRecentTokens: 20000,
                    memoryEnabled: true,
                    customSystemPrompt: '',
                },
            });
            rerender(
                <AgentView
                    onNotify={onNotify}
                    onOpenSystemSettings={onOpenSystemSettings}
                    onOverviewChanged={onOverviewChanged}
                    settingsVersion={1}
                    reloadVersion={0}
                />,
            );
            await waitFor(() => {
                expect(screen.getByText(/gpt-4\.1 · AUTO/)).toBeInTheDocument();
            });
            expect(screen.queryByText('正在加载历史对话...')).not.toBeInTheDocument();
            expect(screen.getByText('继续巡检节点')).toBeInTheDocument();
            expect(mockApi.getAgentMessages).toHaveBeenCalledTimes(msgCallsBefore);

            resolveSend({
                success: true,
                data: [
                    { id: 1, sessionId: 'default', role: 'user', content: '早先提问 A', proposals: [], createdAt: '' },
                    { id: 2, sessionId: 'default', role: 'assistant', content: '早先回答 A', proposals: [], createdAt: '' },
                    { id: 3, sessionId: 'default', role: 'user', content: '近期提问 B', proposals: [], createdAt: '' },
                    { id: 4, sessionId: 'default', role: 'assistant', content: '近期回答 B', proposals: [], createdAt: '' },
                    { id: 5, sessionId: 'default', role: 'user', content: '继续巡检节点', proposals: [], createdAt: '' },
                    { id: 6, sessionId: 'default', role: 'assistant', content: '巡检完成。', proposals: [], createdAt: '' },
                ],
            });
            expect(await screen.findByText('巡检完成。')).toBeInTheDocument();
            unmount();
            expect(unlistenSpy).toHaveBeenCalledTimes(1);
        } finally {
            delete window.__TAURI_INTERNALS__;
        }
    });

    it('选用模型时保留 maxTokens=0 并钳位超限 contextWindow，clearApiKey 传空串、跨源失焦不泄露旧 Key、备份显示 sizeBytes', async () => {
        const user = userEvent.setup();
        mockApi.getAgentSettings.mockResolvedValue({
            success: true,
            data: {
                baseUrl: 'https://api.openai.com/v1',
                model: 'gpt-4o-mini',
                maxTokens: 0,
                hasApiKey: true,
                apiKeyHint: 'sk-1***9999',
                contextWindow: 128000,
                temperature: 0.25,
                autoCompact: true,
                reserveTokens: 16384,
                keepRecentTokens: 20000,
                memoryEnabled: true,
                customSystemPrompt: '',
            },
        });
        mockApi.fetchAgentModels.mockResolvedValue({
            success: true,
            data: {
                sourceUrl: 'https://api.openai.com/v1/models',
                fetchedCount: 1,
                models: [
                    { id: 'gemini-2.5-pro', ownedBy: 'google', contextWindow: 2097152, maxOutputTokens: 65536 },
                ],
            },
        });
        mockApi.listBackups.mockResolvedValue({
            success: true,
            data: [{ name: 'auto_2026-11-25.db', sizeBytes: 204800, createdAt: '2026-11-25 01:00:00' }],
        });

        // 1) 非 AI Tab 打开不应自动拉取模型，且备份列表正确读取 sizeBytes
        const { unmount: unmountBackup } = render(
            <SystemSettingsDialog
                isOpen={true}
                initialTab="backup"
                onClose={vi.fn()}
                onNotify={vi.fn()}
                onBackupRestored={vi.fn()}
            />,
        );
        const backupDialog = await screen.findByRole('dialog', { name: '系统设置' });
        expect(await within(backupDialog).findByText('auto_2026-11-25.db')).toBeInTheDocument();
        expect(within(backupDialog).getByText(/200 KB/)).toBeInTheDocument();
        expect(mockApi.fetchAgentModels).not.toHaveBeenCalled();
        unmountBackup();

        // 2) AI Tab：验证 maxTokens=0 不被覆盖、2097152 钳位至 2000000、支持 0.25 温度、clearApiKey 显式传 ""、跨源失焦不静默拉取
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
        await waitFor(() => {
            expect(mockApi.fetchAgentModels).toHaveBeenCalledWith('https://api.openai.com/v1', null);
        });

        await user.click(within(dialog).getByRole('button', { name: '拉取模型' }));
        await user.click(await within(dialog).findByRole('button', { name: /gemini-2\.5-pro/ }));
        expect(within(dialog).getByText(/已自动同步上下文窗口 2M/)).toBeInTheDocument();
        expect(within(dialog).getByText(/已自动同步上下文窗口 2M/).textContent).not.toContain('最大输出');

        mockApi.saveAgentSettings.mockResolvedValueOnce({
            success: true,
            data: {
                baseUrl: 'https://api.openai.com/v1',
                model: 'gemini-2.5-pro',
                maxTokens: 0,
                hasApiKey: true,
                apiKeyHint: 'sk-1***9999',
                contextWindow: 2000000,
                temperature: 0.25,
                autoCompact: true,
                reserveTokens: 16384,
                keepRecentTokens: 20000,
                memoryEnabled: true,
                customSystemPrompt: '',
            },
        });
        await user.click(within(dialog).getByRole('button', { name: /保存 AI 设置/ }));
        await waitFor(() => {
            expect(mockApi.saveAgentSettings).toHaveBeenCalledWith(
                expect.objectContaining({
                    model: 'gemini-2.5-pro',
                    contextWindow: 2000000,
                    maxTokens: 0,
                    temperature: 0.25,
                }),
            );
        });

        // 勾选「清除已存 Key」后手动拉取模型与测试连接均显式传 ""（而非 null）
        mockApi.fetchAgentModels.mockClear();
        await user.click(within(dialog).getByLabelText(/清除已存 Key/));
        await user.click(within(dialog).getByRole('button', { name: '拉取模型' }));
        expect(mockApi.fetchAgentModels).toHaveBeenCalledWith('https://api.openai.com/v1', '');
        await user.click(within(dialog).getByRole('button', { name: /测试连接/ }));
        expect(mockApi.testAgentConnection).toHaveBeenCalledWith('https://api.openai.com/v1', '', 'gemini-2.5-pro');

        // 取消清除 Key 后修改为跨源 URL 且未填新 Key 时失焦，不得自动拉取泄露旧 Key
        await user.click(within(dialog).getByLabelText(/清除已存 Key/));
        mockApi.fetchAgentModels.mockClear();
        const urlInput = within(dialog).getByPlaceholderText(/https:\/\/api\.openai\.com\/v1/);
        await user.clear(urlInput);
        await user.type(urlInput, 'https://other-provider.example/v1');
        await user.tab();
        expect(mockApi.fetchAgentModels).not.toHaveBeenCalled();
    });

    it('AgentMemoryDialog 支持行内编辑 Enter 保存 / Escape 取消与清空分区确认', async () => {
        const user = userEvent.setup();
        const onSnapshotChange = vi.fn();
        const snapshot = {
            memoryEnabled: true,
            memoryDir: 'C:/Users/test/AppData/Roaming/googlemanager/agent_memory',
            userBudget: 1500,
            memoryBudget: 2500,
            userUsedChars: 24,
            memoryUsedChars: 0,
            userEntries: [
                { id: 1, target: 'user', content: '统一按人民币汇报月度账单', createdAt: '', updatedAt: '' },
            ],
            memoryEntries: [],
            userMarkdown: '# 用户偏好与档案 (USER.md)\n\n- 统一按人民币汇报月度账单\n',
            memoryMarkdown: '# 工作区关键笔记 (MEMORY.md)\n\n（暂无记忆条目）\n',
        };

        render(
            <AgentMemoryDialog
                isOpen={true}
                snapshot={snapshot}
                onClose={vi.fn()}
                onSnapshotChange={onSnapshotChange}
                onNotify={vi.fn()}
                onOpenAiSettings={vi.fn()}
            />,
        );

        const dialog = await screen.findByRole('dialog', { name: 'Hermes 本地长期记忆' });

        // Escape 取消行内编辑不触发更新
        await user.click(within(dialog).getByRole('button', { name: '编辑条目 #1' }));
        const editInput1 = within(dialog).getByLabelText('编辑记忆 #1');
        await user.type(editInput1, '临时改动{Escape}');
        expect(mockApi.updateAgentMemoryEntry).not.toHaveBeenCalled();
        expect(within(dialog).queryByLabelText('编辑记忆 #1')).not.toBeInTheDocument();

        // Enter 直接提交保存
        await user.click(within(dialog).getByRole('button', { name: '编辑条目 #1' }));
        const editInput2 = within(dialog).getByLabelText('编辑记忆 #1');
        await user.clear(editInput2);
        await user.type(editInput2, '按 CNY 汇总每月支出{Enter}');
        await waitFor(() => {
            expect(mockApi.updateAgentMemoryEntry).toHaveBeenCalledWith(1, '按 CNY 汇总每月支出');
        });

        // 清空分区：取消确认时不调用 clearAgentMemory；确认后调用
        confirmDialog.mockResolvedValueOnce(false);
        await user.click(within(dialog).getByRole('button', { name: /清空 USER\.md/ }));
        expect(mockApi.clearAgentMemory).not.toHaveBeenCalled();

        confirmDialog.mockResolvedValueOnce(true);
        await user.click(within(dialog).getByRole('button', { name: /清空 USER\.md/ }));
        await waitFor(() => {
            expect(mockApi.clearAgentMemory).toHaveBeenCalledWith('user');
            expect(onSnapshotChange).toHaveBeenCalled();
        });
    });
});
