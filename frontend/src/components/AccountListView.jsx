import { useMemo, useState, useCallback, useEffect } from 'react';
import {
    Search,
    Tag,
    FileDown,
    RotateCcw,
    Trash2,
} from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import Pagination from './Pagination';
import usePagination from '../hooks/usePagination';
import useInlineEdit from '../hooks/useInlineEdit';
import useAccountSelection from '../hooks/useAccountSelection';
import useTwoFA from '../hooks/useTwoFA';
import useSmsCodes from '../hooks/useSmsCodes';
import HistoryDrawer from './HistoryDrawer';
import ExportDialog from './ExportDialog';
import BatchToolbar from './BatchToolbar';
import AccountTable from './AccountTable';
import api from '../services/api';
import { splitMultiValueLines } from '../utils/multiValueField';
import { extractPhoneAndSmsUrl } from '../utils/smsUtils';

const REUSABLE_INLINE_FIELDS = ['recovery', 'phone', 'groupName', 'remark', 'regYear', 'country'];
const DEFAULT_EXPORT_CATEGORY_LABEL_TEMPLATE = '{index}. {groupField}: {groupValue}（共 {count} 条）';
const DEFAULT_EXPORT_CONFIG = Object.freeze({
    separator: '----',
    fields: ['email', 'password', 'recovery', 'secret'],
    includeStats: true,
    accountOrder: {
        field: 'id',
        direction: 'desc',
    },
    categorySort: {
        field: '',
        direction: 'asc',
    },
    categoryLabelTemplate: DEFAULT_EXPORT_CATEGORY_LABEL_TEMPLATE,
});

const buildEmptyRecentValues = () =>
    Object.fromEntries(REUSABLE_INLINE_FIELDS.map(field => [field, []]));

const extractReusableCandidates = (field, value) => {
    if (!REUSABLE_INLINE_FIELDS.includes(field)) return [];
    if (value === null || value === undefined) return [];
    return splitMultiValueLines(field, value);
};

const normalizeSortDirection = (direction, fallbackDirection) =>
    direction === 'asc' || direction === 'desc' ? direction : fallbackDirection;

const normalizeExportConfig = (rawConfig) => {
    const rawFields = Array.isArray(rawConfig?.fields)
        ? rawConfig.fields.filter(field => typeof field === 'string' && field.trim() !== '')
        : [];

    const separator = typeof rawConfig?.separator === 'string' && rawConfig.separator !== ''
        ? rawConfig.separator
        : DEFAULT_EXPORT_CONFIG.separator;

    const includeStats = typeof rawConfig?.includeStats === 'boolean'
        ? rawConfig.includeStats
        : DEFAULT_EXPORT_CONFIG.includeStats;

    const accountOrderField = typeof rawConfig?.accountOrder?.field === 'string'
        ? rawConfig.accountOrder.field
        : DEFAULT_EXPORT_CONFIG.accountOrder.field;

    const categorySortField = typeof rawConfig?.categorySort?.field === 'string'
        ? rawConfig.categorySort.field
        : DEFAULT_EXPORT_CONFIG.categorySort.field;

    const categoryLabelTemplate = typeof rawConfig?.categoryLabelTemplate === 'string'
        && rawConfig.categoryLabelTemplate.trim() !== ''
        ? rawConfig.categoryLabelTemplate
        : DEFAULT_EXPORT_CONFIG.categoryLabelTemplate;

    return {
        separator,
        fields: rawFields.length > 0 ? rawFields : [...DEFAULT_EXPORT_CONFIG.fields],
        includeStats,
        accountOrder: {
            field: accountOrderField,
            direction: normalizeSortDirection(
                rawConfig?.accountOrder?.direction,
                DEFAULT_EXPORT_CONFIG.accountOrder.direction
            ),
        },
        categorySort: {
            field: categorySortField,
            direction: normalizeSortDirection(
                rawConfig?.categorySort?.direction,
                DEFAULT_EXPORT_CONFIG.categorySort.direction
            ),
        },
        categoryLabelTemplate,
    };
};

/**
 * 账号列表视图组件（主容器）
 */
