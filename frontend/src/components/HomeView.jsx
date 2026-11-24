import { useEffect, useMemo, useState } from 'react';
import { Search, UserPlus, FileDown, Globe, ArrowRight } from 'lucide-react';
import { PixelMascot } from './PixelArt';
import { splitGroupNameValues } from '../utils/multiValueField';
import { formatDbTimestamp } from '../utils/timeUtils';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const formatClock = (date) => {
    const day = WEEKDAYS[date.getDay()];
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${day} ${hh}:${mm}`;
};

const getGreetingByHour = (hour) => {
    if (hour < 6) return '还在忙吗？';
    if (hour < 12) return '早安，开始今天的工作？';
    if (hour < 18) return '下午好，账号状态一切正常';
    return '晚上好，今天还顺利吗？';
};

const parseDbTimeMs = (value) => {
    const raw = formatDbTimestamp(value);
    if (!raw) return 0;
    const ts = Date.parse(raw.replace(' ', 'T'));
    return Number.isNaN(ts) ? 0 : ts;
};

/**
 * MosMos 风格极简首页总览
 */
const HomeView = ({
    accounts = [],
    browserStatuses = {},
    overview = null,
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

    const greeting = getGreetingByHour(now.getHours());

    return (
        <div className="gm-home gm-view-enter">
            {/* 左侧主栏 */}
            <div className="gm-home-main">
                <div className="gm-home-clock" aria-label="当前时间">
                    {formatClock(now)}
                </div>

                <section className="gm-home-hero gm-stagger-1">
                    <div className="gm-home-hero-row">
                        <div
                            onMouseEnter={() => setMascotHover(true)}
                            onMouseLeave={() => setMascotHover(false)}
                            className="inline-flex text-[color:var(--text-primary)] cursor-default shrink-0"
                        >
                            <PixelMascot
                                size={54}
                                variant={loading ? 'loading' : (mascotHover ? 'wave' : 'idle')}
                            />
                        </div>
                        <h1 className="gm-home-greeting">{greeting}</h1>
                    </div>
                    <p className="gm-home-subcopy">
                        在任意视图按 <span className="gm-text-1 font-mono">Ctrl + K</span> 立即检索账号，或直接点击下方快捷入口切入工作。
                    </p>
                </section>

                {/* 复刻 MosMos 无框双行快捷键引导区 */}
                <section className="gm-home-shortcuts gm-stagger-2" aria-label="快捷操作">
                    <div className="gm-home-shortcut-line">
                        <button
                            type="button"
                            onClick={onTriggerSearch}
                            className="gm-shortcut-row"
                        >
                            <span className="gm-shortcut-keys">
                                <kbd className="gm-kbd gm-kbd-lg">Ctrl</kbd>
                                <span className="gm-kbd-plus">+</span>
                                <kbd className="gm-kbd gm-kbd-lg">K</kbd>
                            </span>
                            <span className="gm-shortcut-desc">
                                <span className="sr-only">搜索账号</span>
                                <span>搜索账号，即时检索邮箱、备注或标签</span>
                            </span>
                        </button>
                    </div>

                    <div className="gm-home-shortcut-line">
                        <button
                            type="button"
                            onClick={onTriggerImport}
                            className="gm-shortcut-row"
                        >
                            <span className="gm-shortcut-keys">
                                <kbd className="gm-kbd gm-kbd-lg">Alt</kbd>
                                <span className="gm-kbd-plus">+</span>
                                <kbd className="gm-kbd gm-kbd-lg">N</kbd>
                            </span>
                            <span className="gm-shortcut-desc">
                                <span>导入账号，单条或批量粘贴</span>
                            </span>
                        </button>

                        <button
                            type="button"
                            onClick={onTriggerExport}
                            className="gm-shortcut-row"
                        >
                            <span className="gm-shortcut-keys">
                                <kbd className="gm-kbd gm-kbd-lg">Alt</kbd>
                                <span className="gm-kbd-plus">+</span>
                                <kbd className="gm-kbd gm-kbd-lg">E</kbd>
                            </span>
                            <span className="gm-shortcut-desc">
                                <span>导出账号，自定义格式</span>
                            </span>
                        </button>
                    </div>
                </section>

                {/* 复刻 MosMos 无框纵向双区块：活跃浏览器 → 最近更新 */}
                <div className="gm-home-sections gm-stagger-3">
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
                                    const tags = splitGroupNameValues(acc.groupName);
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

                    {overview && (
                        <section className="gm-home-section" aria-label="数字资产总览">
                            <div className="gm-home-section-head">
                                <h2 className="gm-home-section-title">数字资产工作区</h2>
                                <button
                                    type="button"
                                    onClick={() => onNavigate?.('renewals')}
                                    className="gm-home-more-btn inline-flex items-center gap-1"
                                >
                                    <span>续费与备忘</span>
                                    <ArrowRight size={12} />
                                </button>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                                {[
                                    { id: 'vault', label: '账号密钥', count: overview.vaultItemsCount ?? 0 },
                                    { id: 'ai', label: 'AI 订阅', count: overview.aiSubscriptionsCount ?? 0 },
                                    { id: 'cards', label: '支付卡', count: overview.paymentCardsCount ?? 0 },
                                    { id: 'servers', label: '服务器', count: overview.serversCount ?? 0 },
                                    { id: 'domains', label: '域名', count: overview.domainsCount ?? 0 },
                                ].map(tile => (
                                    <button
                                        key={tile.id}
                                        type="button"
                                        onClick={() => onNavigate?.(tile.id)}
                                        className="gm-card p-3 text-left hover:border-[var(--primary)] transition-colors"
                                    >
                                        <div className="text-[11px] gm-text-3">{tile.label}</div>
                                        <div className="font-mono text-lg font-semibold gm-text-1 mt-0.5">
                                            {tile.count}
                                        </div>
                                    </button>
                                ))}
                            </div>
                            {(overview.upcomingRenewals?.length > 0 || overview.dueReminders?.length > 0) && (
                                <div className="gm-home-list mt-1">
                                    {(overview.upcomingRenewals || []).slice(0, 3).map(item => (
                                        <button
                                            key={`${item.kind}-${item.id}`}
                                            type="button"
                                            onClick={() => onNavigate?.('renewals')}
                                            className="gm-home-row"
                                        >
                                            <span className="truncate text-[13px]">{item.name}</span>
                                            <span className="font-mono text-[11.5px] gm-text-3 shrink-0">
                                                {item.date} ({item.days < 0 ? `已过期 ${Math.abs(item.days)} 天` : `${item.days} 天后`})
                                            </span>
                                        </button>
                                    ))}
                                    {(overview.dueReminders || []).slice(0, 2).map(rem => (
                                        <button
                                            key={`rem-${rem.id}`}
                                            type="button"
                                            onClick={() => onNavigate?.('renewals')}
                                            className="gm-home-row"
                                        >
                                            <span className="truncate text-[13px]">[备忘] {rem.title}</span>
                                            <span className="font-mono text-[11.5px] gm-text-3 shrink-0">{rem.dueAt}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </section>
                    )}
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
