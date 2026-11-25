import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Sparkles,
    Plus,
    RefreshCw,
    Edit3,
    Trash2,
    Link,
    X,
    Terminal,
    Clock,
    ExternalLink,
    Settings,
    Upload,
} from 'lucide-react';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import api from '../services/api';
import {
    BrandLogo,
    EmptyState,
    FluentIcon,
    GlassButton,
    GlassCapsule,
    PageToolbar,
} from './glass';
import { confirmDialog } from '../utils/dialogs';
import { renderInBody } from '../utils/portal';
import { resolveBrandIconUrl } from '../utils/brandIcons';
import {
    DATE_INPUT_MAX,
    DATE_INPUT_MIN,
    DEFAULT_USD_CNY_RATE,
    clampDateInputValue,
    convertToCny,
    finalizeDateInputValue,
    formatCnyAmount,
    formatCycleLabel,
    formatMoney,
} from '../utils/renewalUtils';

const OAUTH_PROVIDERS = [
    { id: 'openai', label: 'OpenAI / ChatGPT (Codex)' },
    { id: 'claude', label: 'Anthropic / Claude' },
    { id: 'grok', label: 'xAI / Grok' },
    { id: 'gemini', label: 'Google / Gemini (Code Assist)' },
];

const EMPTY_SUB_FORM = {
    name: '',
    provider: 'OpenAI',
    plan: '',
    accountEmail: '',
    keyHint: '',
    billingAmount: '',
    billingCurrency: 'USD',
    billingCycle: 'month',
    renewsAt: '',
    googleAccountId: '',
    paymentCardId: '',
    oauthProvider: 'openai',
    tags: '',
    notes: '',
};

const formatResetTime = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const extractGoogleValidationUrl = (text) => {
    if (!text) return null;
    const match = String(text).match(/https:\/\/(?:accounts\.)?google\.com\/[^\s]+/i);
    return match ? match[0] : null;
};

