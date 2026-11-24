import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import {
    Search,
    X,
    FileDown,
    FolderPlus,
    SlidersHorizontal,
    Plus,
    Check,
} from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import Pagination from './Pagination';
import usePagination from '../hooks/usePagination';
import useInlineEdit from '../hooks/useInlineEdit';
import useAccountSelection from '../hooks/useAccountSelection';
import useTwoFA from '../hooks/useTwoFA';
import useSmsCodes from '../hooks/useSmsCodes';
import useBrowserStatus from '../hooks/useBrowserStatus';
import HistoryDrawer from './HistoryDrawer';
import ExportDialog from './ExportDialog';
import PromptDialog from './PromptDialog';
import AccountCategoryDialog from './AccountCategoryDialog';
import BatchToolbar from './BatchToolbar';
import AccountTable from './AccountTable';
import api from '../services/api';
import {
    getCategoryColorMeta,
    joinMultiValueLines,
    splitDelimitedGroupNames,
    splitGroupNameValues,
    splitMultiValueLines,
    UNCATEGORIZED_FILTER_KEY,
} from '../utils/multiValueField';
import { describeClearCacheResult } from '../utils/browserUtils';
import { isTauriRuntime } from '../utils/tauriRuntime';
import { messageDialog } from '../utils/dialogs';
import { renderInBody } from '../utils/portal';

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

const extractReusableCandidates = (field, value, knownCategories = null) => {
    if (!REUSABLE_INLINE_FIELDS.includes(field)) return [];
    if (value === null || value === undefined) return [];
    return splitMultiValueLines(field, value, knownCategories);
};

const normalizeSortDirection = (direction, fallbackDirection) =>
    direction === 'asc' || direction === 'desc' ? direction : fallbackDirection;

const pad2 = (value) => String(value).padStart(2, '0');

/** 本机日期 YYYY-MM-DD（toISOString 是 UTC，东八区凌晨会得到前一天） */
const formatLocalDate = (date) =>
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

