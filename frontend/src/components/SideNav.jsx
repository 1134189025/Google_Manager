import { useState } from 'react';
import {
    Home,
    Users,
    UserPlus,
    Trash2,
    Settings,
    RefreshCw,
    CalendarClock,
    Bot,
    Sparkles,
    CreditCard,
    Server,
    Terminal,
    Globe,
    SlidersHorizontal,
    ChevronDown,
    ChevronRight,
} from 'lucide-react';
import { PixelMascot } from './PixelArt';
import { APP_BUILD_TIME, APP_VERSION, buildVersionLabel, formatBuildTime } from '../utils/buildInfo';

const ContrastIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 2a6 6 0 0 0 0 12V2z" fill="currentColor" />
    </svg>
);

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
 * 分组可折叠悬浮圆角侧栏
 */
const SideNav = ({
    view,
    accountsCount = 0,
    overview = null,
    darkMode,
    updater,
    onNavigate,
    onOpenBrowserSettings,
    onOpenSystemSettings,
    onToggleDarkMode,
}) => {
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

    const groups = [
        {
            id: 'workspace',
            title: '工作台',
            items: [
                { id: 'home', label: '首页', icon: Home },
                {
                    id: 'renewals',
                    label: '费用与续费',
                    icon: CalendarClock,
                    count: overview?.pendingRemindersCount || 0,
                },
                { id: 'agent', label: 'AI 助手', icon: Bot },
            ],
        },
        {
            id: 'google',
            title: '谷歌账号',
            items: [
                { id: 'list', label: '账号列表', icon: Users, count: accountsCount },
                { id: 'import', label: '导入账号', icon: UserPlus },
                { id: 'recycle', label: '回收站', icon: Trash2 },
            ],
        },
        {
            id: 'finance',
            title: '账号与金融',
            items: [
                { id: 'ai', label: 'AI 订阅', icon: Sparkles, count: overview?.aiSubscriptionsCount || 0 },
                { id: 'cards', label: 'U 卡与支付卡', icon: CreditCard, count: overview?.paymentCardsCount || 0 },
            ],
        },
        {
            id: 'infra',
            title: '基础设施',
            items: [
                { id: 'servers', label: '服务器', icon: Server, count: overview?.serversCount || 0 },
                { id: 'terminal', label: 'SSH 终端', icon: Terminal },
                { id: 'domains', label: '域名管理', icon: Globe, count: overview?.domainsCount || 0 },
            ],
        },
    ];

    return (
        <aside className="side-nav" aria-label="主导航">
            {/* 顶部品牌区 */}
            <div className="side-nav-header">
                <div className="side-nav-brand" title="GoogleManager">
                    <PixelMascot size={20} variant="badge" />
                </div>
                <div className="side-nav-brand-text">
                    <span className="side-nav-title">GoogleManager</span>
                    <span className="side-nav-subtitle">个人数字资产工作区</span>
                </div>
            </div>

            {/* 可滚动分组主导航 */}
            <div className="side-nav-scroll">
                <nav className="nav-items" aria-label="工作区视图">
                    {groups.map(group => {
                        const isOpen = expanded[group.id] !== false;
                        return (
                            <div key={group.id} className="nav-group">
                                <button
                                    type="button"
                                    className="nav-group-toggle"
                                    aria-expanded={isOpen}
                                    onClick={() => toggleGroup(group.id)}
                                >
                                    <span>{group.title}</span>
                                    {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                </button>
                                {isOpen && (
                                    <div className="nav-items">
                                        {group.items.map(item => {
                                            const Icon = item.icon;
                                            return (
                                                <button
                                                    key={item.id}
                                                    type="button"
                                                    onClick={() => onNavigate(item.id)}
                                                    className={`nav-item ${view === item.id ? 'active' : ''}`}
                                                    title={item.label}
                                                >
                                                    <Icon className="nav-item-icon" size={16} />
                                                    <span className="nav-item-text">{item.label}</span>
                                                    {item.count > 0 && (
                                                        <span className="nav-item-count">{item.count}</span>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </nav>

                {/* 系统分区 */}
                <div className="nav-group">
                    <button
                        type="button"
                        className="nav-group-toggle"
                        aria-expanded={expanded.system !== false}
                        onClick={() => toggleGroup('system')}
                    >
                        <span>系统</span>
                        {expanded.system !== false ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </button>
                    {expanded.system !== false && (
                        <div className="nav-items">
                            <button
                                type="button"
                                onClick={onOpenBrowserSettings}
                                className="nav-item"
                                title="账号浏览器设置"
                            >
                                <Settings className="nav-item-icon" size={16} />
                                <span className="nav-item-text">浏览器设置</span>
                            </button>

                            {onOpenSystemSettings && (
                                <button
                                    type="button"
                                    onClick={onOpenSystemSettings}
                                    className="nav-item"
                                    title="系统设置"
                                >
                                    <SlidersHorizontal className="nav-item-icon" size={16} />
                                    <span className="nav-item-text">系统设置</span>
                                </button>
                            )}

                            <button
                                type="button"
                                onClick={() => updater?.checkNow?.()}
                                className="nav-item"
                                title={updater?.hasUpdate ? `发现新版本 v${updater.version}，点击查看` : '检查更新'}
                                aria-label="检查更新"
                            >
                                <RefreshCw className="nav-item-icon" size={16} />
                                <span className="nav-item-text">检查更新</span>
                                {updater?.hasUpdate && (
                                    <span className="nav-update-pill">更新</span>
                                )}
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* 底栏：版本号 + 双半圆主题切换 */}
            <div className="side-nav-footer">
                <span className="side-nav-version" title={versionTooltip}>
                    {versionText}
                </span>
                <button
                    type="button"
                    onClick={onToggleDarkMode}
                    className="gm-theme-toggle"
                    data-theme-mode={darkMode ? 'dark' : 'light'}
                    title={darkMode ? '切换亮色模式' : '切换暗色模式'}
                    aria-label={darkMode ? '切换亮色模式' : '切换暗色模式'}
                >
                    <ContrastIcon />
                </button>
            </div>
        </aside>
    );
};

export default SideNav;
