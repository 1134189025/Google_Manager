import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    CalendarClock,
    Check,
    Download,
    Plus,
    RefreshCw,
    Trash2,
    Edit3,
    Bell,
    Clock,
    Wallet,
    X,
} from 'lucide-react';
import api from '../services/api';
import { confirmDialog } from '../utils/dialogs';
import { renderInBody } from '../utils/portal';
import { isTauriRuntime } from '../utils/tauriRuntime';
import {
    buildRenewalsIcs,
    daysUntilDay,
    formatCycleLabel,
    formatDaysBadge,
    formatKindLabel,
    formatMoney,
    formatRepeatLabel,
    localTodayDay,
} from '../utils/renewalUtils';

const EMPTY_FORM = {
    title: '',
    dueAt: localTodayDay(),
    repeat: 'none',
    leadDays: 3,
    note: '',
};

const DAYS_BADGE_STYLE = {
    danger: { background: 'var(--danger-soft)', color: 'var(--danger)' },
    warning: { background: 'var(--warning-soft)', color: 'var(--warning)' },
    accent: { background: 'var(--primary-light)', color: 'var(--primary)' },
    muted: { background: 'var(--bg-elevated)', color: 'var(--text-secondary)' },
};

const RenewalsView = ({ onNotify, onNavigate, onOverviewChanged }) => {
    const [withinDays, setWithinDays] = useState(90);
    const [summary, setSummary] = useState({
        timeline: [],
        spend: {
            cny: { monthly: 0, yearly: 0, once: 0, count: 0 },
            usd: { monthly: 0, yearly: 0, once: 0, count: 0 },
            unpriced: 0,
        },
    });
    const [reminders, setReminders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [advancingKey, setAdvancingKey] = useState('');
    const [modalOpen, setModalOpen] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const [showCompleted, setShowCompleted] = useState(false);

    const loadData = useCallback(async (days = withinDays) => {
        setLoading(true);
        try {
            const [renRes, remRes] = await Promise.all([
                api.getRenewalsSummary(days),
                api.getReminders(),
            ]);
            if (renRes.success && renRes.data) {
                setSummary(renRes.data);
            }
            if (remRes.success && Array.isArray(remRes.data)) {
                setReminders(remRes.data);
            }
        } catch (err) {
            onNotify?.(err instanceof Error ? err.message : '加载续费与备忘失败', 'error');
        } finally {
            setLoading(false);
        }
    }, [withinDays, onNotify]);

    useEffect(() => {
        loadData(withinDays);
    }, [withinDays, loadData]);

    const handleAdvanceRenewal = async (item) => {
        const key = `${item.kind}:${item.id}`;
        setAdvancingKey(key);
        try {
            const res = await api.advanceRenewal(item.kind, item.id);
            if (res.success) {
                onNotify?.(`已顺延「${item.name}」至 ${res.data}`);
                await loadData(withinDays);
                onOverviewChanged?.();
            } else {
                onNotify?.(res.message || '顺延失败', 'error');
            }
        } finally {
            setAdvancingKey('');
        }
    };

    const handleExportIcs = async () => {
        const ics = buildRenewalsIcs(summary.timeline, reminders);
        const filename = `googlemanager-renewals-${localTodayDay()}.ics`;

        if (isTauriRuntime()) {
            try {
                const { save } = await import('@tauri-apps/plugin-dialog');
                const path = await save({
                    defaultPath: filename,
                    filters: [{ name: 'iCalendar', extensions: ['ics'] }],
                });
                if (!path) return;
                const res = await api.writeTextFile(path, ics);
                if (res.success) {
                    onNotify?.(`日历已导出至 ${res.data}`);
                } else {
                    onNotify?.(res.message || '导出日历失败', 'error');
                }
            } catch (err) {
                onNotify?.(err instanceof Error ? err.message : '导出日历失败', 'error');
            }
            return;
        }

        const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        onNotify?.('日历文件已生成下载');
    };

    const openCreateModal = () => {
        setEditingId(null);
        setForm({ ...EMPTY_FORM, dueAt: localTodayDay() });
        setModalOpen(true);
    };

    const openEditModal = (rem) => {
        setEditingId(rem.id);
        setForm({
            title: rem.title || '',
            dueAt: rem.dueAt || localTodayDay(),
            repeat: rem.repeat || 'none',
            leadDays: Number.isFinite(rem.leadDays) ? rem.leadDays : 3,
            note: rem.note || '',
        });
        setModalOpen(true);
    };

    const handleSaveReminder = async (e) => {
        e.preventDefault();
        if (!form.title.trim()) {
            onNotify?.('请填写提醒标题', 'error');
            return;
        }
        setSaving(true);
        try {
            const payload = {
                title: form.title.trim(),
                dueAt: form.dueAt,
                repeat: form.repeat,
                leadDays: Number(form.leadDays) || 0,
                note: form.note.trim() || null,
            };
            const res = editingId
                ? await api.updateReminder(editingId, payload)
                : await api.createReminder(payload);
            if (res.success) {
                onNotify?.(editingId ? '备忘已更新' : '备忘已创建');
                setModalOpen(false);
                await loadData(withinDays);
                onOverviewChanged?.();
            } else {
                onNotify?.(res.message || '保存备忘失败', 'error');
            }
        } finally {
            setSaving(false);
        }
    };

    const handleCompleteReminder = async (rem) => {
        const res = await api.completeReminder(rem.id);
        if (res.success) {
            onNotify?.(
                rem.repeat === 'none'
                    ? `已完成「${rem.title}」`
                    : `已顺延「${rem.title}」至 ${res.data?.dueAt || '下一期'}`,
            );
            await loadData(withinDays);
            onOverviewChanged?.();
        } else {
            onNotify?.(res.message || '操作失败', 'error');
        }
    };

    const handleDeleteReminder = async (rem) => {
        const ok = await confirmDialog(`确定删除备忘「${rem.title}」吗？`, {
            title: '删除备忘',
            kind: 'warning',
            okLabel: '删除',
        });
        if (!ok) return;
        const res = await api.deleteReminder(rem.id);
        if (res.success) {
            onNotify?.('已删除备忘');
            await loadData(withinDays);
            onOverviewChanged?.();
        } else {
            onNotify?.(res.message || '删除失败', 'error');
        }
    };

    const visibleReminders = useMemo(
        () => reminders.filter(r => (showCompleted ? true : !r.done)),
        [reminders, showCompleted],
    );

    const navigateKind = (kind) => {
        if (kind === 'server') onNavigate?.('servers');
        else if (kind === 'domain') onNavigate?.('domains');
        else if (kind === 'ai_subscription') onNavigate?.('ai');
        else if (kind === 'payment_card') onNavigate?.('cards');
    };

    return (
        <div className="max-w-6xl mx-auto space-y-6 gm-view-enter">
            {/* 页头 */}
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h1 className="gm-title flex items-center gap-2">
                        <CalendarClock size={20} style={{ color: 'var(--primary)' }} />
                        <span>费用与续费</span>
                    </h1>
                    <p className="gm-subtitle mt-1">
                        统一汇总服务器、域名、AI 订阅与支付卡支出，管理周期续费与自定义备忘。
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => loadData(withinDays)}
                        className="gm-btn gm-btn-ghost"
                        disabled={loading}
                    >
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                        <span>刷新</span>
                    </button>
                    <button
                        type="button"
                        onClick={handleExportIcs}
                        className="gm-btn gm-btn-ghost"
                    >
                        <Download size={14} />
                        <span>导出 .ics</span>
                    </button>
                    <button
                        type="button"
                        onClick={openCreateModal}
                        className="gm-btn gm-btn-primary"
                    >
                        <Plus size={14} />
                        <span>新建备忘</span>
                    </button>
                </div>
            </div>

            {/* 支出统计卡片 */}
            <section className="grid grid-cols-1 md:grid-cols-3 gap-4" aria-label="支出概览">
                <div className="gm-card p-4 space-y-2">
                    <div className="flex items-center justify-between text-[12px] gm-text-3">
                        <span>美元支出 (USD)</span>
                        <Wallet size={14} />
                    </div>
                    <div className="flex items-baseline gap-3">
                        <span className="font-mono text-2xl font-semibold gm-text-1">
                            {formatMoney(summary.spend.usd.monthly, 'USD')}
                        </span>
                        <span className="text-[12px] gm-text-3">/ 月</span>
                    </div>
                    <div className="text-[12px] gm-text-2 font-mono">
                        折合年付 {formatMoney(summary.spend.usd.yearly, 'USD')}
                        {summary.spend.usd.once > 0 && ` · 一次性 ${formatMoney(summary.spend.usd.once, 'USD')}`}
                    </div>
                </div>

                <div className="gm-card p-4 space-y-2">
                    <div className="flex items-center justify-between text-[12px] gm-text-3">
                        <span>人民币支出 (CNY)</span>
                        <Wallet size={14} />
                    </div>
                    <div className="flex items-baseline gap-3">
                        <span className="font-mono text-2xl font-semibold gm-text-1">
                            {formatMoney(summary.spend.cny.monthly, 'CNY')}
                        </span>
                        <span className="text-[12px] gm-text-3">/ 月</span>
                    </div>
                    <div className="text-[12px] gm-text-2 font-mono">
                        折合年付 {formatMoney(summary.spend.cny.yearly, 'CNY')}
                        {summary.spend.cny.once > 0 && ` · 一次性 ${formatMoney(summary.spend.cny.once, 'CNY')}`}
                    </div>
                </div>

                <div className="gm-card p-4 space-y-2">
                    <div className="flex items-center justify-between text-[12px] gm-text-3">
                        <span>计费条目统计</span>
                        <Clock size={14} />
                    </div>
                    <div className="flex items-baseline gap-3">
                        <span className="font-mono text-2xl font-semibold" style={{ color: 'var(--primary)' }}>
                            {(summary.spend.usd.count || 0) + (summary.spend.cny.count || 0)}
                        </span>
                        <span className="text-[12px] gm-text-3">项已标价资产</span>
                    </div>
                    <div className="text-[12px] gm-text-2">
                        未标价 {summary.spend.unpriced} 项 · 即将到期 {summary.timeline.length} 项
                    </div>
                </div>
            </section>

            {/* 下方双栏：左续费时间线 / 右备忘提醒 */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                <section className="lg:col-span-7 gm-card p-4 space-y-4" aria-label="续费时间线">
                    <div className="flex items-center justify-between gap-2 pb-2 border-b border-[var(--border-light)]">
                        <h2 className="text-[14px] font-semibold gm-text-1">到期与续费时间线</h2>
                        <div className="flex items-center gap-1">
                            {[30, 90, 365].map(days => (
                                <button
                                    key={days}
                                    type="button"
                                    onClick={() => setWithinDays(days)}
                                    className={`px-2.5 py-1 rounded text-[11.5px] font-medium transition-colors ${
                                        withinDays === days
                                            ? 'bg-[var(--primary-light)] text-[var(--primary)]'
                                            : 'gm-text-3 hover:bg-[var(--bg-hover)]'
                                    }`}
                                >
                                    {days} 天内
                                </button>
                            ))}
                        </div>
                    </div>

                    {summary.timeline.length === 0 ? (
                        <div className="py-10 text-center text-[13px] gm-text-3">
                            {loading ? '正在统计到期数据…' : `未来 ${withinDays} 天内暂无待续费资产`}
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {summary.timeline.map(item => {
                                const badge = formatDaysBadge(item.days);
                                const key = `${item.kind}:${item.id}`;
                                const canAdvance = !item.fixedExpiry && (item.billingCycle === 'month' || item.billingCycle === 'year');
                                return (
                                    <div
                                        key={key}
                                        className="flex items-center justify-between gap-3 p-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-light)]"
                                    >
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className="gm-chip">{formatKindLabel(item.kind)}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => navigateKind(item.kind)}
                                                    className="text-[13.5px] font-medium gm-text-1 hover:underline truncate text-left"
                                                >
                                                    {item.name}
                                                </button>
                                            </div>
                                            <div className="flex items-center gap-2 mt-1 text-[11.5px] gm-text-3 font-mono">
                                                <span>{item.date}</span>
                                                {item.subtitle && <span className="truncate">· {item.subtitle}</span>}
                                                {typeof item.billingAmount === 'number' && (
                                                    <span>
                                                        · {formatMoney(item.billingAmount, item.billingCurrency)}/{formatCycleLabel(item.billingCycle)}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <span
                                                className="px-2 py-0.5 rounded text-[11px] font-medium"
                                                style={DAYS_BADGE_STYLE[badge.tone]}
                                            >
                                                {badge.text}
                                            </span>
                                            {canAdvance && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleAdvanceRenewal(item)}
                                                    disabled={advancingKey === key}
                                                    className="gm-btn gm-btn-ghost text-[12px] px-2.5 py-1"
                                                    title="按周期顺延一期"
                                                >
                                                    <Check size={12} />
                                                    <span>已续费</span>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </section>

                <section className="lg:col-span-5 gm-card p-4 space-y-4" aria-label="备忘提醒">
                    <div className="flex items-center justify-between gap-2 pb-2 border-b border-[var(--border-light)]">
                        <h2 className="text-[14px] font-semibold gm-text-1 flex items-center gap-1.5">
                            <Bell size={14} style={{ color: 'var(--primary)' }} />
                            <span>备忘提醒</span>
                        </h2>
                        <label className="flex items-center gap-1.5 text-[11.5px] gm-text-3 cursor-pointer">
                            <input
                                type="checkbox"
                                className="gm-checkbox"
                                checked={showCompleted}
                                onChange={(e) => setShowCompleted(e.target.checked)}
                            />
                            <span>显示已完成</span>
                        </label>
                    </div>

                    {visibleReminders.length === 0 ? (
                        <div className="py-10 text-center text-[13px] gm-text-3">
                            暂无待办备忘，点击右上角「新建备忘」添加
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {visibleReminders.map(rem => {
                                const days = daysUntilDay(rem.dueAt);
                                const badge = formatDaysBadge(days);
                                return (
                                    <div
                                        key={rem.id}
                                        className={`p-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-light)] space-y-1.5 ${
                                            rem.done ? 'opacity-60' : ''
                                        }`}
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0 flex-1">
                                                <div className={`text-[13px] font-medium gm-text-1 ${rem.done ? 'line-through' : ''}`}>
                                                    {rem.title}
                                                </div>
                                                <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] gm-text-3 font-mono">
                                                    <span>{rem.dueAt}</span>
                                                    <span>· {formatRepeatLabel(rem.repeat)}</span>
                                                    <span>· 提前 {rem.leadDays} 天</span>
                                                </div>
                                            </div>
                                            {!rem.done && (
                                                <span
                                                    className="px-2 py-0.5 rounded text-[11px] font-medium shrink-0"
                                                    style={DAYS_BADGE_STYLE[badge.tone]}
                                                >
                                                    {badge.text}
                                                </span>
                                            )}
                                        </div>
                                        {rem.note && (
                                            <p className="text-[12px] gm-text-2 break-words">{rem.note}</p>
                                        )}
                                        <div className="flex items-center justify-end gap-1 pt-1">
                                            {!rem.done && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleCompleteReminder(rem)}
                                                    className="gm-btn gm-btn-ghost text-[11.5px] px-2 py-1"
                                                >
                                                    <Check size={12} />
                                                    <span>{rem.repeat === 'none' ? '完成' : '完成并顺延'}</span>
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => openEditModal(rem)}
                                                className="gm-btn gm-btn-ghost text-[11.5px] px-2 py-1"
                                                aria-label={`编辑 ${rem.title}`}
                                            >
                                                <Edit3 size={12} />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleDeleteReminder(rem)}
                                                className="gm-btn gm-btn-ghost text-[11.5px] px-2 py-1 hover:text-[var(--danger)]"
                                                aria-label={`删除 ${rem.title}`}
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </section>
            </div>

            {/* 新建/编辑备忘弹窗 */}
            {modalOpen && renderInBody(
                <div className="gm-overlay" role="dialog" aria-modal="true" aria-label={editingId ? '编辑备忘' : '新建备忘'}>
                    <div className="gm-panel w-full max-w-md p-5 space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-[15px] font-semibold gm-text-1">
                                {editingId ? '编辑备忘' : '新建备忘'}
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

                        <form onSubmit={handleSaveReminder} className="space-y-3">
                            <div className="space-y-1">
                                <label className="text-[12px] gm-text-2">标题 *</label>
                                <input
                                    type="text"
                                    className="gm-input w-full"
                                    value={form.title}
                                    onChange={(e) => setForm(prev => ({ ...prev, title: e.target.value }))}
                                    placeholder="例如：检查机场流量 / 宽带续费"
                                    maxLength={80}
                                    required
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">到期日期 *</label>
                                    <input
                                        type="date"
                                        className="gm-input w-full"
                                        value={form.dueAt}
                                        onChange={(e) => setForm(prev => ({ ...prev, dueAt: e.target.value }))}
                                        required
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[12px] gm-text-2">重复周期</label>
                                    <select
                                        className="gm-input w-full"
                                        value={form.repeat}
                                        onChange={(e) => setForm(prev => ({ ...prev, repeat: e.target.value }))}
                                    >
                                        <option value="none">不重复</option>
                                        <option value="week">每周</option>
                                        <option value="month">每月</option>
                                        <option value="year">每年</option>
                                    </select>
                                </div>
                            </div>

                            <div className="space-y-1">
                                <label className="text-[12px] gm-text-2">提前提醒天数 (0-90)</label>
                                <input
                                    type="number"
                                    min={0}
                                    max={90}
                                    className="gm-input w-full"
                                    value={form.leadDays}
                                    onChange={(e) => setForm(prev => ({ ...prev, leadDays: Number(e.target.value) }))}
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="text-[12px] gm-text-2">备注</label>
                                <textarea
                                    rows={3}
                                    className="gm-input w-full"
                                    value={form.note}
                                    onChange={(e) => setForm(prev => ({ ...prev, note: e.target.value }))}
                                    placeholder="可选备注说明"
                                    maxLength={1000}
                                />
                            </div>

                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setModalOpen(false)}
                                    className="gm-btn gm-btn-ghost"
                                >
                                    取消
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="gm-btn gm-btn-primary"
                                >
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

export default RenewalsView;
