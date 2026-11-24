import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Globe,
    Cloud,
    RefreshCw,
    Plus,
    Edit3,
    Trash2,
    Search,
    X,
    Check,
    AlertTriangle,
} from 'lucide-react';
import api from '../services/api';
import { confirmDialog } from '../utils/dialogs';
import { renderInBody } from '../utils/portal';
import { resolveBrandIconUrl } from '../utils/brandIcons';
import { daysUntilDay, formatCycleLabel, formatDaysBadge, formatMoney } from '../utils/renewalUtils';

const EMPTY_DOMAIN_FORM = {
    name: '',
    registrar: '',
    autoRenew: false,
    billingAmount: '',
    billingCurrency: 'USD',
    billingCycle: 'year',
    expiresAt: '',
    serverId: '',
    tags: '',
    notes: '',
};

const EMPTY_DNS_FORM = {
    type: 'A',
    name: '',
    content: '',
    ttl: 1,
    proxied: true,
    priority: 10,
    comment: '',
};

const BADGE_STYLE = {
    danger: { background: 'var(--danger-soft)', color: 'var(--danger)' },
    warning: { background: 'var(--warning-soft)', color: 'var(--warning)' },
    accent: { background: 'var(--primary-light)', color: 'var(--primary)' },
    muted: { background: 'var(--bg-elevated)', color: 'var(--text-secondary)' },
};

