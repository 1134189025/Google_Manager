import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    CreditCard,
    Plus,
    Search,
    RotateCw,
    Eye,
    EyeOff,
    Copy,
    Edit3,
    Trash2,
    Sparkles,
    X,
} from 'lucide-react';
import api from '../services/api';
import { confirmDialog } from '../utils/dialogs';
import { renderInBody } from '../utils/portal';
import {
    CARD_NETWORKS,
    CARD_REGIONS,
    CARD_REGION_GROUPS,
    cardAppearance,
    detectCardNetwork,
    detectChinaBank,
    formatCardNumberGroups,
    inferRegionGroup,
} from '../utils/cardUtils';
import {
    DATE_INPUT_MAX,
    DATE_INPUT_MIN,
    DEFAULT_USD_CNY_RATE,
    clampDateInputValue,
    convertToCny,
    formatCnyAmount,
    formatMoney,
} from '../utils/renewalUtils';

const EMPTY_CARD_FORM = {
    name: '',
    issuer: '',
    bankCode: '',
    network: '',
    funding: '预付卡',
    formFactor: '虚拟卡',
    region: '',
    regionGroup: '',
    last4: '',
    expiryMonth: '',
    cardNumber: '',
    cvv: '',
    cardholder: '',
    billingAddress: '',
    billingAmount: '',
    billingCurrency: 'USD',
    billingCycle: 'year',
    expiresAt: '',
    tags: '',
    notes: '',
};

