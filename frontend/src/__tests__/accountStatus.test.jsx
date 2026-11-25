import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
    ACCOUNT_STATUS_OPTIONS,
    ACCOUNT_STATUS_RANK,
    formatAccountStatusLabel,
    getAccountStatusMeta,
    getNextAccountStatus,
    isPaidAccountStatus,
    normalizeAccountStatus,
} from '../utils/accountStatus';
import AccountListView from '../components/AccountListView';
import EditModal from '../components/EditModal';
import BatchToolbar from '../components/BatchToolbar';

vi.mock('../components/HistoryDrawer', () => ({
    default: () => null,
}));

vi.mock('../services/api', () => ({
    default: {
        getBrowserStatuses: vi.fn().mockResolvedValue({ success: true, data: {} }),
    },
}));

describe('accountStatus 工具函数（四档账号状态）', () => {
    it('规范化四档状态并支持别名', () => {
        expect(normalizeAccountStatus('inactive')).toBe('inactive');
        expect(normalizeAccountStatus('pro')).toBe('pro');
        expect(normalizeAccountStatus('ultra_lite')).toBe('ultra_lite');
        expect(normalizeAccountStatus('Ultra Lite')).toBe('ultra_lite');
        expect(normalizeAccountStatus('ultra-lite')).toBe('ultra_lite');
        expect(normalizeAccountStatus('ultra')).toBe('ultra');
        expect(normalizeAccountStatus('unknown')).toBe('inactive');
    });

    it('按 普通 -> Pro -> Ultra Lite -> Ultra -> 普通 顺序循环切换', () => {
        expect(getNextAccountStatus('inactive')).toBe('pro');
        expect(getNextAccountStatus('pro')).toBe('ultra_lite');
        expect(getNextAccountStatus('ultra_lite')).toBe('ultra');
        expect(getNextAccountStatus('ultra')).toBe('inactive');
    });

    it('提供完整的显示文案、样式元数据与排序权重', () => {
        expect(ACCOUNT_STATUS_OPTIONS.map(o => o.value)).toEqual([
            'inactive',
            'pro',
            'ultra_lite',
            'ultra',
        ]);
        expect(formatAccountStatusLabel('inactive')).toBe('普通');
        expect(formatAccountStatusLabel('pro')).toBe('Pro');
        expect(formatAccountStatusLabel('ultra_lite')).toBe('Ultra Lite');
        expect(formatAccountStatusLabel('ultra')).toBe('Ultra');

        expect(getAccountStatusMeta('ultra_lite').badgeClass).toContain('gm-badge-ultra-lite');
        expect(getAccountStatusMeta('ultra').badgeClass).toContain('gm-badge-ultra');
        expect(ACCOUNT_STATUS_RANK.inactive).toBeLessThan(ACCOUNT_STATUS_RANK.pro);
        expect(ACCOUNT_STATUS_RANK.pro).toBeLessThan(ACCOUNT_STATUS_RANK.ultra_lite);
        expect(ACCOUNT_STATUS_RANK.ultra_lite).toBeLessThan(ACCOUNT_STATUS_RANK.ultra);

        expect(isPaidAccountStatus('inactive')).toBe(false);
        expect(isPaidAccountStatus('pro')).toBe(true);
        expect(isPaidAccountStatus('ultra_lite')).toBe(true);
        expect(isPaidAccountStatus('ultra')).toBe(true);
    });
});