const AiSubscriptionsView = ({
    googleAccounts = [],
    paymentCards = [],
    fxRate = DEFAULT_USD_CNY_RATE,
    onNotify,
    onOverviewChanged,
}) => {
    const [subs, setSubs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshingId, setRefreshingId] = useState(null);

    // Antigravity CLI 独立额度
    const [agyQuota, setAgyQuota] = useState(null);
    const [agyLoading, setAgyLoading] = useState(false);
    const [agyError, setAgyError] = useState('');

    // Gemini OAuth 客户端配置弹窗
    const [geminiConfig, setGeminiConfig] = useState(null);
    const [geminiModalOpen, setGeminiModalOpen] = useState(false);
    const [geminiPendingSub, setGeminiPendingSub] = useState(null);
    const [geminiClientId, setGeminiClientId] = useState('');
    const [geminiClientSecret, setGeminiClientSecret] = useState('');
    const [geminiRawJson, setGeminiRawJson] = useState('');
    const [savingGeminiCfg, setSavingGeminiCfg] = useState(false);

    // 新增/编辑弹窗
    const [modalOpen, setModalOpen] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState(EMPTY_SUB_FORM);
    const [saving, setSaving] = useState(false);

    // OAuth 授权弹窗
    const [oauthDialog, setOauthDialog] = useState(null); // { sub, provider, startInfo, status, error }
    const [callbackInput, setCallbackInput] = useState('');
    const [completingOauth, setCompletingOauth] = useState(false);
    const pollTimerRef = useRef(null);

    const loadSubs = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.getAiSubscriptions();
            if (res.success && Array.isArray(res.data)) setSubs(res.data);
        } catch (err) {
            onNotify?.(err instanceof Error ? err.message : '加载 AI 订阅失败', 'error');
        } finally {
            setLoading(false);
        }
    }, [onNotify]);

    const loadGeminiConfig = useCallback(async () => {
        if (typeof api?.getGeminiOauthConfig !== 'function') return;
        try {
            const res = await api.getGeminiOauthConfig();
            if (res?.success && res.data) setGeminiConfig(res.data);
        } catch {
            // 测试环境未 mock 时忽略
        }
    }, []);

    useEffect(() => {
        loadSubs();
        loadGeminiConfig();
        return () => {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        };
    }, [loadSubs, loadGeminiConfig]);

    const openCreate = () => {
        setEditingId(null);
        setForm(EMPTY_SUB_FORM);
        setModalOpen(true);
    };

    const openEdit = (sub) => {
        setEditingId(sub.id);
        setForm({
            name: sub.name || '',
            provider: sub.provider || '',
            plan: sub.plan || '',
            accountEmail: sub.accountEmail || '',
            keyHint: sub.keyHint || '',
            billingAmount: sub.billingAmount != null ? String(sub.billingAmount) : '',
            billingCurrency: sub.billingCurrency || 'USD',
            billingCycle: sub.billingCycle || 'month',
            renewsAt: sub.renewsAt || '',
            googleAccountId: sub.googleAccountId != null ? String(sub.googleAccountId) : '',
            paymentCardId: sub.paymentCardId != null ? String(sub.paymentCardId) : '',
            oauthProvider: sub.oauthProvider || '',
            tags: sub.tags || '',
            notes: sub.notes || '',
        });
        setModalOpen(true);
    };

    const handleSave = async (e) => {
        e.preventDefault();
        if (!form.name.trim() || !form.provider.trim()) {
            onNotify?.('请填写订阅名称与服务商', 'error');
            return;
        }
        setSaving(true);
        try {
            const amt = form.billingAmount.trim() ? Number(form.billingAmount) : null;
            const payload = {
                name: form.name.trim(),
                provider: form.provider.trim(),
                plan: form.plan.trim() || null,
                accountEmail: form.accountEmail.trim() || null,
                keyHint: form.keyHint.trim() || null,
                billingAmount: Number.isFinite(amt) ? amt : null,
                billingCurrency: form.billingCurrency || 'USD',
                billingCycle: form.billingCycle || 'month',
                renewsAt: form.renewsAt.trim() || null,
                googleAccountId: form.googleAccountId ? Number(form.googleAccountId) : null,
                paymentCardId: form.paymentCardId ? Number(form.paymentCardId) : null,
                oauthProvider: form.oauthProvider || null,
                tags: form.tags.trim() || null,
                notes: form.notes.trim() || null,
            };
            const res = editingId
                ? await api.updateAiSubscription(editingId, payload)
                : await api.createAiSubscription(payload);
            if (res.success) {
                onNotify?.(editingId ? 'AI 订阅已更新' : 'AI 订阅已添加');
                setModalOpen(false);
                await loadSubs();
                onOverviewChanged?.();
            } else {
                onNotify?.(res.message || '保存失败', 'error');
            }
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (sub) => {
        const ok = await confirmDialog(`确定删除 AI 订阅「${sub.name}」吗？`, {
            title: '删除 AI 订阅',
            kind: 'warning',
            okLabel: '删除',
        });
        if (!ok) return;
        const res = await api.deleteAiSubscription(sub.id);
        if (res.success) {
            onNotify?.('已删除订阅');
            await loadSubs();
            onOverviewChanged?.();
        }
    };

    const openGeminiConfigModal = (pendingSub = null) => {
        setGeminiPendingSub(pendingSub);
        setGeminiClientId('');
        setGeminiClientSecret('');
        setGeminiRawJson('');
        setGeminiModalOpen(true);
        loadGeminiConfig();
    };

    const handleImportGeminiJsonFile = async () => {
        try {
            const selected = await openFileDialog({
                title: '选择 Google OAuth 客户端 JSON 文件',
                multiple: false,
                filters: [{ name: 'JSON', extensions: ['json'] }],
            });
            if (!selected || Array.isArray(selected)) return;
            const res = await api.readTextFile(selected);
            if (!res.success || !res.data) {
                onNotify?.(res.message || '读取 JSON 文件失败', 'error');
                return;
            }
            setGeminiRawJson(res.data);
            onNotify?.('已加载 OAuth JSON，点击保存即可生效');
        } catch (err) {
            onNotify?.(err?.message || '导入文件失败', 'error');
        }
    };

    const handleSaveGeminiConfig = async (e) => {
        e.preventDefault();
        setSavingGeminiCfg(true);
        try {
            const res = await api.saveGeminiOauthConfig({
                clientId: geminiClientId.trim() || null,
                clientSecret: geminiClientSecret.trim() || null,
                rawJson: geminiRawJson.trim() || null,
            });
            if (!res.success || !res.data) {
                onNotify?.(res.message || '保存 Gemini OAuth 配置失败', 'error');
                return;
            }
            setGeminiConfig(res.data);
            setGeminiModalOpen(false);
            onNotify?.('Gemini OAuth 凭据已保存');
            const retrySub = geminiPendingSub;
            setGeminiPendingSub(null);
            if (retrySub) {
                await handleStartOAuth(retrySub, 'gemini');
            }
        } finally {
            setSavingGeminiCfg(false);
        }
    };

    const handleClearGeminiConfig = async () => {
        setSavingGeminiCfg(true);
        try {
            const res = await api.saveGeminiOauthConfig({ clear: true });
            if (res.success && res.data) {
                setGeminiConfig(res.data);
                onNotify?.('已清除本地保存的 Gemini OAuth 凭据');
            }
        } finally {
            setSavingGeminiCfg(false);
        }
    };

    const handleStartOAuth = async (sub, providerId) => {
        const prov = providerId || sub.oauthProvider || 'openai';
        setCallbackInput('');
        const res = await api.startAiOauth(prov, sub.id);
        if (!res.success || !res.data) {
            const errMsg = String(res.message || '启动 OAuth 授权失败');
            if (prov === 'gemini' && errMsg.includes('GEMINI_OAUTH_NOT_CONFIGURED')) {
                openGeminiConfigModal(sub);
                onNotify?.('请先配置 Gemini OAuth Client ID（或导入 Google OAuth JSON）', 'error');
                return;
            }
            onNotify?.(errMsg.replace(/^GEMINI_OAUTH_NOT_CONFIGURED:/, ''), 'error');
            return;
        }
        const startInfo = res.data;
        setOauthDialog({
            sub,
            provider: prov,
            startInfo,
            status: 'pending',
            error: '',
        });

        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        pollTimerRef.current = setInterval(async () => {
            const stRes = await api.getAiOauthStatus(startInfo.sessionId);
            if (!stRes.success || !stRes.data) return;
            const st = stRes.data;
            if (st.status === 'connected') {
                clearInterval(pollTimerRef.current);
                setOauthDialog(null);
                onNotify?.(`「${sub.name}」OAuth 授权成功`);
                await loadSubs();
            } else if (st.status === 'error' || st.status === 'expired' || st.status === 'cancelled') {
                clearInterval(pollTimerRef.current);
                setOauthDialog(prev => (prev ? { ...prev, status: st.status, error: st.error } : null));
            }
        }, 1500);
    };

    const handleCompleteManualOAuth = async (e) => {
        e.preventDefault();
        if (!oauthDialog?.startInfo?.sessionId || !callbackInput.trim()) return;
        setCompletingOauth(true);
        try {
            const res = await api.completeAiOauth(oauthDialog.startInfo.sessionId, callbackInput.trim());
            if (res.success) {
                if (pollTimerRef.current) clearInterval(pollTimerRef.current);
                setOauthDialog(null);
                onNotify?.(`「${oauthDialog.sub.name}」授权成功`);
                await loadSubs();
            } else {
                onNotify?.(res.message || '完成授权失败', 'error');
            }
        } finally {
            setCompletingOauth(false);
        }
    };

    const handleCancelOAuth = async () => {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        if (oauthDialog?.startInfo?.sessionId) {
            await api.cancelAiOauth(oauthDialog.startInfo.sessionId);
        }
        setOauthDialog(null);
    };

    const handleDisconnectOAuth = async (sub) => {
        const res = await api.disconnectAiOauth(sub.id);
        if (res.success) {
            onNotify?.('已断开 OAuth 授权');
            await loadSubs();
        }
    };

    const handleRefreshQuota = async (sub) => {
        setRefreshingId(sub.id);
        try {
            const res = await api.refreshAiSubscriptionQuota(sub.id);
            if (res.success && res.data) {
                setSubs(prev => prev.map(s => (s.id === sub.id ? res.data : s)));
                if (res.data.usageError) {
                    onNotify?.(res.data.usageError, 'error');
                } else {
                    onNotify?.(`已刷新「${sub.name}」额度`);
                }
            } else {
                onNotify?.(res.message || '刷新额度失败', 'error');
            }
        } finally {
            setRefreshingId(null);
        }
    };

    const handleReadAntigravity = async () => {
        setAgyLoading(true);
        setAgyError('');
        try {
            const res = await api.readAntigravityCliQuota();
            if (res.success && res.data) {
                setAgyQuota(res.data);
                onNotify?.('已读取 Antigravity CLI 额度');
            } else {
                setAgyError(res.message || '读取失败');
            }
        } finally {
            setAgyLoading(false);
        }
    };

    const totalMonthlyCny = useMemo(
        () =>
            subs.reduce((acc, s) => {
                if (typeof s.billingAmount !== 'number') return acc;
                const cny = convertToCny(s.billingAmount, s.billingCurrency, fxRate) || 0;
                if (s.billingCycle === 'month') return acc + cny;
                if (s.billingCycle === 'year') return acc + cny / 12;
                return acc;
            }, 0),
        [subs, fxRate],
    );

    return (
        <>
            <PageToolbar
                title="AI 订阅"
                subtitle={
                    totalMonthlyCny > 0
                        ? `当前折合月费 ${formatCnyAmount(totalMonthlyCny)}/月 · 支持 OAuth 与 CLI 额度刷新`
                        : '管理 AI 会员套餐、OAuth 授权与 Antigravity CLI 额度'
                }
                right={
                    <div className="flex flex-wrap items-center gap-2">
                        <GlassCapsule>
                            <GlassButton
                                onClick={() => openGeminiConfigModal(null)}
                                title={geminiConfig?.configured ? `当前来源：${geminiConfig.source}` : '配置 Gemini OAuth 客户端'}
                            >
                                <FluentIcon name="settings" size={16} />
                                <span>Gemini OAuth{geminiConfig?.configured ? ' ✓' : ''}</span>
                            </GlassButton>
                            <GlassButton
                                onClick={handleReadAntigravity}
                                disabled={agyLoading}
                            >
                                <FluentIcon name="terminal" size={16} />
                                <span>{agyLoading ? '读取中…' : 'Antigravity CLI 额度'}</span>
                            </GlassButton>
                        </GlassCapsule>
                        <GlassButton glass pill prominent onClick={openCreate}>
                            <FluentIcon name="add" size={16} />
                            <span>添加订阅</span>
                        </GlassButton>
                    </div>
                }
            />

            <div className="page page-wide page-in space-y-5">
                {/* Antigravity CLI 结果区 */}
                {(agyQuota || agyError) && (
                    <div className="gm-card p-4 space-y-2.5" aria-label="Antigravity CLI 额度结果">
                        <div className="flex items-center justify-between">
                            <div className="text-[13px] font-semibold gm-text-1 flex items-center gap-2">
                                <Terminal size={14} style={{ color: 'var(--primary)' }} />
                                <span>本机 Antigravity CLI 额度</span>
                                {agyQuota?.checkedAt && (
                                    <span className="text-[11px] font-mono gm-text-3">
                                        · {formatResetTime(agyQuota.checkedAt)}
                                    </span>
                                )}
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setAgyQuota(null);
                                    setAgyError('');
                                }}
                                className="gm-btn gm-btn-ghost p-1"
                                aria-label="收起 Antigravity 结果"
                            >
                                <X size={14} />
                            </button>
                        </div>
                        {agyError && (
                            <div className="text-[12px]" style={{ color: 'var(--danger)' }}>{agyError}</div>
                        )}
                        {agyQuota?.windows?.length > 0 && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                                {agyQuota.windows.map(w => (
                                    <div key={w.label} className="p-2.5 rounded-lg bg-[var(--bg-elevated)] space-y-1">
                                        <div className="flex justify-between text-[12px]">
                                            <span className="font-mono gm-text-1 truncate">{w.label}</span>
                                            <span className="font-mono gm-text-2">
                                                已用 {w.usedPercent ?? 0}%
                                            </span>
                                        </div>
                                        <div className="h-1.5 rounded-full bg-[var(--bg-active)] overflow-hidden">
                                            <div
                                                className="h-full rounded-full"
                                                style={{
                                                    width: `${Math.min(100, Math.max(0, w.usedPercent || 0))}%`,
                                                    background: (w.usedPercent || 0) > 85 ? 'var(--danger)' : 'var(--primary)',
                                                }}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* 订阅卡片列表 */}
                {subs.length === 0 ? (
                    <div className="group">
                        <EmptyState
                            icon="sparkle"
                            title={loading ? '正在加载 AI 订阅…' : '暂无 AI 订阅'}
                            description="点击右上角「添加订阅」录入会员与 OAuth 额度监控。"
                        />
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {subs.map(sub => {
                            const usage = sub.usage;
                            return (
                                <div key={sub.id} className="gm-card p-4 space-y-3">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <BrandLogo
                                                name={sub.name}
                                                hints={[sub.oauthProvider, sub.provider, sub.name]}
                                            />
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <h3 className="text-[14.5px] font-semibold gm-text-1 truncate">{sub.name}</h3>
                                                    {sub.plan && <span className="gm-chip gm-chip-accent">{sub.plan}</span>}
                                                </div>
                                                <div className="text-[11.5px] gm-text-3 truncate">
                                                    {sub.provider}
                                                    {sub.accountEmail ? ` · ${sub.accountEmail}` : ''}
                                                </div>
                                            </div>
                                        </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => openEdit(sub)}
                                            className="gm-btn gm-btn-ghost p-1.5"
                                            aria-label={`编辑 ${sub.name}`}
                                        >
                                            <Edit3 size={13} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleDelete(sub)}
                                            className="gm-btn gm-btn-ghost p-1.5 hover:text-[var(--danger)]"
                                            aria-label={`删除 ${sub.name}`}
                                        >
                                            <Trash2 size={13} />
                                        </button>
                                    </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-2 text-[11.5px] gm-text-2">
                                    {typeof sub.billingAmount === 'number' && (
                                        <span className="font-mono">
                                            {formatMoney(sub.billingAmount, sub.billingCurrency)}/{formatCycleLabel(sub.billingCycle)}
                                        </span>
                                    )}
                                    {sub.renewsAt && (
                                        <span className="font-mono flex items-center gap-1 gm-text-3">
                                            <Clock size={11} />
                                            续费 {sub.renewsAt}
                                        </span>
                                    )}
                                    {sub.googleAccountEmail && (
                                        <span className="gm-chip">谷歌: {sub.googleAccountEmail}</span>
                                    )}
                                    {sub.paymentCardName && (
                                        <span className="gm-chip">卡: {sub.paymentCardName}</span>
                                    )}
                                </div>

                                {/* OAuth 授权与额度区 */}
                                <div className="p-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-light)] space-y-2.5">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="text-[12px] gm-text-2 flex items-center gap-1.5">
                                            <Link size={12} />
                                            <span>
                                                {sub.oauthConnected
                                                    ? `已连接 ${sub.oauthProvider?.toUpperCase() || ''}`
                                                    : '未连接 OAuth 额度查询'}
                                            </span>
                                            {usage?.status === 'stale' && (
                                                <span className="gm-chip" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>
                                                    上次缓存
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            {sub.oauthConnected ? (
                                                <>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRefreshQuota(sub)}
                                                        disabled={refreshingId === sub.id}
                                                        className="gm-btn gm-btn-secondary gm-btn-sm"
                                                    >
                                                        <RefreshCw size={12} className={refreshingId === sub.id ? 'animate-spin' : ''} />
                                                        <span>刷新额度</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDisconnectOAuth(sub)}
                                                        className="gm-btn gm-btn-ghost gm-btn-sm"
                                                    >
                                                        断开
                                                    </button>
                                                </>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => handleStartOAuth(sub)}
                                                    className="gm-btn gm-btn-primary gm-btn-sm"
                                                >
                                                    OAuth 授权
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {sub.usageError && (() => {
                                        const validationUrl = extractGoogleValidationUrl(sub.usageError);
                                        return (
                                            <div className="space-y-1.5">
                                                <div className="text-[11.5px] break-all" style={{ color: 'var(--warning)' }}>
                                                    {sub.usageError}
                                                </div>
                                                {validationUrl && (
                                                    <button
                                                        type="button"
                                                        onClick={() => api.openExternalUrl(validationUrl)}
                                                        className="gm-btn gm-btn-secondary gm-btn-sm"
                                                    >
                                                        <ExternalLink size={12} />
                                                        <span>打开 Google 验证页面</span>
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })()}

                                    {usage?.windows?.length > 0 && (
                                        <div className="space-y-2">
                                            {usage.windows.map(w => {
                                                const remainingPct = w.usedPercent != null
                                                    ? Math.max(0, Math.min(100, 100 - w.usedPercent))
                                                    : null;
                                                return (
                                                    <div key={w.label} className="space-y-1">
                                                        <div className="flex items-center justify-between gap-2 text-[11.5px]">
                                                            <span className="font-mono gm-text-1 truncate">{w.label}</span>
                                                            <span className="font-mono gm-text-2 shrink-0">
                                                                {w.usedPercent != null && `剩余 ${remainingPct.toFixed(0)}% · 已用 ${w.usedPercent.toFixed(1)}%`}
                                                                {w.remaining != null && ` 剩余 ${w.remaining} ${w.unit || ''}`}
                                                                {w.used != null && w.limit != null && ` ${w.used.toFixed(2)}/${w.limit.toFixed(2)} ${w.unit || ''}`}
                                                                {w.resetsAt ? ` · 重置 ${formatResetTime(w.resetsAt)}` : ''}
                                                            </span>
                                                        </div>
                                                        {w.usedPercent != null && (
                                                            <div className="h-1.5 rounded-full bg-[var(--bg-active)] overflow-hidden">
                                                                <div
                                                                    className="h-full rounded-full transition-all"
                                                                    style={{
                                                                        width: `${Math.min(100, Math.max(0, w.usedPercent))}%`,
                                                                        background: w.usedPercent > 85 ? 'var(--danger)' : 'var(--primary)',
                                                                    }}
                                                                />
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                            {usage.scopeNote && (
                                                <div className="text-[10.5px] gm-text-3">{usage.scopeNote}</div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* 新增/编辑订阅弹窗 */}
            {modalOpen && renderInBody(
                <div className="gm-overlay" role="dialog" aria-modal="true" aria-label={editingId ? '编辑 AI 订阅' : '添加 AI 订阅'}>
                    <div className="gm-panel w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between">
                            <h3 className="text-[15px] font-semibold gm-text-1">
                                {editingId ? '编辑 AI 订阅' : '添加 AI 订阅'}
                            </h3>
                            <button type="button" onClick={() => setModalOpen(false)} className="gm-btn gm-btn-ghost p-1" aria-label="关闭">
                                <X size={16} />
                            </button>
                        </div>

                        <form onSubmit={handleSave} className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">订阅名称 *</label>
                                    <input
                                        type="text"
                                        className="gm-input w-full"
                                        value={form.name}
                                        onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                                        placeholder="例如：Claude Max 主号"
                                        required
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">服务商 *</label>
                                    <input
                                        type="text"
                                        className="gm-input w-full"
                                        value={form.provider}
                                        onChange={(e) => setForm(prev => ({ ...prev, provider: e.target.value }))}
                                        placeholder="OpenAI / Claude / Cursor / Gemini"
                                        required
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-3">
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">套餐</label>
                                    <input
                                        type="text"
                                        className="gm-input w-full"
                                        value={form.plan}
                                        onChange={(e) => setForm(prev => ({ ...prev, plan: e.target.value }))}
                                        placeholder="Plus / Pro / Max"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">账号邮箱</label>
                                    <input
                                        type="text"
                                        className="gm-input w-full"
                                        value={form.accountEmail}
                                        onChange={(e) => setForm(prev => ({ ...prev, accountEmail: e.target.value }))}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">OAuth 通道</label>
                                    <select
                                        className="gm-input w-full"
                                        value={form.oauthProvider}
                                        onChange={(e) => setForm(prev => ({ ...prev, oauthProvider: e.target.value }))}
                                    >
                                        <option value="">不绑定</option>
                                        {OAUTH_PROVIDERS.map(p => (
                                            <option key={p.id} value={p.id}>{p.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-4 gap-2">
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">费用</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        className="gm-input w-full"
                                        value={form.billingAmount}
                                        onChange={(e) => setForm(prev => ({ ...prev, billingAmount: e.target.value }))}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">币种</label>
                                    <select
                                        className="gm-input w-full"
                                        value={form.billingCurrency}
                                        onChange={(e) => setForm(prev => ({ ...prev, billingCurrency: e.target.value }))}
                                    >
                                        <option value="USD">USD</option>
                                        <option value="CNY">CNY</option>
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">周期</label>
                                    <select
                                        className="gm-input w-full"
                                        value={form.billingCycle}
                                        onChange={(e) => setForm(prev => ({ ...prev, billingCycle: e.target.value }))}
                                    >
                                        <option value="month">月付</option>
                                        <option value="year">年付</option>
                                        <option value="once">一次性</option>
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">下次续费日</label>
                                    <input
                                        type="date"
                                        min={DATE_INPUT_MIN}
                                        max={DATE_INPUT_MAX}
                                        className="gm-input w-full"
                                        value={form.renewsAt}
                                        onChange={(e) => setForm(prev => ({
                                            ...prev,
                                            renewsAt: clampDateInputValue(e.target.value),
                                        }))}
                                        onBlur={(e) => setForm(prev => ({
                                            ...prev,
                                            renewsAt: finalizeDateInputValue(e.target.value),
                                        }))}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">关联谷歌账号</label>
                                    <select
                                        className="gm-input w-full"
                                        value={form.googleAccountId}
                                        onChange={(e) => setForm(prev => ({ ...prev, googleAccountId: e.target.value }))}
                                    >
                                        <option value="">不关联</option>
                                        {googleAccounts.map(acc => (
                                            <option key={acc.id} value={acc.id}>{acc.email}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">关联支付卡</label>
                                    <select
                                        className="gm-input w-full"
                                        value={form.paymentCardId}
                                        onChange={(e) => setForm(prev => ({ ...prev, paymentCardId: e.target.value }))}
                                    >
                                        <option value="">不关联</option>
                                        {paymentCards.map(c => (
                                            <option key={c.id} value={c.id}>{c.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="space-y-1">
                                <label className="text-[12px] gm-text-2">备注</label>
                                <textarea
                                    rows={2}
                                    className="gm-input w-full"
                                    value={form.notes}
                                    onChange={(e) => setForm(prev => ({ ...prev, notes: e.target.value }))}
                                />
                            </div>

                            <div className="flex justify-end gap-2 pt-2">
                                <button type="button" onClick={() => setModalOpen(false)} className="gm-btn gm-btn-ghost">
                                    取消
                                </button>
                                <button type="submit" disabled={saving} className="gm-btn gm-btn-primary">
                                    {saving ? '保存中…' : '保存'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>,
            )}

            {/* OAuth 授权进度与回调输入弹窗 */}
            {oauthDialog && renderInBody(
                <div className="gm-overlay" role="dialog" aria-modal="true" aria-label="AI OAuth 授权">
                    <div className="gm-panel w-full max-w-md p-5 space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-[15px] font-semibold gm-text-1">
                                授权 {oauthDialog.sub.name} ({oauthDialog.provider.toUpperCase()})
                            </h3>
                            <button type="button" onClick={handleCancelOAuth} className="gm-btn gm-btn-ghost p-1" aria-label="关闭">
                                <X size={16} />
                            </button>
                        </div>

                        <p className="text-[12.5px] gm-text-2">
                            已在系统浏览器中打开授权页面。
                            {oauthDialog.startInfo.manualCallback
                                ? ' 授权完成后，请将页面显示的 code#state 或完整回调链接粘贴到下方提交。'
                                : ' 完成授权后将自动回传结果；若端口被占用或未跳转，也可手动粘贴回调链接。'}
                        </p>

                        <button
                            type="button"
                            onClick={() => api.openExternalUrl(oauthDialog.startInfo.authorizeUrl)}
                            className="gm-btn gm-btn-ghost gm-btn-sm"
                        >
                            <ExternalLink size={12} />
                            <span>重新打开授权页</span>
                        </button>

                        {oauthDialog.error && (
                            <div className="p-2.5 rounded text-[12px]" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
                                {oauthDialog.error}
                            </div>
                        )}

                        <form onSubmit={handleCompleteManualOAuth} className="space-y-3">
                            <input
                                type="text"
                                className="gm-input w-full font-mono text-[12px]"
                                value={callbackInput}
                                onChange={(e) => setCallbackInput(e.target.value)}
                                placeholder={
                                    oauthDialog.startInfo.mode === 'code'
                                        ? '粘贴 code#state'
                                        : '可选：粘贴完整回调 URL (http://localhost:...)'
                                }
                            />
                            <div className="flex justify-end gap-2">
                                <button type="button" onClick={handleCancelOAuth} className="gm-btn gm-btn-ghost">
                                    取消授权
                                </button>
                                <button
                                    type="submit"
                                    disabled={completingOauth || !callbackInput.trim()}
                                    className="gm-btn gm-btn-primary"
                                >
                                    {completingOauth ? '验证中…' : '提交回调'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>,
            )}

            {/* Gemini OAuth 客户端凭据配置弹窗 */}
            {geminiModalOpen && renderInBody(
                <div className="gm-overlay" role="dialog" aria-modal="true" aria-label="配置 Gemini OAuth 凭据">
                    <div className="gm-panel w-full max-w-lg p-5 space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-[15px] font-semibold gm-text-1">配置 Gemini OAuth 凭据</h3>
                            <button
                                type="button"
                                onClick={() => setGeminiModalOpen(false)}
                                className="gm-btn gm-btn-ghost p-1"
                                aria-label="关闭"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <div className="rounded-lg p-3 text-[12px] bg-[var(--bg-elevated)] border border-[var(--border-light)] space-y-1">
                            <div className="flex items-center justify-between">
                                <span className="gm-text-2">当前状态</span>
                                <span className="font-mono font-semibold" style={{ color: geminiConfig?.configured ? 'var(--success)' : 'var(--warning)' }}>
                                    {geminiConfig?.configured ? `已就绪（${geminiConfig.source}）` : '未配置'}
                                </span>
                            </div>
                            {geminiConfig?.clientIdHint && (
                                <div className="text-[11px] font-mono gm-text-3">
                                    Client ID：{geminiConfig.clientIdHint}
                                    {geminiConfig.hasClientSecret ? ' · 已含 Secret' : ''}
                                </div>
                            )}
                            <p className="text-[11.5px] gm-text-3 pt-1 leading-relaxed">
                                支持内置 Antigravity Cloud Code 通道（获取 5 小时 / 周窗口与分模型额度），也可导入/粘贴自定义 Google OAuth JSON 覆盖（仅保存在本机 SQLite）。更新客户端后如旧令牌报错，先点「断开」再重新授权即可。
                            </p>
                        </div>

                        <form onSubmit={handleSaveGeminiConfig} className="space-y-3">
                            <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                    <label className="text-[12px] gm-text-2">方式一：粘贴或导入 OAuth 客户端 JSON</label>
                                    <button
                                        type="button"
                                        onClick={handleImportGeminiJsonFile}
                                        className="gm-btn gm-btn-ghost gm-btn-sm"
                                    >
                                        <Upload size={12} />
                                        <span>从文件导入 JSON</span>
                                    </button>
                                </div>
                                <textarea
                                    rows={3}
                                    className="gm-input w-full font-mono text-[11.5px]"
                                    value={geminiRawJson}
                                    onChange={(e) => setGeminiRawJson(e.target.value)}
                                    placeholder='{"installed":{"client_id":"...apps.googleusercontent.com","client_secret":"..."}}'
                                />
                            </div>

                            <div className="space-y-2 pt-1 border-t border-[var(--border-light)]">
                                <div className="text-[12px] gm-text-2">方式二：直接填写 Client ID 与 Secret</div>
                                <input
                                    type="text"
                                    className="gm-input w-full font-mono text-[12px]"
                                    value={geminiClientId}
                                    onChange={(e) => setGeminiClientId(e.target.value)}
                                    placeholder="Client ID (xxx.apps.googleusercontent.com)"
                                />
                                <input
                                    type="password"
                                    className="gm-input w-full font-mono text-[12px]"
                                    value={geminiClientSecret}
                                    onChange={(e) => setGeminiClientSecret(e.target.value)}
                                    placeholder="Client Secret（可选，桌面客户端通常需要）"
                                />
                            </div>

                            <div className="flex items-center justify-between gap-2 pt-2">
                                {geminiConfig?.source === '本地设置' ? (
                                    <button
                                        type="button"
                                        onClick={handleClearGeminiConfig}
                                        disabled={savingGeminiCfg}
                                        className="gm-btn gm-btn-ghost text-[var(--danger)]"
                                    >
                                        清除本地配置
                                    </button>
                                ) : (
                                    <span />
                                )}
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setGeminiModalOpen(false)}
                                        className="gm-btn gm-btn-ghost"
                                    >
                                        取消
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={savingGeminiCfg || (!geminiRawJson.trim() && !geminiClientId.trim())}
                                        className="gm-btn gm-btn-primary"
                                    >
                                        {savingGeminiCfg
                                            ? '保存中…'
                                            : geminiPendingSub
                                                ? '保存并开始授权'
                                                : '保存配置'}
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>,
            )}
            </div>
        </>
    );
};

export default AiSubscriptionsView;
