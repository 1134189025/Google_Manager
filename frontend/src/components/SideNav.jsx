import { useState } from 'react';
import { FluentIcon, useLiquidGlass } from './glass';
import { APP_BUILD_TIME, APP_VERSION, buildVersionLabel, formatBuildTime } from '../utils/buildInfo';

const NAV_GROUPS_STORAGE_KEY = 'gm.nav.groups';

const DEFAULT_EXPANDED = {
    workspace: true,
    google: true,
    finance: true,
    infra: true,
    system: true,
};

function readExpandedGroups() {
    try {
        const raw = localStorage.getItem(NAV_GROUPS_STORAGE_KEY);
        if (!raw) return DEFAULT_EXPANDED;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? { ...DEFAULT_EXPANDED, ...parsed } : DEFAULT_EXPANDED;
    } catch {
        return DEFAULT_EXPANDED;
    }
}

/**
 * 悬浮液态玻璃侧边导航 (.sidebar.glass)
 * - 保留完整分组折叠与 localStorage 状态持久化 (gm.nav.groups)
 * - 使用 Microsoft Fluent UI System Icons，选中态自动切换 Filled 实心图标与左侧强调药丸
 */
const SideNav = ({
    view,
    accountsCount = 0,
    overview = null,
    updater,
    onNavigate,
    onOpenBrowserSettings,
    onOpenSystemSettings,
}) => {
    const { closeNav } = useLiquidGlass();
    const versionText = APP_VERSION === 'dev' ? 'dev' : `v${APP_VERSION}`;
    const versionTooltip = `版本 ${buildVersionLabel} · 编译 ${formatBuildTime(APP_BUILD_TIME)}`;

    const [expanded, setExpanded] = useState(readExpandedGroups);

    const toggleGroup = (groupId) => {
        setExpanded(prev => {
            const next = { ...prev, [groupId]: !prev[groupId] };
            try {
                localStorage.setItem(NAV_GROUPS_STORAGE_KEY, JSON.stringify(next));
            } catch {
                // 忽略 storage 不可用环境
            }
            return next;
        });
    };

    const handleSelectView = (nextView) => {
        closeNav();
        onNavigate?.(nextView);
    };

    const groups = [
        {
            id: 'workspace',
            title: '工作台',
            items: [
                { id: 'home', label: '首页', icon: 'home' },
                {
                    id: 'renewals',
                    label: '费用与续费',
                    icon: 'calendar',
                    count: overview?.pendingRemindersCount || 0,
                },
                { id: 'agent', label: 'AI 助手', icon: 'bot' },
            ],
        },
        {
            id: 'google',
            title: '谷歌账号',
            items: [
                { id: 'list', label: '账号列表', icon: 'people', count: accountsCount },
                { id: 'import', label: '导入账号', icon: 'personAdd' },
                { id: 'recycle', label: '回收站', icon: 'trash' },
            ],
        },
        {
            id: 'finance',
            title: '账号与金融',
            items: [
                { id: 'ai', label: 'AI 订阅', icon: 'sparkle', count: overview?.aiSubscriptionsCount || 0 },
                { id: 'cards', label: 'U 卡与支付卡', icon: 'card', count: overview?.paymentCardsCount || 0 },
            ],
        },
        {
            id: 'infra',
            title: '基础设施',
            items: [
                { id: 'servers', label: '服务器', icon: 'server', count: overview?.serversCount || 0 },
                { id: 'terminal', label: 'SSH 终端', icon: 'terminal' },
                { id: 'domains', label: '域名管理', icon: 'globe', count: overview?.domainsCount || 0 },
            ],
        },
    ];

    return (
        <aside className="side-nav sidebar glass" data-lens="sidebar" aria-label="主导航">
            <nav className="nav" aria-label="工作区视图">
                {groups.map(group => {
                    const isOpen = expanded[group.id] !== false;
                    return (
                        <div key={group.id}>
                            <button
                                type="button"
                                className="nav-head"
                                aria-expanded={isOpen}
                                onClick={() => toggleGroup(group.id)}
                            >
                                <span>{group.title}</span>
                                <FluentIcon name="chevDown" />
                            </button>
                            {isOpen && (
                                <ul className="nav-list">
                                    {group.items.map(item => {
                                        const active = view === item.id;
                                        return (
                                            <li key={item.id}>
                                                <button
                                                    type="button"
                                                    onClick={() => handleSelectView(item.id)}
                                                    className={`nav-item ${active ? 'active' : ''}`}
                                                    aria-current={active ? 'page' : undefined}
                                                    title={item.label}
                                                >
                                                    <FluentIcon name={item.icon} filled={active} />
                                                    <span className="label">{item.label}</span>
                                                    {item.count > 0 && (
                                                        <span className="count">{item.count}</span>
                                                    )}
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>
                    );
                })}

                {/* 系统分区 */}
                <div>
                    <button
                        type="button"
                        className="nav-head"
                        aria-expanded={expanded.system !== false}
                        onClick={() => toggleGroup('system')}
                    >
                        <span>系统</span>
                        <FluentIcon name="chevDown" />
                    </button>
                    {expanded.system !== false && (
                        <ul className="nav-list">
                            <li>
                                <button
                                    type="button"
                                    onClick={() => {
                                        closeNav();
                                        onOpenBrowserSettings?.();
                                    }}
                                    className="nav-item"
                                    title="账号浏览器设置"
                                >
                                    <FluentIcon name="browser" />
                                    <span className="label">浏览器设置</span>
                                </button>
                            </li>

                            {onOpenSystemSettings && (
                                <li>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            closeNav();
                                            onOpenSystemSettings();
                                        }}
                                        className="nav-item"
                                        title="系统设置"
                                    >
                                        <FluentIcon name="settings" />
                                        <span className="label">系统设置</span>
                                    </button>
                                </li>
                            )}

                            <li>
                                <button
                                    type="button"
                                    onClick={() => {
                                        closeNav();
                                        updater?.checkNow?.();
                                    }}
                                    className="nav-item"
                                    title={updater?.hasUpdate ? `发现新版本 v${updater.version}，点击查看` : '检查更新'}
                                    aria-label="检查更新"
                                >
                                    <FluentIcon name="sync" />
                                    <span className="label">检查更新</span>
                                    {updater?.hasUpdate && (
                                        <span className="nav-update-pill">更新</span>
                                    )}
                                </button>
                            </li>
                        </ul>
                    )}
                </div>
            </nav>

            {/* 底栏：品牌徽标 + 版本号 + 系统设置快捷入口 */}
            <div className="sidebar-foot">
                <div className="me">
                    <span className="me-mark" aria-hidden="true">G</span>
                    <span className="od-field">
                        <span className="t">Google Manager</span>
                        <span className="s side-nav-version" title={versionTooltip}>
                            {versionText} · 本地数据
                        </span>
                    </span>
                </div>
                {onOpenSystemSettings && (
                    <button
                        type="button"
                        onClick={() => {
                            closeNav();
                            onOpenSystemSettings();
                        }}
                        className="gbtn icon"
                        title="系统设置"
                        aria-label="打开系统设置"
                    >
                        <FluentIcon name="settings" size={18} />
                    </button>
                )}
            </div>
        </aside>
    );
};

export default SideNav;
