import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    parseBrowserPasswordsCsv,
    classifyCsvImportRows,
    exportVaultItemsToBrowserCsv,
} from '../utils/passwordCsv';
import {
    detectChinaBank,
    detectCardNetwork,
    inferRegionGroup,
} from '../utils/cardUtils';
import VaultView from '../components/VaultView';
import CardsView from '../components/CardsView';

const { mockApi } = vi.hoisted(() => ({
    mockApi: {
        getVaultFolders: vi.fn(),
        createVaultFolder: vi.fn(),
        deleteVaultFolder: vi.fn(),
        getVaultItems: vi.fn(),
        createVaultItem: vi.fn(),
        updateVaultItem: vi.fn(),
        deleteVaultItem: vi.fn(),
        batchImportVaultItems: vi.fn(),
        generateTotp: vi.fn(),
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

describe('Phase 2: passwordCsv & cardUtils & VaultView & CardsView', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockApi.getVaultFolders.mockResolvedValue({
            success: true,
            data: [{ id: 1, name: '常用开发', sortOrder: 0 }],
        });
        mockApi.getVaultItems.mockResolvedValue({
            success: true,
            data: [
                {
                    id: 10,
                    kind: 'account',
                    name: 'GitHub',
                    url: 'https://github.com',
                    username: 'alice',
                    secretValue: 'old-pass',
                    totpSecret: 'JBSWY3DPEHPK3PXP',
                    folderId: 1,
                    googleAccountId: 1,
                    googleAccountEmail: 'alice@gmail.com',
                    tags: 'dev',
                    notes: '',
                },
            ],
        });
        mockApi.generateTotp.mockResolvedValue({ code: '654321', remaining: 25 });
        mockApi.createVaultItem.mockResolvedValue({ success: true, data: { id: 11 } });
        mockApi.batchImportVaultItems.mockResolvedValue({
            success: true,
            data: { createdCount: 1, skippedCount: 0 },
        });
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

    it('passwordCsv 解析 Chrome/Edge CSV 并识别重复与冲突，导出防止公式注入', () => {
        const csv = 'name,url,username,password,note\nGitHub,https://github.com,alice,old-pass,\nGitHub,https://github.com,alice,new-pass,2fa\nNewSite,https://example.com,bob,"p,w=1",note';
        const parsed = parseBrowserPasswordsCsv(csv);
        expect(parsed).toHaveLength(3);

        const classified = classifyCsvImportRows(parsed, [
            { url: 'https://github.com/', username: 'alice', secretValue: 'old-pass' },
        ]);
        expect(classified[0].status).toBe('duplicate');
        expect(classified[0].selected).toBe(false);
        expect(classified[1].status).toBe('conflict');
        expect(classified[1].selected).toBe(true);
        expect(classified[2].status).toBe('new');

        const exported = exportVaultItemsToBrowserCsv([
            { kind: 'account', name: 'Site', url: 'https://a.com', username: 'u', secretValue: '=1+1', notes: '' },
            { kind: 'api', name: 'OpenAI Key', secretValue: 'sk-xxx' },
        ]);
        expect(exported).toContain("'=1+1");
        expect(exported).not.toContain('sk-xxx');
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

    it('VaultView 支持显示/隐藏密钥、TOTP 倒计时与 CSV 导入', async () => {
        const user = userEvent.setup();
        render(
            <VaultView
                googleAccounts={[{ id: 1, email: 'alice@gmail.com' }]}
                onNotify={vi.fn()}
                onCopy={vi.fn()}
            />,
        );

        await screen.findByText('GitHub');
        expect(screen.getByText('关联: alice@gmail.com')).toBeInTheDocument();
        await waitFor(() => {
            expect(screen.getByText('654321')).toBeInTheDocument();
        });

        expect(screen.queryByText('old-pass')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: '显示 GitHub 密钥' }));
        expect(screen.getByText('old-pass')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /导入 CSV/ }));
        const dialog = screen.getByRole('dialog', { name: '导入浏览器密码 CSV' });
        const textarea = within(dialog).getByPlaceholderText('name,url,username,password,note');
        fireEvent.change(textarea, {
            target: { value: 'name,url,username,password,note\nCloudflare,https://dash.cloudflare.com,cf@a.com,pw1,' },
        });
        await within(dialog).findByText('Cloudflare');
        await user.click(within(dialog).getByRole('button', { name: /导入选中 \(1\)/ }));
        await waitFor(() => {
            expect(mockApi.batchImportVaultItems).toHaveBeenCalledTimes(1);
        });
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
});
