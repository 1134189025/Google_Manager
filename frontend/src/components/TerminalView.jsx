import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Terminal as TerminalIcon,
    Plus,
    X,
    ZoomIn,
    ZoomOut,
    Eraser,
    Maximize2,
    Minimize2,
    RotateCw,
    Command,
    ShieldAlert,
    Server,
} from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { listen } from '@tauri-apps/api/event';
import api from '../services/api';
import { parseHostKeyMismatch } from './ServersView';
import { EmptyState, FluentIcon, GlassCapsule, PageToolbar } from './glass';

const FONT_SIZE_KEY = 'gm.terminal.fontSize';

// 只插入命令文本，不自动追加回车，防止误触在生产主机直接执行
export const QUICK_SNIPPETS = [
    { label: '磁盘', command: 'df -h' },
    { label: '内存', command: 'free -h' },
    { label: '负载', command: 'uptime' },
    { label: '进程', command: 'top' },
    { label: '高占用', command: 'ps aux --sort=-%cpu | head -n 15' },
    { label: '端口', command: 'ss -tulpn' },
    { label: '网卡', command: 'ip -br addr' },
    { label: '容器', command: 'docker ps' },
    { label: '失败服务', command: 'systemctl --failed' },
    { label: '系统日志', command: 'journalctl -n 100 --no-pager' },
    { label: '大目录', command: 'du -sh * | sort -rh | head' },
];

function readInitialFontSize() {
    try {
        const raw = Number.parseInt(localStorage.getItem(FONT_SIZE_KEY) || '', 10);
        if (Number.isInteger(raw) && raw >= 11 && raw <= 22) return raw;
    } catch {
        // 忽略存储不可用环境
    }
    return 14;
}

function getTerminalTheme(darkMode) {
    return darkMode
        ? {
              background: '#1b1b1d',
              foreground: '#f5f5f7',
              cursor: '#0a84ff',
              selectionBackground: 'rgba(10, 132, 255, 0.30)',
          }
        : {
              background: '#fbfbfd',
              foreground: '#1d1d1f',
              cursor: '#007aff',
              selectionBackground: 'rgba(0, 122, 255, 0.22)',
          };
}

