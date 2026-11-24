import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    calendarDay,
    daysUntilDay,
    shiftDay,
    buildRenewalsIcs,
} from '../utils/renewalUtils';
import RenewalsView from '../components/RenewalsView';
import SideNav from '../components/SideNav';

const { mockApi } = vi.hoisted(() => ({
    mockApi: {
        getRenewalsSummary: vi.fn(),
        getReminders: vi.fn(),
        advanceRenewal: vi.fn(),
        createReminder: vi.fn(),
        updateReminder: vi.fn(),
        deleteReminder: vi.fn(),
        completeReminder: vi.fn(),
    },
}));

vi.mock('../services/api', () => ({
    default: mockApi,
}));

vi.mock('../utils/dialogs', () => ({
    confirmDialog: vi.fn().mockResolvedValue(true),
}));

describe('Phase 1: renewalUtils & RenewalsView & SideNav', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        mockApi.getRenewalsSummary.mockResolvedValue({
            success: true,
            data: {
                timeline: [
                    {
                        kind: 'server',
                        id: 1,
                        name: 'Tokyo-VPS',
                        subtitle: '1.2.3.4',
                        date: '2026-12-01',
                        days: 7,
                        billingAmount: 5,
                        billingCurrency: 'USD',
                        billingCycle: 'month',
                        fixedExpiry: false,
                    },
                ],
                spend: {
                    cny: { monthly: 10, yearly: 120, once: 0, count: 1 },
                    usd: { monthly: 5, yearly: 60, once: 0, count: 1 },
                    unpriced: 0,
                },
            },
        });
        mockApi.getReminders.mockResolvedValue({
            success: true,
            data: [
                {
                    id: 10,
                    title: '续费域名',
                    note: '核对自动续费',
                    dueAt: '2026-11-28',
                    repeat: 'year',
                    leadDays: 5,
                    done: false,
                    doneAt: null,
                },
            ],
        });
        mockApi.advanceRenewal.mockResolvedValue({ success: true, data: '2027-01-01' });
        mockApi.completeReminder.mockResolvedValue({
            success: true,
            data: { id: 10, title: '续费域名', dueAt: '2027-11-28', repeat: 'year', done: false },
        });
        mockApi.createReminder.mockResolvedValue({
            success: true,
            data: { id: 11, title: '新提醒', dueAt: '2026-12-15', repeat: 'none', leadDays: 3, done: false },
        });
    });

    it('renewalUtils 正确处理日历日、顺延月底钳制与 ICS 生成', () => {
        expect(calendarDay('2026-11-24')).toBe('2026-11-24');
        expect(calendarDay('2026-02-30')).toBe('');
        expect(shiftDay('2026-01-31', 'month')).toBe('2026-02-28');
        expect(shiftDay('2024-02-29', 'year')).toBe('2025-02-28');
        expect(shiftDay('2026-11-24', 'week')).toBe('2026-12-01');
        expect(daysUntilDay('2026-11-30', new Date('2026-11-24T12:00:00'))).toBe(6);

        const ics = buildRenewalsIcs(
            [
                {
                    kind: 'server',
                    id: 1,
                    name: 'VPS',
                    subtitle: '1.2.3.4',
                    date: '2026-12-01',
                    billingAmount: 5,
                    billingCurrency: 'USD',
                    billingCycle: 'month',
                },
            ],
            [{ id: 2, title: '备忘事项', dueAt: '2026-12-02', done: false }],
            new Date('2026-11-24T00:00:00Z'),
        );
        expect(ics).toContain('BEGIN:VCALENDAR');
        expect(ics).toContain('[服务器] VPS');
        expect(ics).toContain('[备忘] 备忘事项');
        expect(ics).toContain('DTSTART;VALUE=DATE:20261201');
    });

    it('RenewalsView 展示支出与时间线，并支持一键顺延、新建与完成备忘', async () => {
        const user = userEvent.setup();
        const onNotify = vi.fn();
        const onOverviewChanged = vi.fn();
        render(<RenewalsView onNotify={onNotify} onOverviewChanged={onOverviewChanged} />);

        await screen.findByText('Tokyo-VPS');
        expect(screen.getByText('$5.00')).toBeInTheDocument();
        expect(screen.getByText('¥10.00')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /已续费/ }));
        await waitFor(() => {
            expect(mockApi.advanceRenewal).toHaveBeenCalledWith('server', 1);
        });
        expect(onOverviewChanged).toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: /完成并顺延/ }));
        await waitFor(() => {
            expect(mockApi.completeReminder).toHaveBeenCalledWith(10);
        });

        await user.click(screen.getByRole('button', { name: /新建备忘/ }));
        const dialog = screen.getByRole('dialog', { name: '新建备忘' });
        await user.type(within(dialog).getByPlaceholderText(/检查机场流量/), '测试备忘');
        await user.click(within(dialog).getByRole('button', { name: '保存' }));

        await waitFor(() => {
            expect(mockApi.createReminder).toHaveBeenCalledWith(
                expect.objectContaining({ title: '测试备忘' }),
            );
        });
    });

    it('SideNav 支持分组折叠并持久化到 localStorage', async () => {
        const user = userEvent.setup();
        const onNavigate = vi.fn();
        render(
            <SideNav
                view="home"
                accountsCount={3}
                overview={{ vaultItemsCount: 4, serversCount: 2 }}
                darkMode={true}
                onNavigate={onNavigate}
                onOpenBrowserSettings={vi.fn()}
                onToggleDarkMode={vi.fn()}
            />,
        );

        expect(screen.getByRole('button', { name: /账号与密钥/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /AI 订阅/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /服务器/ })).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: '账号与金融' }));
        expect(screen.queryByRole('button', { name: /账号与密钥/ })).not.toBeInTheDocument();
        expect(JSON.parse(localStorage.getItem('gm.nav.groups')).finance).toBe(false);

        await user.click(screen.getByRole('button', { name: '账号与金融' }));
        expect(screen.getByRole('button', { name: /账号与密钥/ })).toBeInTheDocument();
    });
});