describe('AccountListView 四档状态展示与排序', () => {
    const accounts = [
        { id: 1, email: 'n@gmail.com', password: 'p1', status: 'inactive', createdAt: '2026-01-01 00:00:00' },
        { id: 2, email: 'u@gmail.com', password: 'p2', status: 'ultra', createdAt: '2026-01-02 00:00:00' },
        { id: 3, email: 'p@gmail.com', password: 'p3', status: 'pro', createdAt: '2026-01-03 00:00:00' },
        { id: 4, email: 'ul@gmail.com', password: 'p4', status: 'ultra_lite', createdAt: '2026-01-04 00:00:00' },
    ];

    const baseProps = {
        accounts,
        search: '',
        setSearch: vi.fn(),
        groupFilter: null,
        setGroupFilter: vi.fn(),
        allGroups: [],
        copyToClipboard: vi.fn(),
        twoFACodes: {},
        toggleStatus: vi.fn(),
        onEdit: vi.fn(),
        onDelete: vi.fn(),
        onInlineEdit: vi.fn(),
        onBatchDelete: vi.fn(),
        loading: false,
        onSearchChange: vi.fn(),
    };

    it('渲染四档状态徽章并按 状态 列正确排序', async () => {
        const user = userEvent.setup();
        render(<AccountListView {...baseProps} />);

        expect(screen.getByText('普通')).toBeInTheDocument();
        expect(screen.getByText('Pro')).toBeInTheDocument();
        expect(screen.getByText('Ultra Lite')).toBeInTheDocument();
        expect(screen.getByText('Ultra')).toBeInTheDocument();

        const statusHeader = screen.getByRole('button', { name: /状态/ });
        await user.click(statusHeader);

        const rowsAsc = screen.getAllByRole('row').slice(1);
        expect(rowsAsc.map(r => r.textContent)).toEqual([
            expect.stringContaining('n@gmail.com'),
            expect.stringContaining('p@gmail.com'),
            expect.stringContaining('ul@gmail.com'),
            expect.stringContaining('u@gmail.com'),
        ]);

        await user.click(statusHeader);
        const rowsDesc = screen.getAllByRole('row').slice(1);
        expect(rowsDesc.map(r => r.textContent)).toEqual([
            expect.stringContaining('u@gmail.com'),
            expect.stringContaining('ul@gmail.com'),
            expect.stringContaining('p@gmail.com'),
            expect.stringContaining('n@gmail.com'),
        ]);
    });
});

describe('EditModal 四档账号状态选择', () => {
    it('展示四档状态下拉框并提交所选状态', () => {
        const onSubmit = vi.fn((e) => e.preventDefault());
        render(
            <EditModal
                account={{
                    id: 9,
                    email: 'lite@gmail.com',
                    password: 'secret',
                    status: 'ultra_lite',
                }}
                onClose={vi.fn()}
                onSubmit={onSubmit}
            />,
        );

        const select = screen.getByLabelText('账号状态');
        expect(select).toHaveValue('ultra_lite');
        expect(Array.from(select.options).map(o => o.textContent)).toEqual([
            '普通',
            'Pro',
            'Ultra Lite',
            'Ultra',
        ]);

        fireEvent.change(select, { target: { value: 'ultra' } });
        expect(select).toHaveValue('ultra');

        fireEvent.submit(select.closest('form'));
        expect(onSubmit).toHaveBeenCalledTimes(1);
        const submittedFormData = new FormData(select.closest('form'));
        expect(submittedFormData.get('status')).toBe('ultra');
    });
});

describe('BatchToolbar 双行对称布局与全部操作', () => {
    it('渲染双行对称工具栏并保留全部批量回调', async () => {
        const user = userEvent.setup();
        const handlers = {
            onSelectAllCurrentResult: vi.fn(),
            onBatchEdit: vi.fn(),
            onBatchDelete: vi.fn(),
            onBatchClearBrowserCache: vi.fn(),
            onClearSelection: vi.fn(),
        };

        const { container } = render(
            <BatchToolbar
                selectedCount={2}
                totalResultCount={24}
                canSelectAllCurrentResult={true}
                isBatchProcessing={false}
                {...handlers}
            />,
        );

        expect(container.querySelector('.floatbar-row-head')).toBeInTheDocument();
        expect(container.querySelector('.floatbar-divider')).toBeInTheDocument();
        expect(container.querySelector('.floatbar-row-actions')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /全选当前结果/ }));
        await user.click(screen.getByRole('button', { name: /批量设置分类/ }));
        await user.click(screen.getByRole('button', { name: /清理浏览器缓存/ }));
        await user.click(screen.getByRole('button', { name: /批量删除/ }));
        await user.click(screen.getByRole('button', { name: /取消选择/ }));

        expect(handlers.onSelectAllCurrentResult).toHaveBeenCalledTimes(1);
        expect(handlers.onBatchEdit).toHaveBeenCalledWith('groupName', '分类 / 标签');
        expect(handlers.onBatchClearBrowserCache).toHaveBeenCalledTimes(1);
        expect(handlers.onBatchDelete).toHaveBeenCalledTimes(1);
        expect(handlers.onClearSelection).toHaveBeenCalledTimes(1);
    });
});