const TerminalPane = ({
    tab,
    isActive,
    isViewVisible,
    fontSize,
    darkMode,
    registerControls,
    onRetry,
    onResetFingerprint,
}) => {
    const containerRef = useRef(null);
    const termRef = useRef(null);
    const fitRef = useRef(null);
    const sessionIdRef = useRef(tab.sessionId);
    const [fpInput, setFpInput] = useState('');

    useEffect(() => {
        sessionIdRef.current = tab.sessionId;
    }, [tab.sessionId]);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return undefined;

        const term = new Terminal({
            fontSize,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            cursorBlink: true,
            scrollback: 5000,
            theme: getTerminalTheme(darkMode),
        });
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(el);
        try {
            fitAddon.fit();
        } catch {
            // 隐藏容器初始化阶段可能暂无尺寸
        }

        const dataDisposable = term.onData((data) => {
            const sid = sessionIdRef.current;
            if (sid) {
                api.sshWriteSession?.(sid, data);
            }
        });

        termRef.current = term;
        fitRef.current = fitAddon;

        registerControls(tab.tabId, {
            writeOutput: (chunk) => term.write(chunk),
            clear: () => term.clear(),
            focus: () => term.focus(),
            fitAndResize: () => {
                try {
                    fitAddon.fit();
                    const sid = sessionIdRef.current;
                    if (sid && term.cols > 0 && term.rows > 0) {
                        api.sshResizeSession?.(sid, term.cols, term.rows);
                    }
                } catch {
                    // 忽略无尺寸阶段异常
                }
            },
            getDimensions: () => ({ cols: term.cols || 100, rows: term.rows || 30 }),
        });

        let ro = null;
        if (typeof ResizeObserver !== 'undefined') {
            ro = new ResizeObserver(() => {
                if (!el.offsetParent && el.clientWidth === 0) return;
                try {
                    fitAddon.fit();
                    const sid = sessionIdRef.current;
                    if (sid && term.cols > 0 && term.rows > 0) {
                        api.sshResizeSession?.(sid, term.cols, term.rows);
                    }
                } catch {
                    // 忽略
                }
            });
            ro.observe(el);
        }

        return () => {
            ro?.disconnect();
            dataDisposable?.dispose?.();
            registerControls(tab.tabId, null);
            term.dispose();
            termRef.current = null;
            fitRef.current = null;
        };
        // 仅按 tabId 挂载一次，确保切换页签与页面不重建终端实例
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab.tabId]);

    useEffect(() => {
        const term = termRef.current;
        if (!term) return;
        term.options.fontSize = fontSize;
        term.options.theme = getTerminalTheme(darkMode);
        if (isActive && isViewVisible) {
            try {
                fitRef.current?.fit();
                if (tab.sessionId && term.cols > 0 && term.rows > 0) {
                    api.sshResizeSession?.(tab.sessionId, term.cols, term.rows);
                }
            } catch {
                // 忽略
            }
        }
    }, [fontSize, darkMode, isActive, isViewVisible, tab.sessionId]);

    useEffect(() => {
        if (isActive && isViewVisible) {
            try {
                fitRef.current?.fit();
                termRef.current?.focus();
            } catch {
                // 忽略
            }
        }
    }, [isActive, isViewVisible]);

    const expectedHostPort = `${tab.host}:${tab.port}`;

    return (
        <div
            className="relative flex-1 min-h-[380px] rounded-lg overflow-hidden border border-[var(--border-subtle)]"
            style={{
                display: isActive ? 'flex' : 'none',
                flexDirection: 'column',
                background: getTerminalTheme(darkMode).background,
            }}
        >
            {tab.mismatch ? (
                <div className="p-6 max-w-lg mx-auto my-auto space-y-3 bg-[var(--bg-surface)] rounded-xl border border-[var(--border-subtle)] text-xs">
                    <div className="flex items-center gap-2 text-[var(--danger)] font-semibold text-sm">
                        <ShieldAlert size={18} />
                        SSH 主机指纹已变更，连接已拦截
                    </div>
                    <p className="text-[var(--text-secondary)]">
                        主机 <span className="font-mono text-[var(--text-primary)]">{expectedHostPort}</span> 公钥与已钉扎记录不一致。
                    </p>
                    <div className="rounded p-2.5 bg-[var(--bg-elevated)] font-mono space-y-1">
                        <div>原指纹：{tab.mismatch.expected}</div>
                        <div className="text-[var(--danger)]">新指纹：{tab.mismatch.actual}</div>
                    </div>
                    <form
                        className="space-y-2"
                        onSubmit={e => {
                            e.preventDefault();
                            if (fpInput.trim() === expectedHostPort) {
                                onResetFingerprint(tab);
                            }
                        }}
                    >
                        <input
                            className="gm-input w-full font-mono"
                            placeholder={`输入 ${expectedHostPort} 确认重置并重连`}
                            value={fpInput}
                            onChange={e => setFpInput(e.target.value)}
                        />
                        <div className="flex justify-end gap-2">
                            <button
                                type="submit"
                                className="gm-btn gm-btn-danger text-xs"
                                disabled={fpInput.trim() !== expectedHostPort}
                            >
                                重置指纹并重连
                            </button>
                        </div>
                    </form>
                </div>
            ) : (
                <>
                    {tab.status !== 'open' && (
                        <div className="px-3 py-2 text-xs flex items-center justify-between bg-[var(--bg-elevated)] border-b border-[var(--border-subtle)]">
                            <span className={tab.status === 'error' ? 'text-[var(--danger)]' : 'text-[var(--text-secondary)]'}>
                                {tab.status === 'connecting'
                                    ? `正在连接 ${tab.username || 'root'}@${tab.host}:${tab.port}...`
                                    : tab.error || '连接已断开'}
                            </span>
                            {(tab.status === 'closed' || tab.status === 'error') && (
                                <button
                                    type="button"
                                    className="gm-btn gm-btn-primary text-xs py-1 px-2.5"
                                    onClick={() => onRetry(tab)}
                                >
                                    <RotateCw size={12} />
                                    重新连接
                                </button>
                            )}
                        </div>
                    )}
                    <div
                        ref={containerRef}
                        className="flex-1 w-full p-2"
                        data-testid={`xterm-container-${tab.tabId}`}
                    />
                </>
            )}
        </div>
    );
};

