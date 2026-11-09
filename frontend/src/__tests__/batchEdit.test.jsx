import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AccountListView from '../components/AccountListView';

vi.mock('../components/HistoryDrawer', () => ({ default: () => null }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn(), ask: vi.fn(), message: vi.fn() }));
vi.mock('../services/api', () => ({
    default: {
        getBrowserStatuses: vi.fn().mockResolvedValue({ success: true, data: {} }),
    },
}));

const accounts = [
    { id: 1, email: 'a@gmail.com', password: 'p1', status: 'inactive', createdAt: '2024-01-01 00:00:00' },
    { id: 2, email: 'b@gmail.com', password: 'p2', status: 'inactive', createdAt: '2024-01-01 00:00:00' },
];

const renderView = (overrides = {}) => {
    const props = {
        accounts,
        search: '',
        setSearch: vi.fn(),
        groupFilter: null,
        setGroupFilter: vi.fn(),
        allGroups: [],
        copyToClipboard: vi.fn(),
        toggleStatus: vi.fn(),
        onEdit: vi.fn(),
        onDelete: vi.fn(),
        onBatchDelete: vi.fn(),
        onInlineEdit: vi.fn().mockResolvedValue(true),
        onNotify: vi.fn(),
        loading: false,
        ...overrides,
    };
    render(<AccountListView {...props} />);
    return props;
};

const selectAllAndOpen = async (user, title) => {
    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[1]);
    await user.click(checkboxes[2]);
    await user.click(screen.getByTitle(title));
};

describe('批量设置（应用内输入框，替代 window.prompt）', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('输入后应用到全部选中账号并提示', async () => {
        const user = userEvent.setup();
        const props = renderView();
        await selectAllAndOpen(user, '为选中账号设置国家');

        expect(screen.getByRole('dialog', { name: '批量设置国家' })).toBeInTheDocument();
        expect(screen.getByText(/将应用到选中的 2 个账号/)).toBeInTheDocument();
        await user.type(screen.getByLabelText('国家'), 'Japan');
        await user.click(screen.getByRole('button', { name: '应用' }));

        await waitFor(() => expect(props.onNotify).toHaveBeenCalledWith('已更新 2 个账号'));
        expect(props.onInlineEdit).toHaveBeenCalledWith(1, 'country', 'Japan');
        expect(props.onInlineEdit).toHaveBeenCalledWith(2, 'country', 'Japan');
        expect(screen.queryByRole('dialog', { name: '批量设置国家' })).not.toBeInTheDocument();
    });

    it('注册年份格式错误时在输入框内提示，不提交', async () => {
        const user = userEvent.setup();
        const props = renderView();
        await selectAllAndOpen(user, '为选中账号设置注册年份');

        await user.type(screen.getByLabelText('注册年份'), '21');
        await user.click(screen.getByRole('button', { name: '应用' }));

        expect(await screen.findByText('注册年份必须是4位数字（如：2021）')).toBeInTheDocument();
        expect(props.onInlineEdit).not.toHaveBeenCalled();
        expect(screen.getByRole('dialog', { name: '批量设置注册年份' })).toBeInTheDocument();
    });

    it('取消时不做任何修改', async () => {
        const user = userEvent.setup();
        const props = renderView();
        await selectAllAndOpen(user, '为选中账号设置标签');

        await user.click(screen.getByRole('button', { name: '取消' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(props.onInlineEdit).not.toHaveBeenCalled();
    });

    it('部分失败时提示失败数量', async () => {
        const user = userEvent.setup();
        const props = renderView({
            onInlineEdit: vi.fn().mockImplementation(async (id) => id === 1),
        });
        await selectAllAndOpen(user, '为选中账号设置手机号');

        await user.type(screen.getByLabelText('手机号'), '+8613800000000');
        await user.click(screen.getByRole('button', { name: '应用' }));

        await waitFor(() => expect(props.onNotify).toHaveBeenCalledWith('成功更新 1 个账号，1 个失败', 'error'));
    });
});
