import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';

// 导入服务和组件
import api from './services/api';
import TitleBar from './components/TitleBar';
import SideNav from './components/SideNav';
import HomeView from './components/HomeView';
import AccountListView from './components/AccountListView';
import ImportView from './components/ImportView';
import RecycleView from './components/RecycleView';
import EditModal from './components/EditModal';
import BrowserSettingsDialog from './components/BrowserSettingsDialog';
import UpdateDialog from './components/UpdateDialog';
import { PixelDitherBackdrop } from './components/PixelArt';
import useAppUpdater from './hooks/useAppUpdater';
import useBrowserStatus from './hooks/useBrowserStatus';
import { normalizePhoneNumber } from './utils/phoneUtils';
import { normalizeSmsUrlInput } from './utils/smsUtils';
import { normalizeMultiValueValue, splitGroupNameValues } from './utils/multiValueField';

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

    // 账号浏览器设置弹窗；首次打开浏览器时由列表页/首页等待其结果（是否已保存）
    const [browserSettingsDialog, setBrowserSettingsDialog] = useState({ isOpen: false, firstRun: false });
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
        setView(nextView);
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
            <TitleBar view={view} />

            <div className="app-workspace">
                <SideNav
                    view={view}
                    accountsCount={accounts.length}
                    darkMode={darkMode}
                    updater={updater}
                    onNavigate={navigateToView}
                    onOpenBrowserSettings={() => openBrowserSettings()}
                    onToggleDarkMode={() => setDarkMode(prev => !prev)}
                />

                <main className="main-wrapper">
                    {view === 'home' ? (
                        <HomeView
                            accounts={accounts}
                            browserStatuses={homeBrowserStatuses}
                            loading={loading}
                            onTriggerSearch={triggerSearchAction}
                            onTriggerImport={triggerImportAction}
                            onTriggerExport={triggerExportAction}
                            onNavigateList={() => navigateToView('list')}
                            onOpenBrowser={handleHomeOpenBrowser}
                            onCopyEmail={(email) => copyToClipboard(email, '邮箱')}
                        />
                    ) : view === 'list' ? (
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
                    ) : (
                        <ImportView onImport={handleImport} onCancel={() => navigateToView('list')} importing={importing} />
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
        </div>
    );
};

export default App;
