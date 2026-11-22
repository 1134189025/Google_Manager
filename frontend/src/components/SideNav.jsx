import {
    Home,
    Users,
    UserPlus,
    Trash2,
    Settings,
    RefreshCw,
} from 'lucide-react';
import { PixelMascot } from './PixelArt';
import { APP_BUILD_TIME, APP_VERSION, buildVersionLabel, formatBuildTime } from '../utils/buildInfo';

/**
 * 双半圆对比度图标（MosMos 风格主题切换按钮）
 */
const ContrastIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 2a6 6 0 0 0 0 12V2z" fill="currentColor" />
    </svg>
);

/**
 * MosMos 同款脱离边缘的悬浮圆角侧栏
 */
const SideNav = ({
    view,
    accountsCount = 0,
    darkMode,
    updater,
    onNavigate,
    onOpenBrowserSettings,
    onToggleDarkMode,
}) => {
    const versionText = APP_VERSION === 'dev' ? 'dev' : `v${APP_VERSION}`;
    const versionTooltip = `版本 ${buildVersionLabel} · 编译 ${formatBuildTime(APP_BUILD_TIME)}`;

    return (
        <aside className="side-nav" aria-label="主导航">
            {/* 顶部品牌区：黑白反色圆角徽标 + 标题 */}
            <div className="side-nav-header">
                <div className="side-nav-brand" title="GoogleManager">
                    <PixelMascot size={20} variant="badge" />
                </div>
                <div className="side-nav-brand-text">
                    <span className="side-nav-title">GoogleManager</span>
                    <span className="side-nav-subtitle">个人账号工作区</span>
                </div>
            </div>

            {/* 主导航 */}
            <nav className="nav-items" aria-label="工作区视图">
                <button
                    type="button"
                    onClick={() => onNavigate('home')}
                    className={`nav-item ${view === 'home' ? 'active' : ''}`}
                    title="首页"
                >
                    <Home className="nav-item-icon" size={16} />
                    <span className="nav-item-text">首页</span>
                </button>

                <button
                    type="button"
                    onClick={() => onNavigate('list')}
                    className={`nav-item ${view === 'list' ? 'active' : ''}`}
                    title="账号列表"
                >
                    <Users className="nav-item-icon" size={16} />
                    <span className="nav-item-text">账号列表</span>
                    {accountsCount > 0 && (
                        <span className="nav-item-count">{accountsCount}</span>
                    )}
                </button>

                <button
                    type="button"
                    onClick={() => onNavigate('import')}
                    className={`nav-item ${view === 'import' ? 'active' : ''}`}
                    title="导入账号"
                >
                    <UserPlus className="nav-item-icon" size={16} />
                    <span className="nav-item-text">导入账号</span>
                </button>

                <button
                    type="button"
                    onClick={() => onNavigate('recycle')}
                    className={`nav-item ${view === 'recycle' ? 'active' : ''}`}
                    title="回收站"
                >
                    <Trash2 className="nav-item-icon" size={16} />
                    <span className="nav-item-text">回收站</span>
                </button>
            </nav>

            {/* 系统分区 */}
            <div className="nav-section-divider">系统</div>
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
