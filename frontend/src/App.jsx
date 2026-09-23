import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
    Users,
    UserPlus,
    ShieldCheck,
    CheckCircle2,
    Moon,
    Sun,
    Settings
} from 'lucide-react';

// 导入服务和组件
import api from './services/api';
import AccountListView from './components/AccountListView';
import ImportView from './components/ImportView';
import EditModal from './components/EditModal';
import BrowserSettingsDialog from './components/BrowserSettingsDialog';
import { normalizePhoneNumber } from './utils/phoneUtils';
import { normalizeSmsUrlInput } from './utils/smsUtils';
import { normalizeMultiValueValue, splitGroupNameValues } from './utils/multiValueField';
import { APP_BUILD_TIME, buildVersionLabel, formatBuildTime } from './utils/buildInfo';

const App = () => {
    const [view, setView] = useState('list');
    const [accounts, setAccounts] = useState([]);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [groupFilter, setGroupFilter] = useState(null);
    const [notification, setNotification] = useState(null);
    const [loading, setLoading] = useState(true);
    const [importing, setImporting] = useState(false);
    const notificationTimerRef = useRef(null);
    const latestLoadRequestIdRef = useRef(0);

    // Modals state
    const [editingAccount, setEditingAccount] = useState(null);

    // Undo state
    const [deletedAccounts, setDeletedAccounts] = useState([]);

    // 账号浏览器设置弹窗；首次打开浏览器时由列表页等待其结果（是否已保存）
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


    // 暗色模式状态
    const [darkMode, setDarkMode] = useState(() => {
        // 从 localStorage 读取用户偏好（容忍非法值，避免整体渲染失败）
        try {
            const saved = localStorage.getItem('darkMode');
            return saved === null ? false : JSON.parse(saved) === true;
        } catch {
            return false;
        }
    });
    // 保存暗色模式设置到 localStorage，并同步到 <html data-theme>
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

    // 获取所有唯一的标签
    const allGroups = useMemo(() => {
        const groups = accounts.flatMap(acc => splitGroupNameValues(acc.groupName));
        return [...new Set(groups)].sort((left, right) => left.localeCompare(right, 'zh-CN', { sensitivity: 'base' }));
    }, [accounts]);


    // --- Helpers ---
    const showNotification = (msg, type = 'success') => {
        setNotification({ msg, type });

        if (notificationTimerRef.current) {
            clearTimeout(notificationTimerRef.current);
        }

        notificationTimerRef.current = setTimeout(() => {
            setNotification(null);
            notificationTimerRef.current = null;
        }, 5000);
    };

    const copyToClipboard = async (text, label) => {
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
    };

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
            // 保存要删除的账号用于撤回
            const accountToDelete = accounts.find(acc => acc.id === id);

            const result = await api.deleteAccount(id);
            if (result.success) {
                // 先设置 deletedAccounts，再更新 accounts
                if (accountToDelete) {
                    setDeletedAccounts([accountToDelete]);
                }
                setAccounts(prevAccounts => prevAccounts.filter(acc => acc.id !== id));
                // 使用 setTimeout 确保状态更新后再显示通知
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
                // 导入完成后重置筛选，避免“导入后看不到数据”
                setView('list');
                setSearch('');
                setGroupFilter(null);
                await loadAccounts('');

                // 显示导入结果 - 使用API返回的属性名
                const successCount = result.successCount || 0;
                const failCount = result.failCount || 0;
                if (failCount > 0) {
                    // 失败可能来自重复账号、格式问题或字段校验失败
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

                // 当 secret 字段更新时，2FA 验证码会由 AccountListView 内部自动更新
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

    /**
     * 多字段原子更新（手机号 + 接码地址这种绑定关系必须一起提交）
     * 后端 update_account 接收完整账号补丁，任何一项失败都不会部分保存
     */
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

    // 批量删除处理
    const handleBatchDelete = async (ids) => {
        const idsArray = Array.from(ids);

        // 先保存要删除的账号用于撤回
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

        // 收集成功删除的 ID
        const successfulIds = results
            .filter(r => r.status === 'fulfilled' && r.value.success)
            .map(r => r.value.id);

        // 更新 accounts 状态，移除已删除的账号
        if (successfulIds.length > 0) {
            // 保存成功删除的账号用于撤回
            const deletedItems = accountsToDelete.filter(acc => successfulIds.includes(acc.id));
            setDeletedAccounts(deletedItems);
            setAccounts(prevAccounts =>
                prevAccounts.filter(acc => !successfulIds.includes(acc.id))
            );
            // 使用 setTimeout 确保状态更新后再显示通知
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

        // 使用 Set 替代 array.includes() 以提高性能
        const filterSet = new Set([groupFilter]);

        return accounts.filter(acc => {
            const tags = splitGroupNameValues(acc.groupName);
            return tags.some(tag => filterSet.has(tag));
        });
    }, [accounts, groupFilter]);

    return (
        <div className="app-container">
            <aside className="side-nav">
                <div className="side-nav-brand" title="GoogleManager">
                    <ShieldCheck size={22} />
                </div>

                <div className="nav-items">
                    <button
                        onClick={() => setView('list')}
                        className={`nav-item ${view === 'list' ? 'active' : ''}`}
                        title="账号列表"
                    >
                        <Users className="nav-item-icon" size={20} />
                        <span className="nav-item-text">账号列表</span>
                    </button>
                    <button
                        onClick={() => setView('import')}
                        className={`nav-item ${view === 'import' ? 'active' : ''}`}
                        title="导入账号"
                    >
                        <UserPlus className="nav-item-icon" size={20} />
                        <span className="nav-item-text">导入账号</span>
                    </button>
                </div>

                <div className="side-nav-footer">
                    <button
                        onClick={() => openBrowserSettings()}
                        className="gm-icon-btn"
                        title="账号浏览器设置"
                    >
                        <Settings size={18} />
                    </button>
                    <button
                        onClick={() => setDarkMode(!darkMode)}
                        className="gm-icon-btn"
                        title={darkMode ? '切换亮色模式' : '切换暗色模式'}
                    >
                        {darkMode ? <Sun size={18} /> : <Moon size={18} />}
                    </button>
                    <div
                        className="side-nav-version"
                        title={`版本 ${buildVersionLabel} · 编译 ${APP_BUILD_TIME || '未知'}`}
                    >
                        版本 {buildVersionLabel}
                        <br />
                        编译 {formatBuildTime(APP_BUILD_TIME)}
                    </div>
                </div>
            </aside>

            <main className="main-wrapper">
                {view === 'list' ? (
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
                    />
                ) : (
                    <ImportView onImport={handleImport} onCancel={() => setView('list')} importing={importing} />
                )}
            </main>

            {/* Notification Toast */}
            {notification && (
                <div className={`gm-toast ${notification.type === 'success' ? 'gm-toast-success' : 'gm-toast-error'}`}>
                    <CheckCircle2 size={20} />
                    <span style={{ fontWeight: 500 }}>{notification.msg}</span>
                    {deletedAccounts.length > 0 && notification.type === 'success' && (
                        <button onClick={undoDelete} className="gm-toast-action">
                            撤回
                        </button>
                    )}
                </div>
            )}

            {/* Edit Modal */}
            <EditModal
                account={editingAccount}
                onClose={() => setEditingAccount(null)}
                onSubmit={handleUpdate}
            />

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
