import { useCallback, useEffect, useState } from 'react';
import { FluentIcon } from './glass';
import { isTauriRuntime } from '../utils/tauriRuntime';

/**
 * 获取当前 Tauri 窗口实例（仅在桌面端运行时加载，非桌面/测试环境安全返回 null）
 */
const getSafeWindow = async () => {
    if (!isTauriRuntime()) return null;
    try {
        const mod = await import('@tauri-apps/api/window');
        return typeof mod?.getCurrentWindow === 'function' ? mod.getCurrentWindow() : null;
    } catch {
        return null;
    }
};

const VIEW_LABELS = {
    home: '首页',
    list: '账号库',
    import: '导入账号',
    recycle: '回收站',
    renewals: '费用与续费',
    agent: 'AI 助手',
    ai: 'AI 订阅',
    cards: 'U 卡与支付卡',
    servers: '服务器',
    terminal: 'SSH 终端',
    domains: '域名管理',
};

/**
 * Windows 11 风格无边框标题栏 (.titlebar)
 * - 独占顶部 38px 空间，右侧集成主题快速切换与 10x10 锐利窗口控制按钮
 * - 完整保留 Tauri 窗口最小化、最大化/还原状态同步及关闭拦截行为
 */
const TitleBar = ({
    view = 'home',
    darkMode = true,
    onToggleDarkMode,
    onRequestClose,
}) => {
    const [maximized, setMaximized] = useState(false);

    const syncMaximized = useCallback(async () => {
        const win = await getSafeWindow();
        if (!win) return;
        try {
            const state = await win.isMaximized();
            setMaximized(Boolean(state));
        } catch {
            // 忽略非桌面或权限未就绪时的查询失败
        }
    }, []);

    useEffect(() => {
        if (!isTauriRuntime()) return undefined;
        let unlisten = null;
        let active = true;

        (async () => {
            const win = await getSafeWindow();
            if (!win || !active) return;
            try {
                const state = await win.isMaximized();
                if (active) setMaximized(Boolean(state));
                if (typeof win.onResized === 'function') {
                    unlisten = await win.onResized(() => {
                        if (active) syncMaximized();
                    });
                }
            } catch {
                // 忽略测试环境异常
            }
        })();

        return () => {
            active = false;
            if (typeof unlisten === 'function') unlisten();
        };
    }, [syncMaximized]);

    const handleMinimize = async () => {
        const win = await getSafeWindow();
        if (!win) return;
        try {
            await win.minimize();
        } catch {
            // 静默兜底
        }
    };

    const handleToggleMaximize = async () => {
        const win = await getSafeWindow();
        if (!win) return;
        try {
            await win.toggleMaximize();
            await syncMaximized();
        } catch {
            // 静默兜底
        }
    };

    const handleClose = async () => {
        if (!isTauriRuntime()) {
            onRequestClose?.();
            return;
        }
        const win = await getSafeWindow();
        if (!win) {
            onRequestClose?.();
            return;
        }
        try {
            await win.close();
        } catch {
            onRequestClose?.();
        }
    };

    const currentLabel = VIEW_LABELS[view] || '工作区';

    return (
        <header className="titlebar" data-tauri-drag-region>
            <div
                className="tb-app"
                data-tauri-drag-region
                onDoubleClick={handleToggleMaximize}
            >
                <span className="tb-mark" aria-hidden="true">G</span>
                <span className="name" data-tauri-drag-region>Google Manager</span>
                <span className="sep" aria-hidden="true" />
                <span className="view" data-tauri-drag-region>{currentLabel}</span>
            </div>

            <div
                className="tb-grow"
                data-tauri-drag-region
                onDoubleClick={handleToggleMaximize}
            />

            {typeof onToggleDarkMode === 'function' && (
                <div className="tb-tools">
                    <button
                        type="button"
                        onClick={onToggleDarkMode}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="gbtn icon"
                        data-theme-mode={darkMode ? 'dark' : 'light'}
                        title={darkMode ? '切换亮色模式' : '切换暗色模式'}
                        aria-label={darkMode ? '切换亮色模式' : '切换暗色模式'}
                    >
                        <FluentIcon name={darkMode ? 'sun' : 'moon'} size={16} />
                    </button>
                </div>
            )}

            <div className="caption" role="group" aria-label="窗口控制">
                <button
                    type="button"
                    onClick={handleMinimize}
                    onMouseDown={(e) => e.stopPropagation()}
                    title="最小化"
                    aria-label="最小化窗口"
                >
                    <svg
                        className="od-icon"
                        viewBox="0 0 10 10"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1"
                        aria-hidden="true"
                    >
                        <path d="M0 5.5h10" />
                    </svg>
                </button>
                <button
                    type="button"
                    onClick={handleToggleMaximize}
                    onMouseDown={(e) => e.stopPropagation()}
                    title={maximized ? '还原窗口' : '最大化窗口'}
                    aria-label={maximized ? '还原窗口' : '最大化窗口'}
                >
                    {maximized ? (
                        <svg
                            className="od-icon"
                            viewBox="0 0 10 10"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1"
                            aria-hidden="true"
                        >
                            <path d="M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z" />
                        </svg>
                    ) : (
                        <svg
                            className="od-icon"
                            viewBox="0 0 10 10"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1"
                            aria-hidden="true"
                        >
                            <path d="M.5.5h9v9h-9z" />
                        </svg>
                    )}
                </button>
                <button
                    type="button"
                    onClick={handleClose}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="close"
                    title="关闭"
                    aria-label="关闭窗口"
                >
                    <svg
                        className="od-icon"
                        viewBox="0 0 10 10"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1"
                        aria-hidden="true"
                    >
                        <path d="M.5.5l9 9M9.5.5l-9 9" />
                    </svg>
                </button>
            </div>
        </header>
    );
};

export default TitleBar;
