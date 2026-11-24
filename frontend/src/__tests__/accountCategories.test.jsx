import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AccountCategoryDialog from '../components/AccountCategoryDialog';
import AccountListView from '../components/AccountListView';
import EditModal from '../components/EditModal';
import ImportView from '../components/ImportView';
import api from '../services/api';
import { splitGroupNameValues, UNCATEGORIZED_FILTER_KEY } from '../utils/multiValueField';

vi.mock('../components/HistoryDrawer', () => ({ default: () => null }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn(), ask: vi.fn(), message: vi.fn() }));
vi.mock('../utils/dialogs', () => ({
    confirmDialog: vi.fn().mockResolvedValue(true),
    messageDialog: vi.fn(),
}));
vi.mock('../services/api', () => ({
    default: {
        getBrowserStatuses: vi.fn().mockResolvedValue({ success: true, data: {} }),
        exportAccountsText: vi.fn().mockResolvedValue({ success: true, data: '' }),
        exportAccountsToFile: vi.fn().mockResolvedValue({ success: true, data: { path: '/tmp/out.txt', count: 0 } }),
    },
}));

const sampleCategories = [
    { id: 1, name: '主号', color: 'emerald', sortOrder: 0 },
    { id: 2, name: 'AI 订阅', color: 'violet', sortOrder: 1 },
];

const sampleAccounts = [
    {
        id: 1,
        email: 'main@gmail.com',
        password: 'pw1',
        groupName: '主号',
        status: 'pro',
        createdAt: '2026-11-20 00:00:00',
    },
    {
        id: 2,
        email: 'ai@gmail.com',
        password: 'pw2',
        groupName: 'AI 订阅',
        status: 'inactive',
        createdAt: '2026-11-21 00:00:00',
    },
    {
        id: 3,
        email: 'free@gmail.com',
        password: 'pw3',
        groupName: '',
        status: 'inactive',
        createdAt: '2026-11-22 00:00:00',
    },
];

