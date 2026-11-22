import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import HomeView from '../components/HomeView';

const buildAccount = (id, overrides = {}) => ({
    id,
    email: `acc${id}@gmail.com`,
    password: `pw${id}`,
    status: 'inactive',
    smsUrl: '',
    groupName: '',
    createdAt: `2026-11-0${Math.min(id, 9)} 10:00:00`,
    updatedAt: `2026-11-0${Math.min(id, 9)} 12:00:00`,
    ...overrides,
});

describe('HomeView 首页总览', () => {
    const baseAccounts = [
        buildAccount(1, { status: 'pro', smsUrl: 'https://sms.test/1', groupName: '工作' }),
        buildAccount(2, { status: 'pro', smsUrl: '' }),
        buildAccount(3, { status: 'inactive', smsUrl: 'https://sms.test/3' }),
        buildAccount(4, { status: 'inactive' }),
        buildAccount(5, { status: 'inactive' }),
        buildAccount(6, { status: 'pro' }),
    ];

    const defaultProps = () => ({
        accounts: baseAccounts,
        browserStatuses: {
            'acc1@gmail.com': 'running',
            'acc3@gmail.com': 'running',
            'acc2@gmail.com': 'created',
        },
        loading: false,
        onTriggerSearch: vi.fn(),
        onTriggerImport: vi.fn(),
        onTriggerExport: vi.fn(),
        onNavigateList: vi.fn(),
        onOpenBrowser: vi.fn(),
        onCopyEmail: vi.fn(),
    });

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('准确渲染右侧竖排统计数值', () => {
        render(<HomeView {...defaultProps()} />);

        const statsAside = screen.getByLabelText('账号统计');
        const readStat = (label) => {
            const labelEl = within(statsAside).getByText(label);
            return labelEl.closest('.gm-stat-item').querySelector('.gm-stat-value').textContent;
        };

        expect(readStat('总账号')).toBe('6');
        expect(readStat('Pro 账号')).toBe('3');
        expect(readStat('已配接码')).toBe('2');
        expect(readStat('运行中浏览器')).toBe('2');
    });

    it('点击三组快捷键操作行分别触发搜索、导入与导出回调', async () => {
        const user = userEvent.setup();
        const props = defaultProps();
        render(<HomeView {...props} />);

        await user.click(screen.getByRole('button', { name: /搜索账号/ }));
        expect(props.onTriggerSearch).toHaveBeenCalledTimes(1);

        await user.click(screen.getByRole('button', { name: /导入账号/ }));
        expect(props.onTriggerImport).toHaveBeenCalledTimes(1);

        await user.click(screen.getByRole('button', { name: /导出账号/ }));
        expect(props.onTriggerExport).toHaveBeenCalledTimes(1);
    });

    it('渲染活跃浏览器列表并支持点击切回；无运行中时显示安静提示', async () => {
        const user = userEvent.setup();
        const props = defaultProps();
        const { rerender } = render(<HomeView {...props} />);

        const activeSection = screen.getByLabelText('活跃浏览器');
        expect(within(activeSection).getByText('acc1@gmail.com')).toBeInTheDocument();
        expect(within(activeSection).getByText('acc3@gmail.com')).toBeInTheDocument();
        expect(within(activeSection).queryByText('acc2@gmail.com')).not.toBeInTheDocument();

        await user.click(within(activeSection).getByText('acc1@gmail.com'));
        expect(props.onOpenBrowser).toHaveBeenCalledWith(expect.objectContaining({ id: 1, email: 'acc1@gmail.com' }));

        rerender(<HomeView {...props} browserStatuses={{}} />);
        expect(screen.getByText('暂无运行中的独立浏览器')).toBeInTheDocument();
    });

    it('最近更新最多展示 5 条账号，支持点击复制邮箱与「全部 →」跳转', async () => {
        const user = userEvent.setup();
        const props = defaultProps();
        render(<HomeView {...props} />);

        const recentSection = screen.getByLabelText('最近更新');
        const rows = recentSection.querySelectorAll('.gm-home-row');
        expect(rows).toHaveLength(5);

        // 最新更新的 acc6 应排在前面，最早的 acc1 不在前 5 条内
        expect(within(recentSection).getByText('acc6@gmail.com')).toBeInTheDocument();
        expect(within(recentSection).queryByText('acc1@gmail.com')).not.toBeInTheDocument();

        await user.click(within(recentSection).getByText('acc6@gmail.com'));
        expect(props.onCopyEmail).toHaveBeenCalledWith('acc6@gmail.com');

        await user.click(within(recentSection).getByRole('button', { name: /全部/ }));
        expect(props.onNavigateList).toHaveBeenCalledTimes(1);
    });
});
