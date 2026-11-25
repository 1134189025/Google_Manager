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

    it('首页集合展示统一人民币费用总览、实时汇率、即将到期续费与资产工作区入口', async () => {
        const user = userEvent.setup();
        const props = defaultProps();
        const onNavigate = vi.fn();
        const onRefreshFxRate = vi.fn();
        render(
            <HomeView
                {...props}
                onNavigate={onNavigate}
                onRefreshFxRate={onRefreshFxRate}
                fxInfo={{ rate: 7.2, source: 'open.er-api.com', isFallback: false, loading: false }}
                overview={{
                    paymentCardsCount: 3,
                    aiSubscriptionsCount: 2,
                    serversCount: 4,
                    serversOnlineCount: 3,
                    domainsCount: 6,
                    pendingRemindersCount: 1,
                    spend: {
                        cny: { monthly: 100, yearly: 1200, once: 0, count: 2 },
                        usd: { monthly: 10, yearly: 120, once: 0, count: 1 },
                        unpriced: 0,
                    },
                    upcomingRenewals: [
                        {
                            kind: 'server',
                            id: 1,
                            name: '香港-VPS',
                            date: '2026-12-04',
                            days: 10,
                            billingAmount: 10,
                            billingCurrency: 'USD',
                            billingCycle: 'month',
                        },
                    ],
                    dueReminders: [
                        { id: 9, title: '核对信用卡账单', dueAt: '2026-12-01' },
                    ],
                }}
            />,
        );

        const spendSection = screen.getByLabelText('费用结算总览');
        // 100 + 10 * 7.2 = ¥172.00；年付 1200 + 120 * 7.2 = ¥2064.00
        expect(within(spendSection).getByText('¥172.00')).toBeInTheDocument();
        expect(within(spendSection).getByText('¥2064.00')).toBeInTheDocument();
        expect(within(spendSection).getByText('1 USD = ¥7.2000')).toBeInTheDocument();

        await user.click(within(spendSection).getByRole('button', { name: '刷新实时汇率' }));
        expect(onRefreshFxRate).toHaveBeenCalledWith(true);

        const renewalsSection = screen.getByLabelText('即将到期续费');
        expect(within(renewalsSection).getByText('香港-VPS')).toBeInTheDocument();
        expect(within(renewalsSection).getByText('¥72.00/月付')).toBeInTheDocument();

        const remindersSection = screen.getByLabelText('待办备忘提醒');
        expect(within(remindersSection).getByText('核对信用卡账单')).toBeInTheDocument();

        const assetsSection = screen.getByLabelText('数字资产总览');
        expect(within(assetsSection).queryByRole('button', { name: /账号与密钥/ })).not.toBeInTheDocument();
        expect(within(assetsSection).getAllByRole('button')).toHaveLength(8);
        expect(within(assetsSection).getByRole('button', { name: /费用与续费/ })).toBeInTheDocument();
        expect(within(assetsSection).getByText('3/4')).toBeInTheDocument();
        await user.click(within(assetsSection).getByRole('button', { name: /费用与续费/ }));
        expect(onNavigate).toHaveBeenCalledWith('renewals');
        await user.click(within(assetsSection).getByRole('button', { name: /域名管理/ }));
        expect(onNavigate).toHaveBeenCalledWith('domains');
    });

    it('最近更新徽章传入 accountCategories 时完整保留含空格自定义分类名', () => {
        const props = defaultProps();
        render(
            <HomeView
                {...props}
                accounts={[
                    buildAccount(10, { groupName: 'AI 订阅', updatedAt: '2026-11-24 12:00:00' }),
                ]}
                accountCategories={[{ id: 1, name: 'AI 订阅', color: 'violet', sortOrder: 0 }]}
            />,
        );

        const recentSection = screen.getByLabelText('最近更新');
        expect(within(recentSection).getByText('AI 订阅')).toBeInTheDocument();
    });

    it('包含 Ultra 与 Ultra Lite 账号时展示统计副行与对应等级徽章', () => {
        const props = defaultProps();
        render(
            <HomeView
                {...props}
                accounts={[
                    buildAccount(21, { status: 'pro', updatedAt: '2026-11-24 10:00:00' }),
                    buildAccount(22, { status: 'ultra_lite', updatedAt: '2026-11-24 11:00:00' }),
                    buildAccount(23, { status: 'ultra', updatedAt: '2026-11-24 12:00:00' }),
                    buildAccount(24, { status: 'ultra', updatedAt: '2026-11-24 12:30:00' }),
                ]}
            />,
        );

        const statsAside = screen.getByLabelText('账号统计');
        const proItem = within(statsAside).getByText('Pro 账号').closest('.gm-stat-item');
        expect(proItem.querySelector('.gm-stat-value').textContent).toBe('1');
        expect(within(proItem).getByText('Ultra 2 · Ultra Lite 1')).toBeInTheDocument();

        const recentSection = screen.getByLabelText('最近更新');
        expect(within(recentSection).getAllByText('Ultra')).toHaveLength(2);
        expect(within(recentSection).getByText('Ultra Lite')).toBeInTheDocument();
        expect(recentSection.querySelector('.signal.is-ultra')).toBeInTheDocument();
        expect(recentSection.querySelector('.signal.is-ultra-lite')).toBeInTheDocument();
    });
});
