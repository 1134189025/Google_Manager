import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import {
    BrandLogo,
    Chip,
    EmptyState,
    FluentIcon,
    GlassButton,
    GlassCapsule,
    PageToolbar,
    SegmentedControl,
} from './glass';
import { confirmDialog } from '../utils/dialogs';
import { renderInBody } from '../utils/portal';
import { isTauriRuntime } from '../utils/tauriRuntime';
import {
    DATE_INPUT_MAX,
    DATE_INPUT_MIN,
    DEFAULT_USD_CNY_RATE,
    buildRenewalsIcs,
    clampDateInputValue,
    computeUnifiedCnySpend,
    convertToCny,
    daysUntilDay,
    finalizeDateInputValue,
    formatCnyAmount,
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

const mapBadgeTone = (tone) => {
    if (tone === 'danger') return 'bad';
    if (tone === 'warning') return 'warn';
    if (tone === 'accent') return 'accent';
    return '';
};

const RANGE_OPTIONS = [
    { value: 30, label: '30 天内' },
    { value: 90, label: '90 天内' },
    { value: 365, label: '365 天内' },
];

const RenewalsView = ({ fxInfo: externalFxInfo, onRefreshFxRate, onNotify, onNavigate, onOverviewChanged }) => {
    const [withinDays, setWithinDays] = useState(90);
    const [summary, setSummary] = useState({
        timeline: [],
        spend: {
            cny: { monthly: 0, yearly: 0, once: 0, count: 0 },
            usd: { monthly: 0, yearly: 0, once: 0, count: 0 },
            unpriced: 0,
        },
    });
    const [localFxInfo, setLocalFxInfo] = useState({
        rate: DEFAULT_USD_CNY_RATE,
        updatedAt: '',
        source: '默认参考汇率',
        isFallback: true,
        loading: false,
    });
    const fxInfo = externalFxInfo || localFxInfo;
    const [reminders, setReminders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [advancingKey, setAdvancingKey] = useState('');
    const [modalOpen, setModalOpen] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const [showCompleted, setShowCompleted] = useState(false);

    const loadLocalFx = useCallback(async (force = false) => {
        if (externalFxInfo || typeof api?.getUsdCnyRate !== 'function') return;
        setLocalFxInfo(prev => ({ ...prev, loading: true }));
        try {
            const res = await api.getUsdCnyRate(force);
            if (res?.success && res.data && Number.isFinite(Number(res.data.rate))) {
                setLocalFxInfo({
                    rate: Number(res.data.rate),
                    updatedAt: res.data.updatedAt || '',
                    source: res.data.source || '实时汇率',
                    isFallback: Boolean(res.data.isFallback),
                    loading: false,
                });
                return;
            }
        } catch {
            // 保持默认或上次汇率
        }
        setLocalFxInfo(prev => ({ ...prev, loading: false }));
    }, [externalFxInfo]);

    const handleRefreshFx = async () => {
        if (typeof onRefreshFxRate === 'function') {
            await onRefreshFxRate(true);
        } else {
            await loadLocalFx(true);
        }
    };

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

    useEffect(() => {
        if (!externalFxInfo) {
            loadLocalFx(false);
        }
    }, [externalFxInfo, loadLocalFx]);

    const unifiedSpend = useMemo(
        () => computeUnifiedCnySpend(summary.spend, fxInfo.rate),
        [summary.spend, fxInfo.rate],
    );

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
        <>
            <PageToolbar
                title="费用与续费"
                subtitle="统一汇总服务器、域名、AI 订阅与支付卡支出"
                right={
                    <div className="flex items-center gap-2 flex-wrap">
                        <SegmentedControl
                            label="续费时间范围"
                            options={RANGE_OPTIONS}
                            value={withinDays}
                            onChange={setWithinDays}
                        />
                        <GlassCapsule>
                            <GlassButton onClick={() => loadData(withinDays)} disabled={loading} title="刷新数据">
                                <FluentIcon name="sync" size={16} className={loading ? 'animate-spin' : ''} />
                                <span>刷新</span>
                            </GlassButton>
                            <GlassButton onClick={handleExportIcs} title="导出 iCalendar 日历文件">
                                <FluentIcon name="export" size={16} />
                                <span>导出 .ics</span>
                            </GlassButton>
                        </GlassCapsule>
                        <GlassButton glass pill prominent onClick={openCreateModal}>
                            <FluentIcon name="add" size={16} />
                            <span>新建备忘</span>
                        </GlassButton>
                    </div>
                }
            />

            <div className="page page-in">
                {/* 统一人民币结算总览卡片 */}
                <section className="overview group" aria-label="支出概览">
                    <div className="ov-main">
                        <span className="k">月度总支出（人民币结算）</span>
                        <div className="flex items-baseline gap-2 flex-wrap">
                            <span className="v">{formatCnyAmount(unifiedSpend.monthlyCny)}</span>
                            <span className="s">/ 月</span>
                        </div>
                        <span className="s">
                            折合年付总支出{' '}
                            <strong style={{ color: 'var(--accent)' }}>{formatCnyAmount(unifiedSpend.yearlyCny)}</strong> / 年
                            {unifiedSpend.usdMonthly > 0
                                ? ` · 含美元折算 ${formatMoney(unifiedSpend.usdMonthly, 'USD')} → ${formatCnyAmount(unifiedSpend.usdMonthlyInCny)}`
                                : ' · 全部为人民币计费，无需换汇'}
                        </span>
                        {unifiedSpend.onceCny > 0 && (
                            <span className="muted text-[12px]">
                                另含一次性支出 {formatCnyAmount(unifiedSpend.onceCny)}
                            </span>
                        )}
                    </div>

                    <div className="ov-cats">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span
                                className="chip accent font-mono"
                                title={fxInfo.updatedAt ? `更新于 ${fxInfo.updatedAt}` : `来源：${fxInfo.source}`}
                            >
                                1 USD = ¥{unifiedSpend.rate.toFixed(4)}
                            </span>
                            <div className="flex items-center gap-1.5">
                                <Chip tone={fxInfo.isFallback ? '' : 'ok'}>
                                    {fxInfo.isFallback ? '缓存/参考' : '实时汇率'}
                                </Chip>
                                <button
                                    type="button"
                                    onClick={handleRefreshFx}
                                    disabled={Boolean(fxInfo.loading)}
                                    className="btn"
                                    style={{ height: 28, padding: '0 10px' }}
                                    aria-label="刷新实时汇率"
                                    title="立即拉取最新 USD → CNY 汇率"
                                >
                                    <FluentIcon
                                        name="sync"
                                        size={13}
                                        className={fxInfo.loading ? 'animate-spin' : ''}
                                    />
                                </button>
                            </div>
                        </div>

                        <div className="prov">
                            <FluentIcon name="receipt" size={16} style={{ color: 'var(--accent)' }} />
                            <span>已标价资产</span>
                            <span className="muted font-semibold" style={{ color: 'var(--text)' }}>
                                {unifiedSpend.totalPricedCount} 项
                            </span>
                        </div>
                        <div className="prov">
                            <FluentIcon name="calendar" size={16} style={{ color: 'var(--orange)' }} />
                            <span>{withinDays} 天内即将到期</span>
                            <span className="muted font-semibold" style={{ color: 'var(--text)' }}>
                                {summary.timeline.length} 项
                            </span>
                        </div>
                        <div className="prov">
                            <span className="muted" style={{ marginLeft: 0 }} title={fxInfo.source}>
                                汇率来源：{fxInfo.source}
                            </span>
                        </div>
                    </div>
                </section>

                {/* 下方双栏：续费时间线 / 备忘提醒 */}
                <div className="section grid grid-cols-1 lg:grid-cols-12 gap-6">
                    <section className="lg:col-span-7" aria-label="续费时间线">
                        <div className="section-h">
                            <h2>到期与续费时间线</h2>
                            <span className="muted text-[12px] tabular-nums">
                                共 {summary.timeline.length} 项
                            </span>
                        </div>

                        <div className="group">
                            {summary.timeline.length === 0 ? (
                                <EmptyState
                                    icon="calendar"
                                    title={loading ? '正在统计到期数据…' : `未来 ${withinDays} 天内暂无待续费资产`}
                                    description="已配置到期日或计费周期的服务器、域名、AI 订阅与支付卡会自动汇聚到这里。"
                                />
                            ) : (
                                <ul className="rows logo-rows">
                                    {summary.timeline.map(item => {
                                        const badge = formatDaysBadge(item.days);
                                        const key = `${item.kind}:${item.id}`;
                                        const canAdvance = !item.fixedExpiry && (item.billingCycle === 'month' || item.billingCycle === 'year');
                                        const cnyPrice = typeof item.billingAmount === 'number'
                                            ? convertToCny(item.billingAmount, item.billingCurrency, unifiedSpend.rate)
                                            : null;
                                        return (
                                            <li key={key}>
                                                <div className="rrow">
                                                    <BrandLogo
                                                        name={item.name}
                                                        hints={[item.subtitle, item.name, item.kind]}
                                                    />
                                                    <span className="od-field">
                                                        <button
                                                            type="button"
                                                            onClick={() => navigateKind(item.kind)}
                                                            className="t od-truncate text-left border-0 bg-transparent p-0 hover:underline cursor-pointer"
                                                            style={{ color: 'var(--text)' }}
                                                        >
                                                            {item.name}
                                                        </button>
                                                        <span className="s od-truncate">
                                                            {formatKindLabel(item.kind)}
                                                            {item.subtitle ? ` · ${item.subtitle}` : ''}
                                                            {item.billingCycle ? ` · ${formatCycleLabel(item.billingCycle)}` : ''}
                                                            {item.billingCurrency === 'USD' && typeof item.billingAmount === 'number'
                                                                ? ` · ${formatMoney(item.billingAmount, 'USD')}`
                                                                : ''}
                                                        </span>
                                                    </span>
                                                    <span className="od-field due">
                                                        <span className="font-mono">{item.date}</span>
                                                        <span className="muted">{formatCycleLabel(item.billingCycle)}</span>
                                                    </span>
                                                    <Chip tone={mapBadgeTone(badge.tone)}>{badge.text}</Chip>
                                                    <span className="amount">
                                                        {cnyPrice !== null ? formatCnyAmount(cnyPrice) : '未标价'}
                                                    </span>
                                                    {canAdvance ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleAdvanceRenewal(item)}
                                                            disabled={advancingKey === key}
                                                            className="btn"
                                                            style={{ height: 30, padding: '0 12px' }}
                                                            title="按周期顺延一期"
                                                        >
                                                            <FluentIcon name="check" size={14} />
                                                            <span>已续费</span>
                                                        </button>
                                                    ) : (
                                                        <span className="muted text-[12px] text-right">固定到期</span>
                                                    )}
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>
                    </section>

                    <section className="lg:col-span-5" aria-label="备忘提醒">
                        <div className="section-h">
                            <h2>备忘提醒</h2>
                            <label className="flex items-center gap-2 text-[12.5px] muted cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="check"
                                    checked={showCompleted}
                                    onChange={(e) => setShowCompleted(e.target.checked)}
                                />
                                <span>显示已完成</span>
                            </label>
                        </div>

                        <div className="group">
                            {visibleReminders.length === 0 ? (
                                <EmptyState
                                    icon="clock"
                                    title="暂无待办备忘"
                                    description="点击右上角「新建备忘」记录自定义到期事项。"
                                />
                            ) : (
                                <ul className="rows flush">
                                    {visibleReminders.map(rem => {
                                        const days = daysUntilDay(rem.dueAt);
                                        const badge = formatDaysBadge(days);
                                        return (
                                            <li key={rem.id}>
                                                <div className={`row flex-col items-stretch gap-2.5 ${rem.done ? 'opacity-60' : ''}`}>
                                                    <div className="flex items-start justify-between gap-2">
                                                        <div className="od-field od-fill">
                                                            <span className={`t ${rem.done ? 'todo-text done' : ''}`}>
                                                                {rem.title}
                                                            </span>
                                                            <span className="s font-mono">
                                                                {rem.dueAt} · {formatRepeatLabel(rem.repeat)} · 提前 {rem.leadDays} 天
                                                            </span>
                                                        </div>
                                                        {!rem.done && (
                                                            <Chip tone={mapBadgeTone(badge.tone)}>{badge.text}</Chip>
                                                        )}
                                                    </div>
                                                    {rem.note && (
                                                        <p className="text-[12.5px] muted break-words m-0">{rem.note}</p>
                                                    )}
                                                    <div className="flex items-center justify-end gap-1.5">
                                                        {!rem.done && (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleCompleteReminder(rem)}
                                                                className="btn"
                                                                style={{ height: 28, padding: '0 10px', fontSize: 'var(--fs-s)' }}
                                                            >
                                                                <FluentIcon name="check" size={13} />
                                                                <span>{rem.repeat === 'none' ? '完成' : '完成并顺延'}</span>
                                                            </button>
                                                        )}
                                                        <button
                                                            type="button"
                                                            onClick={() => openEditModal(rem)}
                                                            className="gbtn icon"
                                                            style={{ width: 28, height: 28, minWidth: 28 }}
                                                            aria-label={`编辑 ${rem.title}`}
                                                            title="编辑"
                                                        >
                                                            <FluentIcon name="edit" size={15} />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleDeleteReminder(rem)}
                                                            className="gbtn icon"
                                                            style={{ width: 28, height: 28, minWidth: 28, color: 'var(--red)' }}
                                                            aria-label={`删除 ${rem.title}`}
                                                            title="删除"
                                                        >
                                                            <FluentIcon name="trash" size={15} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>
                    </section>
                </div>
            </div>

            {/* 新建/编辑备忘液态玻璃弹窗 */}
            {modalOpen && renderInBody(
                <div
                    className="gm-overlay"
                    role="dialog"
                    aria-modal="true"
                    aria-label={editingId ? '编辑备忘' : '新建备忘'}
                    onClick={() => setModalOpen(false)}
                >
                    <div
                        className="sheet glass"
                        data-lens="sheet"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <form onSubmit={handleSaveReminder}>
                            <div className="sheet-in">
                                <div className="flex items-center justify-between">
                                    <span style={{ width: 28 }} />
                                    <h2>{editingId ? '编辑备忘' : '新建备忘'}</h2>
                                    <button
                                        type="button"
                                        onClick={() => setModalOpen(false)}
                                        className="gbtn icon"
                                        style={{ width: 28, height: 28, minWidth: 28 }}
                                        aria-label="关闭"
                                    >
                                        <FluentIcon name="dismiss" size={16} />
                                    </button>
                                </div>
                                <p className="desc">配置到期日期与重复周期，到期前会在首页与工作区提示。</p>

                                <div className="field">
                                    <label>
                                        标题<span className="req">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        value={form.title}
                                        onChange={(e) => setForm(prev => ({ ...prev, title: e.target.value }))}
                                        placeholder="例如：检查机场流量 / 宽带续费"
                                        maxLength={80}
                                        required
                                    />
                                </div>

                                <div className="pair">
                                    <div className="field">
                                        <label>
                                            到期日期<span className="req">*</span>
                                        </label>
                                        <input
                                            type="date"
                                            min={DATE_INPUT_MIN}
                                            max={DATE_INPUT_MAX}
                                            value={form.dueAt}
                                            onChange={(e) => setForm(prev => ({
                                                ...prev,
                                                dueAt: clampDateInputValue(e.target.value),
                                            }))}
                                            onBlur={(e) => setForm(prev => ({
                                                ...prev,
                                                dueAt: finalizeDateInputValue(e.target.value),
                                            }))}
                                            required
                                        />
                                    </div>
                                    <div className="field">
                                        <label>重复周期</label>
                                        <select
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

                                <div className="field">
                                    <label>提前提醒天数 (0-90)</label>
                                    <input
                                        type="number"
                                        min={0}
                                        max={90}
                                        value={form.leadDays}
                                        onChange={(e) => setForm(prev => ({ ...prev, leadDays: Number(e.target.value) }))}
                                    />
                                </div>

                                <div className="field">
                                    <label>备注</label>
                                    <textarea
                                        rows={3}
                                        value={form.note}
                                        onChange={(e) => setForm(prev => ({ ...prev, note: e.target.value }))}
                                        placeholder="可选备注说明"
                                        maxLength={1000}
                                    />
                                </div>
                            </div>

                            <div className="sheet-foot">
                                <button
                                    type="button"
                                    onClick={() => setModalOpen(false)}
                                    className="gbtn glass"
                                    data-lens="cap"
                                >
                                    取消
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="gbtn glass prominent"
                                    data-lens="cap"
                                >
                                    {saving ? '保存中…' : '保存'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>,
            )}
        </>
    );
};

export default RenewalsView;