const TerminalView = ({
    servers = [],
    darkMode = true,
    isActiveView = true,
    pendingOpenServer = null,
    onConsumePendingOpen,
    onNotify,
    onNavigateServers,
}) => {
    const [tabs, setTabs] = useState([]);
    const [activeTabId, setActiveTabId] = useState(null);
    const [fontSize, setFontSize] = useState(readInitialFontSize);
    const [snippetsOpen, setSnippetsOpen] = useState(true);
    const [focusMode, setFocusMode] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);

    const controlsMapRef = useRef(new Map());
    const tabsRef = useRef([]);
    const tabSeqRef = useRef(0);

    useEffect(() => {
        tabsRef.current = tabs;
    }, [tabs]);

    const registerControls = useCallback((tabId, controls) => {
        if (controls) {
            controlsMapRef.current.set(tabId, controls);
        } else {
            controlsMapRef.current.delete(tabId);
        }
    }, []);

    // 监听来自 Rust 后端的 ssh-output 与 ssh-closed 事件
    useEffect(() => {
        let disposed = false;
        let unlistenOut = null;
        let unlistenClosed = null;

        const subscribe = async () => {
            try {
                unlistenOut = await listen('ssh-output', (event) => {
                    if (disposed || !event?.payload) return;
                    const payload = event.payload;
                    const sid = payload.session_id ?? payload.sessionId;
                    const data = payload.data ?? '';
                    const tab = tabsRef.current.find(t => t.sessionId === sid);
                    if (tab) {
                        controlsMapRef.current.get(tab.tabId)?.writeOutput(data);
                    }
                });
                unlistenClosed = await listen('ssh-closed', (event) => {
                    if (disposed || !event?.payload) return;
                    const payload = event.payload;
                    const sid = payload.session_id ?? payload.sessionId;
                    const reason = payload.reason || '远程连接已关闭';
                    setTabs(prev =>
                        prev.map(t =>
                            t.sessionId === sid ? { ...t, status: 'closed', error: reason } : t,
                        ),
                    );
                });
            } catch {
                // 非 Tauri 环境静默忽略
            }
        };
        subscribe();

        return () => {
            disposed = true;
            if (typeof unlistenOut === 'function') unlistenOut();
            if (typeof unlistenClosed === 'function') unlistenClosed();
        };
    }, []);

    const connectTab = useCallback(
        async (tabId, server) => {
            const dims = controlsMapRef.current.get(tabId)?.getDimensions() || { cols: 100, rows: 30 };
            setTabs(prev =>
                prev.map(t =>
                    t.tabId === tabId
                        ? { ...t, status: 'connecting', error: '', mismatch: null }
                        : t,
                ),
            );
            const res = await api.sshOpenSession(server.id, dims.cols, dims.rows);
            if (res.success && res.data) {
                const sid = res.data.sessionId;
                setTabs(prev =>
                    prev.map(t =>
                        t.tabId === tabId
                            ? { ...t, sessionId: sid, status: 'open', error: '', mismatch: null }
                            : t,
                    ),
                );
                controlsMapRef.current.get(tabId)?.focus();
                return;
            }
            const mismatch = parseHostKeyMismatch(res.message);
            setTabs(prev =>
                prev.map(t =>
                    t.tabId === tabId
                        ? {
                              ...t,
                              sessionId: null,
                              status: 'error',
                              error: res.message || '连接 SSH 失败',
                              mismatch,
                          }
                        : t,
                ),
            );
            onNotify?.(mismatch ? 'SSH 主机指纹已变更' : res.message || '连接 SSH 失败', 'error');
        },
        [onNotify],
    );

    const openServerTab = useCallback(
        (server) => {
            if (!server) return;
            tabSeqRef.current += 1;
            const tabId = `ssh-tab-${tabSeqRef.current}`;
            const newTab = {
                tabId,
                sessionId: null,
                serverId: server.id,
                serverName: server.name,
                host: server.host,
                port: server.port,
                username: server.username,
                status: 'connecting',
                error: '',
                mismatch: null,
            };
            setTabs(prev => [...prev, newTab]);
            setActiveTabId(tabId);
            setPickerOpen(false);
            connectTab(tabId, server);
        },
        [connectTab],
    );

    // 处理从「服务器台账 -> 打开终端」跳转过来的目标服务器
    useEffect(() => {
        if (!pendingOpenServer?.seq) return;
        const target =
            pendingOpenServer.server ||
            servers.find(s => s.id === pendingOpenServer.serverId);
        if (target) {
            openServerTab(target);
        }
        onConsumePendingOpen?.(pendingOpenServer.seq);
    }, [pendingOpenServer, servers, openServerTab, onConsumePendingOpen]);

    const closeTab = useCallback(
        async (tab) => {
            if (tab.sessionId) {
                await api.sshCloseSession?.(tab.sessionId);
            }
            setTabs(prev => {
                const next = prev.filter(t => t.tabId !== tab.tabId);
                if (activeTabId === tab.tabId) {
                    setActiveTabId(next.length > 0 ? next[next.length - 1].tabId : null);
                }
                return next;
            });
        },
        [activeTabId],
    );

    const activeTab = useMemo(
        () => tabs.find(t => t.tabId === activeTabId) || null,
        [tabs, activeTabId],
    );

    const updateFontSize = (delta) => {
        setFontSize(prev => {
            const next = Math.max(11, Math.min(22, prev + delta));
            try {
                localStorage.setItem(FONT_SIZE_KEY, String(next));
            } catch {
                // 忽略
            }
            return next;
        });
    };

    const handleInsertSnippet = async (snippet) => {
        if (!activeTab?.sessionId || activeTab.status !== 'open') {
            onNotify?.('当前没有已连接的终端会话', 'error');
            return;
        }
        // 仅插入命令文本，不自动发送回车
        await api.sshWriteSession?.(activeTab.sessionId, snippet.command);
        controlsMapRef.current.get(activeTab.tabId)?.focus();
    };

    const handleRetryTab = (tab) => {
        const srv = servers.find(s => s.id === tab.serverId) || {
            id: tab.serverId,
            name: tab.serverName,
            host: tab.host,
            port: tab.port,
            username: tab.username,
        };
        connectTab(tab.tabId, srv);
    };

    const handleResetFingerprintAndRetry = async (tab) => {
        const res = await api.resetServerHostFingerprint(tab.serverId);
        if (!res.success) {
            onNotify?.(res.message || '重置主机指纹失败', 'error');
            return;
        }
        onNotify?.('已清除旧指纹，正在重新建立连接');
        handleRetryTab(tab);
    };

    const toolbarControls = (
        <GlassCapsule>
            <button
                type="button"
                className="gbtn icon"
                onClick={() => updateFontSize(-1)}
                title="减小字号"
                aria-label="减小字号"
            >
                <ZoomOut size={14} />
            </button>
            <span className="text-[11px] font-mono muted px-1 tabular-nums">
                {fontSize}px
            </span>
            <button
                type="button"
                className="gbtn icon"
                onClick={() => updateFontSize(1)}
                title="增大字号"
                aria-label="增大字号"
            >
                <ZoomIn size={14} />
            </button>
            <button
                type="button"
                className="gbtn icon"
                onClick={() => {
                    if (activeTab) {
                        controlsMapRef.current.get(activeTab.tabId)?.clear();
                        controlsMapRef.current.get(activeTab.tabId)?.focus();
                    }
                }}
                title="清空屏幕"
                aria-label="清空屏幕"
                disabled={!activeTab}
            >
                <Eraser size={14} />
            </button>
            <button
                type="button"
                className={`gbtn ${snippetsOpen ? 'prominent glass' : ''}`}
                onClick={() => setSnippetsOpen(v => !v)}
                title="快捷命令条"
            >
                <Command size={13} />
                <span>快捷命令</span>
            </button>
            <button
                type="button"
                className="gbtn icon"
                onClick={() => setFocusMode(v => !v)}
                title={focusMode ? '退出专注模式' : '专注模式'}
                aria-label={focusMode ? '退出专注模式' : '专注模式'}
            >
                {focusMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
        </GlassCapsule>
    );

    return (
        <>
            {!focusMode && (
                <PageToolbar
                    title="SSH 终端"
                    subtitle="多标签持久化会话 · 切换视图不中断"
                    right={toolbarControls}
                />
            )}

            <div
                className={`${
                    focusMode
                        ? 'fixed inset-0 z-50 p-4 bg-[var(--win)] h-screen'
                        : 'page page-full page-in'
                } flex flex-col gap-3`}
                style={focusMode ? undefined : { height: 'calc(100vh - var(--titlebar-h) - 82px)', paddingBottom: 20 }}
            >
                {/* 顶部标签栏 */}
                <div className="gm-card px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 overflow-x-auto">
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)] pr-2">
                            <FluentIcon name="terminal" size={16} style={{ color: 'var(--accent)' }} />
                            <span>会话标签</span>
                        </span>
                        {tabs.map(tab => (
                            <div
                                key={tab.tabId}
                                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border transition-colors ${
                                    tab.tabId === activeTabId
                                        ? 'bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--text-primary)] font-semibold'
                                        : 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-secondary)]'
                                }`}
                            >
                                <button
                                    type="button"
                                    className="flex items-center gap-1.5"
                                    onClick={() => setActiveTabId(tab.tabId)}
                                >
                                    <span
                                        className="w-2 h-2 rounded-full"
                                        style={{
                                            background:
                                                tab.status === 'open'
                                                    ? 'var(--success)'
                                                    : tab.status === 'connecting'
                                                        ? 'var(--warning)'
                                                        : 'var(--danger)',
                                        }}
                                    />
                                    <span>{tab.serverName}</span>
                                </button>
                                <button
                                    type="button"
                                    className="hover:text-[var(--danger)]"
                                    onClick={() => closeTab(tab)}
                                    aria-label={`关闭标签 ${tab.serverName}`}
                                >
                                    <X size={12} />
                                </button>
                            </div>
                        ))}
                        <div className="relative">
                            <button
                                type="button"
                                className="btn"
                                style={{ height: 28, padding: '0 10px', fontSize: '12px' }}
                                onClick={() => setPickerOpen(v => !v)}
                            >
                                <Plus size={13} />
                                <span>新建连接</span>
                            </button>
                            {pickerOpen && (
                                <div className="gm-panel glass absolute left-0 top-full mt-1 w-64 p-2 z-30 space-y-1" data-lens="panel">
                                    {servers.length === 0 ? (
                                        <div className="p-2 text-xs text-[var(--text-secondary)] space-y-2">
                                            <div>暂无可用服务器</div>
                                            {onNavigateServers && (
                                                <button
                                                    type="button"
                                                    className="gm-btn gm-btn-primary text-xs w-full"
                                                    onClick={() => {
                                                        setPickerOpen(false);
                                                        onNavigateServers();
                                                    }}
                                                >
                                                    前往添加服务器
                                                </button>
                                            )}
                                        </div>
                                    ) : (
                                        servers.map(srv => (
                                            <button
                                                key={srv.id}
                                                type="button"
                                                className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-xs flex items-center justify-between gap-2"
                                                onClick={() => openServerTab(srv)}
                                            >
                                                <span className="truncate font-medium text-[var(--text-primary)]">
                                                    {srv.name}
                                                </span>
                                                <span className="font-mono text-[10px] text-[var(--text-muted)] shrink-0">
                                                    {srv.host}
                                                </span>
                                            </button>
                                        ))
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {focusMode && toolbarControls}
                </div>

                {/* 快捷运维命令条（只插入不自动回车） */}
                {snippetsOpen && (
                    <div className="gm-card px-3 py-2 flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] text-[var(--text-secondary)] mr-1">
                            快捷命令（点击插入不回车）：
                        </span>
                        {QUICK_SNIPPETS.map(item => (
                            <button
                                key={item.label}
                                type="button"
                                className="gm-btn gm-btn-ghost text-xs py-0.5 px-2"
                                onClick={() => handleInsertSnippet(item)}
                                title={item.command}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>
                )}

                {/* 主终端区域或空状态 */}
                {tabs.length === 0 ? (
                    <div className="group flex-1 flex flex-col items-center justify-center p-8 text-center">
                        <EmptyState
                            icon="terminal"
                            title="选择一个服务器开启多标签 SSH 会话"
                            description="切换左侧工作区视图时，已打开的终端标签将保持连接不中断。"
                            action={
                                servers.length > 0 ? (
                                    <div className="flex flex-wrap justify-center gap-2 max-w-xl mt-3">
                                        {servers.map(srv => (
                                            <button
                                                key={srv.id}
                                                type="button"
                                                className="btn primary"
                                                onClick={() => openServerTab(srv)}
                                            >
                                                <TerminalIcon size={13} />
                                                <span>连接 {srv.name}</span>
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    onNavigateServers && (
                                        <button
                                            type="button"
                                            className="btn primary mt-3"
                                            onClick={onNavigateServers}
                                        >
                                            前往服务器台账添加主机
                                        </button>
                                    )
                                )
                            }
                        />
                    </div>
                ) : (
                    <div className="flex-1 flex flex-col min-h-0">
                        {tabs.map(tab => (
                            <TerminalPane
                                key={tab.tabId}
                                tab={tab}
                                isActive={tab.tabId === activeTabId}
                                isViewVisible={isActiveView}
                                fontSize={fontSize}
                                darkMode={darkMode}
                                registerControls={registerControls}
                                onRetry={handleRetryTab}
                                onResetFingerprint={handleResetFingerprintAndRetry}
                            />
                        ))}
                    </div>
                )}
            </div>
        </>
    );
};

export default TerminalView;
