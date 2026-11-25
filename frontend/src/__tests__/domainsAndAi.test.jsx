import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import DomainsView from '../components/DomainsView';
import AiSubscriptionsView from '../components/AiSubscriptionsView';

const { mockApi } = vi.hoisted(() => ({
    mockApi: {
        getDomains: vi.fn(),
        probeDomain: vi.fn(),
        getCloudflareConnections: vi.fn(),
        listDomainDnsRecords: vi.fn(),
        applyDomainDnsRecord: vi.fn(),
        getAiSubscriptions: vi.fn(),
        getGeminiOauthConfig: vi.fn(),
        saveGeminiOauthConfig: vi.fn(),
        startAiOauth: vi.fn(),
        getAiOauthStatus: vi.fn(),
        completeAiOauth: vi.fn(),
        cancelAiOauth: vi.fn(),
        refreshAiSubscriptionQuota: vi.fn(),
        readAntigravityCliQuota: vi.fn(),
        openExternalUrl: vi.fn(),
    },
}));

vi.mock('../services/api', () => ({
    default: mockApi,
}));

vi.mock('../utils/dialogs', () => ({
    confirmDialog: vi.fn().mockResolvedValue(true),
}));

describe('Phase 3: DomainsView & AiSubscriptionsView', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockApi.getDomains.mockResolvedValue({
            success: true,
            data: [
                {
                    id: 1,
                    name: 'example.com',
                    registrar: 'Cloudflare',
                    nameservers: ['alice.ns.cloudflare.com'],
                    autoRenew: true,
                    billingAmount: 10.5,
                    billingCurrency: 'USD',
                    billingCycle: 'year',
                    expiresAt: '2027-05-01',
                    cfConnectionId: 2,
                    cfZoneId: '0123456789abcdef0123456789abcdef',
                },
            ],
        });
        mockApi.probeDomain.mockResolvedValue({
            success: true,
            data: {
                id: 1,
                name: 'example.com',
                registrar: 'Cloudflare',
                nameservers: ['alice.ns.cloudflare.com'],
                autoRenew: true,
                expiresAt: '2027-05-01',
                cfConnectionId: 2,
                cfZoneId: '0123456789abcdef0123456789abcdef',
            },
        });
        mockApi.getCloudflareConnections.mockResolvedValue({
            success: true,
            data: [{ id: 2, name: '主账号', tokenHint: 'cf_a••••1234' }],
        });
        mockApi.listDomainDnsRecords.mockResolvedValue({
            success: true,
            data: [
                {
                    id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                    type: 'A',
                    name: 'www.example.com',
                    content: '1.2.3.4',
                    ttl: 1,
                    proxied: true,
                },
            ],
        });
        mockApi.applyDomainDnsRecord.mockResolvedValue({ success: true, data: null });

        mockApi.getAiSubscriptions.mockResolvedValue({
            success: true,
            data: [
                {
                    id: 1,
                    name: 'Codex Plus',
                    provider: 'OpenAI',
                    plan: 'Plus',
                    accountEmail: 'ai@gmail.com',
                    billingAmount: 20,
                    billingCurrency: 'USD',
                    billingCycle: 'month',
                    renewsAt: '2026-12-10',
                    googleAccountEmail: 'ai@gmail.com',
                    oauthProvider: 'openai',
                    oauthConnected: false,
                    usage: {
                        source: 'openai-wham',
                        scope: 'codex',
                        scopeNote: '此处为 Codex 额度。',
                        status: 'stale',
                        checkedAt: '2026-11-24T10:00:00Z',
                        windows: [{ label: 'primary_window', usedPercent: 35, stale: true }],
                    },
                },
            ],
        });
        mockApi.getGeminiOauthConfig.mockResolvedValue({
            success: true,
            data: { configured: false, source: '未配置', clientIdHint: null, hasClientSecret: false },
        });
        mockApi.saveGeminiOauthConfig.mockResolvedValue({
            success: true,
            data: { configured: true, source: '本地设置', clientIdHint: 'demo12…com', hasClientSecret: true },
        });
        mockApi.startAiOauth.mockResolvedValue({
            success: true,
            data: {
                sessionId: 'sess-1',
                mode: 'loopback',
                authorizeUrl: 'https://auth.openai.com/oauth/authorize',
                redirectUri: 'http://localhost:1455/auth/callback',
                manualCallback: false,
            },
        });
        mockApi.getAiOauthStatus.mockResolvedValue({
            success: true,
            data: { status: 'pending', error: '', subscriptionId: 1 },
        });
        mockApi.completeAiOauth.mockResolvedValue({ success: true, data: { id: 1, oauthConnected: true } });
        mockApi.readAntigravityCliQuota.mockResolvedValue({
            success: true,
            data: {
                checkedAt: '2026-11-24T12:00:00Z',
                windows: [{ label: 'Claude/five_hour', usedPercent: 20 }],
            },
        });
    });

    it('DomainsView 支持探测刷新并在 DNS 变更前强制显示预览确认', async () => {
        const user = userEvent.setup();
        render(<DomainsView onNotify={vi.fn()} />);

        await screen.findByText('example.com');
        await user.click(screen.getByRole('button', { name: '探测 example.com' }));
        await waitFor(() => {
            expect(mockApi.probeDomain).toHaveBeenCalledWith(1);
        });

        await user.click(screen.getByRole('button', { name: /管理 DNS/ }));
        const dialog = await screen.findByRole('dialog', { name: '管理 DNS - example.com' });
        await within(dialog).findByText('www.example.com');

        await user.type(within(dialog).getByPlaceholderText('记录值 (IP / 目标主机 / TXT)'), '5.6.7.8');
        await user.click(within(dialog).getByRole('button', { name: '预览变更' }));

        expect(mockApi.applyDomainDnsRecord).not.toHaveBeenCalled();
        expect(within(dialog).getByText(/确认新增 DNS 记录？/)).toBeInTheDocument();

        await user.click(within(dialog).getByRole('button', { name: /确认应用变更/ }));
        await waitFor(() => {
            expect(mockApi.applyDomainDnsRecord).toHaveBeenCalledWith(
                1,
                'create',
                null,
                expect.objectContaining({ type: 'A', content: '5.6.7.8' }),
            );
        });
    });

    it('AiSubscriptionsView 展示额度、支持 OAuth 弹窗与 Antigravity CLI 读取', async () => {
        const user = userEvent.setup();
        render(<AiSubscriptionsView onNotify={vi.fn()} />);

        await screen.findByText('Codex Plus');
        expect(screen.getByText('上次缓存')).toBeInTheDocument();
        expect(screen.getByText(/已用 35.0%/)).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /Antigravity CLI 额度/ }));
        await screen.findByText('Claude/five_hour');
        expect(screen.getByText(/已用 20%/)).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'OAuth 授权' }));
        const dialog = await screen.findByRole('dialog', { name: 'AI OAuth 授权' });
        await user.type(
            within(dialog).getByPlaceholderText(/粘贴完整回调 URL/),
            'http://localhost:1455/auth/callback?code=c1&state=s1',
        );
        await user.click(within(dialog).getByRole('button', { name: '提交回调' }));
        await waitFor(() => {
            expect(mockApi.completeAiOauth).toHaveBeenCalledWith(
                'sess-1',
                'http://localhost:1455/auth/callback?code=c1&state=s1',
            );
        });
    });

    it('AiSubscriptionsView 在 Gemini OAuth 未配置时自动引导填写并重试授权', async () => {
        const user = userEvent.setup();
        mockApi.getAiSubscriptions.mockResolvedValueOnce({
            success: true,
            data: [
                {
                    id: 9,
                    name: 'Gemini Ultra',
                    provider: 'Google',
                    plan: 'ultra 20x',
                    oauthProvider: 'gemini',
                    oauthConnected: false,
                },
            ],
        });
        mockApi.startAiOauth
            .mockResolvedValueOnce({
                success: false,
                message: 'GEMINI_OAUTH_NOT_CONFIGURED:Gemini OAuth 尚未配置凭据',
            })
            .mockResolvedValueOnce({
                success: true,
                data: {
                    sessionId: 'gem-1',
                    mode: 'loopback',
                    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
                    redirectUri: 'http://localhost:12345/oauth2callback',
                    manualCallback: false,
                },
            });

        render(<AiSubscriptionsView onNotify={vi.fn()} />);
        await screen.findByText('Gemini Ultra');

        await user.click(screen.getByRole('button', { name: 'OAuth 授权' }));
        const cfgDialog = await screen.findByRole('dialog', { name: '配置 Gemini OAuth 凭据' });
        await user.type(
            within(cfgDialog).getByPlaceholderText(/Client ID \(xxx\.apps\.googleusercontent\.com\)/),
            'my-client-id.apps.googleusercontent.com',
        );
        await user.click(within(cfgDialog).getByRole('button', { name: '保存并开始授权' }));

        await waitFor(() => {
            expect(mockApi.saveGeminiOauthConfig).toHaveBeenCalledWith(
                expect.objectContaining({ clientId: 'my-client-id.apps.googleusercontent.com' }),
            );
            expect(mockApi.startAiOauth).toHaveBeenCalledTimes(2);
        });
    });

    it('AiSubscriptionsView 展示 Gemini 验证链接按钮并可打开外部验证页', async () => {
        const user = userEvent.setup();
        mockApi.openExternalUrl.mockResolvedValue({ success: true });
        mockApi.getAiSubscriptions.mockResolvedValueOnce({
            success: true,
            data: [
                {
                    id: 12,
                    name: 'Gemini Ultra',
                    provider: 'Google',
                    plan: 'g1-ultra-tier',
                    oauthProvider: 'gemini',
                    oauthConnected: true,
                    usageError: 'Google 需要验证此账号后才能查询额度：https://accounts.google.com/signin/continue?authuser=u%40gmail.com',
                },
            ],
        });

        render(<AiSubscriptionsView onNotify={vi.fn()} />);
        await screen.findByText('Gemini Ultra');
        await user.click(screen.getByRole('button', { name: /打开 Google 验证页面/ }));
        expect(mockApi.openExternalUrl).toHaveBeenCalledWith(
            'https://accounts.google.com/signin/continue?authuser=u%40gmail.com',
        );
    });

    it('AiSubscriptionsView 对 Gemini / Google AI Ultra 仅展示双分组核心限额并过滤冗余分模型条目', async () => {
        mockApi.getAiSubscriptions.mockResolvedValueOnce({
            success: true,
            data: [
                {
                    id: 15,
                    name: 'gemini',
                    provider: 'google',
                    plan: 'Google AI Ultra',
                    oauthProvider: 'gemini',
                    oauthConnected: true,
                    usage: {
                        source: 'gemini-cloudcode',
                        status: 'available',
                        windows: [
                            { label: 'Gemini 5小时额度', model: 'gemini-5h', usedPercent: 3.2, windowSeconds: 18000, resetsAt: '2026-11-25T01:00:00Z' },
                            { label: 'Gemini 周额度', model: 'gemini-weekly', usedPercent: 2.1, windowSeconds: 604800, resetsAt: '2026-12-01T04:06:00Z' },
                            { label: 'Claude 5小时额度', model: '3p-5h', usedPercent: 0, windowSeconds: 18000, resetsAt: '2026-11-25T03:51:00Z' },
                            { label: 'Claude 周额度', model: '3p-weekly', usedPercent: 9.6, windowSeconds: 604800, resetsAt: '2026-12-01T22:51:00Z' },
                            { label: 'Claude Opus 5.5 (High)', model: 'claude-opus-5-5-high', usedPercent: 0 },
                            { label: 'Claude Sonnet 5.5 (Medium)', model: 'claude-sonnet-5-5-medium', usedPercent: 0 },
                            { label: 'Gemini 2.5 Pro', model: 'gemini-2.5-pro', usedPercent: 3.2 },
                            { label: 'Gemini 3.1 Flash Lite', model: 'gemini-3.1-flash-lite', usedPercent: 3.2 },
                        ],
                    },
                },
            ],
        });

        const { container } = render(<AiSubscriptionsView onNotify={vi.fn()} />);

        await screen.findByText('Gemini 模型');
        expect(screen.getByText('Claude 和 GPT 模型')).toBeInTheDocument();
        expect(screen.getAllByText('周限额')).toHaveLength(2);
        expect(screen.getAllByText('5 小时限额')).toHaveLength(2);
        expect(screen.getByText('97.9%')).toBeInTheDocument();
        expect(screen.getByText('96.8%')).toBeInTheDocument();
        expect(screen.getByText('90.4%')).toBeInTheDocument();
        expect(screen.getByText('100.0%')).toBeInTheDocument();

        // 冗余的分模型行全部被过滤，不再杂乱展示
        expect(screen.queryByText('Claude Opus 5.5 (High)')).not.toBeInTheDocument();
        expect(screen.queryByText('Gemini 2.5 Pro')).not.toBeInTheDocument();
        expect(screen.queryByText('Gemini 3.1 Flash Lite')).not.toBeInTheDocument();

        // 进度条按剩余比例填充（97.9%）
        const fills = Array.from(container.querySelectorAll('.gm-quota-bar-fill')).map(el => el.style.width);
        expect(fills).toContain('97.9%');
        expect(fills).toContain('96.8%');
        expect(fills).toContain('90.4%');
        expect(fills).toContain('100%');
    });

    it('AiSubscriptionsView 在 Gemini grouped 模式下保留 scopeNote 与 credits 积分，且 OpenAI 含 gpt-* 附加限额不丢主限额', async () => {
        mockApi.getAiSubscriptions.mockResolvedValueOnce({
            success: true,
            data: [
                {
                    id: 16,
                    name: 'Gemini Code Assist',
                    provider: 'Google',
                    plan: 'Ultra',
                    oauthProvider: 'gemini',
                    oauthConnected: true,
                    usage: {
                        source: 'gemini-cloudcode',
                        scopeNote: '此处展示 Google Cloud Code 聚合配额。',
                        status: 'available',
                        windows: [
                            { label: 'Gemini 周额度', model: 'gemini-weekly', usedPercent: 10, windowSeconds: 604800 },
                            { label: 'Gemini 5小时额度', model: 'gemini-5h', usedPercent: 5, windowSeconds: 18000 },
                            { label: 'credits/GOOGLE_ONE_AI', remaining: 1200, unit: 'credits' },
                        ],
                    },
                },
                {
                    id: 17,
                    name: 'OpenAI Codex Pro',
                    provider: 'OpenAI',
                    plan: 'Pro',
                    oauthProvider: 'openai',
                    oauthConnected: true,
                    usage: {
                        source: 'openai-wham',
                        scopeNote: '此处为 Codex 额度。',
                        status: 'available',
                        windows: [
                            { label: 'primary_window', usedPercent: 22, windowSeconds: 18000 },
                            { label: 'secondary_window', usedPercent: 40, windowSeconds: 604800 },
                            { label: 'gpt-5-codex', model: 'gpt-5-codex', usedPercent: 15, windowSeconds: 18000 },
                            { label: 'credits', remaining: 18.5, unit: 'USD' },
                        ],
                    },
                },
            ],
        });

        render(<AiSubscriptionsView onNotify={vi.fn()} />);

        await screen.findByText('Gemini Code Assist');
        expect(screen.getByText('此处展示 Google Cloud Code 聚合配额。')).toBeInTheDocument();
        expect(screen.getByText('credits/GOOGLE_ONE_AI')).toBeInTheDocument();
        expect(screen.getByText('剩余 1200 credits')).toBeInTheDocument();

        // OpenAI 订阅不应被 gpt-5-codex 窗口误分组，主限额与余额完整保留
        expect(screen.getByText('primary_window')).toBeInTheDocument();
        expect(screen.getByText('secondary_window')).toBeInTheDocument();
        expect(screen.getByText('gpt-5-codex')).toBeInTheDocument();
        expect(screen.getByText('credits')).toBeInTheDocument();
        expect(screen.getByText(/剩余 18\.5 USD/)).toBeInTheDocument();
    });

    it('AiSubscriptionsView 在 Antigravity CLI 返回多周期汇总时走双分组渲染', async () => {
        const user = userEvent.setup();
        mockApi.readAntigravityCliQuota.mockResolvedValueOnce({
            success: true,
            data: {
                checkedAt: '2026-11-24T12:00:00Z',
                windows: [
                    { label: 'Gemini/five_hour', model: 'Gemini', usedPercent: 10, windowSeconds: 18000 },
                    { label: 'Gemini/seven_day', model: 'Gemini', usedPercent: 25, windowSeconds: 604800 },
                    { label: 'Claude/five_hour', model: 'Claude', usedPercent: 5, windowSeconds: 18000 },
                    { label: 'Claude/seven_day', model: 'Claude', usedPercent: 30, windowSeconds: 604800 },
                ],
            },
        });

        render(<AiSubscriptionsView onNotify={vi.fn()} />);
        await screen.findByText('Codex Plus');
        await user.click(screen.getByRole('button', { name: /Antigravity CLI 额度/ }));

        await screen.findByText('Gemini 模型');
        expect(screen.getByText('Claude 和 GPT 模型')).toBeInTheDocument();
        expect(screen.getByText('75.0%')).toBeInTheDocument();
        expect(screen.getByText('90.0%')).toBeInTheDocument();
        expect(screen.getByText('70.0%')).toBeInTheDocument();
        expect(screen.getByText('95.0%')).toBeInTheDocument();
    });
});
