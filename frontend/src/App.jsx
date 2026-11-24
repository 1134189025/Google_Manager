import React, { Suspense, lazy, useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';

// 导入服务和组件
import api from './services/api';
import TitleBar from './components/TitleBar';
import SideNav from './components/SideNav';
import HomeView from './components/HomeView';
import AccountListView from './components/AccountListView';
import ImportView from './components/ImportView';
import RecycleView from './components/RecycleView';
import RenewalsView from './components/RenewalsView';
import VaultView from './components/VaultView';
import CardsView from './components/CardsView';
import DomainsView from './components/DomainsView';
import AiSubscriptionsView from './components/AiSubscriptionsView';
import ServersView from './components/ServersView';
import AgentView from './components/AgentView';
import EditModal from './components/EditModal';
import BrowserSettingsDialog from './components/BrowserSettingsDialog';
import SystemSettingsDialog from './components/SystemSettingsDialog';
import CloseConfirmDialog from './components/CloseConfirmDialog';
import UpdateDialog from './components/UpdateDialog';
import { PixelDitherBackdrop } from './components/PixelArt';
import { isTauriRuntime } from './utils/tauriRuntime';

const TerminalView = lazy(() => import('./components/TerminalView'));
import useAppUpdater from './hooks/useAppUpdater';
import useBrowserStatus from './hooks/useBrowserStatus';
import { normalizePhoneNumber } from './utils/phoneUtils';
import { normalizeSmsUrlInput } from './utils/smsUtils';
import { normalizeMultiValueValue, splitGroupNameValues } from './utils/multiValueField';
import { DEFAULT_USD_CNY_RATE } from './utils/renewalUtils';

const isTypingTarget = (target) => {
    if (!target || typeof target.tagName !== 'string') return false;
    const tag = target.tagName.toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
};

const App = () => {
    const updater = useAppUpdater();
    const [view, setView] = useState('home');
    const [accounts, setAccounts] = useState([]);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [groupFilter, setGroupFilter] = useState(null);
    const [notification, setNotification] = useState(null);
    const [loading, setLoading] = useState(true);
    const [importing, setImporting] = useState(false);
    const notificationTimerRef = useRef(null);
    const latestLoadRequestIdRef = useRef(0);

    // 跨视图待消费的一次性动作（搜索聚焦 / 导出弹窗 / 回收站抽屉）
    const [pendingListAction, setPendingListAction] = useState(null);
    const listActionSeqRef = useRef(0);

    // Modals state
    const [editingAccount, setEditingAccount] = useState(null);

    // Undo state
    const [deletedAccounts, setDeletedAccounts] = useState([]);
    const [workspaceOverview, setWorkspaceOverview] = useState(null);
    const [fxInfo, setFxInfo] = useState({
        rate: DEFAULT_USD_CNY_RATE,
        updatedAt: '',
        source: '默认参考汇率',
        isFallback: true,
        loading: false,
    });
    const [paymentCardsCache, setPaymentCardsCache] = useState([]);
    const [serversCache, setServersCache] = useState([]);
    const [terminalMounted, setTerminalMounted] = useState(false);
    const [pendingTerminalTarget, setPendingTerminalTarget] = useState(null);
    const terminalTargetSeqRef = useRef(0);

    const refreshOverview = useCallback(async () => {
        if (typeof api?.getWorkspaceOverview !== 'function') return;
        try {
            const res = await api.getWorkspaceOverview();
            if (res?.success && res.data) {
                setWorkspaceOverview(res.data);
            }
        } catch {
            // 测试 mock 未提供扩展接口时静默跳过
        }
    }, []);

    const refreshFxRate = useCallback(async (force = false) => {
        if (typeof api?.getUsdCnyRate !== 'function') return;
        setFxInfo(prev => ({ ...prev, loading: true }));
        try {
            const res = await api.getUsdCnyRate(force);
            if (res?.success && res.data && Number.isFinite(Number(res.data.rate))) {
                setFxInfo({
                    rate: Number(res.data.rate),
                    updatedAt: res.data.updatedAt || '',
                    source: res.data.source || '实时汇率',
                    isFallback: Boolean(res.data.isFallback),
                    loading: false,
                });
                return;
            }
        } catch {
            // 测试 mock 未提供或离线时静默回退
        }
        setFxInfo(prev => ({ ...prev, loading: false }));
    }, []);

    // 账号浏览器设置弹窗；首次打开浏览器时由列表页/首页等待其结果（是否已保存）
    const [browserSettingsDialog, setBrowserSettingsDialog] = useState({ isOpen: false, firstRun: false });
    const [systemSettingsDialog, setSystemSettingsDialog] = useState({ isOpen: false, tab: 'ai' });
    const [closeDialogOpen, setCloseDialogOpen] = useState(false);
    const browserSettingsResolveRef = useRef(null);

    const openBrowserSettings = useCallback(({ firstRun = false } = {}) => new Promise(resolve => {
        browserSettingsResolveRef.current?.(false);
        browserSettingsResolveRef.current = resolve;
        setBrowserSettingsDialog({ isOpen: true, firstRun });
    }), []);

    const closeBrowserSettings = useCallback((saved) => {
        setBrowserSettingsDialog({ isOpen: false, firstRun: false });
        browserSettingsResolveRef.current?.(saved === true);
        browserSettingsResolveRef.current = null;
    }, []);

    // 暗黑优先：无 localStorage 记录时默认开启暗色模式
    const [darkMode, setDarkMode] = useState(() => {
        try {
            const saved = localStorage.getItem('darkMode');
            return saved === null ? true : JSON.parse(saved) === true;
        } catch {
            return true;
        }
    });

    useEffect(() => {
        localStorage.setItem('darkMode', JSON.stringify(darkMode));
        document.documentElement.dataset.theme = darkMode ? 'dark' : 'light';
    }, [darkMode]);

    useEffect(() => {
        return () => {
            if (notificationTimerRef.current) {
                clearTimeout(notificationTimerRef.current);
                notificationTimerRef.current = null;
            }
        };
    }, []);

    // 搜索防抖，避免每次按键都触发后端查询
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(search);
        }, 250);
        return () => clearTimeout(timer);
    }, [search]);

    // --- 加载账号数据 ---
    useEffect(() => {
        loadAccounts(debouncedSearch);
    }, [debouncedSearch]);

    useEffect(() => {
        refreshOverview();
    }, [refreshOverview, accounts.length]);

    useEffect(() => {
        refreshFxRate(false);
    }, [refreshFxRate]);

    useEffect(() => {
        if (view === 'ai' && typeof api?.getPaymentCards === 'function') {
            api.getPaymentCards().then(res => {
                if (res?.success && Array.isArray(res.data)) setPaymentCardsCache(res.data);
            }).catch(() => {});
        }
        if ((view === 'domains' || view === 'servers' || view === 'terminal') && typeof api?.getServers === 'function') {
            api.getServers().then(res => {
                if (res?.success && Array.isArray(res.data)) setServersCache(res.data);
            }).catch(() => {});
        }
        if (view === 'terminal') {
            setTerminalMounted(true);
        }
    }, [view]);

    const loadAccounts = async (searchValue = search) => {
        const requestId = ++latestLoadRequestIdRef.current;
        try {
            setLoading(true);
            const data = await api.getAccounts(searchValue);
            if (requestId !== latestLoadRequestIdRef.current) return;
            setAccounts(data);
        } catch (error) {
            if (requestId !== latestLoadRequestIdRef.current) return;
            console.error('加载账号失败:', error);
            showNotification('加载账号失败', 'error');
        } finally {
            if (requestId !== latestLoadRequestIdRef.current) return;
            setLoading(false);
        }
    };

    // 首页轮询运行中的浏览器，支撑「活跃浏览器」卡片与统计
    const { browserStatuses: homeBrowserStatuses, refresh: refreshHomeBrowserStatus } = useBrowserStatus({
        accounts,
        getBrowserStatuses: api?.getBrowserStatuses,
        enabled: view === 'home',
    });

    // 获取所有唯一的标签
    const allGroups = useMemo(() => {
        const groups = accounts.flatMap(acc => splitGroupNameValues(acc.groupName));
        return [...new Set(groups)].sort((left, right) => left.localeCompare(right, 'zh-CN', { sensitivity: 'base' }));
    }, [accounts]);

    // --- Helpers ---
    const showNotification = useCallback((msg, type = 'success') => {
        setNotification({ msg, type, id: Date.now() });

        if (notificationTimerRef.current) {
            clearTimeout(notificationTimerRef.current);
        }

        notificationTimerRef.current = setTimeout(() => {
            setNotification(null);
            notificationTimerRef.current = null;
        }, 5000);
    }, []);

    const copyToClipboard = useCallback(async (text, label) => {
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            const el = document.createElement('textarea');
            el.value = text;
            el.style.position = 'fixed';
            el.style.opacity = '0';
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
        }
        showNotification(`已复制 ${label} 到剪切板`);
    }, [showNotification]);

    // 跨视图动作分发：写入一次性动作并在 AccountListView 消费后清除，避免重新挂载时重放旧动作
    const navigateToView = useCallback((nextView) => {
        setPendingListAction(null);
        if (nextView === 'terminal') {
            setTerminalMounted(true);
        }
        setView(nextView);
    }, []);

    const handleOpenTerminalForServer = useCallback((server) => {
        if (!server) return;
        terminalTargetSeqRef.current += 1;
        setPendingTerminalTarget({ server, serverId: server.id, seq: terminalTargetSeqRef.current });
        setTerminalMounted(true);
        setView('terminal');
    }, []);

    const consumePendingTerminalTarget = useCallback((seq) => {
        setPendingTerminalTarget(prev => (prev && prev.seq === seq ? null : prev));
    }, []);

    const dispatchListAction = useCallback((type) => {
        listActionSeqRef.current += 1;
        setPendingListAction({ type, id: listActionSeqRef.current });
        setView('list');
    }, []);

    const consumePendingListAction = useCallback((actionId) => {
        setPendingListAction(prev => (prev && prev.id === actionId ? null : prev));
    }, []);

    const triggerSearchAction = useCallback(() => {
        dispatchListAction('search');
    }, [dispatchListAction]);

    const triggerImportAction = useCallback(() => {
        navigateToView('import');
    }, [navigateToView]);

    const triggerExportAction = useCallback(() => {
        dispatchListAction('export');
    }, [dispatchListAction]);

    // 屏蔽桌面端 WebView 默认网页右键菜单（输入框或已选中文本时保留原生复制/粘贴菜单）及 F5/Ctrl+R 刷新
    useEffect(() => {
        const handleContextMenu = (event) => {
            if (isTypingTarget(event.target)) return;
            const selected = typeof window.getSelection === 'function'
                ? String(window.getSelection()?.toString() || '').trim()
                : '';
            if (selected.length > 0) return;
            event.preventDefault();
        };
        const handleRefreshBlock = (event) => {
            const key = String(event.key || '').toLowerCase();
            if (key === 'f5' || ((event.ctrlKey || event.metaKey) && key === 'r')) {
                event.preventDefault();
            }
        };
        window.addEventListener('contextmenu', handleContextMenu);
        window.addEventListener('keydown', handleRefreshBlock);
        return () => {
            window.removeEventListener('contextmenu', handleContextMenu);
            window.removeEventListener('keydown', handleRefreshBlock);
        };
    }, []);

    // 监听 Tauri 主窗口关闭拦截事件（弹出最小化至托盘 / 直接退出选择窗）
    useEffect(() => {
        if (!isTauriRuntime()) return undefined;
        let active = true;
        let unlisten = null;
        (async () => {
            try {
                const mod = await import('@tauri-apps/api/event');
                if (typeof mod?.listen !== 'function' || !active) return;
                const stop = await mod.listen('window-close-requested', () => {
                    if (active) setCloseDialogOpen(true);
                });
                if (active) {
                    unlisten = stop;
                } else if (typeof stop === 'function') {
                    stop();
                }
            } catch {
                // 非桌面或测试环境静默忽略
            }
        })();
        return () => {
            active = false;
            if (typeof unlisten === 'function') unlisten();
        };
    }, []);

    // 全局快捷键：Ctrl/Cmd+K 搜索、Alt+N 导入、Alt+E 导出
    useEffect(() => {
        const handleGlobalKeyDown = (event) => {
            const key = String(event.key || '').toLowerCase();
            if ((event.ctrlKey || event.metaKey) && key === 'k') {
                event.preventDefault();
                triggerSearchAction();
                return;
            }
            if (isTypingTarget(event.target)) return;
            if (event.altKey && !event.ctrlKey && !event.metaKey && key === 'n') {
                event.preventDefault();
                triggerImportAction();
            } else if (event.altKey && !event.ctrlKey && !event.metaKey && key === 'e') {
                event.preventDefault();
                triggerExportAction();
            }
        };
        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, [triggerSearchAction, triggerImportAction, triggerExportAction]);

    // 首页点击活跃浏览器条目切回/打开浏览器
    const handleHomeOpenBrowser = useCallback(async (acc) => {
        try {
            const settingsResult = await api.getBrowserSettings();
            if (settingsResult.success && !settingsResult.data?.configured) {
                const saved = await openBrowserSettings({ firstRun: true });
                if (!saved) return;
            }
            const result = await api.openAccountBrowser(acc.id);
            if (!result.success) {
                showNotification(result.message || '打开浏览器失败', 'error');
                return;
            }
            refreshHomeBrowserStatus();
        } catch {
            showNotification('打开浏览器失败', 'error');
        }
    }, [openBrowserSettings, refreshHomeBrowserStatus, showNotification]);

    // 撤回删除
    const undoDelete = async () => {
        if (deletedAccounts.length === 0) return;
        try {
            const restoreResults = await Promise.allSettled(
                deletedAccounts.map(acc => api.restoreAccount(acc.id))
            );
            const successCount = restoreResults.filter(
                item => item.status === 'fulfilled' && item.value?.success
            ).length;

            if (successCount > 0) {
                await loadAccounts();
                showNotification(`已撤回 ${successCount} 个账号的删除`);
            } else {
                showNotification('撤回失败', 'error');
            }
        } catch (error) {
            console.error('撤回删除失败:', error);
            showNotification('撤回失败', 'error');
        }
        setDeletedAccounts([]);
    };

    const toggleStatus = async (id) => {
        try {
            const result = await api.toggleStatus(id);
            if (result.success) {
                setAccounts(accounts.map(acc =>
                    acc.id === id ? result.data : acc
                ));
            } else {
                showNotification(result.message || '切换状态失败', 'error');
            }
        } catch (error) {
            console.error('切换状态失败:', error);
            showNotification('切换状态失败', 'error');
        }
    };

    // --- Handlers ---
    const handleDelete = async (id) => {
        try {
            const accountToDelete = accounts.find(acc => acc.id === id);

            const result = await api.deleteAccount(id);
            if (result.success) {
                if (accountToDelete) {
                    setDeletedAccounts([accountToDelete]);
                }
                setAccounts(prevAccounts => prevAccounts.filter(acc => acc.id !== id));
                setTimeout(() => showNotification('账号已删除'), 0);
            } else {
                showNotification(result.message || '删除失败', 'error');
            }
        } catch (error) {
            console.error('删除失败:', error);
            showNotification('删除失败', 'error');
        }
    };

    const handleUpdate = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const updated = {
            email: formData.get('email'),
            password: formData.get('password'),
            recovery: formData.get('recovery'),
            phone: normalizePhoneNumber(formData.get('phone') || '') || '',
            secret: (formData.get('secret') || '').replace(/\s/g, ''),
            smsUrl: normalizeSmsUrlInput(formData.get('smsUrl') || ''),
            regYear: formData.get('regYear'),
            country: formData.get('country'),
            groupName: normalizeMultiValueValue('groupName', formData.get('groupName') ?? editingAccount.groupName ?? ''),
            remark: normalizeMultiValueValue('remark', formData.get('remark') ?? ''),
        };

        try {
            const result = await api.updateAccount(editingAccount.id, updated);
            if (result.success) {
                setAccounts(accounts.map(acc =>
                    acc.id === editingAccount.id ? result.data : acc
                ));
                showNotification('账号信息已更新');
            } else {
                showNotification(result.message || '更新失败', 'error');
            }
        } catch (error) {
            console.error('更新失败:', error);
            showNotification('更新失败', 'error');
        }
        setEditingAccount(null);
    };

    const handleImport = async (importedList) => {
        if (importing) return;
        setImporting(true);
        try {
            const result = await api.batchImport(importedList);
            if (result.success) {
                setView('list');
                setSearch('');
                setGroupFilter(null);
                await loadAccounts('');

                const successCount = result.successCount || 0;
                const failCount = result.failCount || 0;
                if (failCount > 0) {
                    showNotification(
                        `成功导入 ${successCount} 个账号，${failCount} 个账号导入失败（可能重复或格式不合法）`,
                        successCount > 0 ? 'success' : 'error'
                    );
                } else {
                    showNotification(`成功导入 ${successCount} 个账号`);
                }
            } else {
                showNotification(result.message || '导入失败', 'error');
            }
        } catch (error) {
            console.error('导入失败:', error);
            showNotification('导入失败', 'error');
        } finally {
            setImporting(false);
        }
    };

    // 行内编辑保存
    const handleInlineEdit = async (id, field, value) => {
        try {
            const account = accounts.find(acc => acc.id === id);
            if (!account) return false;

            const editableFields = new Set(['email', 'password', 'recovery', 'phone', 'secret', 'groupName', 'remark', 'regYear', 'country', 'smsUrl']);
            if (!editableFields.has(field)) {
                return false;
            }

            const normalizedValue = field === 'secret'
                ? String(value || '').replace(/\s/g, '')
                : field === 'phone'
                    ? (normalizePhoneNumber(value) || '')
                    : field === 'smsUrl'
                        ? normalizeSmsUrlInput(value)
                        : (field === 'groupName' || field === 'remark')
                            ? normalizeMultiValueValue(field, value)
                            : value;

            const result = await api.updateAccount(id, { [field]: normalizedValue });
            if (result.success) {
                const updatedAccount = result.data || { ...account, [field]: normalizedValue };
                setAccounts(prevAccounts =>
                    prevAccounts.map(acc => (acc.id === id ? updatedAccount : acc))
                );
                showNotification(field + ' 已更新');
                return true;
            } else {
                showNotification(result.message || '更新失败', 'error');
                return false;
            }
        } catch (error) {
            console.error('更新失败:', error);
            showNotification('更新失败', 'error');
            return false;
        }
    };

    const handleInlineEditMany = async (id, patch) => {
        try {
            const account = accounts.find(acc => acc.id === id);
            if (!account || !patch || typeof patch !== 'object') return false;

            const editableFields = new Set(['email', 'password', 'recovery', 'phone', 'secret', 'groupName', 'remark', 'regYear', 'country', 'smsUrl']);
            const payload = {};
            for (const [field, value] of Object.entries(patch)) {
                if (!editableFields.has(field)) continue;
                payload[field] = field === 'phone'
                    ? (normalizePhoneNumber(value) || '')
                    : field === 'smsUrl'
                        ? normalizeSmsUrlInput(value)
                        : (field === 'groupName' || field === 'remark')
                            ? normalizeMultiValueValue(field, value)
                            : value;
            }
            if (Object.keys(payload).length === 0) return false;

            const result = await api.updateAccount(id, payload);
            if (result.success) {
                const updatedAccount = result.data || { ...account, ...payload };
                setAccounts(prevAccounts =>
                    prevAccounts.map(acc => (acc.id === id ? updatedAccount : acc))
                );
                showNotification('账号信息已更新');
                return true;
            }

            showNotification(result.message || '更新失败', 'error');
            return false;
        } catch (error) {
            console.error('更新失败:', error);
            showNotification('更新失败', 'error');
            return false;
        }
    };

    const handleBatchDelete = async (ids) => {
        const idsArray = Array.from(ids);
        const accountsToDelete = accounts.filter(acc => idsArray.includes(acc.id));

        const deletePromises = idsArray.map(id =>
            api.deleteAccount(id)
                .then(result => ({ id, success: result.success }))
                .catch(error => {
                    console.error(`删除账号 ${id} 失败:`, error);
                    return { id, success: false, error };
                })
        );

        const results = await Promise.allSettled(deletePromises);
        const successfulIds = results
            .filter(r => r.status === 'fulfilled' && r.value.success)
            .map(r => r.value.id);

        if (successfulIds.length > 0) {
            const deletedItems = accountsToDelete.filter(acc => successfulIds.includes(acc.id));
            setDeletedAccounts(deletedItems);
            setAccounts(prevAccounts =>
                prevAccounts.filter(acc => !successfulIds.includes(acc.id))
            );
            setTimeout(() => showNotification(`已删除 ${successfulIds.length} 个账号`), 0);
        }

        const failedCount = results.length - successfulIds.length;
        if (failedCount > 0) {
            showNotification(`${failedCount} 个账号删除失败`, 'error');
        }

        return { successfulIds, failedCount };
    };

    // 账号已由后端筛选搜索，前端额外过滤标签
    const filteredAccounts = useMemo(() => {
        if (!groupFilter) return accounts;
        const filterSet = new Set([groupFilter]);
        return accounts.filter(acc => {
            const tags = splitGroupNameValues(acc.groupName);
            return tags.some(tag => filterSet.has(tag));
        });
    }, [accounts, groupFilter]);

    return (
        <div className="app-container">
            <PixelDitherBackdrop />
            <TitleBar view={view} onRequestClose={() => setCloseDialogOpen(true)} />

            <div className="app-workspace">
                <SideNav
                    view={view}
                    accountsCount={accounts.length}
                    overview={workspaceOverview}
                    darkMode={darkMode}
                    updater={updater}
                    onNavigate={navigateToView}
                    onOpenBrowserSettings={() => openBrowserSettings()}
                    onOpenSystemSettings={() => setSystemSettingsDialog({ isOpen: true, tab: 'ai' })}
                    onToggleDarkMode={() => setDarkMode(prev => !prev)}
                />

                <main className="main-wrapper">
                    {view === 'home' ? (
                        <HomeView
                            accounts={accounts}
                            browserStatuses={homeBrowserStatuses}
                            overview={workspaceOverview}
                            fxInfo={fxInfo}
                            onRefreshFxRate={refreshFxRate}
                            loading={loading}
                            onTriggerSearch={triggerSearchAction}
                            onTriggerImport={triggerImportAction}
                            onTriggerExport={triggerExportAction}
                            onNavigateList={() => navigateToView('list')}
                            onNavigate={navigateToView}
                            onOpenBrowser={handleHomeOpenBrowser}
                            onCopyEmail={(email) => copyToClipboard(email, '邮箱')}
                        />
                    ) : view === 'renewals' ? (
                        <RenewalsView
                            fxInfo={fxInfo}
                            onRefreshFxRate={refreshFxRate}
                            onNotify={showNotification}
                            onNavigate={navigateToView}
                            onOverviewChanged={refreshOverview}
                        />
                    ) : view === 'vault' ? (
                        <VaultView
                            googleAccounts={accounts}
                            onNotify={showNotification}
                            onCopy={copyToClipboard}
                            onOverviewChanged={refreshOverview}
                        />
                    ) : view === 'cards' ? (
                        <CardsView
                            darkMode={darkMode}
                            fxRate={fxInfo.rate}
                            onNotify={showNotification}
                            onCopy={copyToClipboard}
                            onOverviewChanged={refreshOverview}
                        />
                    ) : view === 'domains' ? (
                        <DomainsView
                            servers={serversCache}
                            fxRate={fxInfo.rate}
                            onNotify={showNotification}
                            onOverviewChanged={refreshOverview}
                        />
                    ) : view === 'ai' ? (
                        <AiSubscriptionsView
                            googleAccounts={accounts}
                            paymentCards={paymentCardsCache}
                            fxRate={fxInfo.rate}
                            onNotify={showNotification}
                            onOverviewChanged={refreshOverview}
                        />
                    ) : view === 'servers' ? (
                        <ServersView
                            fxRate={fxInfo.rate}
                            onNotify={showNotification}
                            onOverviewChanged={() => {
                                refreshOverview();
                                if (typeof api?.getServers === 'function') {
                                    api.getServers().then(res => {
                                        if (res?.success && Array.isArray(res.data)) setServersCache(res.data);
                                    }).catch(() => {});
                                }
                            }}
                            onOpenTerminal={handleOpenTerminalForServer}
                            onOpenSystemSettings={(tab = 'monitor') => setSystemSettingsDialog({ isOpen: true, tab })}
                        />
                    ) : view === 'agent' ? (
                        <AgentView
                            onNotify={showNotification}
                            onOpenSystemSettings={(tab = 'ai') => setSystemSettingsDialog({ isOpen: true, tab })}
                            onOverviewChanged={refreshOverview}
                        />
                    ) : view === 'terminal' ? null : view === 'list' ? (
                        <AccountListView
                            accounts={filteredAccounts}
                            search={search}
                            setSearch={setSearch}
                            groupFilter={groupFilter}
                            setGroupFilter={setGroupFilter}
                            allGroups={allGroups}
                            copyToClipboard={copyToClipboard}
                            toggleStatus={toggleStatus}
                            onEdit={setEditingAccount}
                            onDelete={handleDelete}
                            onBatchDelete={handleBatchDelete}
                            onInlineEdit={handleInlineEdit}
                            onInlineEditMany={handleInlineEditMany}
                            onRefreshAccounts={() => loadAccounts()}
                            loading={loading}
                            onNotify={showNotification}
                            openBrowserSettings={openBrowserSettings}
                            pendingAction={pendingListAction}
                            onConsumePendingAction={consumePendingListAction}
                        />
                    ) : view === 'recycle' ? (
                        <RecycleView
                            onRefreshAccounts={() => loadAccounts()}
                            onNotify={showNotification}
                            onNavigateList={() => navigateToView('list')}
                        />
                    ) : view === 'import' ? (
                        <ImportView onImport={handleImport} onCancel={() => navigateToView('list')} importing={importing} />
                    ) : (
                        <div className="max-w-3xl mx-auto gm-card p-8 text-center space-y-2 gm-view-enter">
                            <h2 className="gm-title">模块建设中</h2>
                            <p className="gm-subtitle">该工作区模块将在后续阶段接入。</p>
                        </div>
                    )}

                    {/* 持久挂载懒加载终端，切换左侧视图不中断已连会话 */}
                    {terminalMounted && (
                        <div style={{ display: view === 'terminal' ? 'block' : 'none' }}>
                            <Suspense
                                fallback={
                                    <div className="gm-card p-8 text-center text-xs text-[var(--text-secondary)]">
                                        正在加载 SSH 终端组件...
                                    </div>
                                }
                            >
                                <TerminalView
                                    servers={serversCache}
                                    darkMode={darkMode}
                                    isActiveView={view === 'terminal'}
                                    pendingOpenServer={pendingTerminalTarget}
                                    onConsumePendingOpen={consumePendingTerminalTarget}
                                    onNotify={showNotification}
                                    onNavigateServers={() => navigateToView('servers')}
                                />
                            </Suspense>
                        </div>
                    )}
                </main>
            </div>

            {/* Notification Toast */}
            {notification && (
                <div
                    key={notification.id}
                    className={`gm-toast ${notification.type === 'success' ? 'gm-toast-success' : 'gm-toast-error'}`}
                >
                    {notification.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                    <span className="text-[13px] font-medium">{notification.msg}</span>
                    {deletedAccounts.length > 0 && notification.type === 'success' && (
                        <button onClick={undoDelete} className="gm-toast-action">
                            撤回
                        </button>
                    )}
                    <span className="gm-toast-bar" aria-hidden="true" />
                </div>
            )}

            {/* Edit Modal */}
            <EditModal
                account={editingAccount}
                onClose={() => setEditingAccount(null)}
                onSubmit={handleUpdate}
            />

            <UpdateDialog updater={updater} />

            <BrowserSettingsDialog
                isOpen={browserSettingsDialog.isOpen}
                firstRun={browserSettingsDialog.firstRun}
                onClose={closeBrowserSettings}
                onNotify={showNotification}
            />

            <SystemSettingsDialog
                isOpen={systemSettingsDialog.isOpen}
                initialTab={systemSettingsDialog.tab}
                onClose={() => setSystemSettingsDialog(prev => ({ ...prev, isOpen: false }))}
                onNotify={showNotification}
                onBackupRestored={() => {
                    loadAccounts('');
                    refreshOverview();
                }}
            />

            <CloseConfirmDialog
                isOpen={closeDialogOpen}
                onClose={() => setCloseDialogOpen(false)}
                onNotify={showNotification}
            />
        </div>
    );
};

export default App;
