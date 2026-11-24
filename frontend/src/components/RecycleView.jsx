import { useCallback, useEffect, useMemo, useState } from 'react';
import { RotateCcw, Trash2, RefreshCw, Search, X, ArrowLeft } from 'lucide-react';
import api from '../services/api';
import { PixelLoader, PixelMascot } from './PixelArt';
import { formatDbTimestamp } from '../utils/timeUtils';
import { splitGroupNameValues } from '../utils/multiValueField';
import { confirmDialog, messageDialog } from '../utils/dialogs';

/**
 * 回收站整页视图（MosMos 无框极简列表，替代旧版弹窗）
 */
const RecycleView = ({ onRefreshAccounts, onNotify, onNavigateList, accountCategories = [] }) => {
    const [accounts, setAccounts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [busyId, setBusyId] = useState(null);
    const [purgingAll, setPurgingAll] = useState(false);

    const knownCategoryNames = useMemo(
        () => accountCategories.map(cat => cat?.name).filter(Boolean),
        [accountCategories],
    );

    const notifyError = useCallback((msg) => {
        if (onNotify) {
            onNotify(msg, 'error');
        } else {
            messageDialog(msg, { kind: 'error' });
        }
    }, [onNotify]);

    const loadDeletedAccounts = useCallback(async () => {
        setLoading(true);
        try {
            const result = await api.getDeletedAccounts();
            if (result.success) {
                setAccounts(result.data || []);
            } else {
                notifyError(result.message || '加载回收站失败');
            }
        } catch (error) {
            notifyError(error.message || '加载回收站失败');
        } finally {
            setLoading(false);
        }
    }, [notifyError]);

    useEffect(() => {
        loadDeletedAccounts();
    }, [loadDeletedAccounts]);

    const filteredAccounts = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return accounts;
        return accounts.filter(acc =>
            `${acc.email || ''} ${acc.remark || ''} ${acc.groupName || ''}`.toLowerCase().includes(q)
        );
    }, [accounts, search]);

    const askDeleteBrowserProfiles = async (emails) => {
        const uniqueEmails = [...new Set(emails.filter(Boolean))];
        if (uniqueEmails.length === 0) return [];

        const statusResult = await api.getBrowserStatuses(uniqueEmails);
        const withProfile = uniqueEmails.filter(email => (statusResult.data?.[email] || 'none') !== 'none');
        if (withProfile.length === 0) return [];

        const subject = withProfile.length === 1 && uniqueEmails.length === 1
            ? '该账号'
            : `其中 ${withProfile.length} 个账号`;
        const confirmed = await confirmDialog(
            `${subject}有浏览器配置（保存着登录状态），是否一起删除？\n选「取消」则保留配置目录。`,
            { okLabel: '一起删除', cancelLabel: '保留配置' }
        );
        return confirmed ? withProfile : [];
    };

    const deleteBrowserProfilesAfterPurge = async (emails) => {
        if (emails.length === 0) return;
        const result = await api.deleteBrowserProfiles(emails);
        if (!result.success) {
            notifyError(result.message || '删除浏览器配置失败');
            return;
        }
        const { deleted = 0, skipped = 0 } = result.data || {};
        onNotify?.(skipped > 0
            ? `已删除 ${deleted} 个浏览器配置，${skipped} 个因正在运行或仍被其他账号使用而保留`
            : `已删除 ${deleted} 个浏览器配置`);
    };

    const handleRestore = async (acc) => {
        setBusyId(acc.id);
        try {
            const result = await api.restoreAccount(acc.id);
            if (!result.success) {
                notifyError(result.message || '恢复失败');
                return;
            }
            onNotify?.(`已恢复账号 ${acc.email}`);
            await loadDeletedAccounts();
            if (onRefreshAccounts) {
                await onRefreshAccounts();
            }
        } finally {
            setBusyId(null);
        }
    };

    const handlePurge = async (acc) => {
        if (!await confirmDialog('确定永久删除该账号吗？此操作不可撤销。', { okLabel: '永久删除' })) return;
        setBusyId(acc.id);
        try {
            const profileEmails = await askDeleteBrowserProfiles([acc.email]);
            const result = await api.purgeAccount(acc.id);
            if (!result.success) {
                notifyError(result.message || '永久删除失败');
                return;
            }
            await deleteBrowserProfilesAfterPurge(profileEmails);
            await loadDeletedAccounts();
        } finally {
            setBusyId(null);
        }
    };

    const handlePurgeAll = async () => {
        if (accounts.length === 0) return;
        if (!await confirmDialog('确定清空回收站吗？此操作不可撤销。', { okLabel: '清空' })) return;
        setPurgingAll(true);
        try {
            const profileEmails = await askDeleteBrowserProfiles(accounts.map(acc => acc.email));
            const result = await api.purgeAllDeleted();
            if (!result.success) {
                notifyError(result.message || '清空回收站失败');
                return;
            }
            await deleteBrowserProfilesAfterPurge(profileEmails);
            await loadDeletedAccounts();
        } finally {
            setPurgingAll(false);
        }
    };

    return (
        <div className="gm-recycle-shell gm-view-enter">
            {/* 页头：标题 + 实时计数 + 搜索 + 刷新 / 清空 */}
            <div className="gm-list-header">
                <div className="gm-list-title-group">
                    <div className="flex items-baseline gap-2.5">
                        <h1 className="gm-title">回收站</h1>
                        <span className="font-mono text-[11.5px] gm-text-3 tabular-nums">
                            {accounts.length} 条
                        </span>
                    </div>
                    <p className="gm-subtitle">软删除的账号仍保留独立浏览器配置，可随时恢复或彻底清理</p>
                </div>

                <div className="gm-list-actions">
                    {accounts.length > 0 && (
                        <div className="gm-search-box">
                            <Search className="gm-search-icon" size={14} />
                            <input
                                type="text"
                                placeholder="搜索回收站邮箱或备注..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="gm-input"
                            />
                            {search && (
                                <button
                                    type="button"
                                    onClick={() => setSearch('')}
                                    className="gm-search-clear"
                                    aria-label="清空搜索"
                                    title="清空搜索"
                                >
                                    <X size={13} />
                                </button>
                            )}
                        </div>
                    )}

                    <button
                        type="button"
                        onClick={loadDeletedAccounts}
                        disabled={loading || purgingAll}
                        className="gm-btn gm-btn-secondary"
                        title="刷新回收站"
                    >
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                        <span>刷新</span>
                    </button>

                    <button
                        type="button"
                        onClick={handlePurgeAll}
                        disabled={accounts.length === 0 || loading || purgingAll}
                        className="gm-btn gm-btn-danger"
                    >
                        <Trash2 size={14} />
                        <span>清空回收站</span>
                    </button>
                </div>
            </div>

            {/* 列表主体：无框编辑式行流 */}
            <div className="gm-recycle-body">
                {loading ? (
                    <div className="gm-recycle-empty">
                        <PixelLoader label="加载中..." />
                    </div>
                ) : accounts.length === 0 ? (
                    <div className="gm-recycle-empty">
                        <PixelMascot size={60} variant="sleep" className="gm-text-3" />
                        <p className="text-[14px] font-medium gm-text-2 mt-3">回收站为空</p>
                        <p className="text-[12px] gm-text-3 mt-1">删除的账号会先暂存在这里，防止误删丢失数据</p>
                        {onNavigateList && (
                            <button
                                type="button"
                                onClick={onNavigateList}
                                className="gm-btn gm-btn-ghost gm-btn-sm mt-4"
                            >
                                <ArrowLeft size={13} />
                                <span>返回账号列表</span>
                            </button>
                        )}
                    </div>
                ) : filteredAccounts.length === 0 ? (
                    <div className="gm-recycle-empty">
                        <PixelMascot size={52} variant="sleep" className="gm-text-3" />
                        <p className="text-[13.5px] font-medium gm-text-2 mt-3">没有匹配的已删除账号</p>
                        <button
                            type="button"
                            onClick={() => setSearch('')}
                            className="gm-btn gm-btn-ghost gm-btn-sm mt-3"
                        >
                            清空筛选
                        </button>
                    </div>
                ) : (
                    <div className="gm-recycle-list" role="list" aria-label="已删除账号列表">
                        {filteredAccounts.map((acc) => {
                            const tags = splitGroupNameValues(acc.groupName, knownCategoryNames);
                            const isBusy = busyId === acc.id || purgingAll;
                            return (
                                <div key={acc.id} className="gm-recycle-row" role="listitem">
                                    <div className="min-w-0 flex-1 flex flex-col gap-1">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span
                                                className={`gm-row-signal ${acc.status === 'pro' ? 'is-pro' : ''}`}
                                                aria-hidden="true"
                                            />
                                            <span className="font-medium text-[13.5px] truncate gm-text-1">
                                                {acc.email}
                                            </span>
                                            {acc.status === 'pro' && (
                                                <span className="gm-chip gm-chip-accent">Pro</span>
                                            )}
                                            {tags.slice(0, 3).map((tag) => (
                                                <span key={tag} className="gm-chip">{tag}</span>
                                            ))}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-3 text-[11.5px] gm-text-3">
                                            <span className="font-mono tabular-nums">
                                                删除时间：{formatDbTimestamp(acc.deletedAt) || '-'}
                                            </span>
                                            {acc.remark && (
                                                <span className="truncate max-w-[360px]">
                                                    备注：{acc.remark.split('\n')[0]}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="gm-recycle-row-actions">
                                        <button
                                            type="button"
                                            disabled={isBusy}
                                            onClick={() => handleRestore(acc)}
                                            className="gm-btn gm-btn-secondary gm-btn-sm"
                                        >
                                            <RotateCcw size={13} />
                                            <span>恢复</span>
                                        </button>
                                        <button
                                            type="button"
                                            disabled={isBusy}
                                            onClick={() => handlePurge(acc)}
                                            className="gm-btn gm-btn-danger gm-btn-sm"
                                        >
                                            永久删除
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default RecycleView;
