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

/**
 * 极简无边框标题栏
 * - 顶部 36px 透明拖拽区，融入画布
 * - 双击拖拽区切换最大化；右上角提供 — □ × 窗口控制
 */
const TitleBar = () => {
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

    return (
        <header className="gm-titlebar" data-tauri-drag-region>
            <div
                className="gm-titlebar-drag"
                data-tauri-drag-region
                onDoubleClick={handleToggleMaximize}
                aria-hidden="true"
            />
            <div className="gm-titlebar-controls">
                <button
                    type="button"
                    onClick={handleMinimize}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="gm-titlebar-btn"
                    title="最小化"
                    aria-label="最小化窗口"
                >
                    <Minus size={14} strokeWidth={1.75} />
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
                        ? <Copy size={12} strokeWidth={1.75} />
                        : <Square size={12} strokeWidth={1.75} />}
                </button>
                <button
                    type="button"
                    onClick={handleClose}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="gm-titlebar-btn gm-titlebar-close"
                    title="关闭"
                    aria-label="关闭窗口"
                >
                    <X size={14} strokeWidth={1.75} />
                </button>
            </div>
        </header>
    );
};

export default TitleBar;