const AccountListView = ({
    accounts,
    search,
    setSearch,
    groupFilter,
    setGroupFilter,
    allGroups,
    copyToClipboard,
    twoFACodes: externalTwoFACodes,
    toggleStatus,
    onEdit,
    onDelete,
    onInlineEdit,
    onInlineEditMany,
    onBatchDelete,
    onRefreshAccounts,
    loading,
    onSearchChange,
}) => {
    const [sortConfig, setSortConfig] = useState({ key: null, direction: null });
    const [inlineRecentValuesByField, setInlineRecentValuesByField] = useState(() => buildEmptyRecentValues());

    const sortedAccounts = useMemo(() => {
        if (!sortConfig.key || !sortConfig.direction) return accounts;

        const isEmpty = (value) => value === null || value === undefined || String(value).trim() === '';
        const compareNullableText = (a, b, direction) => {
            const aEmpty = isEmpty(a);
            const bEmpty = isEmpty(b);
            if (aEmpty && bEmpty) return 0;
            if (aEmpty) return direction === 'asc' ? 1 : -1;
            if (bEmpty) return direction === 'asc' ? -1 : 1;
            const result = String(a).localeCompare(String(b), 'zh-CN', { numeric: true, sensitivity: 'base' });
            return direction === 'asc' ? result : -result;
        };

        const direction = sortConfig.direction;
        const sorted = [...accounts].sort((a, b) => {
            switch (sortConfig.key) {
                case 'id': {
                    const aId = Number(a.id) || 0;
                    const bId = Number(b.id) || 0;
                    return direction === 'asc' ? aId - bId : bId - aId;
                }
                case 'email':
                case 'recovery':
                case 'secret':
                case 'phone':
                case 'groupName':
                case 'remark':
                case 'country': {
                    return compareNullableText(a[sortConfig.key], b[sortConfig.key], direction);
                }
                case 'regYear': {
                    const aYear = Number.parseInt(a.regYear, 10);
                    const bYear = Number.parseInt(b.regYear, 10);
                    const aValid = Number.isFinite(aYear) ? aYear : null;
                    const bValid = Number.isFinite(bYear) ? bYear : null;
                    if (aValid === null && bValid === null) return 0;
                    if (aValid === null) return direction === 'asc' ? 1 : -1;
                    if (bValid === null) return direction === 'asc' ? -1 : 1;
                    return direction === 'asc' ? aValid - bValid : bValid - aValid;
                }
                case 'status': {
                    const statusRank = { inactive: 0, pro: 1 };
                    const aStatus = statusRank[a.status] ?? -1;
                    const bStatus = statusRank[b.status] ?? -1;
                    return direction === 'asc' ? aStatus - bStatus : bStatus - aStatus;
                }
                case 'createdAt': {
                    const aTs = Date.parse(a.createdAt || '');
                    const bTs = Date.parse(b.createdAt || '');
                    const aValid = Number.isNaN(aTs) ? null : aTs;
                    const bValid = Number.isNaN(bTs) ? null : bTs;
                    if (aValid === null && bValid === null) {
                        return compareNullableText(a.createdAt, b.createdAt, direction);
                    }
                    if (aValid === null) return direction === 'asc' ? 1 : -1;
                    if (bValid === null) return direction === 'asc' ? -1 : 1;
                    return direction === 'asc' ? aValid - bValid : bValid - aValid;
                }
                default:
                    return 0;
            }
        });

        return sorted;
    }, [accounts, sortConfig]);

    const pagination = usePagination(sortedAccounts, 100);

    // 2FA 验证码：只处理当前页可见账号
    const { twoFACodes: visibleTwoFACodes } = useTwoFA(pagination.paginatedData);
    const twoFACodes = externalTwoFACodes ?? visibleTwoFACodes;

    // 手机短信验证码：只轮询当前页、且已配置接码地址的账号（默认 5 秒一轮）
    const { smsCodes, refresh: refreshSmsCode, reset: resetSmsCode } = useSmsCodes({
        accounts: pagination.paginatedData,
        fetchSmsCode: api.fetchSmsCode,
    });

    // 可复用列的最近 5 条值（用于行内编辑自动补全）
    const accountRecentValuesByField = useMemo(() => {
        const byField = Object.fromEntries(REUSABLE_INLINE_FIELDS.map(field => [field, []]));
        const seenByField = Object.fromEntries(REUSABLE_INLINE_FIELDS.map(field => [field, new Set()]));

        // accounts 默认后端按 id DESC 返回，直接线性扫描可避免每次 n log n 排序
        for (const account of accounts) {
            for (const field of REUSABLE_INLINE_FIELDS) {
                if (byField[field].length >= 5) continue;

                const rawValue = account?.[field];
                if (!rawValue) continue;

                const candidates = splitMultiValueLines(field, rawValue);

                for (const candidate of candidates) {
                    if (!candidate || seenByField[field].has(candidate)) continue;
                    seenByField[field].add(candidate);
                    byField[field].push(candidate);
                    if (byField[field].length >= 5) break;
                }
            }

            if (REUSABLE_INLINE_FIELDS.every(field => byField[field].length >= 5)) break;
        }

        return byField;
    }, [accounts]);

    const recentValuesByField = useMemo(() => {
        const merged = buildEmptyRecentValues();

        for (const field of REUSABLE_INLINE_FIELDS) {
            const result = [];
            const seen = new Set();
            const sources = [
                inlineRecentValuesByField[field] || [],
                accountRecentValuesByField[field] || [],
            ];

            for (const source of sources) {
                for (const item of source) {
                    const normalized = String(item || '').trim();
                    if (!normalized || seen.has(normalized)) continue;
                    seen.add(normalized);
                    result.push(normalized);
                    if (result.length >= 5) break;
                }
                if (result.length >= 5) break;
            }

            merged[field] = result;
        }

        return merged;
    }, [inlineRecentValuesByField, accountRecentValuesByField]);

    const trackRecentInlineValue = useCallback((field, value) => {
        const candidates = extractReusableCandidates(field, value);
        if (candidates.length === 0) return;

        setInlineRecentValuesByField(prev => {
            const next = { ...prev };
            const current = Array.isArray(prev[field]) ? prev[field] : [];
            const updated = [...current];

            for (const candidate of candidates) {
                const existingIndex = updated.indexOf(candidate);
                if (existingIndex >= 0) {
                    updated.splice(existingIndex, 1);
                }
                updated.unshift(candidate);
            }

            next[field] = updated.slice(0, 5);
            return next;
        });
    }, []);

    const handleInlineEditWithRecent = useCallback((id, field, value) => {
        trackRecentInlineValue(field, value);
        if (typeof onInlineEdit === 'function') {
            return onInlineEdit(id, field, value);
        }
        return Promise.resolve(false);
    }, [onInlineEdit, trackRecentInlineValue]);

    /**
     * 一次提交多个字段（例如手机号 + 接码地址这种绑定关系）
     * 逐字段合并为一个补丁，任何一项失败都不部分保存，避免只存一半
     */
    const handleInlineEditManyWithRecent = useCallback((id, patch) => {
        if (!patch || typeof onInlineEditMany !== 'function') return Promise.resolve(false);
        for (const [field, value] of Object.entries(patch)) {
            trackRecentInlineValue(field, value);
        }
        return onInlineEditMany(id, patch);
    }, [onInlineEditMany, trackRecentInlineValue]);
    const inlineEdit = useInlineEdit({
        onInlineEdit: handleInlineEditWithRecent,
        onInlineEditMany: handleInlineEditManyWithRecent,
        getAccount: (id) => accounts.find(account => account.id === id),
        allGroups,
        recentValuesByField,
    });
    const handleSmsRefresh = useCallback((accountId) => {
        return refreshSmsCode(accountId);
    }, [refreshSmsCode]);

    /**
     * 点击手机验证码：只复制验证码本身；
     * 失败时保留的旧验证码会明确提示为「上次获取」，避免误用
     */
    const handleSmsCopy = useCallback((code, label, meta) => {
        if (!code) return;
        if (meta?.stale) {
            copyToClipboard(code, '手机验证码（上次获取）');
            return;
        }
        copyToClipboard(code, label || '手机验证码');
    }, [copyToClipboard]);

    /**
     * 复制号码 + 完整接码地址（结果形如 +12025550123|https://...）
     * 单独成操作，不并入「复制全部信息」，避免无意间带出 token
     */
    const copyPhoneWithSmsUrl = useCallback((acc) => {
        const smsUrl = String(acc?.smsUrl || '').trim();
        const phone = String(acc?.phone || '').trim();
        if (!smsUrl && !phone) return;
        copyToClipboard(`${phone}|${smsUrl}`.replace(/\|$/, ''), '手机号+接码地址');
    }, [copyToClipboard]);

    // 历史抽屉状态
    const [historyDrawer, setHistoryDrawer] = useState({ isOpen: false, account: null });

    // 批量处理状态
    const [isBatchProcessing, setIsBatchProcessing] = useState(false);

    // 导出对话框状态
    const [exportDialog, setExportDialog] = useState({ isOpen: false, mode: 'all' });
    const [recycleDrawer, setRecycleDrawer] = useState({ isOpen: false, loading: false, accounts: [] });

    // 多选 Hook
    const selection = useAccountSelection();
    const currentResultAccountIds = useMemo(
        () => sortedAccounts.map(account => account.id),
        [sortedAccounts]
    );

    const normalizedSearchKeyword = (search || '').trim();
    const hasGroupNameFilter = Boolean(groupFilter);
    const selectedAccountIds = Array.from(selection.selectedIds);
    const selectedAccountsForExport = accounts.filter(account => selection.selectedIds.has(account.id));

    const getCurrentExportMode = () => {
        if (selectedAccountIds.length > 0) return 'selected';
        if (normalizedSearchKeyword || hasGroupNameFilter) return 'filtered';
        return 'all';
    };

    const buildExportRequestParams = (mode) => {
        if (mode === 'selected') {
            return { accountIds: selectedAccountIds, searchParam: null };
        }
        if (mode === 'filtered') {
            if (hasGroupNameFilter) {
                return { accountIds: accounts.map(a => a.id), searchParam: null };
            }
            return {
                accountIds: null,
                searchParam: normalizedSearchKeyword || null,
            };
        }
        return { accountIds: null, searchParam: null };
    };

    const exportScopeCounts = {
        selected: selectedAccountIds.length,
        filtered: accounts.length,
        all: accounts.length,
    };

    const previewAccountsForExport = exportDialog.mode === 'selected'
        ? selectedAccountsForExport
        : accounts;

    // 筛选切换或结果集变更时，清理不在当前结果中的残留选中 ID
    useEffect(() => {
        selection.keepOnlyCurrentResultIds(currentResultAccountIds);
    }, [selection.keepOnlyCurrentResultIds, currentResultAccountIds]);

    const handleSelectAllCurrentResult = useCallback(() => {
        selection.selectAllCurrentResult(currentResultAccountIds);
    }, [selection.selectAllCurrentResult, currentResultAccountIds]);

    const canSelectAllCurrentResult = (
        selection.selectedIds.size > 0 &&
        selection.selectedIds.size < currentResultAccountIds.length
    );

    const handleSortChange = (key) => {
        setSortConfig(prev => {
            if (prev.key === key) {
                return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
            }
            return { key, direction: 'asc' };
        });
        pagination.resetPage();
    };

    // 搜索时重置到第一页
    const handleSearchChange = (e) => {
        setSearch(e.target.value);
        pagination.resetPage();
        if (onSearchChange) onSearchChange(e.target.value);
    };

    // 历史抽屉
    const openHistoryDrawer = (account) => setHistoryDrawer({ isOpen: true, account });
    const closeHistoryDrawer = () => setHistoryDrawer({ isOpen: false, account: null });

    // 复制全部信息
    const copyAllInfo = (acc) => {
        const cleanSecret = acc.secret ? acc.secret.replace(/\s/g, '') : '';
        const fullInfo = `邮箱账号：${acc.email}\n密码：${acc.password}\n恢复邮箱：${acc.recovery}\n手机号：${acc.phone || '无'}\n注册年份：${acc.regYear || '无'}\n国家：${acc.country || '无'}\n谷歌验证码获取：https://2fa.run/2fa/${cleanSecret}\n【账号到手后必备工作】：https://qcn4p837qb99.feishu.cn/wiki/S2bFwQ5vBifHgCkrmgrcAUzlnJd?from=from_copylink`;
        copyToClipboard(fullInfo, '全部信息');
    };

    // 批量删除
    const handleBatchDelete = async () => {
        if (selection.selectedIds.size === 0 || isBatchProcessing) return;
        setIsBatchProcessing(true);
        try {
            await onBatchDelete(selection.selectedIds);
            selection.clearSelection();
        } catch (error) {
            console.error('批量删除失败:', error);
        } finally {
            setIsBatchProcessing(false);
        }
    };

    // 批量编辑
    const handleBatchEdit = useCallback(async (field, fieldLabel) => {
        if (selection.selectedIds.size === 0 || isBatchProcessing) return;

        const value = window.prompt(`请输入要设置的${fieldLabel}（将应用到选中的 ${selection.selectedIds.size} 个账号）：`);
        if (value === null) return;

        if (field === 'regYear' && value.trim() !== '') {
            if (!/^\d{4}$/.test(value.trim())) {
                alert('注册年份必须是4位数字（如：2021）');
                return;
            }
        }

        setIsBatchProcessing(true);
        try {
            const updatePromises = Array.from(selection.selectedIds).map(id =>
                handleInlineEditWithRecent(id, field, value)
                    .then(success => ({ id, success }))
                    .catch(error => {
                        console.error(`更新账号 ${id} 失败:`, error);
                        return { id, success: false, error };
                    })
            );

            const results = await Promise.allSettled(updatePromises);
            const successCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
            const failCount = results.length - successCount;

            if (failCount > 0 && successCount === 0) {
                alert(`批量更新失败，共 ${failCount} 个账号`);
            } else if (failCount > 0) {
                alert(`成功更新 ${successCount} 个账号，${failCount} 个失败`);
            }

            selection.clearSelection();
        } catch (error) {
            console.error('批量编辑失败:', error);
            alert('批量编辑失败');
        } finally {
            setIsBatchProcessing(false);
        }
    }, [selection, isBatchProcessing, handleInlineEditWithRecent]);

    // 导出账号
    const handleOpenExportDialog = () => {
        setExportDialog({ isOpen: true, mode: getCurrentExportMode() });
    };

    const handleExportAccounts = async (config) => {
        try {
            const { accountIds, searchParam } = buildExportRequestParams(exportDialog.mode);
            const normalizedConfig = normalizeExportConfig(config);
            const result = await api.exportAccountsText(accountIds, searchParam, normalizedConfig);

            // TauriAdapter 返回 {success, data} 包装对象
            const textContent = typeof result === 'string' ? result : (result?.data ?? '');
            if (typeof result === 'object' && result !== null && !result.success) {
                alert('导出失败: ' + result.message);
                return;
            }

            const dateStr = new Date().toISOString().split('T')[0];

            if (window.__TAURI__) {
                const filePath = await save({
                    defaultPath: `accounts_export_${dateStr}.txt`,
                    filters: [{ name: 'Text Files', extensions: ['txt'] }]
                });
                if (filePath) {
                    await writeTextFile(filePath, textContent);
                    setExportDialog({ isOpen: false, mode: 'all' });
                    alert('账号导出成功！');
                }
            } else {
                // HTTP 模式：用浏览器原生 Blob 下载
                const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `accounts_export_${dateStr}.txt`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                setExportDialog({ isOpen: false, mode: 'all' });
            }
        } catch (error) {
            console.error('导出账号失败:', error);
            alert('导出失败: ' + error.message);
        }
    };

    const loadDeletedAccounts = async () => {
        setRecycleDrawer(prev => ({ ...prev, loading: true }));
        try {
            const result = await api.getDeletedAccounts();
            if (result.success) {
                setRecycleDrawer(prev => ({ ...prev, accounts: result.data || [], loading: false }));
            } else {
                setRecycleDrawer(prev => ({ ...prev, loading: false }));
                alert(result.message || '加载回收站失败');
            }
        } catch (error) {
            setRecycleDrawer(prev => ({ ...prev, loading: false }));
            alert(error.message || '加载回收站失败');
        }
    };

    const openRecycleDrawer = async () => {
        setRecycleDrawer(prev => ({ ...prev, isOpen: true }));
        await loadDeletedAccounts();
    };

    const closeRecycleDrawer = () => {
        setRecycleDrawer({ isOpen: false, loading: false, accounts: [] });
    };

    const handleRestoreDeleted = async (id) => {
        const result = await api.restoreAccount(id);
        if (!result.success) {
            alert(result.message || '恢复失败');
            return;
        }
        await loadDeletedAccounts();
        if (onRefreshAccounts) {
            await onRefreshAccounts();
        }
    };

    const handlePurgeDeleted = async (id) => {
        if (!window.confirm('确定永久删除该账号吗？此操作不可撤销。')) return;
        const result = await api.purgeAccount(id);
        if (!result.success) {
            alert(result.message || '永久删除失败');
            return;
        }
        await loadDeletedAccounts();
    };

    const handlePurgeAllDeleted = async () => {
        if (!window.confirm('确定清空回收站吗？此操作不可撤销。')) return;
        const result = await api.purgeAllDeleted();
        if (!result.success) {
            alert(result.message || '清空回收站失败');
            return;
        }
        await loadDeletedAccounts();
    };

    return (
        <>
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h1 className="gm-title">账号库</h1>
                        <p className="gm-subtitle">管理您的所有谷歌账号资产</p>
                    </div>
                    <div className="relative w-full md:w-80">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 gm-text-3" size={18} />
                        <input
                            type="text"
                            placeholder="搜索邮箱或备注内容..."
                            value={search}
                            onChange={handleSearchChange}
                            className="gm-input w-full"
                            style={{ paddingLeft: 38 }}
                        />
                    </div>
                </div>

                {/* 筛选与操作按钮 */}
                <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
                    {/* 标签筛选 */}
                    {allGroups && allGroups.length > 0 && (
                        <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1">
                                <Tag size={16} className="gm-text-3" />
                                <span className="text-sm font-medium gm-text-2">标签：</span>
                            </div>
                            <select
                                value={groupFilter || ''}
                                onChange={(e) => { setGroupFilter(e.target.value || null); pagination.resetPage(); }}
                                className="gm-select"
                            >
                                <option value="">全部标签</option>
                                {allGroups.map(group => (
                                    <option key={group} value={group}>{group}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* 导出 / 回收站按钮 */}
                    <div className="flex items-center gap-2 ml-auto">
                        <button
                            onClick={handleOpenExportDialog}
                            className="gm-btn gm-btn-success"
                            title="导出账号为文本文件"
                        >
                            <FileDown size={18} />
                            <span>导出账号</span>
                        </button>
                        <button
                            onClick={openRecycleDrawer}
                            className="gm-btn gm-btn-secondary"
                            title="查看回收站账号"
                        >
                            <Trash2 size={18} />
                            <span>回收站</span>
                        </button>
                    </div>
                </div>

                {/* 批量操作工具栏 */}
                <BatchToolbar
                    selectedCount={selection.selectedIds.size}
                    totalResultCount={currentResultAccountIds.length}
                    canSelectAllCurrentResult={canSelectAllCurrentResult}
                    isBatchProcessing={isBatchProcessing}
                    onSelectAllCurrentResult={handleSelectAllCurrentResult}
                    onBatchEdit={handleBatchEdit}
                    onBatchDelete={handleBatchDelete}
                    onClearSelection={selection.clearSelection}
                />

                {/* 表格 */}
                <AccountTable
                    paginatedData={pagination.paginatedData}
                    pagination={pagination}
                    loading={loading}
                    sortConfig={sortConfig}
                    onSortChange={handleSortChange}
                    selectedIds={selection.selectedIds}
                    onToggleSelectAll={selection.toggleSelectAll}
                    onToggleCheckbox={selection.toggleCheckbox}
                    onRowMouseDown={(e, accId) => selection.handleRowMouseDown(e, accId, pagination.paginatedData, inlineEdit.editingCell)}
                    onRowMouseEnter={(accId) => selection.handleRowMouseEnter(accId, pagination.paginatedData)}
                    editingCell={inlineEdit.editingCell}
                    editValue={inlineEdit.editValue}
                    setEditValue={inlineEdit.setEditValue}
                    inputRef={inlineEdit.inputRef}
                    showSuggestions={inlineEdit.showSuggestions}
                    filteredSuggestions={inlineEdit.filteredSuggestions}
                    onCellClick={(value, label) => inlineEdit.handleCellClick(value, label, copyToClipboard)}
                    onCellDoubleClick={inlineEdit.handleCellDoubleClick}
                    onEditableInputBlur={inlineEdit.handleEditableInputBlur}
                    onKeyDown={inlineEdit.handleKeyDown}
                    onSelectSuggestion={inlineEdit.selectSuggestion}
                    toggleStatus={toggleStatus}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    copyToClipboard={copyToClipboard}
                    copyAllInfo={copyAllInfo}
                    openHistoryDrawer={openHistoryDrawer}
                    twoFACodes={twoFACodes}
                    smsCodes={smsCodes}
                    onSmsRefresh={handleSmsRefresh}
                    onSmsCopy={handleSmsCopy}
                />

                {/* 分页 */}
                {!loading && accounts.length > 0 && (
                    <Pagination
                        currentPage={pagination.currentPage}
                        totalPages={pagination.totalPages}
                        totalItems={pagination.totalItems}
                        pageSize={pagination.pageSize}
                        onPageChange={pagination.goToPage}
                        onPageSizeChange={pagination.changePageSize}
                        hasNextPage={pagination.hasNextPage}
                        hasPrevPage={pagination.hasPrevPage}
                    />
                )}
            </div>

            {/* 历史记录抽屉 */}
            <HistoryDrawer
                isOpen={historyDrawer.isOpen}
                onClose={closeHistoryDrawer}
                account={historyDrawer.account}
            />

            {/* 导出配置对话框 */}
            <ExportDialog
                isOpen={exportDialog.isOpen}
                onClose={() => setExportDialog({ isOpen: false, mode: 'all' })}
                onExport={handleExportAccounts}
                exportMode={exportDialog.mode}
                exportScopeCounts={exportScopeCounts}
                previewAccounts={previewAccountsForExport}
            />

            {recycleDrawer.isOpen && (
                <div className="gm-overlay">
                    <div className="gm-modal max-w-3xl">
                        <div className="gm-modal-header">
                            <div className="flex items-center gap-2">
                                <Trash2 size={18} />
                                <h3 className="text-lg font-semibold gm-text-1">回收站</h3>
                                <span className="gm-chip">
                                    {recycleDrawer.accounts.length} 条
                                </span>
                            </div>
                            <button
                                onClick={closeRecycleDrawer}
                                className="gm-btn gm-btn-ghost gm-btn-sm"
                            >
                                关闭
                            </button>
                        </div>
                        <div className="gm-modal-body max-h-[60vh] overflow-y-auto space-y-2">
                            {recycleDrawer.loading ? (
                                <div className="gm-empty">加载中...</div>
                            ) : recycleDrawer.accounts.length === 0 ? (
                                <div className="gm-empty">回收站为空</div>
                            ) : recycleDrawer.accounts.map(acc => (
                                <div
                                    key={acc.id}
                                    className="gm-solid px-4 py-3 flex items-center justify-between gap-3"
                                >
                                    <div className="min-w-0">
                                        <p className="font-medium truncate gm-text-1">{acc.email}</p>
                                        <p className="text-xs truncate gm-text-3">
                                            删除时间：{acc.deletedAt || '-'}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <button
                                            onClick={() => handleRestoreDeleted(acc.id)}
                                            className="gm-btn gm-btn-success gm-btn-sm"
                                        >
                                            <RotateCcw size={14} />
                                            恢复
                                        </button>
                                        <button
                                            onClick={() => handlePurgeDeleted(acc.id)}
                                            className="gm-btn gm-btn-danger gm-btn-sm"
                                        >
                                            永久删除
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="gm-modal-footer">
                            <button
                                onClick={loadDeletedAccounts}
                                className="gm-btn gm-btn-secondary gm-btn-sm"
                            >
                                刷新
                            </button>
                            <button
                                onClick={handlePurgeAllDeleted}
                                className="gm-btn gm-btn-danger"
                            >
                                清空回收站
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default AccountListView;
