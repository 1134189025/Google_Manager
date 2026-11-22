import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

const { mockApi } = vi.hoisted(() => ({
    mockApi: {
        getAccounts: vi.fn(),
        getDeletedAccounts: vi.fn(),
        getBrowserStatuses: vi.fn(),
        getBrowserSettings: vi.fn(),
        generateTotp: vi.fn(),
        fetchSmsCode: vi.fn(),
    },
}));

vi.mock('../services/api', () => ({
    default: mockApi,
}));

describe('App 跨视图动作一次性消费回归', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        mockApi.getAccounts.mockResolvedValue([
            {
                id: 1,
                email: 'demo@gmail.com',
                password: 'pass',
                recovery: '',
                phone: '',
                secret: '',
                smsUrl: '',
                regYear: '2022',
                country: 'US',
                groupName: '美区',
                remark: '',
                status: 'pro',
                createdAt: '2026-11-20 10:00:00',
                updatedAt: '2026-11-20 12:00:00',
            },
        ]);
        mockApi.getDeletedAccounts.mockResolvedValue({ success: true, data: [] });
        mockApi.getBrowserStatuses.mockResolvedValue({ success: true, data: {} });
        mockApi.getBrowserSettings.mockResolvedValue({ success: true, data: { configured: true } });
    });

    it('打开过回收站后回到首页，再点搜索账号或导出账号不会再次弹出回收站', async () => {
        const user = userEvent.setup();
        render(<App />);

        const sideNav = screen.getByRole('navigation', { name: '工作区视图' });

        // 1. 从侧栏点击回收站，作为独立整页视图渲染（非弹窗）
        const recycleNavBtn = within(sideNav).getByRole('button', { name: '回收站' });
        await user.click(recycleNavBtn);
        expect(await screen.findByText('回收站为空')).toBeInTheDocument();
        expect(screen.queryByRole('dialog', { name: '回收站' })).not.toBeInTheDocument();
        expect(recycleNavBtn.className).toContain('active');

        // 返回首页
        await user.click(within(sideNav).getByRole('button', { name: '首页' }));
        await waitFor(() => {
            expect(screen.queryByText('回收站为空')).not.toBeInTheDocument();
        });

        // 2. 从首页点击「搜索账号」：进入账号列表并聚焦搜索框，不能弹出回收站
        await user.click(screen.getByRole('button', { name: /搜索账号/ }));
        const searchInput = await screen.findByPlaceholderText('搜索邮箱或备注内容...');
        expect(searchInput).toHaveFocus();
        expect(screen.queryByText('回收站为空')).not.toBeInTheDocument();

        // 3. 再次回到首页，点击「导出账号」：只弹出导出弹窗，不能弹出回收站
        await user.click(within(sideNav).getByRole('button', { name: '首页' }));
        await user.click(screen.getByRole('button', { name: /导出账号/ }));
        expect(await screen.findByText('导出账号配置')).toBeInTheDocument();
        expect(screen.queryByText('回收站为空')).not.toBeInTheDocument();
    });
});
