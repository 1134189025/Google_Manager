import { useEffect, useMemo, useState } from 'react';
import {
    Globe,
    ArrowRight,
    Wallet,
    RefreshCw,
    CalendarClock,
    Bell,
    Sparkles,
    CreditCard,
    Server,
    Terminal,
    Bot,
    Users,
    ArrowLeftRight,
} from 'lucide-react';
import { PixelDivider, PixelMascot } from './PixelArt';
import { splitGroupNameValues } from '../utils/multiValueField';
import { formatDbTimestamp } from '../utils/timeUtils';
import {
    DEFAULT_USD_CNY_RATE,
    computeUnifiedCnySpend,
    convertToCny,
    formatCnyAmount,
    formatCycleLabel,
    formatDaysBadge,
    formatKindLabel,
    formatMoney,
} from '../utils/renewalUtils';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const formatClock = (date) => {
    const day = WEEKDAYS[date.getDay()];
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${day} ${hh}:${mm}`;
};

const getGreetingByHour = (hour) => {
    if (hour < 6) return '还在忙吗？';
    if (hour < 12) return '早安，资产状态一目了然';
    if (hour < 18) return '下午好，数字资产总控台';
    return '晚上好，今天还顺利吗？';
};

const parseDbTimeMs = (value) => {
    const raw = formatDbTimestamp(value);
    if (!raw) return 0;
    const ts = Date.parse(raw.replace(' ', 'T'));
    return Number.isNaN(ts) ? 0 : ts;
};

const DAYS_BADGE_STYLE = {
    danger: { background: 'var(--danger-soft)', color: 'var(--danger)' },
    warning: { background: 'var(--warning-soft)', color: 'var(--warning)' },
    accent: { background: 'var(--primary-light)', color: 'var(--primary)' },
    muted: { background: 'var(--bg-elevated)', color: 'var(--text-secondary)' },
};

/**
 * 像素风个人数字资产首页总控台
 * - 顶部聚合：统一人民币月/年费用、实时 USD→CNY 汇率、即将到期与待办数
 * - 中部矩阵：8 大工作区资产一键直达 + 到期续费/备忘双栏看板
 * - 底部保留：活跃浏览器与最近更新谷歌账号；右侧保留竖排账号统计
 */
const HomeView = ({
    accounts = [],
    accountCategories = [],
    browserStatuses = {},
    overview = null,
    fxInfo = null,
    onRefreshFxRate,
    loading = false,
    onTriggerSearch,
    onTriggerImport,
    onTriggerExport,
    onNavigateList,
    onNavigate,
    onOpenBrowser,
    onCopyEmail,
}) => {
    const [now, setNow] = useState(() => new Date());
    const [mascotHover, setMascotHover] = useState(false);

    const knownCategoryNames = useMemo(
        () => accountCategories.map(cat => cat?.name).filter(Boolean),
        [accountCategories],
    );

    useEffect(() => {
        const timer = setInterval(() => {
            setNow(new Date());
        }, 30000);
        return () => clearInterval(timer);
    }, []);

    const stats = useMemo(() => {
        let proCount = 0;
        let smsCount = 0;
        for (const acc of accounts) {
            if (acc.status === 'pro') proCount += 1;
            if (acc.smsUrl && String(acc.smsUrl).trim()) smsCount += 1;
        }
        const runningAccounts = accounts.filter(acc => browserStatuses[acc.email] === 'running');
        return {
            total: accounts.length,
            pro: proCount,
            sms: smsCount,
            runningAccounts,
            runningCount: runningAccounts.length,
        };
    }, [accounts, browserStatuses]);

    const recentAccounts = useMemo(() => {
        if (accounts.length === 0) return [];
        return [...accounts]
            .sort((a, b) => {
                const diff = parseDbTimeMs(b.updatedAt || b.createdAt) - parseDbTimeMs(a.updatedAt || a.createdAt);
                if (diff !== 0) return diff;
                return (Number(b.id) || 0) - (Number(a.id) || 0);
            })
            .slice(0, 5);
    }, [accounts]);

    const effectiveFx = fxInfo || {
        rate: DEFAULT_USD_CNY_RATE,
        source: '默认参考汇率',
        isFallback: true,
        loading: false,
    };

    const unifiedSpend = useMemo(
        () => computeUnifiedCnySpend(overview?.spend, effectiveFx.rate),
        [overview?.spend, effectiveFx.rate],
    );

    const upcomingRenewals = overview?.upcomingRenewals || [];
    const dueReminders = overview?.dueReminders || [];
    const pendingRemindersCount = overview?.pendingRemindersCount ?? 0;
    const serversTotal = overview?.serversCount ?? 0;
    const serversOnline = overview?.serversOnlineCount ?? 0;

    const workspaceTiles = useMemo(
        () => [
            {
                id: 'list',
                label: '谷歌账号',
                icon: Users,
                value: String(stats.total),
                sub: `Pro ${stats.pro} · 接码 ${stats.sms}`,
                led: stats.runningCount > 0 ? 'is-success' : 'is-primary',
                onClick: () => (onNavigateList ? onNavigateList() : onNavigate?.('list')),
            },
            {
                id: 'renewals',
                label: '费用与续费',
                icon: CalendarClock,
                value: String(upcomingRenewals.length + pendingRemindersCount),
                sub: `到期 ${upcomingRenewals.length} · 备忘 ${pendingRemindersCount}`,
                led: upcomingRenewals.length > 0 ? 'is-warning' : 'is-primary',
                onClick: () => onNavigate?.('renewals'),
            },
            {
                id: 'ai',
                label: 'AI 订阅',
                icon: Sparkles,
                value: String(overview?.aiSubscriptionsCount ?? 0),
                sub: '额度与 OAuth 直连',
                led: 'is-primary',
                onClick: () => onNavigate?.('ai'),
            },
            {
                id: 'cards',
                label: 'U 卡与支付卡',
                icon: CreditCard,
                value: String(overview?.paymentCardsCount ?? 0),
                sub: '卡面与 CVV 账单',
                led: 'is-primary',
                onClick: () => onNavigate?.('cards'),
            },
            {
                id: 'servers',
                label: '服务器节点',
                icon: Server,
                value: `${serversOnline}/${serversTotal}`,
                sub: serversTotal > 0 ? `${serversOnline} 台在线` : '暂未录入主机',
                led: serversOnline > 0 ? 'is-success' : serversTotal > 0 ? 'is-warning' : '',
                onClick: () => onNavigate?.('servers'),
            },
            {
                id: 'domains',
                label: '域名管理',
                icon: Globe,
                value: String(overview?.domainsCount ?? 0),
                sub: 'WHOIS 与 CF DNS',
                led: 'is-primary',
                onClick: () => onNavigate?.('domains'),
            },
            {
                id: 'terminal',
                label: 'SSH 终端',
                icon: Terminal,
                value: 'TTY',
                sub: '多标签与 SFTP',
                led: 'is-success',
                onClick: () => onNavigate?.('terminal'),
            },
            {
                id: 'agent',
                label: 'AI 助手',
                icon: Bot,
                value: 'SAFE',
                sub: '脱敏洞察与提案',
                led: 'is-primary',
                onClick: () => onNavigate?.('agent'),
            },
        ],
        [
            stats.total,
            stats.pro,
            stats.sms,
            stats.runningCount,
            upcomingRenewals.length,
            pendingRemindersCount,
            overview?.aiSubscriptionsCount,
            overview?.paymentCardsCount,
            overview?.domainsCount,
            serversOnline,
            serversTotal,
            onNavigateList,
            onNavigate,
        ],
    );

    const greeting = getGreetingByHour(now.getHours());

    return (
        <div className="gm-home gm-view-enter">
            {/* 左侧主栏 */}
            <div className="gm-home-main">
                {/* 顶部像素问候 + 快捷操作条 */}
                <section className="space-y-3 gm-stagger-1">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3.5 min-w-0">
                            <div
                                onMouseEnter={() => setMascotHover(true)}
                                onMouseLeave={() => setMascotHover(false)}
                                className="inline-flex text-[color:var(--text-primary)] cursor-default shrink-0"
                            >
                                <PixelMascot
                                    size={46}
                                    variant={loading ? 'loading' : (mascotHover ? 'wave' : 'idle')}
                                />
                            </div>
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="gm-pixel-tag is-accent" aria-label="当前时间">
                                        {formatClock(now)}
                                    </span>
                                    <span className="text-[11px] font-mono gm-text-3">
                                        WORKSPACE · ALL-IN-ONE
                                    </span>
                                </div>
                                <h1 className="gm-home-greeting mt-1">{greeting}</h1>
                            </div>
                        </div>

                        {/* 紧凑快捷键操作区（完整保留 Ctrl+K / Alt+N / Alt+E 交互） */}
                        <div className="flex flex-wrap items-center gap-2" aria-label="快捷操作">
                            <button
                                type="button"
                                onClick={onTriggerSearch}
                                className="gm-btn gm-btn-secondary gm-btn-sm"
                            >
                                <kbd className="gm-kbd">Ctrl+K</kbd>
                                <span>搜索账号</span>
                            </button>
                            <button
                                type="button"
                                onClick={onTriggerImport}
                                className="gm-btn gm-btn-secondary gm-btn-sm"
                            >
                                <kbd className="gm-kbd">Alt+N</kbd>
                                <span>导入账号</span>
                            </button>
                            <button
                                type="button"
                                onClick={onTriggerExport}
                                className="gm-btn gm-btn-secondary gm-btn-sm"
                            >
                                <kbd className="gm-kbd">Alt+E</kbd>
                                <span>导出账号</span>
                            </button>
                        </div>
                    </div>
                </section>

                {/* 核心焦点 1：费用与续费统一人民币结算面板 */}
                <section className="gm-home-spend-hero gm-pixel-card gm-stagger-1" aria-label="费用结算总览">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--border-light)]">
                        <div className="flex items-center gap-2">
                            <span className="gm-pixel-led is-primary" aria-hidden="true" />
                            <Wallet size={15} style={{ color: 'var(--primary)' }} />
                            <h2 className="text-[13.5px] font-semibold gm-text-1">
                                资产费用总览（统一人民币结算）
                            </h2>
                        </div>
                        <div className="flex items-center gap-2">
                            <span
                                className="inline-flex items-center gap-1.5 text-[11px] font-mono gm-text-2 px-2 py-0.5 rounded bg-[var(--bg-elevated)] border border-[var(--border-light)]"
                                title={`汇率来源：${effectiveFx.source}`}
                            >
                                <ArrowLeftRight size={11} style={{ color: 'var(--primary)' }} />
                                <span>1 USD = ¥{unifiedSpend.rate.toFixed(4)}</span>
                            </span>
                            {typeof onRefreshFxRate === 'function' && (
                                <button
                                    type="button"
                                    onClick={() => onRefreshFxRate(true)}
                                    disabled={Boolean(effectiveFx.loading)}
                                    className="gm-btn gm-btn-ghost p-1"
                                    aria-label="刷新实时汇率"
                                    title="立即刷新 USD → CNY 实时汇率"
                                >
                                    <RefreshCw size={12} className={effectiveFx.loading ? 'animate-spin' : ''} />
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => onNavigate?.('renewals')}
                                className="gm-btn gm-btn-sm"
                                style={{
                                    background: 'var(--primary-light)',
                                    color: 'var(--primary)',
                                    borderColor: 'rgba(107, 155, 247, 0.36)',
                                }}
                            >
                                <span>费用详情</span>
                                <ArrowRight size={12} />
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3.5">
                        <div>
                            <div className="text-[11.5px] gm-text-3">本月预计总支出</div>
                            <div className="mt-1 flex items-baseline gap-1.5">
                                <span className="font-mono text-[26px] font-bold tracking-tight gm-text-1">
                                    {formatCnyAmount(unifiedSpend.monthlyCny)}
                                </span>
                                <span className="text-[11.5px] gm-text-3">/ 月</span>
                            </div>
                            <div className="mt-1 text-[11px] font-mono gm-text-3">
                                {unifiedSpend.usdMonthly > 0
                                    ? `含美元 ${formatMoney(unifiedSpend.usdMonthly, 'USD')} → ${formatCnyAmount(unifiedSpend.usdMonthlyInCny)}`
                                    : `${unifiedSpend.totalPricedCount} 项已标价资产`}
                            </div>
                        </div>

                        <div>
                            <div className="text-[11.5px] gm-text-3">折合年度总支出</div>
                            <div className="mt-1 flex items-baseline gap-1.5">
                                <span className="font-mono text-[26px] font-bold tracking-tight" style={{ color: 'var(--primary)' }}>
                                    {formatCnyAmount(unifiedSpend.yearlyCny)}
                                </span>
                                <span className="text-[11.5px] gm-text-3">/ 年</span>
                            </div>
                            <div className="mt-1 text-[11px] font-mono gm-text-3">
                                {unifiedSpend.onceCny > 0
                                    ? `另含一次性 ${formatCnyAmount(unifiedSpend.onceCny)}`
                                    : unifiedSpend.unpricedCount > 0
                                        ? `尚有 ${unifiedSpend.unpricedCount} 项未填费用`
                                        : '全部周期费用已计入'}
                            </div>
                        </div>

                        <div className="flex flex-col justify-between gap-2 sm:border-l sm:border-[var(--border-light)] sm:pl-4">
                            <div className="flex items-center justify-between text-[12px]">
                                <span className="gm-text-3 flex items-center gap-1.5">
                                    <CalendarClock size={13} style={{ color: 'var(--warning)' }} />
                                    <span>90 天内到期续费</span>
                                </span>
                                <span className="font-mono font-bold text-[15px] gm-text-1">
                                    {upcomingRenewals.length} 项
                                </span>
                            </div>
                            <div className="flex items-center justify-between text-[12px]">
                                <span className="gm-text-3 flex items-center gap-1.5">
                                    <Bell size={13} style={{ color: 'var(--primary)' }} />
                                    <span>待办备忘提醒</span>
                                </span>
                                <span className="font-mono font-bold text-[15px] gm-text-1">
                                    {overview?.pendingRemindersCount ?? 0} 项
                                </span>
                            </div>
                            <div className="text-[10.5px] font-mono gm-text-3 truncate">
                                {effectiveFx.isFallback ? '汇率：缓存/参考' : `实时汇率 · ${effectiveFx.source}`}
                            </div>
                        </div>
                    </div>
                </section>

                {/* 核心焦点 2：即将到期续费 & 待办提醒双栏面板 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 gm-stagger-2">
                    <section className="gm-card gm-pixel-card p-4 space-y-2.5" aria-label="即将到期续费">
                        <div className="flex items-center justify-between pb-2 border-b border-[var(--border-light)]">
                            <h2 className="text-[13px] font-semibold gm-text-1 flex items-center gap-1.5">
                                <CalendarClock size={14} style={{ color: 'var(--warning)' }} />
                                <span>即将到期续费</span>
                            </h2>
                            <button
                                type="button"
                                onClick={() => onNavigate?.('renewals')}
                                className="gm-home-more-btn inline-flex items-center gap-1"
                            >
                                <span>处理</span>
                                <ArrowRight size={12} />
                            </button>
                        </div>
                        {upcomingRenewals.length > 0 ? (
                            <div className="space-y-1.5">
                                {upcomingRenewals.slice(0, 5).map(item => {
                                    const badge = formatDaysBadge(item.days);
                                    const cnyAmt = typeof item.billingAmount === 'number'
                                        ? convertToCny(item.billingAmount, item.billingCurrency, unifiedSpend.rate)
                                        : null;
                                    return (
                                        <button
                                            key={`${item.kind}-${item.id}`}
                                            type="button"
                                            onClick={() => onNavigate?.('renewals')}
                                            className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-light)] text-left transition-colors cursor-pointer"
                                        >
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="gm-pixel-tag">{formatKindLabel(item.kind)}</span>
                                                    <span className="text-[12.5px] font-medium gm-text-1 truncate">
                                                        {item.name}
                                                    </span>
                                                </div>
                                                <div className="mt-0.5 text-[11px] font-mono gm-text-3 flex items-center gap-2">
                                                    <span>{item.date}</span>
                                                    {cnyAmt !== null && (
                                                        <span className="gm-text-2">
                                                            {formatCnyAmount(cnyAmt)}/{formatCycleLabel(item.billingCycle)}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <span
                                                className="px-2 py-0.5 rounded-[4px] text-[10.5px] font-mono font-semibold shrink-0"
                                                style={DAYS_BADGE_STYLE[badge.tone]}
                                            >
                                                {badge.text}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="py-5 text-center text-[12px] gm-text-3">
                                近期暂无即将到期的资产续费
                            </div>
                        )}
                    </section>

                    <section className="gm-card gm-pixel-card p-4 space-y-2.5" aria-label="待办备忘提醒">
                        <div className="flex items-center justify-between pb-2 border-b border-[var(--border-light)]">
                            <h2 className="text-[13px] font-semibold gm-text-1 flex items-center gap-1.5">
                                <Bell size={14} style={{ color: 'var(--primary)' }} />
                                <span>待办备忘提醒</span>
                            </h2>
                            <button
                                type="button"
                                onClick={() => onNavigate?.('renewals')}
                                className="gm-home-more-btn inline-flex items-center gap-1"
                            >
                                <span>管理</span>
                                <ArrowRight size={12} />
                            </button>
                        </div>
                        {dueReminders.length > 0 ? (
                            <div className="space-y-1.5">
                                {dueReminders.slice(0, 5).map(rem => (
                                    <button
                                        key={`rem-${rem.id}`}
                                        type="button"
                                        onClick={() => onNavigate?.('renewals')}
                                        className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-light)] text-left transition-colors cursor-pointer"
                                    >
                                        <span className="text-[12.5px] font-medium gm-text-1 truncate">
                                            {rem.title}
                                        </span>
                                        <span className="font-mono text-[11px] gm-text-3 shrink-0">
                                            {rem.dueAt}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="py-5 text-center text-[12px] gm-text-3">
                                暂无到期备忘提醒，可前往费用与续费页新建
                            </div>
                        )}
                    </section>
                </div>

                {/* 核心焦点 3：全部数字资产工作区像素矩阵 */}
                <section className="gm-home-section gm-stagger-2" aria-label="数字资产总览">
                    <div className="gm-home-section-head">
                        <h2 className="gm-home-section-title flex items-center gap-2">
                            <span className="gm-pixel-led is-primary" aria-hidden="true" />
                            <span>数字资产工作区</span>
                        </h2>
                        <span className="text-[11px] font-mono gm-text-3">点击磁贴直达对应模块</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                        {workspaceTiles.map(tile => {
                            const Icon = tile.icon;
                            return (
                                <button
                                    key={tile.id}
                                    type="button"
                                    onClick={tile.onClick}
                                    className="gm-home-asset-tile"
                                >
                                    <div className="flex items-center justify-between gap-2 w-full">
                                        <span className="text-[11.5px] font-medium gm-text-2 flex items-center gap-1.5 truncate">
                                            <Icon size={13} style={{ color: 'var(--primary)' }} className="shrink-0" />
                                            <span className="truncate">{tile.label}</span>
                                        </span>
                                        <span className={`gm-pixel-led ${tile.led}`} aria-hidden="true" />
                                    </div>
                                    <div>
                                        <div className="font-mono text-xl font-bold gm-text-1 leading-tight">
                                            {tile.value}
                                        </div>
                                        <div className="mt-0.5 text-[10.5px] gm-text-3 truncate">
                                            {tile.sub}
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </section>

                <PixelDivider />

                {/* 活跃浏览器 + 最近更新谷歌账号 */}
                <div className="gm-home-sections gm-stagger-3" style={{ paddingTop: 0, gap: '20px' }}>
                    <section className="gm-home-section" aria-label="活跃浏览器">
                        <div className="gm-home-section-head">
                            <h2 className="gm-home-section-title">
                                活跃浏览器 <span className="gm-home-section-count">· {stats.runningCount}</span>
                            </h2>
                        </div>
                        {stats.runningAccounts.length > 0 ? (
                            <div className="gm-home-pill-strip">
                                {stats.runningAccounts.slice(0, 6).map(acc => (
                                    <button
                                        key={acc.id}
                                        type="button"
                                        onClick={() => onOpenBrowser?.(acc)}
                                        className="gm-home-browser-pill"
                                        title={`点击切换到 ${acc.email} 的浏览器窗口`}
                                    >
                                        <span
                                            className="w-1.5 h-1.5 rounded-[1px] shrink-0 gm-pixel-status-pulse"
                                            style={{ background: 'var(--success)' }}
                                            aria-hidden="true"
                                        />
                                        <span className="truncate">{acc.email}</span>
                                        <Globe size={12} className="shrink-0 gm-text-3" />
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="gm-home-empty">
                                暂无运行中的独立浏览器
                            </div>
                        )}
                    </section>

                    <section className="gm-home-section" aria-label="最近更新">
                        <div className="gm-home-section-head">
                            <h2 className="gm-home-section-title">最近更新</h2>
                            <button
                                type="button"
                                onClick={onNavigateList}
                                className="gm-home-more-btn inline-flex items-center gap-1"
                            >
                                <span>全部</span>
                                <ArrowRight size={12} />
                            </button>
                        </div>
                        {recentAccounts.length > 0 ? (
                            <div className="gm-home-list">
                                {recentAccounts.map(acc => {
                                    const tags = splitGroupNameValues(acc.groupName, knownCategoryNames);
                                    const badgeText = tags[0] || (acc.status === 'pro' ? 'Pro' : '普通');
                                    const timeText = formatDbTimestamp(acc.updatedAt || acc.createdAt);
                                    const isPro = acc.status === 'pro';
                                    return (
                                        <button
                                            key={acc.id}
                                            type="button"
                                            onClick={() => onCopyEmail?.(acc.email)}
                                            className="gm-home-row"
                                            title="点击复制邮箱"
                                        >
                                            <span className="inline-flex items-center gap-2.5 min-w-0 flex-1">
                                                <span
                                                    className="gm-home-row-dot"
                                                    style={{ background: isPro ? 'var(--primary)' : 'var(--text-muted)' }}
                                                    aria-hidden="true"
                                                />
                                                <span className="truncate text-[13.5px] font-normal">
                                                    {acc.email}
                                                </span>
                                                {acc.remark && (
                                                    <span className="truncate text-[12px] gm-text-3 hidden sm:inline">
                                                        {acc.remark.split('\n')[0]}
                                                    </span>
                                                )}
                                            </span>
                                            <span className="inline-flex items-center gap-3 shrink-0">
                                                <span className={`gm-chip ${isPro ? 'gm-chip-accent' : ''}`}>{badgeText}</span>
                                                <span className="font-mono text-[11.5px] gm-text-3 tabular-nums">
                                                    {timeText ? timeText.slice(5, 16) : '-'}
                                                </span>
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="gm-home-empty">
                                {loading ? '正在加载账号数据…' : '暂无账号记录，可点击导入账号'}
                            </div>
                        )}
                    </section>
                </div>
            </div>

            {/* 右侧竖排统计栏 */}
            <aside className="gm-home-stats" aria-label="账号统计">
                <div className="gm-stat-item gm-stagger-1">
                    <span className="gm-stat-label">总账号</span>
                    <div className="gm-stat-value-row">
                        <span className="gm-stat-value">{stats.total}</span>
                        <span className="gm-stat-unit">个</span>
                    </div>
                </div>

                <div className="gm-stat-item gm-stagger-2">
                    <span className="gm-stat-label">Pro 账号</span>
                    <div className="gm-stat-value-row">
                        <span className="gm-stat-value is-accent">{stats.pro}</span>
                        <span className="gm-stat-unit">个</span>
                    </div>
                </div>

                <div className="gm-stat-item gm-stagger-3">
                    <span className="gm-stat-label">已配接码</span>
                    <div className="gm-stat-value-row">
                        <span className="gm-stat-value">{stats.sms}</span>
                        <span className="gm-stat-unit">个</span>
                    </div>
                </div>

                <div className="gm-stat-item gm-stagger-4">
                    <span className="gm-stat-label">运行中浏览器</span>
                    <div className="gm-stat-value-row">
                        <span className={`gm-stat-value ${stats.runningCount > 0 ? 'is-success' : ''}`}>
                            {stats.runningCount}
                        </span>
                        <span className="gm-stat-unit">个</span>
                    </div>
                </div>
            </aside>
        </div>
    );
};

export default HomeView;
