import { useCallback, useEffect, useState } from 'react';
import { Minus, Square, Copy, X } from 'lucide-react';
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
    list: '账号列表',
    import: '导入账号',
    recycle: '回收站',
    renewals: '费用与续费',
    agent: 'AI 助手',
    vault: '账号与密钥',
    ai: 'AI 订阅',
    cards: 'U 卡与支付卡',
    servers: '服务器',
    terminal: 'SSH 终端',
    domains: '域名管理',
};

/**
 * 独立无边框顶部标题栏
 * - 独占顶部 38px 空间，与下方内容区严格分离，滚动列表绝不遮挡窗口按钮
 * - 质感与悬浮侧栏保持一致（半透明石墨磨砂 + 极细底分割线 + 统一圆角窗口按钮）
 */
const TitleBar = ({ view = 'home' }) => {
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
        const win = await getSafeWindow();
        if (!win) return;
        try {
            await win.close();
        } catch {
            // 静默兜底
        }
    };

    const currentLabel = VIEW_LABELS[view] || '工作区';

    return (
        <header className="gm-titlebar" data-tauri-drag-region>
            <div
                className="gm-titlebar-drag"
                data-tauri-drag-region
                onDoubleClick={handleToggleMaximize}
            >
                <span className="gm-titlebar-brand" data-tauri-drag-region>
                    <span className="gm-titlebar-pixel" aria-hidden="true" />
                    <span className="gm-titlebar-app" data-tauri-drag-region>GoogleManager</span>
                    <span className="gm-titlebar-sep" aria-hidden="true">/</span>
                    <span className="gm-titlebar-view" data-tauri-drag-region>{currentLabel}</span>
                </span>
            </div>
            <div className="gm-titlebar-controls">
                <button
                    type="button"
                    onClick={handleMinimize}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="gm-titlebar-btn"
                    title="最小化"
                    aria-label="最小化窗口"
                >
                    <Minus size={13} strokeWidth={1.85} />
                </button>
                <button
                    type="button"
                    onClick={handleToggleMaximize}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="gm-titlebar-btn"
                    title={maximized ? '还原窗口' : '最大化窗口'}
                    aria-label={maximized ? '还原窗口' : '最大化窗口'}
                >
                    {maximized
                        ? <Copy size={11.5} strokeWidth={1.85} />
                        : <Square size={11.5} strokeWidth={1.85} />}
                </button>
                <button
                    type="button"
                    onClick={handleClose}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="gm-titlebar-btn gm-titlebar-close"
                    title="关闭"
                    aria-label="关闭窗口"
                >
                    <X size={13.5} strokeWidth={1.85} />
                </button>
            </div>
        </header>
    );
};

export default TitleBar;