/** 路径中的文件名（兼容 / 与 \） */
const baseName = (path) => String(path || '').split(/[\\/]/).pop();

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
    allAccounts = null,
    accountCategories = [],
    onCreateCategory,
    onUpdateCategory,
    onDeleteCategory,
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
    onNotify,
    openBrowserSettings,
    pendingAction = null,
    onConsumePendingAction,
}) => {
    const [sortConfig, setSortConfig] = useState({ key: null, direction: null });
    const [inlineRecentValuesByField, setInlineRecentValuesByField] = useState(() => buildEmptyRecentValues());
    const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
    const searchInputRef = useRef(null);
    const handledActionIdRef = useRef(0);

    const knownCategoryNames = useMemo(
        () => accountCategories.map(cat => cat.name).filter(Boolean),
        [accountCategories],
    );

    const categoryColorMap = useMemo(() => {
        const map = {};
        for (const cat of accountCategories) {
            if (cat?.name) map[cat.name] = cat.color || 'blue';
        }
        return map;
    }, [accountCategories]);

    const countSourceAccounts = useMemo(
        () => (Array.isArray(allAccounts) ? allAccounts : accounts),
        [allAccounts, accounts],
    );

    const { categoryCounts, uncategorizedCount, adHocTags } = useMemo(() => {
        const counts = {};
        let uncategorized = 0;
        const formalByLower = new Map();
        for (const name of knownCategoryNames) {
            formalByLower.set(name.toLowerCase(), name);
        }
        const adHocSet = new Set();
        const adHocLowerSet = new Set();

        for (const acc of countSourceAccounts) {
            const tags = splitGroupNameValues(acc?.groupName, knownCategoryNames);
            if (tags.length === 0) {
                uncategorized += 1;
                continue;
            }
            const accountCountedKeys = new Set();
            for (const tag of tags) {
                const lower = tag.toLowerCase();
                const canonical = formalByLower.get(lower) || tag;
                if (!accountCountedKeys.has(canonical.toLowerCase())) {
                    accountCountedKeys.add(canonical.toLowerCase());
                    counts[canonical] = (counts[canonical] || 0) + 1;
                }
                if (!formalByLower.has(lower) && !adHocLowerSet.has(lower)) {
                    adHocLowerSet.add(lower);
                    adHocSet.add(tag);
                }
            }
        }

        return {
            categoryCounts: counts,
            uncategorizedCount: uncategorized,
            adHocTags: Array.from(adHocSet).sort((a, b) => a.localeCompare(b, 'zh-CN', { sensitivity: 'base' })),
        };
    }, [countSourceAccounts, knownCategoryNames]);

    const mergedGroups = useMemo(() => {
        const seenLower = new Set();
        const list = [];
        for (const name of knownCategoryNames) {
            const lower = name.toLowerCase();
            if (!seenLower.has(lower)) {
                seenLower.add(lower);
                list.push(name);
            }
        }
        for (const name of (allGroups || [])) {
            const lower = String(name || '').toLowerCase();
            if (name && !seenLower.has(lower)) {
                seenLower.add(lower);
                list.push(name);
            }
        }
        return list;
    }, [knownCategoryNames, allGroups]);

    // 错误提示：优先用右上角提示条，没有时退回系统提示框
    const notifyError = useCallback((msg) => {
        if (onNotify) {
            onNotify(msg, 'error');
        } else {
            messageDialog(msg, { kind: 'error' });
        }
    }, [onNotify]);

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
    const { smsCodes, refresh: refreshSmsCode } = useSmsCodes({
        accounts: pagination.paginatedData,
        fetchSmsCode: api.fetchSmsCode,
    });

    // 账号独立浏览器：只查当前页账号的配置目录状态（默认 3 秒一轮）
    const { browserStatuses, refresh: refreshBrowserStatus } = useBrowserStatus({
        accounts: pagination.paginatedData,
        getBrowserStatuses: api.getBrowserStatuses,
    });
    const [openingBrowserIds, setOpeningBrowserIds] = useState(() => new Set());
    const openingBrowserIdsRef = useRef(new Set());

    const setBrowserOpening = useCallback((accountId, opening) => {
        if (opening) openingBrowserIdsRef.current.add(accountId);
        else openingBrowserIdsRef.current.delete(accountId);
        setOpeningBrowserIds(new Set(openingBrowserIdsRef.current));
    }, []);

    const handleOpenBrowser = useCallback(async (acc) => {
        if (openingBrowserIdsRef.current.has(acc.id)) return;
        setBrowserOpening(acc.id, true);
        try {
            const settingsResult = await api.getBrowserSettings();
            if (settingsResult.success && !settingsResult.data?.configured && openBrowserSettings) {
                const saved = await openBrowserSettings({ firstRun: true });
                if (!saved) return;
            }

            const copyEmail = async () => {
                try {
                    await copyToClipboard(acc.email, '邮箱');
                } catch (error) {
                    console.warn('复制邮箱失败:', error);
                }
            };

            const expectFirstLaunch = (browserStatuses[acc.email] || 'none') === 'none';
            if (expectFirstLaunch) await copyEmail();

            const result = await api.openAccountBrowser(acc.id);
            if (!result.success) {
                notifyError(result.message || '打开浏览器失败');
                return;
            }

            if (result.data?.firstLaunch) {
                if (!expectFirstLaunch) await copyEmail();
                onNotify?.('已打开 Google 登录页并复制邮箱；密码、2FA 码和短信码可在表格里点击复制');
            }

            refreshBrowserStatus();
            setTimeout(refreshBrowserStatus, 1500);
        } finally {
            setBrowserOpening(acc.id, false);
        }
    }, [browserStatuses, copyToClipboard, notifyError, onNotify, openBrowserSettings, refreshBrowserStatus, setBrowserOpening]);

    // 可复用列的最近 5 条值（用于行内编辑自动补全）
    const accountRecentValuesByField = useMemo(() => {
        const byField = Object.fromEntries(REUSABLE_INLINE_FIELDS.map(field => [field, []]));
        const seenByField = Object.fromEntries(REUSABLE_INLINE_FIELDS.map(field => [field, new Set()]));

        for (const account of accounts) {
            for (const field of REUSABLE_INLINE_FIELDS) {
                if (byField[field].length >= 5) continue;

                const rawValue = account?.[field];
                if (!rawValue) continue;

                const candidates = splitMultiValueLines(field, rawValue, knownCategoryNames);

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
    }, [accounts, knownCategoryNames]);

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
        const candidates = extractReusableCandidates(field, value, knownCategoryNames);
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
    }, [knownCategoryNames]);

    const handleInlineEditWithRecent = useCallback((id, field, value) => {
        trackRecentInlineValue(field, value);
        if (typeof onInlineEdit === 'function') {
            return onInlineEdit(id, field, value);
        }
        return Promise.resolve(false);
    }, [onInlineEdit, trackRecentInlineValue]);

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
        allGroups: mergedGroups,
        knownCategoryNames,
        recentValuesByField,
    });

    const handleSmsRefresh = useCallback((accountId) => {
        return refreshSmsCode(accountId);
    }, [refreshSmsCode]);

    const handleSmsCopy = useCallback((code, label, meta) => {
        if (!code) return;
        if (meta?.stale) {
            copyToClipboard(code, '手机验证码（上次获取）');
            return;
        }
        copyToClipboard(code, label || '手机验证码');
    }, [copyToClipboard]);

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

    const getCurrentExportMode = useCallback(() => {
        if (selectedAccountIds.length > 0) return 'selected';
        if (normalizedSearchKeyword || hasGroupNameFilter) return 'filtered';
        return 'all';
    }, [selectedAccountIds.length, normalizedSearchKeyword, hasGroupNameFilter]);

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

    const handleSearchChange = (e) => {
        setSearch(e.target.value);
        pagination.resetPage();
        if (onSearchChange) onSearchChange(e.target.value);
    };

    const openHistoryDrawer = (account) => setHistoryDrawer({ isOpen: true, account });
    const closeHistoryDrawer = () => setHistoryDrawer({ isOpen: false, account: null });

    const copyAllInfo = (acc) => {
        const cleanSecret = acc.secret ? acc.secret.replace(/\s/g, '') : '';
        const twoFALink = cleanSecret ? `https://2fa.run/2fa/${cleanSecret}` : '无';
        const fullInfo = `邮箱账号：${acc.email}\n密码：${acc.password}\n恢复邮箱：${acc.recovery || '无'}\n手机号：${acc.phone || '无'}\n注册年份：${acc.regYear || '无'}\n国家：${acc.country || '无'}\n谷歌验证码获取：${twoFALink}\n【账号到手后必备工作】：https://qcn4p837qb99.feishu.cn/wiki/S2bFwQ5vBifHgCkrmgrcAUzlnJd?from=from_copylink`;
        copyToClipboard(fullInfo, '全部信息');
    };

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

    const [batchEditPrompt, setBatchEditPrompt] = useState(null);
    const [batchCategoryModal, setBatchCategoryModal] = useState(null); // { count }
    const [batchSelectedCats, setBatchSelectedCats] = useState([]);
    const [batchCustomTagInput, setBatchCustomTagInput] = useState('');
    const [batchCategoryMode, setBatchCategoryMode] = useState('replace'); // 'replace' | 'append'
    const [batchQuickCatName, setBatchQuickCatName] = useState('');
    const [batchQuickCatError, setBatchQuickCatError] = useState('');
    const [batchCategoryError, setBatchCategoryError] = useState('');
    const [creatingBatchQuickCat, setCreatingBatchQuickCat] = useState(false);

    const handleCloseCategoryDialog = useCallback(() => {
        setCategoryDialogOpen(false);
    }, []);

    useEffect(() => {
        if (!batchCategoryModal) return undefined;
        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                setBatchCategoryModal(null);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [batchCategoryModal]);

    const handleBatchEdit = useCallback((field, fieldLabel) => {
        if (selection.selectedIds.size === 0 || isBatchProcessing) return;
        if (field === 'groupName') {
            setBatchSelectedCats([]);
            setBatchCustomTagInput('');
            setBatchCategoryMode('replace');
            setBatchQuickCatName('');
            setBatchQuickCatError('');
            setBatchCategoryError('');
            setBatchCategoryModal({ count: selection.selectedIds.size });
            return;
        }
        setBatchEditPrompt({ field, fieldLabel, count: selection.selectedIds.size });
    }, [selection, isBatchProcessing]);

    const toggleBatchSelectedCat = (catName) => {
        if (batchCategoryError) setBatchCategoryError('');
        setBatchSelectedCats(prev =>
            prev.includes(catName) ? prev.filter(n => n !== catName) : [...prev, catName],
        );
    };

    const handleCreateBatchQuickCategory = async () => {
        const trimmed = batchQuickCatName.trim();
        if (!trimmed || creatingBatchQuickCat || typeof onCreateCategory !== 'function') return;
        setBatchQuickCatError('');
        setCreatingBatchQuickCat(true);
        try {
            const res = await onCreateCategory({ name: trimmed, color: 'blue' });
            if (res?.success && res.data?.name) {
                setBatchSelectedCats(prev => (prev.includes(res.data.name) ? prev : [...prev, res.data.name]));
                setBatchQuickCatName('');
                if (batchCategoryError) setBatchCategoryError('');
            } else {
                setBatchQuickCatError(res?.message || '添加分类失败');
            }
        } finally {
            setCreatingBatchQuickCat(false);
        }
    };

    const applyBatchCategoryAssignment = async (e) => {
        e.preventDefault();
        if (selection.selectedIds.size === 0 || isBatchProcessing) return;

        const extraTags = splitDelimitedGroupNames(batchCustomTagInput);
        const chosenTags = [];
        const seen = new Set();
        for (const tag of [...batchSelectedCats, ...extraTags]) {
            const clean = String(tag || '').trim();
            if (clean && !seen.has(clean)) {
                seen.add(clean);
                chosenTags.push(clean);
            }
        }

        const mode = batchCategoryMode;
        if (mode === 'append' && chosenTags.length === 0) {
            setBatchCategoryError('追加模式下请至少选择一个分类或输入自定义标签');
            return;
        }

        setBatchCategoryError('');
        const selectedIds = Array.from(selection.selectedIds);
        setBatchCategoryModal(null);
        setIsBatchProcessing(true);
        try {
            const accountMap = new Map(accounts.map(acc => [acc.id, acc]));
            const updatePromises = selectedIds.map(id => {
                let nextVal;
                if (mode === 'append') {
                    const existing = splitGroupNameValues(accountMap.get(id)?.groupName, knownCategoryNames);
                    nextVal = joinMultiValueLines([...existing, ...chosenTags]);
                } else {
                    nextVal = joinMultiValueLines(chosenTags);
                }
                return handleInlineEditWithRecent(id, 'groupName', nextVal)
                    .then(success => ({ id, success }))
                    .catch(error => {
                        console.error(`更新账号 ${id} 分类失败:`, error);
                        return { id, success: false, error };
                    });
            });

            const results = await Promise.allSettled(updatePromises);
            const successCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
            const failCount = results.length - successCount;

            if (failCount > 0 && successCount === 0) {
                notifyError(`批量分类失败，共 ${failCount} 个账号`);
            } else if (failCount > 0) {
                notifyError(`成功更新 ${successCount} 个账号，${failCount} 个失败`);
            } else {
                onNotify?.(`已更新 ${successCount} 个账号`);
            }
            selection.clearSelection();
        } finally {
            setIsBatchProcessing(false);
        }
    };

    const applyBatchEdit = useCallback(async (field, value) => {
        if (field === 'regYear' && value.trim() !== '') {
            if (!/^\d{4}$/.test(value.trim())) {
                return '注册年份必须是4位数字（如：2021）';
            }
        }

        setBatchEditPrompt(null);
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
                notifyError(`批量更新失败，共 ${failCount} 个账号`);
            } else if (failCount > 0) {
                notifyError(`成功更新 ${successCount} 个账号，${failCount} 个失败`);
            } else {
                onNotify?.(`已更新 ${successCount} 个账号`);
            }

            selection.clearSelection();
        } catch (error) {
            console.error('批量编辑失败:', error);
            notifyError('批量编辑失败');
        } finally {
            setIsBatchProcessing(false);
        }
        return undefined;
    }, [selection, handleInlineEditWithRecent, notifyError, onNotify]);

    const handleOpenExportDialog = useCallback(() => {
        setExportDialog({ isOpen: true, mode: getCurrentExportMode() });
    }, [getCurrentExportMode]);

    const handleExportAccounts = async (config) => {
        try {
            const targetCount = exportScopeCounts[exportDialog.mode] ?? 0;
            if (targetCount <= 0) {
                notifyError('当前范围无符合条件的账号可导出');
                return;
            }
            const { accountIds, searchParam } = buildExportRequestParams(exportDialog.mode);
            if (Array.isArray(accountIds) && accountIds.length === 0) {
                notifyError('当前范围无符合条件的账号可导出');
                return;
            }
            const normalizedConfig = normalizeExportConfig(config);
            const fileName = `accounts_export_${formatLocalDate(new Date())}.txt`;

            if (isTauriRuntime()) {
                const filePath = await save({
                    defaultPath: fileName,
                    filters: [{ name: '文本文件', extensions: ['txt'] }]
                });
                if (!filePath) return;

                const result = await api.exportAccountsToFile(accountIds, searchParam, normalizedConfig, filePath);
                if (!result.success) {
                    notifyError('导出失败：' + (result.message || '未知错误'));
                    return;
                }
                setExportDialog({ isOpen: false, mode: 'all' });
                onNotify?.(`已导出 ${result.data.count} 个账号到 ${baseName(result.data.path)}`);
                return;
            }

            const result = await api.exportAccountsText(accountIds, searchParam, normalizedConfig);
            const textContent = typeof result === 'string' ? result : (result?.data ?? '');
            if (typeof result === 'object' && result !== null && !result.success) {
                notifyError('导出失败：' + result.message);
                return;
            }
            const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            setExportDialog({ isOpen: false, mode: 'all' });
        } catch (error) {
            console.error('导出账号失败:', error);
            notifyError('导出失败：' + (error?.message || String(error)));
        }
    };

    // 响应来自 App 的一次性跨视图指令，执行后立即通知父组件清除，避免切回时重放旧动作
    useEffect(() => {
        if (!pendingAction?.id || pendingAction.id === handledActionIdRef.current) return;
        handledActionIdRef.current = pendingAction.id;
        onConsumePendingAction?.(pendingAction.id);

        if (pendingAction.type === 'search') {
            searchInputRef.current?.focus();
            searchInputRef.current?.select?.();
        } else if (pendingAction.type === 'export') {
            handleOpenExportDialog();
        }
    }, [pendingAction, onConsumePendingAction, handleOpenExportDialog]);

    const handleBatchClearBrowserCache = async () => {
        if (selection.selectedIds.size === 0 || isBatchProcessing) return;
        setIsBatchProcessing(true);
        try {
            const result = await api.clearBrowserCache(Array.from(selection.selectedIds));
            if (!result.success) {
                notifyError(result.message || '清理浏览器缓存失败');
                return;
            }
            onNotify?.(describeClearCacheResult(result.data));
        } finally {
            setIsBatchProcessing(false);
        }
    };

    return (
        <>
            <div className="space-y-3.5 gm-view-enter">
                {/* 精简页头：标题与实时计数在左，命令式搜索框与轻量动作在右 */}
                <div className="gm-list-header">
                    <div className="gm-list-title-group">
                        <div className="flex items-baseline gap-2.5">
                            <h1 className="gm-title">账号库</h1>
                            <span className="font-mono text-[11.5px] gm-text-3 tabular-nums">
                                {accounts.length} 条
                            </span>
                        </div>
                        <p className="gm-subtitle">管理您的所有谷歌账号资产</p>
                    </div>

                    <div className="gm-list-actions">
                        <div className="gm-search-box">
                            <Search className="gm-search-icon" size={14} />
                            <input
                                ref={searchInputRef}
                                type="text"
                                placeholder="搜索邮箱或备注内容..."
                                value={search}
                                onChange={handleSearchChange}
                                className="gm-input"
                            />
                            {search ? (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSearch('');
                                        pagination.resetPage();
                                        onSearchChange?.('');
                                        searchInputRef.current?.focus();
                                    }}
                                    className="gm-search-clear"
                                    aria-label="清空搜索"
                                    title="清空搜索"
                                >
                                    <X size={13} />
                                </button>
                            ) : (
                                <span className="gm-search-kbd inline-flex items-center gap-0.5">
                                    <kbd className="gm-kbd">Ctrl</kbd>
                                    <kbd className="gm-kbd">K</kbd>
                                </span>
                            )}
                        </div>

                        <button
                            onClick={handleOpenExportDialog}
                            className="gm-btn gm-btn-secondary"
                            title="导出账号为文本文件"
                        >
                            <FileDown size={15} />
                            <span>导出账号</span>
                        </button>
                    </div>
                </div>

                {/* 横向像素胶囊分类筛选条（常驻显示，支持添加/管理自定义分类与未分类筛选） */}
                <div className="gm-filter-strip" role="group" aria-label="账号分类筛选">
                    <button
                        type="button"
                        onClick={() => { setGroupFilter(null); pagination.resetPage(); }}
                        className={`gm-filter-pill inline-flex items-center gap-1.5 ${!groupFilter ? 'is-active' : ''}`}
                    >
                        <span>全部</span>
                        <span className="font-mono text-[10.5px] opacity-75">{countSourceAccounts.length}</span>
                    </button>

                    {mergedGroups.map(group => {
                        const isActive = groupFilter === group;
                        const catColor = categoryColorMap[group];
                        const colorMeta = catColor ? getCategoryColorMeta(catColor) : null;
                        const count = categoryCounts[group] || 0;
                        return (
                            <button
                                key={group}
                                type="button"
                                onClick={() => {
                                    setGroupFilter(isActive ? null : group);
                                    pagination.resetPage();
                                }}
                                className={`gm-filter-pill inline-flex items-center gap-1.5 ${isActive ? 'is-active' : ''}`}
                                style={isActive && colorMeta ? {
                                    background: colorMeta.bg,
                                    borderColor: colorMeta.border,
                                    color: colorMeta.text,
                                } : undefined}
                            >
                                {colorMeta && (
                                    <span
                                        className="w-1.5 h-1.5 rounded-[1px] shrink-0"
                                        style={{ background: colorMeta.dot }}
                                        aria-hidden="true"
                                    />
                                )}
                                <span>{group}</span>
                                <span className="font-mono text-[10.5px] opacity-70">{count}</span>
                            </button>
                        );
                    })}

                    {(uncategorizedCount > 0 || groupFilter === UNCATEGORIZED_FILTER_KEY) && mergedGroups.length > 0 && (
                        <button
                            type="button"
                            onClick={() => {
                                setGroupFilter(groupFilter === UNCATEGORIZED_FILTER_KEY ? null : UNCATEGORIZED_FILTER_KEY);
                                pagination.resetPage();
                            }}
                            className={`gm-filter-pill inline-flex items-center gap-1.5 ${groupFilter === UNCATEGORIZED_FILTER_KEY ? 'is-active' : ''}`}
                        >
                            <span>未分类</span>
                            <span className="font-mono text-[10.5px] opacity-70">{uncategorizedCount}</span>
                        </button>
                    )}

                    {typeof onCreateCategory === 'function' && (
                        <button
                            type="button"
                            onClick={() => setCategoryDialogOpen(true)}
                            className="gm-filter-pill inline-flex items-center gap-1"
                            style={{
                                borderStyle: 'dashed',
                                color: 'var(--primary)',
                                borderColor: 'rgba(91, 142, 244, 0.35)',
                            }}
                            title="添加或自定义谷歌邮箱分类"
                        >
                            <FolderPlus size={12} />
                            <span>添加分类</span>
                        </button>
                    )}

                    {typeof onCreateCategory === 'function' && (accountCategories.length > 0 || adHocTags.length > 0) && (
                        <button
                            type="button"
                            onClick={() => setCategoryDialogOpen(true)}
                            className="gm-filter-pill inline-flex items-center gap-1"
                            title="重命名、改色或删除分类"
                        >
                            <SlidersHorizontal size={11.5} />
                            <span>管理分类</span>
                        </button>
                    )}
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
                    onBatchClearBrowserCache={handleBatchClearBrowserCache}
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
                    copyPhoneWithSmsUrl={copyPhoneWithSmsUrl}
                    openHistoryDrawer={openHistoryDrawer}
                    twoFACodes={twoFACodes}
                    smsCodes={smsCodes}
                    onSmsRefresh={handleSmsRefresh}
                    onSmsCopy={handleSmsCopy}
                    browserStatuses={browserStatuses}
                    openingBrowserIds={openingBrowserIds}
                    onOpenBrowser={handleOpenBrowser}
                    categoryColorMap={categoryColorMap}
                    knownCategoryNames={knownCategoryNames}
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

            <PromptDialog
                isOpen={Boolean(batchEditPrompt)}
                title={batchEditPrompt ? `批量设置${batchEditPrompt.fieldLabel}` : ''}
                description={batchEditPrompt ? `将应用到选中的 ${batchEditPrompt.count} 个账号；留空表示清空该字段。` : ''}
                label={batchEditPrompt?.fieldLabel || ''}
                submitLabel="应用"
                onSubmit={(value) => applyBatchEdit(batchEditPrompt.field, value)}
                onCancel={() => setBatchEditPrompt(null)}
            />

            {/* 批量设置分类 / 标签弹窗 */}
            {batchCategoryModal && renderInBody(
                <div
                    className="gm-overlay"
                    role="dialog"
                    aria-modal="true"
                    aria-label="批量设置分类"
                    onClick={() => setBatchCategoryModal(null)}
                >
                    <div
                        className="gm-modal w-full max-w-md"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="gm-modal-header">
                            <h3 className="gm-title text-base">批量设置分类 / 标签</h3>
                            <button
                                type="button"
                                onClick={() => setBatchCategoryModal(null)}
                                className="gm-icon-btn"
                                style={{ width: 30, height: 30 }}
                                aria-label="关闭批量分类"
                            >
                                <X size={16} />
                            </button>
                        </div>
                        <form onSubmit={applyBatchCategoryAssignment}>
                            <div className="gm-modal-body space-y-3.5">
                                <p className="text-xs gm-text-2">
                                    将应用到选中的 {batchCategoryModal.count} 个账号；不勾选且输入框留空时，覆盖模式会清空原有分类。
                                </p>

                                {mergedGroups.length > 0 && (
                                    <div className="space-y-1.5">
                                        <span className="text-xs font-medium gm-text-2 block">点击选择分类（可多选）</span>
                                        <div className="flex flex-wrap gap-1.5">
                                            {mergedGroups.map(name => {
                                                const active = batchSelectedCats.includes(name);
                                                const catColor = categoryColorMap[name];
                                                const meta = catColor ? getCategoryColorMeta(catColor) : null;
                                                return (
                                                    <button
                                                        key={name}
                                                        type="button"
                                                        onClick={() => toggleBatchSelectedCat(name)}
                                                        className={`gm-filter-pill inline-flex items-center gap-1.5 ${active ? 'is-active' : ''}`}
                                                        style={active && meta ? {
                                                            background: meta.bg,
                                                            borderColor: meta.border,
                                                            color: meta.text,
                                                        } : undefined}
                                                    >
                                                        {meta && (
                                                            <span
                                                                className="w-1.5 h-1.5 rounded-[1px]"
                                                                style={{ background: meta.dot }}
                                                                aria-hidden="true"
                                                            />
                                                        )}
                                                        <span>{name}</span>
                                                        {active && <Check size={11} />}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {typeof onCreateCategory === 'function' && (
                                    <div className="space-y-1">
                                        <span className="text-xs font-medium gm-text-2 block">快速新建自定义分类</span>
                                        <div className="flex items-center gap-1.5">
                                            <input
                                                type="text"
                                                maxLength={40}
                                                value={batchQuickCatName}
                                                onChange={(e) => {
                                                    setBatchQuickCatName(e.target.value);
                                                    if (batchQuickCatError) setBatchQuickCatError('');
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        handleCreateBatchQuickCategory();
                                                    }
                                                }}
                                                placeholder="输入新分类名，如：AI 订阅"
                                                className="gm-input flex-1 h-8 text-xs"
                                            />
                                            <button
                                                type="button"
                                                onClick={handleCreateBatchQuickCategory}
                                                disabled={creatingBatchQuickCat || !batchQuickCatName.trim()}
                                                className="gm-btn gm-btn-secondary gm-btn-sm shrink-0"
                                            >
                                                <Plus size={12} />
                                                <span>新建并选中</span>
                                            </button>
                                        </div>
                                        {batchQuickCatError && (
                                            <p role="alert" className="text-xs" style={{ color: 'var(--danger)' }}>
                                                {batchQuickCatError}
                                            </p>
                                        )}
                                    </div>
                                )}

                                <label className="block space-y-1">
                                    <span className="text-xs font-medium gm-text-2">其他自定义标签（可选）</span>
                                    <input
                                        type="text"
                                        value={batchCustomTagInput}
                                        onChange={(e) => {
                                            setBatchCustomTagInput(e.target.value);
                                            if (batchCategoryError) setBatchCategoryError('');
                                        }}
                                        placeholder="多个可用逗号分隔，留空则仅使用上方所选分类"
                                        className="gm-input w-full text-xs"
                                    />
                                </label>

                                <div className="flex items-center gap-3 pt-1">
                                    <label className="flex items-center gap-1.5 text-xs gm-text-2 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="batchCategoryMode"
                                            value="replace"
                                            checked={batchCategoryMode === 'replace'}
                                            onChange={() => {
                                                setBatchCategoryMode('replace');
                                                if (batchCategoryError) setBatchCategoryError('');
                                            }}
                                        />
                                        <span>覆盖原有分类</span>
                                    </label>
                                    <label className="flex items-center gap-1.5 text-xs gm-text-2 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="batchCategoryMode"
                                            value="append"
                                            checked={batchCategoryMode === 'append'}
                                            onChange={() => {
                                                setBatchCategoryMode('append');
                                                if (batchCategoryError) setBatchCategoryError('');
                                            }}
                                        />
                                        <span>追加到现有分类</span>
                                    </label>
                                </div>
                                {batchCategoryError && (
                                    <p role="alert" className="text-xs" style={{ color: 'var(--danger)' }}>
                                        {batchCategoryError}
                                    </p>
                                )}
                            </div>
                            <div className="gm-modal-footer">
                                <button
                                    type="button"
                                    onClick={() => setBatchCategoryModal(null)}
                                    className="gm-btn gm-btn-secondary flex-1"
                                >
                                    取消
                                </button>
                                <button type="submit" className="gm-btn gm-btn-primary flex-1">
                                    应用
                                </button>
                            </div>
                        </form>
                    </div>
                </div>,
            )}

            {/* 账号自定义分类管理弹窗 */}
            <AccountCategoryDialog
                isOpen={categoryDialogOpen}
                categories={accountCategories}
                categoryCounts={categoryCounts}
                adHocTags={adHocTags}
                onCreateCategory={onCreateCategory}
                onUpdateCategory={onUpdateCategory}
                onDeleteCategory={onDeleteCategory}
                onClose={handleCloseCategoryDialog}
            />
        </>
    );
};

export default AccountListView;
