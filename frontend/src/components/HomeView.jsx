import { useEffect, useMemo, useState } from 'react';
import {
    BrandLogo,
    Chip,
    FluentIcon,
    GlassButton,
    GlassCapsule,
    LogoStack,
    PageToolbar,
} from './glass';
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
    const month = date.getMonth() + 1;
    const dayNum = date.getDate();
    const day = WEEKDAYS[date.getDay()];
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${month}月${dayNum}日 ${day} ${hh}:${mm}`;
};

const getGreetingByHour = (hour) => {
    if (hour < 6) return '夜深了，还在忙吗？';
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

const mapBadgeTone = (tone) => {
    if (tone === 'danger') return 'bad';
    if (tone === 'warning') return 'warn';
    if (tone === 'accent') return 'accent';
    return '';
};

/**
 * Windows 11 Liquid Glass 首页总控台
 * - 顶部粘性工具栏 + 快捷操作玻璃胶囊（Ctrl+K 搜索 / Alt+N 导入 / Alt+E 导出）
 * - 排版数字统计条 + 统一人民币费用概览卡
 * - 即将到期续费与待办备忘双栏 + 8 大数字资产工作区磁贴 + 活跃浏览器与最近更新
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
                icon: 'people',
                value: String(stats.total),
                unit: '个',
                sub: `Pro ${stats.pro} · 接码 ${stats.sms}`,
                brands: ['google', 'gmail'],
                onClick: () => (onNavigateList ? onNavigateList() : onNavigate?.('list')),
            },
            {
                id: 'renewals',
                label: '费用与续费',
                icon: 'calendar',
                value: String(upcomingRenewals.length + pendingRemindersCount),
                unit: '项',
                sub: `到期 ${upcomingRenewals.length} · 备忘 ${pendingRemindersCount}`,
                warn: upcomingRenewals.length > 0,
                brands: [],
                onClick: () => onNavigate?.('renewals'),
            },
            {
                id: 'ai',
                label: 'AI 订阅',
                icon: 'sparkle',
                value: String(overview?.aiSubscriptionsCount ?? 0),
                unit: '项',
                sub: '额度与 OAuth 直连',
                brands: ['openai', 'claude', 'gemini', 'grok'],
                onClick: () => onNavigate?.('ai'),
            },
            {
                id: 'cards',
                label: 'U 卡与支付卡',
                icon: 'card',
                value: String(overview?.paymentCardsCount ?? 0),
                unit: '张',
                sub: '卡面与 CVV 账单',
                brands: ['visa', 'mastercard', 'wise'],
                onClick: () => onNavigate?.('cards'),
            },
            {
                id: 'servers',
                label: '服务器节点',
                icon: 'server',
                value: `${serversOnline}/${serversTotal}`,
                unit: '在线',
                sub: serversTotal > 0 ? `${serversOnline} 台在线运行` : '暂未录入主机',
                brands: ['hetzner', 'vultr', 'digitalocean', 'aws'],
                onClick: () => onNavigate?.('servers'),
            },
            {
                id: 'domains',
                label: '域名管理',
                icon: 'globe',
                value: String(overview?.domainsCount ?? 0),
                unit: '个',
                sub: 'WHOIS 与 CF DNS',
                brands: ['cloudflare', 'namecheap', 'porkbun'],
                onClick: () => onNavigate?.('domains'),
            },
            {
                id: 'terminal',
                label: 'SSH 终端',
                icon: 'terminal',
                value: 'TTY',
                unit: '',
                sub: '多标签与 SFTP',
                brands: ['ubuntu', 'debian', 'docker'],
                onClick: () => onNavigate?.('terminal'),
            },
            {
                id: 'agent',
                label: 'AI 助手',
                icon: 'bot',
                value: 'SAFE',
                unit: '',
                sub: '脱敏洞察与提案',
                brands: [],
                onClick: () => onNavigate?.('agent'),
            },
        ],
        [
            stats.total,
            stats.pro,
            stats.sms,
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
        <>
            <PageToolbar
                title="首页"
                subtitle={formatClock(now)}
                right={
                    <GlassCapsule aria-label="快捷操作">
                        <GlassButton onClick={onTriggerSearch} title="搜索账号 (Ctrl+K)">
                            <FluentIcon name="search" size={16} />
                            <span>搜索账号</span>
                            <kbd className="gm-kbd">Ctrl+K</kbd>
                        </GlassButton>
                        <GlassButton onClick={onTriggerImport} title="导入账号 (Alt+N)">
                            <FluentIcon name="personAdd" size={16} />
                            <span>导入账号</span>
                            <kbd className="gm-kbd">Alt+N</kbd>
                        </GlassButton>
                        <GlassButton onClick={onTriggerExport} title="导出账号 (Alt+E)">
                            <FluentIcon name="export" size={16} />
                            <span>导出账号</span>
                            <kbd className="gm-kbd">Alt+E</kbd>
                        </GlassButton>
                    </GlassCapsule>
                }
            />

            <div className="page page-in">
                <h2 className="hello">{greeting}</h2>
                <p className="hello-sub">
                    当前管理 <b>{stats.total}</b> 个谷歌账号，本月周期费用折合{' '}
                    <b>{formatCnyAmount(unifiedSpend.monthlyCny)}</b>，90 天内有{' '}
                    <b>{upcomingRenewals.length}</b> 项待续费、<b>{pendingRemindersCount}</b> 条待办提醒。
                </p>

                {/* 排版数字统计条（完整保留 aria-label="账号统计" 与 .gm-stat-item / .gm-stat-value） */}
                <section className="figures" aria-label="账号统计">
                    <div className="figure gm-stat-item">
                        <span className="v gm-stat-value">{stats.total}</span>
                        <span className="k">总账号</span>
                    </div>
                    <div className="figure gm-stat-item">
                        <span className="v gm-stat-value" style={{ color: 'var(--accent)' }}>
                            {stats.pro}
                        </span>
                        <span className="k">Pro 账号</span>
                    </div>
                    <div className="figure gm-stat-item">
                        <span className="v gm-stat-value">{stats.sms}</span>
                        <span className="k">已配接码</span>
                    </div>
                    <div className="figure gm-stat-item">
                        <span
                            className="v gm-stat-value"
                            style={{ color: stats.runningCount > 0 ? 'var(--green)' : undefined }}
                        >
                            {stats.runningCount}
                        </span>
                        <span className="k">运行中浏览器</span>
                    </div>
                </section>

                {/* 统一人民币费用结算总览 */}
                <section className="overview group" aria-label="费用结算总览">
                    <div className="ov-main">
                        <span className="k">资产费用总览（统一人民币结算）</span>
                        <div className="flex items-baseline gap-2 flex-wrap">
                            <span className="v">{formatCnyAmount(unifiedSpend.monthlyCny)}</span>
                            <span className="s">/ 月</span>
                        </div>
                        <span className="s">
                            折合年度 <strong style={{ color: 'var(--accent)' }}>{formatCnyAmount(unifiedSpend.yearlyCny)}</strong> / 年
                            {unifiedSpend.usdMonthly > 0
                                ? ` · 含美元 ${formatMoney(unifiedSpend.usdMonthly, 'USD')} → ${formatCnyAmount(unifiedSpend.usdMonthlyInCny)}`
                                : unifiedSpend.onceCny > 0
                                    ? ` · 另含一次性 ${formatCnyAmount(unifiedSpend.onceCny)}`
                                    : unifiedSpend.unpricedCount > 0
                                        ? ` · 尚有 ${unifiedSpend.unpricedCount} 项未填费用`
                                        : ` · 共 ${unifiedSpend.totalPricedCount} 项已标价资产`}
                        </span>
                    </div>

                    <div className="ov-cats">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span
                                className="chip accent font-mono"
                                title={`汇率来源：${effectiveFx.source}`}
                            >
                                1 USD = ¥{unifiedSpend.rate.toFixed(4)}
                            </span>
                            <div className="flex items-center gap-1.5">
                                {typeof onRefreshFxRate === 'function' && (
                                    <button
                                        type="button"
                                        onClick={() => onRefreshFxRate(true)}
                                        disabled={Boolean(effectiveFx.loading)}
                                        className="btn"
                                        style={{ height: 30, padding: '0 10px' }}
                                        aria-label="刷新实时汇率"
                                        title="立即刷新 USD → CNY 实时汇率"
                                    >
                                        <FluentIcon
                                            name="sync"
                                            size={14}
                                            className={effectiveFx.loading ? 'animate-spin' : ''}
                                        />
                                        <span>刷新汇率</span>
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => onNavigate?.('renewals')}
                                    className="btn primary"
                                    style={{ height: 30, padding: '0 12px' }}
                                >
                                    <span>费用详情</span>
                                    <FluentIcon name="chevRight" size={14} />
                                </button>
                            </div>
                        </div>

                        <div className="prov">
                            <FluentIcon name="calendar" size={16} style={{ color: 'var(--orange)' }} />
                            <span>90 天内到期续费</span>
                            <span className="muted font-semibold" style={{ color: 'var(--text)' }}>
                                {upcomingRenewals.length} 项
                            </span>
                        </div>
                        <div className="prov">
                            <FluentIcon name="alert" size={16} style={{ color: 'var(--accent)' }} />
                            <span>待办备忘提醒</span>
                            <span className="muted font-semibold" style={{ color: 'var(--text)' }}>
                                {pendingRemindersCount} 项
                            </span>
                        </div>
                        <div className="prov">
                            <span className="muted" style={{ marginLeft: 0 }}>
                                {effectiveFx.isFallback ? '汇率：缓存/参考' : `实时汇率 · ${effectiveFx.source}`}
                            </span>
                        </div>
                    </div>
                </section>

                {/* 即将到期续费 & 待办备忘提醒双栏 */}
                <div className="section cols">
                    <section aria-label="即将到期续费">
                        <div className="section-h">
                            <h2>即将到期续费</h2>
                            <button
                                type="button"
                                onClick={() => onNavigate?.('renewals')}
                                className="btn link"
                            >
                                <span>处理</span>
                                <FluentIcon name="chevRight" size={14} />
                            </button>
                        </div>
                        <div className="group">
                            {upcomingRenewals.length > 0 ? (
                                <ul className="rows logo-rows">
                                    {upcomingRenewals.slice(0, 5).map(item => {
                                        const badge = formatDaysBadge(item.days);
                                        const cnyAmt = typeof item.billingAmount === 'number'
                                            ? convertToCny(item.billingAmount, item.billingCurrency, unifiedSpend.rate)
                                            : null;
                                        return (
                                            <li key={`${item.kind}-${item.id}`}>
                                                <button
                                                    type="button"
                                                    onClick={() => onNavigate?.('renewals')}
                                                    className="rrow compact w-full text-left border-0 bg-transparent cursor-pointer hover:bg-[var(--row-hover)] transition-colors"
                                                >
                                                    <BrandLogo
                                                        name={item.name}
                                                        hints={[item.provider, item.name, item.kind]}
                                                    />
                                                    <span className="od-field">
                                                        <span className="t od-truncate">{item.name}</span>
                                                        <span className="s od-truncate">
                                                            {formatKindLabel(item.kind)} · {item.date}
                                                        </span>
                                                    </span>
                                                    <Chip tone={mapBadgeTone(badge.tone)}>{badge.text}</Chip>
                                                    <span className="amount">
                                                        {cnyAmt !== null
                                                            ? `${formatCnyAmount(cnyAmt)}/${formatCycleLabel(item.billingCycle)}`
                                                            : '未标价'}
                                                    </span>
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            ) : (
                                <div className="gm-home-empty">近期暂无即将到期的资产续费</div>
                            )}
                        </div>
                    </section>

                    <section aria-label="待办备忘提醒">
                        <div className="section-h">
                            <h2>待办备忘提醒</h2>
                            <button
                                type="button"
                                onClick={() => onNavigate?.('renewals')}
                                className="btn link"
                            >
                                <span>管理</span>
                                <FluentIcon name="chevRight" size={14} />
                            </button>
                        </div>
                        <div className="group">
                            {dueReminders.length > 0 ? (
                                <ul className="rows flush">
                                    {dueReminders.slice(0, 5).map(rem => (
                                        <li key={`rem-${rem.id}`}>
                                            <button
                                                type="button"
                                                onClick={() => onNavigate?.('renewals')}
                                                className="row"
                                            >
                                                <span
                                                    className="app-ico"
                                                    style={{ background: 'var(--accent)', width: 26, height: 26 }}
                                                    aria-hidden="true"
                                                >
                                                    <FluentIcon name="clock" size={14} />
                                                </span>
                                                <span className="od-field od-fill">
                                                    <span className="t od-truncate">{rem.title}</span>
                                                    {rem.note && <span className="s od-truncate">{rem.note}</span>}
                                                </span>
                                                <span className="chip font-mono">{rem.dueAt}</span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <div className="gm-home-empty">
                                    暂无到期备忘提醒，可前往费用与续费页新建
                                </div>
                            )}
                        </div>
                    </section>
                </div>

                {/* 全部 8 大数字资产工作区磁贴 */}
                <section className="section" aria-label="数字资产总览">
                    <div className="section-h">
                        <h2>数字资产工作区</h2>
                        <span className="muted text-[12px]">点击磁贴直达对应模块</span>
                    </div>
                    <div className="assets cols-4">
                        {workspaceTiles.map(tile => (
                            <button
                                key={tile.id}
                                type="button"
                                onClick={tile.onClick}
                                className="asset"
                            >
                                <div className="asset-top">
                                    <FluentIcon name={tile.icon} filled className="asset-ic" />
                                    <span className="asset-name">{tile.label}</span>
                                    <FluentIcon name="chevRight" className="chev" />
                                </div>
                                <div className="asset-num">
                                    <span className="n">{tile.value}</span>
                                    {tile.unit && <span className="u">{tile.unit}</span>}
                                </div>
                                <div className="asset-foot">
                                    {tile.brands.length > 0 && <LogoStack items={tile.brands} max={3} />}
                                    <span className={`asset-meta ${tile.warn ? 'warn' : ''}`}>
                                        {tile.sub}
                                    </span>
                                </div>
                            </button>
                        ))}
                    </div>
                </section>

                {/* 活跃浏览器 + 最近更新谷歌账号 */}
                <div className="section cols">
                    <section aria-label="活跃浏览器">
                        <div className="section-h">
                            <h2>活跃浏览器 · {stats.runningCount}</h2>
                        </div>
                        <div className="group p-4">
                            {stats.runningAccounts.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                    {stats.runningAccounts.slice(0, 6).map(acc => (
                                        <button
                                            key={acc.id}
                                            type="button"
                                            onClick={() => onOpenBrowser?.(acc)}
                                            className="gm-home-browser-pill"
                                            title={`点击切换到 ${acc.email} 的浏览器窗口`}
                                        >
                                            <span
                                                className="signal running"
                                                style={{ marginTop: 0 }}
                                                aria-hidden="true"
                                            />
                                            <span className="truncate">{acc.email}</span>
                                            <FluentIcon name="browser" size={14} />
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div className="gm-home-empty" style={{ padding: '4px 2px' }}>
                                    暂无运行中的独立浏览器
                                </div>
                            )}
                        </div>
                    </section>

                    <section aria-label="最近更新">
                        <div className="section-h">
                            <h2>最近更新</h2>
                            <button
                                type="button"
                                onClick={onNavigateList}
                                className="btn link"
                            >
                                <span>全部</span>
                                <FluentIcon name="chevRight" size={14} />
                            </button>
                        </div>
                        <div className="group">
                            {recentAccounts.length > 0 ? (
                                <ul className="rows flush">
                                    {recentAccounts.map(acc => {
                                        const tags = splitGroupNameValues(acc.groupName, knownCategoryNames);
                                        const badgeText = tags[0] || (acc.status === 'pro' ? 'Pro' : '普通');
                                        const timeText = formatDbTimestamp(acc.updatedAt || acc.createdAt);
                                        const isPro = acc.status === 'pro';
                                        return (
                                            <li key={acc.id}>
                                                <button
                                                    type="button"
                                                    onClick={() => onCopyEmail?.(acc.email)}
                                                    className="row gm-home-row"
                                                    style={{ minHeight: 52 }}
                                                    title="点击复制邮箱"
                                                >
                                                    <span
                                                        className={`signal ${isPro ? 'pro' : ''}`}
                                                        style={{ marginTop: 0 }}
                                                        aria-hidden="true"
                                                    />
                                                    <span className="od-field od-fill">
                                                        <span className="t od-truncate">{acc.email}</span>
                                                        {acc.remark && (
                                                            <span className="s od-truncate">
                                                                {acc.remark.split('\n')[0]}
                                                            </span>
                                                        )}
                                                    </span>
                                                    <Chip tone={isPro ? 'accent' : ''}>{badgeText}</Chip>
                                                    <span className="font-mono text-[11.5px] muted tabular-nums shrink-0">
                                                        {timeText ? timeText.slice(5, 16) : '-'}
                                                    </span>
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            ) : (
                                <div className="gm-home-empty">
                                    {loading ? '正在加载账号数据…' : '暂无账号记录，可点击导入账号'}
                                </div>
                            )}
                        </div>
                    </section>
                </div>
            </div>
        </>
    );
};

export default HomeView;