const CardsView = ({ darkMode, fxRate = DEFAULT_USD_CNY_RATE, onNotify, onCopy, onOverviewChanged }) => {
    const [docLight, setDocLight] = useState(
        () => typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light',
    );
    const isLightMode = typeof darkMode === 'boolean' ? !darkMode : docLight;

    useEffect(() => {
        if (typeof darkMode === 'boolean' || typeof document === 'undefined') return undefined;
        const syncTheme = () => setDocLight(document.documentElement.dataset.theme === 'light');
        syncTheme();
        const observer = new MutationObserver(syncTheme);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        return () => observer.disconnect();
    }, [darkMode]);

    const [cards, setCards] = useState([]);
    const [loading, setLoading] = useState(true);
    const [regionGroup, setRegionGroup] = useState('all');
    const [search, setSearch] = useState('');
    const [flipped, setFlipped] = useState({});
    const [revealed, setRevealed] = useState({});

    const [modalOpen, setModalOpen] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState(EMPTY_CARD_FORM);
    const [saving, setSaving] = useState(false);

    const loadCards = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.getPaymentCards();
            if (res.success && Array.isArray(res.data)) {
                setCards(res.data);
            }
        } catch (err) {
            onNotify?.(err instanceof Error ? err.message : '加载支付卡失败', 'error');
        } finally {
            setLoading(false);
        }
    }, [onNotify]);

    useEffect(() => {
        loadCards();
    }, [loadCards]);

    const filteredCards = useMemo(() => {
        const q = search.trim().toLowerCase();
        return cards.filter(c => {
            if (regionGroup !== 'all' && c.regionGroup !== regionGroup) return false;
            if (!q) return true;
            return [c.name, c.issuer, c.network, c.region, c.last4, c.tags, c.notes]
                .some(v => String(v ?? '').toLowerCase().includes(q));
        });
    }, [cards, regionGroup, search]);

    const binSuggestion = useMemo(() => {
        const bank = detectChinaBank(form.cardNumber);
        const network = detectCardNetwork(form.cardNumber);
        if (!bank && !network) return null;
        return { bank, network };
    }, [form.cardNumber]);

    const handleCopy = (val, label) => {
        if (!val) return;
        if (onCopy) onCopy(val, label);
        else {
            navigator.clipboard?.writeText?.(val);
            onNotify?.(`已复制 ${label}`);
        }
    };

    const openCreateModal = () => {
        setEditingId(null);
        setForm(EMPTY_CARD_FORM);
        setModalOpen(true);
    };

    const openEditModal = (card) => {
        setEditingId(card.id);
        setForm({
            name: card.name || '',
            issuer: card.issuer || '',
            bankCode: card.bankCode || '',
            network: card.network || '',
            funding: card.funding || '',
            formFactor: card.formFactor || '',
            region: card.region || '',
            regionGroup: card.regionGroup || '',
            last4: card.last4 || '',
            expiryMonth: card.expiryMonth || '',
            cardNumber: card.cardNumber || '',
            cvv: card.cvv || '',
            cardholder: card.cardholder || '',
            billingAddress: card.billingAddress || '',
            billingAmount: card.billingAmount != null ? String(card.billingAmount) : '',
            billingCurrency: card.billingCurrency || 'USD',
            billingCycle: card.billingCycle || 'year',
            expiresAt: card.expiresAt || '',
            tags: card.tags || '',
            notes: card.notes || '',
        });
        setModalOpen(true);
    };

    const applyBinSuggestion = () => {
        if (!binSuggestion) return;
        setForm(prev => ({
            ...prev,
            ...(binSuggestion.bank
                ? {
                    issuer: binSuggestion.bank.issuer,
                    bankCode: binSuggestion.bank.code,
                    region: prev.region || binSuggestion.bank.region,
                    regionGroup: binSuggestion.bank.regionGroup,
                }
                : {}),
            ...(binSuggestion.network && !prev.network ? { network: binSuggestion.network } : {}),
        }));
    };

    const handleSave = async (e) => {
        e.preventDefault();
        if (!form.name.trim()) {
            onNotify?.('请填写卡片名称', 'error');
            return;
        }
        setSaving(true);
        try {
            const amount = form.billingAmount.trim() ? Number(form.billingAmount) : null;
            const payload = {
                name: form.name.trim(),
                issuer: form.issuer.trim() || null,
                bankCode: form.bankCode.trim() || null,
                network: form.network.trim() || null,
                funding: form.funding.trim() || null,
                formFactor: form.formFactor.trim() || null,
                region: form.region.trim() || null,
                regionGroup: inferRegionGroup(form.region, form.regionGroup),
                last4: form.last4.trim() || null,
                expiryMonth: form.expiryMonth.trim() || null,
                cardNumber: form.cardNumber.trim() || null,
                cvv: form.cvv.trim() || null,
                cardholder: form.cardholder.trim() || null,
                billingAddress: form.billingAddress.trim() || null,
                billingAmount: Number.isFinite(amount) ? amount : null,
                billingCurrency: form.billingCurrency || 'USD',
                billingCycle: form.billingCycle || 'year',
                expiresAt: form.expiresAt.trim() || null,
                tags: form.tags.trim() || null,
                notes: form.notes.trim() || null,
            };
            const res = editingId
                ? await api.updatePaymentCard(editingId, payload)
                : await api.createPaymentCard(payload);
            if (res.success) {
                onNotify?.(editingId ? '支付卡已更新' : '支付卡已添加');
                setModalOpen(false);
                await loadCards();
                onOverviewChanged?.();
            } else {
                onNotify?.(res.message || '保存失败', 'error');
            }
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (card) => {
        const ok = await confirmDialog(`确定删除支付卡「${card.name}」吗？`, {
            title: '删除支付卡',
            kind: 'warning',
            okLabel: '删除',
        });
        if (!ok) return;
        const res = await api.deletePaymentCard(card.id);
        if (res.success) {
            onNotify?.('已删除支付卡');
            await loadCards();
            onOverviewChanged?.();
        } else {
            onNotify?.(res.message || '删除失败', 'error');
        }
    };

    return (
        <div className="max-w-6xl mx-auto space-y-5 gm-view-enter">
            {/* 页头 */}
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h1 className="gm-title flex items-center gap-2">
                        <CreditCard size={20} style={{ color: 'var(--primary)' }} />
                        <span>U 卡与支付卡</span>
                    </h1>
                    <p className="gm-subtitle mt-1">
                        管理虚拟 U 卡与银行卡，支持点击翻转查看私密卡号/CVV、离线 BIN 银行识别与年费追踪。
                    </p>
                </div>
                <button type="button" onClick={openCreateModal} className="gm-btn gm-btn-primary">
                    <Plus size={14} />
                    <span>添加卡片</span>
                </button>
            </div>

            {/* 筛选栏 */}
            <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[200px]">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 gm-text-3" />
                    <input
                        type="text"
                        className="gm-input w-full pl-9"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="搜索卡名、发行方、尾号、地区或备注…"
                    />
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {CARD_REGION_GROUPS.map(g => (
                        <button
                            key={g.id}
                            type="button"
                            onClick={() => setRegionGroup(g.id)}
                            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                                regionGroup === g.id
                                    ? 'bg-[var(--primary-light)] text-[var(--primary)]'
                                    : 'gm-card gm-text-2 hover:text-[var(--text-primary)]'
                            }`}
                        >
                            {g.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* 卡片网格 */}
            {filteredCards.length === 0 ? (
                <div className="gm-card p-10 text-center text-[13px] gm-text-3">
                    {loading ? '正在加载卡片…' : '暂无支付卡记录，点击右上角「添加卡片」'}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                    {filteredCards.map(card => {
                        const appearance = cardAppearance(card.issuer || card.name, card.network, card.bankCode, {
                            lightMode: isLightMode,
                        });
                        const isFlipped = Boolean(flipped[card.id]);
                        const isRevealed = Boolean(revealed[card.id]);
                        const displayLast4 = card.last4 || '••••';
                        const lightCard = appearance.isLight;
                        const cnyFee = typeof card.billingAmount === 'number'
                            ? convertToCny(card.billingAmount, card.billingCurrency, fxRate)
                            : null;

                        return (
                            <div key={card.id} className="space-y-2.5">
                                <div style={{ perspective: '1200px' }}>
                                    <div
                                        style={{
                                            position: 'relative',
                                            height: '208px',
                                            transformStyle: 'preserve-3d',
                                            WebkitTransformStyle: 'preserve-3d',
                                            transition: 'transform 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
                                            transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
                                        }}
                                    >
                                        {/* 正面 */}
                                        <div
                                            data-card-face="front"
                                            data-card-theme={lightCard ? 'light' : 'dark'}
                                            onClick={() => setFlipped(prev => ({ ...prev, [card.id]: true }))}
                                            className={`absolute inset-0 rounded-2xl p-5 flex flex-col justify-between cursor-pointer overflow-hidden gm-pixel-card-face ${
                                                lightCard
                                                    ? 'text-slate-900 shadow-[0_10px_28px_rgba(15,23,42,0.08)]'
                                                    : 'text-white shadow-[0_14px_34px_rgba(0,0,0,0.45)]'
                                            }`}
                                            style={{
                                                background: appearance.background,
                                                border: `1px solid ${appearance.borderColor}`,
                                                backfaceVisibility: 'hidden',
                                                WebkitBackfaceVisibility: 'hidden',
                                                transform: 'rotateY(0deg) translateZ(1px)',
                                                zIndex: isFlipped ? 0 : 2,
                                            }}
                                        >
                                            {/* 像素微点装饰层 */}
                                            <div
                                                aria-hidden="true"
                                                className="pointer-events-none absolute inset-0"
                                                style={{
                                                    backgroundImage: lightCard
                                                        ? 'radial-gradient(rgba(15, 23, 42, 0.06) 1px, transparent 1px)'
                                                        : 'radial-gradient(rgba(255, 255, 255, 0.08) 1px, transparent 1px)',
                                                    backgroundSize: '8px 8px',
                                                    maskImage: 'linear-gradient(135deg, transparent 35%, black 100%)',
                                                    WebkitMaskImage: 'linear-gradient(135deg, transparent 35%, black 100%)',
                                                }}
                                            />

                                            <div className="relative flex items-start justify-between gap-2">
                                                <div className="flex items-center gap-2.5 min-w-0">
                                                    {appearance.issuerIconUrl ? (
                                                        <img
                                                            src={appearance.issuerIconUrl}
                                                            alt=""
                                                            className={`w-7 h-7 rounded-md p-1 object-contain shrink-0 ${
                                                                lightCard
                                                                    ? 'bg-white border border-slate-200/90 shadow-xs'
                                                                    : 'bg-white/95'
                                                            }`}
                                                        />
                                                    ) : (
                                                        <span
                                                            className={`w-7 h-7 rounded-md flex items-center justify-center text-[11px] font-bold font-mono shrink-0 ${
                                                                lightCard
                                                                    ? 'bg-slate-900/8 text-slate-800 border border-slate-900/12'
                                                                    : 'bg-white/15 text-white border border-white/15'
                                                            }`}
                                                        >
                                                            {appearance.mark}
                                                        </span>
                                                    )}
                                                    <div className="min-w-0">
                                                        <div className="text-[14.5px] font-semibold truncate">{card.name}</div>
                                                        <div
                                                            className={`text-[11px] truncate ${
                                                                lightCard ? 'text-slate-600' : 'text-white/70'
                                                            }`}
                                                        >
                                                            {card.issuer || '自定义发行方'}
                                                            {card.region ? ` · ${card.region}` : ''}
                                                        </div>
                                                    </div>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setFlipped(prev => ({ ...prev, [card.id]: true }));
                                                    }}
                                                    aria-label={`翻转 ${card.name} 查看背面`}
                                                    className={`text-[10.5px] px-2.5 py-1 rounded-md font-mono font-medium shrink-0 transition-colors cursor-pointer ${
                                                        lightCard
                                                            ? 'bg-slate-900/[0.07] hover:bg-slate-900/[0.13] text-slate-700 border border-slate-900/12'
                                                            : 'bg-white/12 hover:bg-white/20 text-white/90 border border-white/15'
                                                    }`}
                                                >
                                                    点击翻转
                                                </button>
                                            </div>

                                            <div className="relative flex items-center justify-between gap-3">
                                                <div
                                                    className={`font-mono text-lg tracking-widest font-semibold ${
                                                        lightCard ? 'text-slate-900' : 'text-white/95'
                                                    }`}
                                                >
                                                    •••• •••• •••• {displayLast4}
                                                </div>
                                                {/* 像素风 EMV 芯片徽记 */}
                                                <svg
                                                    width="26"
                                                    height="20"
                                                    viewBox="0 0 13 10"
                                                    shapeRendering="crispEdges"
                                                    aria-hidden="true"
                                                    className="shrink-0 opacity-85"
                                                >
                                                    <rect
                                                        x="1"
                                                        y="1"
                                                        width="11"
                                                        height="8"
                                                        fill={lightCard ? '#d9a441' : '#e5b869'}
                                                    />
                                                    <rect
                                                        x="2"
                                                        y="0"
                                                        width="9"
                                                        height="1"
                                                        fill={lightCard ? '#c38c28' : '#c99742'}
                                                    />
                                                    <rect
                                                        x="2"
                                                        y="9"
                                                        width="9"
                                                        height="1"
                                                        fill={lightCard ? '#c38c28' : '#c99742'}
                                                    />
                                                    <rect
                                                        x="4"
                                                        y="1"
                                                        width="1"
                                                        height="8"
                                                        fill={lightCard ? '#9a6b16' : '#8a601b'}
                                                    />
                                                    <rect
                                                        x="8"
                                                        y="1"
                                                        width="1"
                                                        height="8"
                                                        fill={lightCard ? '#9a6b16' : '#8a601b'}
                                                    />
                                                    <rect
                                                        x="1"
                                                        y="4"
                                                        width="3"
                                                        height="1"
                                                        fill={lightCard ? '#9a6b16' : '#8a601b'}
                                                    />
                                                    <rect
                                                        x="9"
                                                        y="4"
                                                        width="3"
                                                        height="1"
                                                        fill={lightCard ? '#9a6b16' : '#8a601b'}
                                                    />
                                                </svg>
                                            </div>

                                            <div
                                                className={`relative flex items-end justify-between text-[11.5px] ${
                                                    lightCard ? 'text-slate-600' : 'text-white/80'
                                                }`}
                                            >
                                                <div className="space-x-3 font-mono">
                                                    <span>有效期 {card.expiryMonth || '--/--'}</span>
                                                    {card.formFactor && <span>· {card.formFactor}</span>}
                                                </div>
                                                {appearance.networkIconUrl ? (
                                                    <img
                                                        src={appearance.networkIconUrl}
                                                        alt={card.network || ''}
                                                        className={`h-5 object-contain rounded px-1.5 py-0.5 ${
                                                            lightCard
                                                                ? 'bg-white border border-slate-200/80'
                                                                : 'bg-white/92'
                                                        }`}
                                                    />
                                                ) : (
                                                    <span className="font-semibold font-mono">{card.network || ''}</span>
                                                )}
                                            </div>
                                        </div>

                                        {/* 背面（私密信息） */}
                                        <div
                                            data-card-face="back"
                                            className="absolute inset-0 rounded-2xl p-4 flex flex-col justify-between bg-[var(--bg-elevated)] border border-[var(--border-strong)] shadow-lg"
                                            style={{
                                                backfaceVisibility: 'hidden',
                                                WebkitBackfaceVisibility: 'hidden',
                                                transform: 'rotateY(180deg) translateZ(1px)',
                                                zIndex: isFlipped ? 2 : 0,
                                            }}
                                        >
                                            <div className="flex items-center justify-between">
                                                <span className="text-[12px] font-semibold gm-text-1">{card.name} · 私密资料</span>
                                                <div className="flex items-center gap-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => setRevealed(prev => ({ ...prev, [card.id]: !prev[card.id] }))}
                                                        className="gm-btn gm-btn-ghost p-1"
                                                        aria-label={isRevealed ? `隐藏 ${card.name} 卡号` : `显示 ${card.name} 卡号`}
                                                    >
                                                        {isRevealed ? <EyeOff size={14} /> : <Eye size={14} />}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setFlipped(prev => ({ ...prev, [card.id]: false }))}
                                                        className="gm-btn gm-btn-ghost p-1"
                                                        aria-label={`翻回 ${card.name} 正面`}
                                                    >
                                                        <RotateCw size={14} />
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="space-y-1.5 text-[12px]">
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="gm-text-3">卡号</span>
                                                    <div className="flex items-center gap-1.5 font-mono gm-text-1">
                                                        <span>
                                                            {card.cardNumber
                                                                ? isRevealed
                                                                    ? formatCardNumberGroups(card.cardNumber)
                                                                    : `•••• •••• •••• ${displayLast4}`
                                                                : '未填写'}
                                                        </span>
                                                        {card.cardNumber && (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleCopy(card.cardNumber.replace(/\s+/g, ''), '卡号')}
                                                                className="gm-text-3 hover:text-[var(--primary)]"
                                                                aria-label={`复制 ${card.name} 卡号`}
                                                            >
                                                                <Copy size={12} />
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="gm-text-3">CVV / 安全码</span>
                                                    <div className="flex items-center gap-1.5 font-mono gm-text-1">
                                                        <span>{card.cvv ? (isRevealed ? card.cvv : '•••') : '未填写'}</span>
                                                        {card.cvv && (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleCopy(card.cvv, 'CVV')}
                                                                className="gm-text-3 hover:text-[var(--primary)]"
                                                                aria-label={`复制 ${card.name} CVV`}
                                                            >
                                                                <Copy size={12} />
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>

                                                {card.cardholder && (
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className="gm-text-3">持卡人</span>
                                                        <span className="gm-text-1 truncate">{card.cardholder}</span>
                                                    </div>
                                                )}

                                                {card.billingAddress && (
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className="gm-text-3 shrink-0">账单地址</span>
                                                        <div className="flex items-center gap-1 min-w-0">
                                                            <span className="gm-text-2 truncate">{card.billingAddress}</span>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleCopy(card.billingAddress, '账单地址')}
                                                                className="gm-text-3 hover:text-[var(--primary)] shrink-0"
                                                            >
                                                                <Copy size={12} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="text-[11px] gm-text-3 truncate">
                                                {card.notes || '无额外备注'}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* 卡片下方操作条 */}
                                <div className="flex items-center justify-between px-1 text-[11.5px] gm-text-3">
                                    <div className="flex items-center gap-2 truncate">
                                        {typeof card.billingAmount === 'number' && (
                                            <span className="font-mono text-[var(--text-secondary)]">
                                                {cnyFee !== null ? formatCnyAmount(cnyFee) : formatMoney(card.billingAmount, card.billingCurrency)}
                                                {card.billingCurrency === 'USD' && (
                                                    <span className="ml-1 text-[10.5px] gm-text-3">
                                                        ({formatMoney(card.billingAmount, 'USD')})
                                                    </span>
                                                )}
                                            </span>
                                        )}
                                        {card.expiresAt && <span className="font-mono">到期 {card.expiresAt}</span>}
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => openEditModal(card)}
                                            className="gm-btn gm-btn-ghost p-1"
                                            aria-label={`编辑 ${card.name}`}
                                        >
                                            <Edit3 size={13} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleDelete(card)}
                                            className="gm-btn gm-btn-ghost p-1 hover:text-[var(--danger)]"
                                            aria-label={`删除 ${card.name}`}
                                        >
                                            <Trash2 size={13} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* 添加/编辑弹窗 */}
            {modalOpen && renderInBody(
                <div className="gm-overlay" role="dialog" aria-modal="true" aria-label={editingId ? '编辑支付卡' : '添加支付卡'}>
                    <div className="gm-panel w-full max-w-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between">
                            <h3 className="text-[15px] font-semibold gm-text-1">
                                {editingId ? '编辑支付卡' : '添加支付卡'}
                            </h3>
                            <button
                                type="button"
                                onClick={() => setModalOpen(false)}
                                className="gm-btn gm-btn-ghost p-1"
                                aria-label="关闭"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <form onSubmit={handleSave} className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">卡片名称 *</label>
                                    <input
                                        type="text"
                                        className="gm-input w-full"
                                        value={form.name}
                                        onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                                        placeholder="例如：RedotPay 港卡"
                                        required
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">完整卡号 / BIN 前缀</label>
                                    <input
                                        type="text"
                                        className="gm-input w-full font-mono"
                                        value={form.cardNumber}
                                        onChange={(e) => setForm(prev => ({ ...prev, cardNumber: e.target.value }))}
                                        placeholder="输入卡号自动识别银行/卡组织"
                                    />
                                </div>
                            </div>

                            {binSuggestion && (
                                <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[var(--primary-light)] text-[12px]">
                                    <span className="flex items-center gap-1.5" style={{ color: 'var(--primary)' }}>
                                        <Sparkles size={13} />
                                        <span>
                                            识别到：
                                            {binSuggestion.bank ? `${binSuggestion.bank.issuer} (${binSuggestion.bank.code})` : ''}
                                            {binSuggestion.bank && binSuggestion.network ? ' · ' : ''}
                                            {binSuggestion.network || ''}
                                        </span>
                                    </span>
                                    <button
                                        type="button"
                                        onClick={applyBinSuggestion}
                                        className="gm-btn gm-btn-primary gm-btn-sm"
                                    >
                                        应用识别结果
                                    </button>
                                </div>
                            )}

                            <div className="grid grid-cols-3 gap-3">
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">发行方 / 银行</label>
                                    <input
                                        type="text"
                                        className="gm-input w-full"
                                        value={form.issuer}
                                        onChange={(e) => setForm(prev => ({ ...prev, issuer: e.target.value }))}
                                        placeholder="RedotPay / 招商银行"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">卡组织</label>
                                    <select
                                        className="gm-input w-full"
                                        value={form.network}
                                        onChange={(e) => setForm(prev => ({ ...prev, network: e.target.value }))}
                                    >
                                        <option value="">未选择</option>
                                        {CARD_NETWORKS.map(n => (
                                            <option key={n} value={n}>{n}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">发卡地区</label>
                                    <input
                                        type="text"
                                        list="gm-card-regions"
                                        className="gm-input w-full"
                                        value={form.region}
                                        onChange={(e) => setForm(prev => ({ ...prev, region: e.target.value, regionGroup: '' }))}
                                        placeholder="中国香港 / 美国"
                                    />
                                    <datalist id="gm-card-regions">
                                        {CARD_REGIONS.map(r => <option key={r} value={r} />)}
                                    </datalist>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-3">
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">卡面有效期 (MM/YY)</label>
                                    <input
                                        type="text"
                                        className="gm-input w-full font-mono"
                                        value={form.expiryMonth}
                                        onChange={(e) => setForm(prev => ({ ...prev, expiryMonth: e.target.value }))}
                                        placeholder="12/29"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">CVV 安全码</label>
                                    <input
                                        type="text"
                                        className="gm-input w-full font-mono"
                                        value={form.cvv}
                                        onChange={(e) => setForm(prev => ({ ...prev, cvv: e.target.value }))}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">形态</label>
                                    <input
                                        type="text"
                                        className="gm-input w-full"
                                        value={form.formFactor}
                                        onChange={(e) => setForm(prev => ({ ...prev, formFactor: e.target.value }))}
                                        placeholder="虚拟卡 / 实体卡"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">持卡人姓名</label>
                                    <input
                                        type="text"
                                        className="gm-input w-full"
                                        value={form.cardholder}
                                        onChange={(e) => setForm(prev => ({ ...prev, cardholder: e.target.value }))}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">账单地址</label>
                                    <input
                                        type="text"
                                        className="gm-input w-full"
                                        value={form.billingAddress}
                                        onChange={(e) => setForm(prev => ({ ...prev, billingAddress: e.target.value }))}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-4 gap-2">
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">年费/管理费</label>
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
                                        <option value="year">年付</option>
                                        <option value="month">月付</option>
                                        <option value="once">一次性</option>
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">到期提醒日</label>
                                    <input
                                        type="date"
                                        min={DATE_INPUT_MIN}
                                        max={DATE_INPUT_MAX}
                                        className="gm-input w-full"
                                        value={form.expiresAt}
                                        onChange={(e) => setForm(prev => ({ ...prev, expiresAt: clampDateInputValue(e.target.value) }))}
                                    />
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
        </div>
    );
};

export default CardsView;
