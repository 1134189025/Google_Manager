import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    detectChinaBank,
    detectCardNetwork,
    inferRegionGroup,
} from '../utils/cardUtils';
import CardsView from '../components/CardsView';

const { mockApi } = vi.hoisted(() => ({
    mockApi: {
        getPaymentCards: vi.fn(),
        createPaymentCard: vi.fn(),
        updatePaymentCard: vi.fn(),
        deletePaymentCard: vi.fn(),
    },
}));

vi.mock('../services/api', () => ({
    default: mockApi,
}));

vi.mock('../utils/dialogs', () => ({
    confirmDialog: vi.fn().mockResolvedValue(true),
}));

describe('Phase 2: cardUtils & CardsView', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockApi.getPaymentCards.mockResolvedValue({
            success: true,
            data: [
                {
                    id: 1,
                    name: '招行经典卡',
                    issuer: '招商银行',
                    bankCode: 'CMB',
                    network: 'Visa',
                    region: '中国大陆',
                    regionGroup: 'mainland',
                    last4: '8888',
                    expiryMonth: '10/29',
                    cardNumber: '4392250011118888',
                    cvv: '321',
                    cardholder: 'ZHANG SAN',
                    billingAddress: 'Shanghai',
                    billingAmount: 300,
                    billingCurrency: 'CNY',
                    billingCycle: 'year',
                    expiresAt: '2026-12-31',
                },
            ],
        });
        mockApi.createPaymentCard.mockResolvedValue({ success: true, data: { id: 2 } });
    });

    it('cardUtils 正确识别国内 BIN 银行、卡组织与地区分组', () => {
        expect(detectCardNetwork('4111 1111')).toBe('Visa');
        expect(detectCardNetwork('5100 0000')).toBe('Mastercard');
        expect(detectCardNetwork('6222 0200')).toBe('UnionPay');
        expect(inferRegionGroup('中国香港')).toBe('hmt');
        expect(inferRegionGroup('中国大陆')).toBe('mainland');
        expect(inferRegionGroup('全球 / 多地区')).toBe('global');
        expect(inferRegionGroup('美国')).toBe('overseas');

        const cmb = detectChinaBank('356889');
        expect(cmb?.code).toBe('CMB');
        expect(cmb?.issuer).toBe('招商银行');
    });

    it('CardsView 支持 3D 翻转显隐卡号与新建弹窗 BIN 自动识别', async () => {
        const user = userEvent.setup();
        render(<CardsView onNotify={vi.fn()} onCopy={vi.fn()} />);

        await screen.findByText('招行经典卡');
        expect(screen.queryByText('4392 2500 1111 8888')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: '显示 招行经典卡 卡号' }));
        expect(screen.getByText('4392 2500 1111 8888')).toBeInTheDocument();
        expect(screen.getByText('321')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /添加卡片/ }));
        const dialog = screen.getByRole('dialog', { name: '添加支付卡' });
        await user.type(within(dialog).getByPlaceholderText('输入卡号自动识别银行/卡组织'), '356889');
        expect(await within(dialog).findByText(/招商银行 \(CMB\)/)).toBeInTheDocument();
        await user.click(within(dialog).getByRole('button', { name: '应用识别结果' }));
        expect(within(dialog).getByPlaceholderText('RedotPay / 招商银行')).toHaveValue('招商银行');
    });

    it('CardsView 在亮色模式下卡片正面切换为亮色配色，并支持正反面翻转切换', async () => {
        const user = userEvent.setup();
        const { container } = render(
            <CardsView darkMode={false} fxRate={7.2} onNotify={vi.fn()} onCopy={vi.fn()} />,
        );

        await screen.findByText('招行经典卡');
        const frontFace = container.querySelector('[data-card-face="front"]');
        expect(frontFace).toHaveAttribute('data-card-theme', 'light');

        // 点击翻转按钮翻到背面，再点击翻回正面
        await user.click(screen.getByRole('button', { name: '翻转 招行经典卡 查看背面' }));
        expect(frontFace.parentElement.style.transform).toBe('rotateY(180deg)');

        await user.click(screen.getByRole('button', { name: '翻回 招行经典卡 正面' }));
        expect(frontFace.parentElement.style.transform).toBe('rotateY(0deg)');
    });
});