const DomainsView = ({ servers = [], onNotify, onOverviewChanged }) => {
    const [domains, setDomains] = useState([]);
    const [connections, setConnections] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [probingId, setProbingId] = useState(null);

    // 域名增改弹窗
    const [domainModalOpen, setDomainModalOpen] = useState(false);
    const [editingDomainId, setEditingDomainId] = useState(null);
    const [domainForm, setDomainForm] = useState(EMPTY_DOMAIN_FORM);
    const [savingDomain, setSavingDomain] = useState(false);

    // Cloudflare 连接与导入弹窗
    const [cfModalOpen, setCfModalOpen] = useState(false);
    const [cfName, setCfName] = useState('');
    const [cfToken, setCfToken] = useState('');
    const [savingCf, setSavingCf] = useState(false);
    const [scanningConnId, setScanningConnId] = useState(null);
    const [scannedZones, setScannedZones] = useState([]);
    const [selectedZoneIds, setSelectedZoneIds] = useState({});

    // DNS 管理与变更预览弹窗
    const [dnsDomain, setDnsDomain] = useState(null);
    const [dnsRecords, setDnsRecords] = useState([]);
    const [dnsLoading, setDnsLoading] = useState(false);
    const [dnsEditingId, setDnsEditingId] = useState(null);
    const [dnsForm, setDnsForm] = useState(EMPTY_DNS_FORM);
    const [dnsPreview, setDnsPreview] = useState(null); // { action, recordId, before, after }
    const [dnsApplying, setDnsApplying] = useState(false);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [dRes, cRes] = await Promise.all([
                api.getDomains(),
                api.getCloudflareConnections(),
            ]);
            if (dRes.success && Array.isArray(dRes.data)) setDomains(dRes.data);
            if (cRes.success && Array.isArray(cRes.data)) setConnections(cRes.data);
        } catch (err) {
            onNotify?.(err instanceof Error ? err.message : '加载域名失败', 'error');
        } finally {
            setLoading(false);
        }
    }, [onNotify]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const filteredDomains = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return domains;
        return domains.filter(d =>
            [d.name, d.registrar, ...(d.nameservers || []), d.tags, d.notes]
                .some(v => String(v ?? '').toLowerCase().includes(q)),
        );
    }, [domains, search]);

    const serverMap = useMemo(
        () => Object.fromEntries(servers.map(s => [s.id, s.name])),
        [servers],
    );

    const openCreateDomain = () => {
        setEditingDomainId(null);
        setDomainForm(EMPTY_DOMAIN_FORM);
        setDomainModalOpen(true);
    };

    const openEditDomain = (dom) => {
        setEditingDomainId(dom.id);
        setDomainForm({
            name: dom.name || '',
            registrar: dom.registrar || '',
            autoRenew: Boolean(dom.autoRenew),
            billingAmount: dom.billingAmount != null ? String(dom.billingAmount) : '',
            billingCurrency: dom.billingCurrency || 'USD',
            billingCycle: dom.billingCycle || 'year',
            expiresAt: dom.expiresAt || '',
            serverId: dom.serverId != null ? String(dom.serverId) : '',
            tags: dom.tags || '',
            notes: dom.notes || '',
        });
        setDomainModalOpen(true);
    };

    const handleSaveDomain = async (e) => {
        e.preventDefault();
        if (!domainForm.name.trim()) {
            onNotify?.('请填写域名', 'error');
            return;
        }
        setSavingDomain(true);
        try {
            const amt = domainForm.billingAmount.trim() ? Number(domainForm.billingAmount) : null;
            const payload = {
                name: domainForm.name.trim(),
                registrar: domainForm.registrar.trim() || null,
                autoRenew: Boolean(domainForm.autoRenew),
                billingAmount: Number.isFinite(amt) ? amt : null,
                billingCurrency: domainForm.billingCurrency || 'USD',
                billingCycle: domainForm.billingCycle || 'year',
                expiresAt: domainForm.expiresAt.trim() || null,
                serverId: domainForm.serverId ? Number(domainForm.serverId) : null,
                tags: domainForm.tags.trim() || null,
                notes: domainForm.notes.trim() || null,
            };
            const res = editingDomainId
                ? await api.updateDomain(editingDomainId, payload)
                : await api.createDomain(payload);
            if (res.success) {
                onNotify?.(editingDomainId ? '域名已更新' : '域名已添加');
                setDomainModalOpen(false);
                await loadData();
                onOverviewChanged?.();
            } else {
                onNotify?.(res.message || '保存失败', 'error');
            }
        } finally {
            setSavingDomain(false);
        }
    };

    const handleDeleteDomain = async (dom) => {
        const ok = await confirmDialog(`确定删除域名「${dom.name}」吗？（不会影响远端 DNS 或注册商记录）`, {
            title: '删除域名',
            kind: 'warning',
            okLabel: '删除',
        });
        if (!ok) return;
        const res = await api.deleteDomain(dom.id);
        if (res.success) {
            onNotify?.('已删除域名');
            await loadData();
            onOverviewChanged?.();
        } else {
            onNotify?.(res.message || '删除失败', 'error');
        }
    };

    const handleProbeDomain = async (dom) => {
        setProbingId(dom.id);
        try {
            const res = await api.probeDomain(dom.id);
            if (res.success && res.data) {
                setDomains(prev => prev.map(d => (d.id === dom.id ? res.data : d)));
                if (res.data.probeError) {
                    onNotify?.(`探测 ${dom.name} 失败：${res.data.probeError}`, 'error');
                } else {
                    onNotify?.(`已刷新 ${dom.name} WHOIS 与 NS 记录`);
                }
                onOverviewChanged?.();
            } else {
                onNotify?.(res.message || '探测失败', 'error');
            }
        } finally {
            setProbingId(null);
        }
    };

    // Cloudflare 连接
    const handleAddCloudflareConn = async (e) => {
        e.preventDefault();
        if (!cfName.trim() || !cfToken.trim()) {
            onNotify?.('请填写连接名称与 API Token', 'error');
            return;
        }
        setSavingCf(true);
        try {
            const res = await api.saveCloudflareConnection(null, {
                name: cfName.trim(),
                apiToken: cfToken.trim(),
            });
            if (res.success) {
                setCfName('');
                setCfToken('');
                onNotify?.('Cloudflare 连接验证并保存成功');
                await loadData();
            } else {
                onNotify?.(res.message || 'Cloudflare 连接失败', 'error');
            }
        } finally {
            setSavingCf(false);
        }
    };

    const handleScanZones = async (connId) => {
        setScanningConnId(connId);
        setScannedZones([]);
        try {
            const res = await api.listCloudflareZones(connId);
            if (res.success && Array.isArray(res.data)) {
                setScannedZones(res.data);
                const initSel = {};
                for (const z of res.data) initSel[z.zoneId] = true;
                setSelectedZoneIds(initSel);
            } else {
                onNotify?.(res.message || '读取 Cloudflare 域名失败', 'error');
            }
        } finally {
            setScanningConnId(null);
        }
    };

    const handleImportZones = async (connId) => {
        const chosen = scannedZones.filter(z => selectedZoneIds[z.zoneId]);
        if (chosen.length === 0) {
            onNotify?.('请至少选择一个域名', 'error');
            return;
        }
        const res = await api.importCloudflareZones(connId, chosen);
        if (res.success) {
            onNotify?.(`已导入/绑定 ${res.data} 个 Cloudflare 域名`);
            setScannedZones([]);
            await loadData();
            onOverviewChanged?.();
        } else {
            onNotify?.(res.message || '导入失败', 'error');
        }
    };

    const handleDeleteCfConn = async (conn) => {
        const ok = await confirmDialog(`移除 Cloudflare 连接「${conn.name}」？已导入的域名记录会保留。`, {
            title: '移除 Cloudflare 连接',
            kind: 'warning',
            okLabel: '移除',
        });
        if (!ok) return;
        const res = await api.deleteCloudflareConnection(conn.id);
        if (res.success) {
            onNotify?.('已移除 Cloudflare 连接');
            await loadData();
        }
    };

    // DNS 记录管理
    const openDnsManager = async (dom) => {
        setDnsDomain(dom);
        setDnsRecords([]);
        setDnsEditingId(null);
        setDnsForm({ ...EMPTY_DNS_FORM, name: dom.name });
        setDnsPreview(null);
        setDnsLoading(true);
        try {
            const res = await api.listDomainDnsRecords(dom.id);
            if (res.success && Array.isArray(res.data)) {
                setDnsRecords(res.data);
            } else {
                onNotify?.(res.message || '加载 DNS 记录失败', 'error');
            }
        } finally {
            setDnsLoading(false);
        }
    };

    const handlePreviewDnsSave = (e) => {
        e.preventDefault();
        const before = dnsEditingId
            ? dnsRecords.find(r => r.id === dnsEditingId) || null
            : null;
        const after = {
            type: dnsForm.type,
            name: dnsForm.name.trim(),
            content: dnsForm.content,
            ttl: Number(dnsForm.ttl) || 1,
            ...(['A', 'AAAA', 'CNAME'].includes(dnsForm.type) ? { proxied: Boolean(dnsForm.proxied) } : {}),
            ...(dnsForm.type === 'MX' ? { priority: Number(dnsForm.priority) || 10 } : {}),
            ...(dnsForm.comment.trim() ? { comment: dnsForm.comment.trim() } : {}),
        };
        setDnsPreview({
            action: dnsEditingId ? 'update' : 'create',
            recordId: dnsEditingId,
            before,
            after,
        });
    };

    const handlePreviewDnsDelete = (record) => {
        setDnsPreview({
            action: 'delete',
            recordId: record.id,
            before: record,
            after: null,
        });
    };

    const handleApplyDnsPreview = async () => {
        if (!dnsDomain || !dnsPreview) return;
        setDnsApplying(true);
        try {
            const res = await api.applyDomainDnsRecord(
                dnsDomain.id,
                dnsPreview.action,
                dnsPreview.recordId,
                dnsPreview.after,
            );
            if (res.success) {
                onNotify?.('DNS 变更已应用');
                setDnsPreview(null);
                setDnsEditingId(null);
                setDnsForm({ ...EMPTY_DNS_FORM, name: dnsDomain.name });
                const listRes = await api.listDomainDnsRecords(dnsDomain.id);
                if (listRes.success && Array.isArray(listRes.data)) {
                    setDnsRecords(listRes.data);
                }
            } else {
                onNotify?.(res.message || 'DNS 变更失败', 'error');
            }
        } finally {
            setDnsApplying(false);
        }
    };

    return (
        <div className="max-w-6xl mx-auto space-y-5 gm-view-enter">
            {/* 页头 */}
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h1 className="gm-title flex items-center gap-2">
                        <Globe size={20} style={{ color: 'var(--primary)' }} />
                        <span>域名管理</span>
                    </h1>
                    <p className="gm-subtitle mt-1">
                        管理域名到期与费用，一键 WHOIS / DoH NS 探测，支持 Cloudflare 账户导入与 DNS 记录预览编辑。
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setCfModalOpen(true)}
                        className="gm-btn gm-btn-ghost"
                    >
                        <Cloud size={14} />
                        <span>Cloudflare ({connections.length})</span>
                    </button>
                    <button type="button" onClick={openCreateDomain} className="gm-btn gm-btn-primary">
                        <Plus size={14} />
                        <span>添加域名</span>
                    </button>
                </div>
            </div>

            {/* 搜索 */}
            <div className="relative max-w-md">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 gm-text-3" />
                <input
                    type="text"
                    className="gm-input w-full pl-9"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="搜索域名、注册商、NS 或备注…"
                />
            </div>

            {/* 域名列表 */}
            {filteredDomains.length === 0 ? (
                <div className="gm-card p-10 text-center text-[13px] gm-text-3">
                    {loading ? '正在加载域名…' : '暂无域名记录，可手动添加或通过 Cloudflare 连接导入'}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {filteredDomains.map(dom => {
                        const days = dom.expiresAt ? daysUntilDay(dom.expiresAt) : null;
                        const badge = days != null ? formatDaysBadge(days) : null;
                        const regIcon = resolveBrandIconUrl([dom.registrar]);
                        return (
                            <div key={dom.id} className="gm-card p-4 space-y-3">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex items-center gap-2.5 min-w-0">
                                        {regIcon ? (
                                            <img
                                                src={regIcon}
                                                alt=""
                                                className="w-7 h-7 rounded-md bg-white/10 p-1 object-contain shrink-0"
                                            />
                                        ) : (
                                            <div className="w-7 h-7 rounded-md bg-[var(--bg-elevated)] flex items-center justify-center shrink-0">
                                                <Globe size={14} className="gm-text-3" />
                                            </div>
                                        )}
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <h3 className="text-[14.5px] font-semibold gm-text-1 truncate font-mono">
                                                    {dom.name}
                                                </h3>
                                                {dom.cfZoneId && (
                                                    <span className="gm-chip gm-chip-accent">CF</span>
                                                )}
                                                {dom.autoRenew && (
                                                    <span className="gm-chip">自动续费</span>
                                                )}
                                            </div>
                                            <div className="text-[11.5px] gm-text-3 truncate">
                                                {dom.registrar || '未知注册商'}
                                                {dom.serverId && serverMap[dom.serverId] ? ` · 绑定主机 ${serverMap[dom.serverId]}` : ''}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => handleProbeDomain(dom)}
                                            disabled={probingId === dom.id}
                                            className="gm-btn gm-btn-ghost p-1.5"
                                            title="WHOIS/NS 探测刷新"
                                            aria-label={`探测 ${dom.name}`}
                                        >
                                            <RefreshCw size={13} className={probingId === dom.id ? 'animate-spin' : ''} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => openEditDomain(dom)}
                                            className="gm-btn gm-btn-ghost p-1.5"
                                            aria-label={`编辑 ${dom.name}`}
                                        >
                                            <Edit3 size={13} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleDeleteDomain(dom)}
                                            className="gm-btn gm-btn-ghost p-1.5 hover:text-[var(--danger)]"
                                            aria-label={`删除 ${dom.name}`}
                                        >
                                            <Trash2 size={13} />
                                        </button>
                                    </div>
                                </div>

                                <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                                    <div className="flex items-center gap-2 font-mono gm-text-2">
                                        <span>到期: {dom.expiresAt || '未填写'}</span>
                                        {typeof dom.billingAmount === 'number' && (
                                            <span>
                                                · {formatMoney(dom.billingAmount, dom.billingCurrency)}/{formatCycleLabel(dom.billingCycle)}
                                            </span>
                                        )}
                                    </div>
                                    {badge && (
                                        <span className="px-2 py-0.5 rounded text-[11px] font-medium" style={BADGE_STYLE[badge.tone]}>
                                            {badge.text}
                                        </span>
                                    )}
                                </div>

                                {dom.nameservers?.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                        {dom.nameservers.slice(0, 4).map(ns => (
                                            <span key={ns} className="gm-chip font-mono text-[10.5px]">{ns}</span>
                                        ))}
                                    </div>
                                )}

                                {dom.probeError && (
                                    <div className="text-[11.5px]" style={{ color: 'var(--warning)' }}>
                                        上次探测异常：{dom.probeError}
                                    </div>
                                )}

                                {dom.cfConnectionId && dom.cfZoneId && (
                                    <div className="pt-1 flex justify-end">
                                        <button
                                            type="button"
                                            onClick={() => openDnsManager(dom)}
                                            className="gm-btn gm-btn-secondary gm-btn-sm"
                                        >
                                            <Cloud size={12} />
                                            <span>管理 DNS</span>
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* 添加/编辑域名弹窗 */}
            {domainModalOpen && renderInBody(
                <div className="gm-overlay" role="dialog" aria-modal="true" aria-label={editingDomainId ? '编辑域名' : '添加域名'}>
                    <div className="gm-panel w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between">
                            <h3 className="text-[15px] font-semibold gm-text-1">
                                {editingDomainId ? '编辑域名' : '添加域名'}
                            </h3>
                            <button type="button" onClick={() => setDomainModalOpen(false)} className="gm-btn gm-btn-ghost p-1" aria-label="关闭">
                                <X size={16} />
                            </button>
                        </div>

                        <form onSubmit={handleSaveDomain} className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">域名 *</label>
                                    <input
                                        type="text"
                                        className="gm-input w-full font-mono"
                                        value={domainForm.name}
                                        onChange={(e) => setDomainForm(prev => ({ ...prev, name: e.target.value }))}
                                        placeholder="example.com"
                                        required
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">注册商</label>
                                    <input
                                        type="text"
                                        className="gm-input w-full"
                                        value={domainForm.registrar}
                                        onChange={(e) => setDomainForm(prev => ({ ...prev, registrar: e.target.value }))}
                                        placeholder="Cloudflare / Namecheap / Porkbun"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-4 gap-2">
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">续费金额</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        className="gm-input w-full"
                                        value={domainForm.billingAmount}
                                        onChange={(e) => setDomainForm(prev => ({ ...prev, billingAmount: e.target.value }))}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">币种</label>
                                    <select
                                        className="gm-input w-full"
                                        value={domainForm.billingCurrency}
                                        onChange={(e) => setDomainForm(prev => ({ ...prev, billingCurrency: e.target.value }))}
                                    >
                                        <option value="USD">USD</option>
                                        <option value="CNY">CNY</option>
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">周期</label>
                                    <select
                                        className="gm-input w-full"
                                        value={domainForm.billingCycle}
                                        onChange={(e) => setDomainForm(prev => ({ ...prev, billingCycle: e.target.value }))}
                                    >
                                        <option value="year">年付</option>
                                        <option value="month">月付</option>
                                        <option value="once">一次性</option>
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">到期日</label>
                                    <input
                                        type="date"
                                        className="gm-input w-full"
                                        value={domainForm.expiresAt}
                                        onChange={(e) => setDomainForm(prev => ({ ...prev, expiresAt: e.target.value }))}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3 items-end">
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">关联服务器（可选）</label>
                                    <select
                                        className="gm-input w-full"
                                        value={domainForm.serverId}
                                        onChange={(e) => setDomainForm(prev => ({ ...prev, serverId: e.target.value }))}
                                    >
                                        <option value="">不关联</option>
                                        {servers.map(s => (
                                            <option key={s.id} value={s.id}>{s.name} ({s.host})</option>
                                        ))}
                                    </select>
                                </div>
                                <label className="flex items-center gap-2 text-[12.5px] gm-text-2 pb-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        className="gm-checkbox"
                                        checked={domainForm.autoRenew}
                                        onChange={(e) => setDomainForm(prev => ({ ...prev, autoRenew: e.target.checked }))}
                                    />
                                    <span>已开启自动续费</span>
                                </label>
                            </div>

                            <div className="space-y-1">
                                <label className="text-[12px] gm-text-2">备注</label>
                                <textarea
                                    rows={2}
                                    className="gm-input w-full"
                                    value={domainForm.notes}
                                    onChange={(e) => setDomainForm(prev => ({ ...prev, notes: e.target.value }))}
                                />
                            </div>

                            <div className="flex justify-end gap-2 pt-2">
                                <button type="button" onClick={() => setDomainModalOpen(false)} className="gm-btn gm-btn-ghost">
                                    取消
                                </button>
                                <button type="submit" disabled={savingDomain} className="gm-btn gm-btn-primary">
                                    {savingDomain ? '保存中…' : '保存'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>,
            )}

            {/* Cloudflare 连接管理与导入弹窗 */}
            {cfModalOpen && renderInBody(
                <div className="gm-overlay" role="dialog" aria-modal="true" aria-label="Cloudflare 连接管理">
                    <div className="gm-panel w-full max-w-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between">
                            <h3 className="text-[15px] font-semibold gm-text-1">Cloudflare 连接与域名导入</h3>
                            <button type="button" onClick={() => setCfModalOpen(false)} className="gm-btn gm-btn-ghost p-1" aria-label="关闭">
                                <X size={16} />
                            </button>
                        </div>

                        <form onSubmit={handleAddCloudflareConn} className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                            <input
                                type="text"
                                className="gm-input sm:col-span-4"
                                value={cfName}
                                onChange={(e) => setCfName(e.target.value)}
                                placeholder="连接名称（如：主号）"
                                required
                            />
                            <input
                                type="password"
                                className="gm-input sm:col-span-6 font-mono"
                                value={cfToken}
                                onChange={(e) => setCfToken(e.target.value)}
                                placeholder="粘贴 Cloudflare API Token"
                                required
                            />
                            <button type="submit" disabled={savingCf} className="gm-btn gm-btn-primary sm:col-span-2">
                                {savingCf ? '验证中…' : '添加'}
                            </button>
                        </form>

                        {connections.length > 0 && (
                            <div className="space-y-2">
                                {connections.map(conn => (
                                    <div key={conn.id} className="p-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-light)] space-y-2">
                                        <div className="flex items-center justify-between gap-2">
                                            <div>
                                                <div className="text-[13px] font-semibold gm-text-1">{conn.name}</div>
                                                <div className="text-[11.5px] gm-text-3 font-mono">
                                                    {conn.tokenHint} {conn.accountSummary ? `· ${conn.accountSummary}` : ''}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <button
                                                    type="button"
                                                    onClick={() => handleScanZones(conn.id)}
                                                    disabled={scanningConnId === conn.id}
                                                    className="gm-btn gm-btn-secondary gm-btn-sm"
                                                >
                                                    <RefreshCw size={12} className={scanningConnId === conn.id ? 'animate-spin' : ''} />
                                                    <span>读取域名</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDeleteCfConn(conn)}
                                                    className="gm-btn gm-btn-ghost p-1 hover:text-[var(--danger)]"
                                                    aria-label={`删除连接 ${conn.name}`}
                                                >
                                                    <Trash2 size={13} />
                                                </button>
                                            </div>
                                        </div>

                                        {scannedZones.length > 0 && (
                                            <div className="space-y-2 pt-2 border-t border-[var(--border-light)]">
                                                <div className="max-h-48 overflow-y-auto space-y-1">
                                                    {scannedZones.map(z => (
                                                        <label key={z.zoneId} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-[var(--bg-hover)] text-[12px] cursor-pointer">
                                                            <span className="flex items-center gap-2">
                                                                <input
                                                                    type="checkbox"
                                                                    className="gm-checkbox"
                                                                    checked={Boolean(selectedZoneIds[z.zoneId])}
                                                                    onChange={() =>
                                                                        setSelectedZoneIds(prev => ({
                                                                            ...prev,
                                                                            [z.zoneId]: !prev[z.zoneId],
                                                                        }))
                                                                    }
                                                                />
                                                                <span className="font-mono gm-text-1">{z.name}</span>
                                                            </span>
                                                            <span className="gm-chip">{z.status}</span>
                                                        </label>
                                                    ))}
                                                </div>
                                                <div className="flex justify-end">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleImportZones(conn.id)}
                                                        className="gm-btn gm-btn-primary gm-btn-sm"
                                                    >
                                                        导入勾选域名
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>,
            )}

            {/* DNS 管理弹窗（含强制变更预览确认） */}
            {dnsDomain && renderInBody(
                <div className="gm-overlay" role="dialog" aria-modal="true" aria-label={`管理 DNS - ${dnsDomain.name}`}>
                    <div className="gm-panel w-full max-w-3xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between">
                            <h3 className="text-[15px] font-semibold gm-text-1 font-mono">
                                DNS 管理 · {dnsDomain.name}
                            </h3>
                            <button type="button" onClick={() => setDnsDomain(null)} className="gm-btn gm-btn-ghost p-1" aria-label="关闭">
                                <X size={16} />
                            </button>
                        </div>

                        {/* 新增/编辑 DNS 表单 */}
                        <form onSubmit={handlePreviewDnsSave} className="p-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-light)] space-y-2.5">
                            <div className="text-[12px] font-semibold gm-text-2">
                                {dnsEditingId ? '编辑 DNS 记录' : '新增 DNS 记录'}
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                                <select
                                    className="gm-input sm:col-span-2"
                                    value={dnsForm.type}
                                    onChange={(e) => setDnsForm(prev => ({ ...prev, type: e.target.value }))}
                                >
                                    {['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS'].map(t => (
                                        <option key={t} value={t}>{t}</option>
                                    ))}
                                </select>
                                <input
                                    type="text"
                                    className="gm-input sm:col-span-4 font-mono text-[12px]"
                                    value={dnsForm.name}
                                    onChange={(e) => setDnsForm(prev => ({ ...prev, name: e.target.value }))}
                                    placeholder={`完整域名如 www.${dnsDomain.name}`}
                                    required
                                />
                                <input
                                    type="text"
                                    className="gm-input sm:col-span-4 font-mono text-[12px]"
                                    value={dnsForm.content}
                                    onChange={(e) => setDnsForm(prev => ({ ...prev, content: e.target.value }))}
                                    placeholder="记录值 (IP / 目标主机 / TXT)"
                                    required
                                />
                                <input
                                    type="number"
                                    className="gm-input sm:col-span-2 font-mono text-[12px]"
                                    value={dnsForm.ttl}
                                    onChange={(e) => setDnsForm(prev => ({ ...prev, ttl: Number(e.target.value) }))}
                                    placeholder="TTL(1=自动)"
                                />
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-3 text-[12px] gm-text-2">
                                    {['A', 'AAAA', 'CNAME'].includes(dnsForm.type) && (
                                        <label className="flex items-center gap-1.5 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                className="gm-checkbox"
                                                checked={dnsForm.proxied}
                                                onChange={(e) =>
                                                    setDnsForm(prev => ({
                                                        ...prev,
                                                        proxied: e.target.checked,
                                                        ttl: e.target.checked ? 1 : prev.ttl,
                                                    }))
                                                }
                                            />
                                            <span>CF 代理 (小云朵)</span>
                                        </label>
                                    )}
                                    {dnsForm.type === 'MX' && (
                                        <label className="flex items-center gap-1.5">
                                            <span>优先级</span>
                                            <input
                                                type="number"
                                                className="gm-input w-20 text-[12px]"
                                                value={dnsForm.priority}
                                                onChange={(e) => setDnsForm(prev => ({ ...prev, priority: Number(e.target.value) }))}
                                            />
                                        </label>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    {dnsEditingId && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setDnsEditingId(null);
                                                setDnsForm({ ...EMPTY_DNS_FORM, name: dnsDomain.name });
                                            }}
                                            className="gm-btn gm-btn-ghost gm-btn-sm"
                                        >
                                            取消编辑
                                        </button>
                                    )}
                                    <button type="submit" className="gm-btn gm-btn-primary gm-btn-sm">
                                        预览变更
                                    </button>
                                </div>
                            </div>
                        </form>

                        {/* 变更预览确认框 */}
                        {dnsPreview && (
                            <div className="p-3.5 rounded-lg border space-y-2.5" style={{ borderColor: 'var(--warning)', background: 'var(--warning-soft)' }}>
                                <div className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: 'var(--warning)' }}>
                                    <AlertTriangle size={15} />
                                    <span>
                                        确认{dnsPreview.action === 'create' ? '新增' : dnsPreview.action === 'update' ? '修改' : '删除'} DNS 记录？
                                    </span>
                                </div>
                                {dnsPreview.before && (
                                    <div className="text-[12px] font-mono gm-text-2">
                                        变更前：{dnsPreview.before.type} {dnsPreview.before.name} → {dnsPreview.before.content} (TTL {dnsPreview.before.ttl})
                                    </div>
                                )}
                                {dnsPreview.after && (
                                    <div className="text-[12px] font-mono gm-text-1">
                                        变更后：{dnsPreview.after.type} {dnsPreview.after.name} → {dnsPreview.after.content} (TTL {dnsPreview.after.ttl})
                                    </div>
                                )}
                                <div className="flex justify-end gap-2">
                                    <button type="button" onClick={() => setDnsPreview(null)} className="gm-btn gm-btn-ghost gm-btn-sm">
                                        取消
                                    </button>
                                    <button
                                        type="button"
                                        disabled={dnsApplying}
                                        onClick={handleApplyDnsPreview}
                                        className="gm-btn gm-btn-primary gm-btn-sm"
                                    >
                                        <Check size={12} />
                                        <span>{dnsApplying ? '应用中…' : '确认应用变更'}</span>
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* 现有记录表 */}
                        {dnsLoading ? (
                            <div className="py-8 text-center text-[13px] gm-text-3">正在读取 Cloudflare DNS 记录…</div>
                        ) : dnsRecords.length === 0 ? (
                            <div className="py-8 text-center text-[13px] gm-text-3">暂无 DNS 记录</div>
                        ) : (
                            <div className="border border-[var(--border)] rounded-lg overflow-hidden divide-y divide-[var(--border-light)]">
                                {dnsRecords.map(rec => (
                                    <div key={rec.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[12px]">
                                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                            <span className="gm-chip font-mono w-14 justify-center shrink-0">{rec.type}</span>
                                            <span className="font-mono gm-text-1 truncate max-w-[180px]">{rec.name}</span>
                                            <span className="font-mono gm-text-2 truncate flex-1">{rec.content}</span>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            {rec.proxied != null && (
                                                <span className="text-[11px] gm-text-3">{rec.proxied ? '代理' : '仅DNS'}</span>
                                            )}
                                            {['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS'].includes(rec.type) && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setDnsEditingId(rec.id);
                                                        setDnsForm({
                                                            type: rec.type,
                                                            name: rec.name,
                                                            content: rec.content,
                                                            ttl: rec.ttl,
                                                            proxied: Boolean(rec.proxied),
                                                            priority: rec.priority ?? 10,
                                                            comment: rec.comment || '',
                                                        });
                                                    }}
                                                    className="gm-btn gm-btn-ghost p-1"
                                                    aria-label={`编辑 DNS ${rec.name}`}
                                                >
                                                    <Edit3 size={12} />
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => handlePreviewDnsDelete(rec)}
                                                className="gm-btn gm-btn-ghost p-1 hover:text-[var(--danger)]"
                                                aria-label={`删除 DNS ${rec.name}`}
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>,
            )}
        </div>
    );
};

export default DomainsView;