describe('谷歌邮箱自定义分类功能', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('splitGroupNameValues 在提供已知分类名时保留带空格的自定义分类名，同时兼容旧空白分隔', () => {
        expect(splitGroupNameValues('AI 订阅', ['主号', 'AI 订阅'])).toEqual(['AI 订阅']);
        expect(splitGroupNameValues('AI 订阅\n主号', ['主号', 'AI 订阅'])).toEqual(['AI 订阅', '主号']);
        expect(splitGroupNameValues('主号 成员1 成员2')).toEqual(['主号', '成员1', '成员2']);
    });

    it('AccountListView 展示分类筛选条、计数与未分类，并支持新建/重命名/删除自定义分类', async () => {
        const user = userEvent.setup();
        const setGroupFilter = vi.fn();
        const onCreateCategory = vi.fn().mockResolvedValue({
            success: true,
            data: { id: 3, name: '美区小号', color: 'amber', sortOrder: 2 },
        });
        const onUpdateCategory = vi.fn().mockResolvedValue({
            success: true,
            data: { id: 1, name: '核心主号', color: 'emerald', sortOrder: 0 },
        });
        const onDeleteCategory = vi.fn().mockResolvedValue({ success: true });

        render(
            <AccountListView
                accounts={sampleAccounts}
                allAccounts={sampleAccounts}
                accountCategories={sampleCategories}
                onCreateCategory={onCreateCategory}
                onUpdateCategory={onUpdateCategory}
                onDeleteCategory={onDeleteCategory}
                search=""
                setSearch={vi.fn()}
                groupFilter={null}
                setGroupFilter={setGroupFilter}
                allGroups={['主号', 'AI 订阅']}
                copyToClipboard={vi.fn()}
                toggleStatus={vi.fn()}
                onEdit={vi.fn()}
                onDelete={vi.fn()}
                onBatchDelete={vi.fn()}
                onInlineEdit={vi.fn().mockResolvedValue(true)}
                onNotify={vi.fn()}
                loading={false}
            />,
        );

        const filterStrip = screen.getByRole('group', { name: '账号分类筛选' });
        expect(within(filterStrip).getByRole('button', { name: /全部\s*3/ })).toBeInTheDocument();
        expect(within(filterStrip).getByRole('button', { name: /AI 订阅\s*1/ })).toBeInTheDocument();
        expect(within(filterStrip).getByRole('button', { name: /未分类\s*1/ })).toBeInTheDocument();

        // 点击分类与未分类筛选
        await user.click(within(filterStrip).getByRole('button', { name: /AI 订阅\s*1/ }));
        expect(setGroupFilter).toHaveBeenCalledWith('AI 订阅');
        await user.click(within(filterStrip).getByRole('button', { name: /未分类\s*1/ }));
        expect(setGroupFilter).toHaveBeenCalledWith(UNCATEGORIZED_FILTER_KEY);

        // 打开分类管理弹窗：新增、重命名、删除自定义分类
        await user.click(within(filterStrip).getByRole('button', { name: /添加分类/ }));
        const dialog = await screen.findByRole('dialog', { name: '管理账号分类' });

        await user.type(within(dialog).getByPlaceholderText(/如：主号、AI 订阅/), '美区小号');
        const amberRadio = within(dialog).getByRole('radio', { name: '颜色 琥珀' });
        await user.click(amberRadio);
        expect(amberRadio).toHaveAttribute('aria-checked', 'true');
        await user.click(within(dialog).getByRole('button', { name: '添加分类' }));
        await waitFor(() => {
            expect(onCreateCategory).toHaveBeenCalledWith({ name: '美区小号', color: 'amber' });
        });

        await user.click(within(dialog).getByRole('button', { name: '重命名分类 主号' }));
        const renameInput = within(dialog).getByLabelText('修改分类名称');
        await user.clear(renameInput);
        await user.type(renameInput, '核心主号');
        await user.click(within(dialog).getByRole('button', { name: '保存' }));
        await waitFor(() => {
            expect(onUpdateCategory).toHaveBeenCalledWith(1, { name: '核心主号', color: 'emerald' });
        });

        await user.click(within(dialog).getByRole('button', { name: '删除分类 AI 订阅' }));
        await waitFor(() => {
            expect(onDeleteCategory).toHaveBeenCalledWith(2, 'AI 订阅');
        });
    });

    it('批量设置分类弹窗支持点选分类与追加模式', async () => {
        const user = userEvent.setup();
        const onInlineEdit = vi.fn().mockResolvedValue(true);

        render(
            <AccountListView
                accounts={sampleAccounts}
                allAccounts={sampleAccounts}
                accountCategories={sampleCategories}
                onCreateCategory={vi.fn()}
                search=""
                setSearch={vi.fn()}
                groupFilter={null}
                setGroupFilter={vi.fn()}
                allGroups={['主号', 'AI 订阅']}
                copyToClipboard={vi.fn()}
                toggleStatus={vi.fn()}
                onEdit={vi.fn()}
                onDelete={vi.fn()}
                onBatchDelete={vi.fn()}
                onInlineEdit={onInlineEdit}
                onNotify={vi.fn()}
                loading={false}
            />,
        );

        const checkboxes = screen.getAllByRole('checkbox');
        await user.click(checkboxes[1]); // main@gmail.com (已有 主号)
        await user.click(checkboxes[3]); // free@gmail.com (无分类)
        await user.click(screen.getByTitle('为选中账号设置标签'));

        const dialog = await screen.findByRole('dialog', { name: '批量设置分类' });
        await user.click(within(dialog).getByRole('button', { name: 'AI 订阅' }));
        await user.click(within(dialog).getByLabelText('追加到现有分类'));
        await user.click(within(dialog).getByRole('button', { name: '应用' }));

        await waitFor(() => {
            expect(onInlineEdit).toHaveBeenCalledWith(1, 'groupName', '主号\nAI 订阅');
            expect(onInlineEdit).toHaveBeenCalledWith(3, 'groupName', 'AI 订阅');
        });
    });

    it('EditModal 与 ImportView 支持快捷选择和新建自定义分类', async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn((e) => e.preventDefault());
        const onCreateCategory = vi.fn().mockResolvedValue({
            success: true,
            data: { id: 4, name: '备用号', color: 'blue', sortOrder: 3 },
        });

        const { unmount } = render(
            <EditModal
                account={sampleAccounts[0]}
                accountCategories={sampleCategories}
                onCreateCategory={onCreateCategory}
                onClose={vi.fn()}
                onSubmit={onSubmit}
            />,
        );

        const quickGroup = screen.getByRole('group', { name: '快捷选择分类' });
        const groupTextarea = screen.getByPlaceholderText(/每行一个分类或标签/);
        await user.click(within(quickGroup).getByRole('button', { name: 'AI 订阅' }));
        expect(groupTextarea).toHaveValue('主号\nAI 订阅');

        await user.type(screen.getByPlaceholderText('输入新分类名快速添加...'), '备用号');
        await user.click(screen.getByRole('button', { name: '添加分类' }));
        await waitFor(() => {
            expect(onCreateCategory).toHaveBeenCalledWith({ name: '备用号', color: 'blue' });
            expect(groupTextarea).toHaveValue('主号\nAI 订阅\n备用号');
        });

        unmount();

        const onImport = vi.fn();
        render(
            <ImportView
                onImport={onImport}
                onCancel={vi.fn()}
                accountCategories={sampleCategories}
                onCreateCategory={onCreateCategory}
            />,
        );

        await user.type(screen.getByPlaceholderText('example@gmail.com'), 'new@gmail.com');
        await user.type(screen.getByPlaceholderText('输入密码'), 'pass123');
        await user.selectOptions(screen.getByLabelText('归属分类'), 'AI 订阅');
        await user.click(screen.getByRole('button', { name: /立即导入/ }));

        expect(onImport).toHaveBeenCalledWith([
            expect.objectContaining({
                email: 'new@gmail.com',
                group_name: 'AI 订阅',
            }),
        ]);
    });

    it('AccountCategoryDialog 在父组件频繁重渲染传新 onClose 时不清空输入、不退出重命名态，且 Escape 优先退出重命名', async () => {
        const user = userEvent.setup();
        const onCloseFirst = vi.fn();
        const onCloseSecond = vi.fn();

        const { rerender } = render(
            <AccountCategoryDialog
                isOpen={true}
                categories={sampleCategories}
                categoryCounts={{ 主号: 1, 'AI 订阅': 1 }}
                onCreateCategory={vi.fn()}
                onUpdateCategory={vi.fn()}
                onDeleteCategory={vi.fn()}
                onClose={onCloseFirst}
            />,
        );

        const dialog = await screen.findByRole('dialog', { name: '管理账号分类' });
        const nameInput = within(dialog).getByPlaceholderText(/如：主号、AI 订阅/);
        await user.type(nameInput, '美区 AI 订阅');
        await user.click(within(dialog).getByRole('radio', { name: '颜色 紫罗兰' }));
        await user.click(within(dialog).getByRole('button', { name: '重命名分类 主号' }));
        const renameInput = within(dialog).getByLabelText('修改分类名称');
        await user.clear(renameInput);
        await user.type(renameInput, '核心主号');

        // 模拟 2FA/SMS 每秒倒计时引发父组件重渲染并传入全新 onClose 引用
        rerender(
            <AccountCategoryDialog
                isOpen={true}
                categories={sampleCategories}
                categoryCounts={{ 主号: 1, 'AI 订阅': 1 }}
                onCreateCategory={vi.fn()}
                onUpdateCategory={vi.fn()}
                onDeleteCategory={vi.fn()}
                onClose={onCloseSecond}
            />,
        );

        expect(within(dialog).getByPlaceholderText(/如：主号、AI 订阅/)).toHaveValue('美区 AI 订阅');
        expect(within(dialog).getByRole('radio', { name: '颜色 紫罗兰' })).toHaveAttribute('aria-checked', 'true');
        expect(within(dialog).getByLabelText('修改分类名称')).toHaveValue('核心主号');

        // 重命名态按 Escape 仅退出重命名，不关闭弹窗；再次按 Escape 才调用最新 onClose
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(within(dialog).queryByLabelText('修改分类名称')).not.toBeInTheDocument();
        expect(onCloseFirst).not.toHaveBeenCalled();
        expect(onCloseSecond).not.toHaveBeenCalled();

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onCloseSecond).toHaveBeenCalledTimes(1);
    });

    it('筛选空自定义分类时导出弹窗禁用提交并阻断 0 条全库导出', async () => {
        const user = userEvent.setup();
        render(
            <AccountListView
                accounts={[]}
                allAccounts={sampleAccounts}
                accountCategories={[...sampleCategories, { id: 3, name: '待养号', color: 'amber', sortOrder: 2 }]}
                onCreateCategory={vi.fn()}
                search=""
                setSearch={vi.fn()}
                groupFilter="待养号"
                setGroupFilter={vi.fn()}
                allGroups={['主号', 'AI 订阅', '待养号']}
                copyToClipboard={vi.fn()}
                toggleStatus={vi.fn()}
                onEdit={vi.fn()}
                onDelete={vi.fn()}
                onBatchDelete={vi.fn()}
                onInlineEdit={vi.fn().mockResolvedValue(true)}
                onNotify={vi.fn()}
                loading={false}
            />,
        );

        await user.click(screen.getByRole('button', { name: '导出账号' }));
        const dialog = await screen.findByRole('dialog', { name: '导出账号配置' });
        expect(within(dialog).getByText('将导出当前筛选结果，共 0 条')).toBeInTheDocument();
        expect(within(dialog).getByText('当前范围无符合条件的账号可导出')).toBeInTheDocument();

        const submitBtn = within(dialog).getByRole('button', { name: '导出' });
        expect(submitBtn).toBeDisabled();
        expect(api.exportAccountsToFile).not.toHaveBeenCalled();
        expect(api.exportAccountsText).not.toHaveBeenCalled();
    });

    it('行内编辑保存单条含空格分类 "AI 订阅" 不被拆碎，且批量手动标签保留内部空格', async () => {
        const user = userEvent.setup();
        const onInlineEdit = vi.fn().mockResolvedValue(true);

        render(
            <AccountListView
                accounts={sampleAccounts}
                allAccounts={sampleAccounts}
                accountCategories={sampleCategories}
                onCreateCategory={vi.fn()}
                search=""
                setSearch={vi.fn()}
                groupFilter={null}
                setGroupFilter={vi.fn()}
                allGroups={['主号', 'AI 订阅']}
                copyToClipboard={vi.fn()}
                toggleStatus={vi.fn()}
                onEdit={vi.fn()}
                onDelete={vi.fn()}
                onBatchDelete={vi.fn()}
                onInlineEdit={onInlineEdit}
                onNotify={vi.fn()}
                loading={false}
            />,
        );

        // 双击空白分类单元格（free@gmail.com）并输入带空格的已知分类 "AI 订阅"
        const emptyTagBtn = screen.getByTitle('双击添加标签');
        await user.dblClick(emptyTagBtn);
        const editor = screen.getByPlaceholderText(/每行一个标签/);
        await user.type(editor, 'AI 订阅');
        fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });

        await waitFor(() => {
            expect(onInlineEdit).toHaveBeenCalledWith(3, 'groupName', 'AI 订阅');
        });

        // 批量设置分类：在「其他自定义标签」输入带空格未收录标签 "Claude Pro" 应保持完整
        onInlineEdit.mockClear();
        const checkboxes = screen.getAllByRole('checkbox');
        await user.click(checkboxes[3]);
        await user.click(screen.getByTitle('为选中账号设置标签'));
        const batchDialog = await screen.findByRole('dialog', { name: '批量设置分类' });
        await user.type(within(batchDialog).getByPlaceholderText(/多个可用逗号分隔/), 'Claude Pro');
        await user.click(within(batchDialog).getByRole('button', { name: '应用' }));

        await waitFor(() => {
            expect(onInlineEdit).toHaveBeenCalledWith(3, 'groupName', 'Claude Pro');
        });
    });

    it('大小写不同自由标签不重复出现在待收录列表，且快捷新建失败时展示内联错误', async () => {
        const user = userEvent.setup();
        const onCreateCategory = vi.fn().mockResolvedValue({
            success: false,
            message: '分类「vip」已存在',
        });

        expect(splitGroupNameValues('ai 订阅', ['AI 订阅'])).toEqual(['ai 订阅']);

        const { unmount } = render(
            <AccountListView
                accounts={[
                    ...sampleAccounts,
                    { id: 4, email: 'vip@gmail.com', password: 'pw4', groupName: 'vip\n未收录标签', status: 'inactive', createdAt: '2026-11-23 00:00:00' },
                ]}
                allAccounts={[
                    ...sampleAccounts,
                    { id: 4, email: 'vip@gmail.com', password: 'pw4', groupName: 'vip\n未收录标签', status: 'inactive', createdAt: '2026-11-23 00:00:00' },
                ]}
                accountCategories={[...sampleCategories, { id: 9, name: 'VIP', color: 'amber', sortOrder: 2 }]}
                onCreateCategory={onCreateCategory}
                search=""
                setSearch={vi.fn()}
                groupFilter={null}
                setGroupFilter={vi.fn()}
                allGroups={['主号', 'AI 订阅', 'VIP', '未收录标签']}
                copyToClipboard={vi.fn()}
                toggleStatus={vi.fn()}
                onEdit={vi.fn()}
                onDelete={vi.fn()}
                onBatchDelete={vi.fn()}
                onInlineEdit={vi.fn().mockResolvedValue(true)}
                onNotify={vi.fn()}
                loading={false}
            />,
        );

        await user.click(screen.getByRole('button', { name: /管理分类/ }));
        const catDialog = await screen.findByRole('dialog', { name: '管理账号分类' });
        expect(within(catDialog).queryByTitle('将「vip」收录为正式分类')).not.toBeInTheDocument();
        expect(within(catDialog).getByTitle('将「未收录标签」收录为正式分类')).toBeInTheDocument();
        unmount();

        // EditModal 快捷新建失败展示错误提示，且手动输入 "Claude Pro" 点快捷胶囊不被拆碎
        render(
            <EditModal
                account={sampleAccounts[2]}
                accountCategories={sampleCategories}
                onCreateCategory={onCreateCategory}
                onClose={vi.fn()}
                onSubmit={vi.fn((e) => e.preventDefault())}
            />,
        );

        const groupTextarea = screen.getByPlaceholderText(/每行一个分类或标签/);
        await user.type(groupTextarea, 'Claude Pro');
        await user.click(within(screen.getByRole('group', { name: '快捷选择分类' })).getByRole('button', { name: '主号' }));
        expect(groupTextarea).toHaveValue('Claude Pro\n主号');

        await user.type(screen.getByPlaceholderText('输入新分类名快速添加...'), 'vip');
        await user.click(screen.getByRole('button', { name: '添加分类' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('分类「vip」已存在');
    });
});
