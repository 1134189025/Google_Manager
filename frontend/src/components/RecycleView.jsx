import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import {
    Chip,
    EmptyState,
    FluentIcon,
    GlassButton,
    GlassCapsule,
    GlassSearch,
    PageToolbar,
} from './glass';
import { formatDbTimestamp } from '../utils/timeUtils';
import { splitGroupNameValues } from '../utils/multiValueField';
import { confirmDialog, messageDialog } from '../utils/dialogs';

/**
 * 回收站视图（Windows 11 Liquid Glass 分组列表）
 * - 保留全部软删除恢复、永久删除、清空回收站及独立浏览器配置清理确认流程
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
            `${acc.email || ''} ${acc.remark || ''} ${acc.groupName || ''}`.toLowerCase().includes(q),
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
            { okLabel: '一起删除', cancelLabel: '保留配置' },
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
        <>
            <PageToolbar
                title="回收站"
                subtitle={`${accounts.length} 条 · 软删除账号保留独立浏览器配置`}
                right={
                    <div className="flex items-center gap-2 flex-wrap">
                        {accounts.length > 0 && (
                            <GlassSearch
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                onClear={() => setSearch('')}
                                placeholder="搜索回收站邮箱或备注…"
                                ariaLabel="搜索回收站"
                            />
                        )}
                        <GlassCapsule>
                            <GlassButton
                                onClick={loadDeletedAccounts}
                                disabled={loading || purgingAll}
                                title="刷新回收站"
                            >
                                <FluentIcon name="sync" size={16} className={loading ? 'animate-spin' : ''} />
                                <span>刷新</span>
                            </GlassButton>
                        </GlassCapsule>
                        <GlassButton
                            glass
                            pill
                            onClick={handlePurgeAll}
                            disabled={accounts.length === 0 || loading || purgingAll}
                            style={{ color: accounts.length > 0 ? 'var(--red)' : undefined }}
                        >
                            <FluentIcon name="trash" size={16} />
                            <span>清空回收站</span>
                        </GlassButton>
                    </div>
                }
            />

            <div className="page page-in">
                {loading ? (
                    <div className="group">
                        <EmptyState icon="sync" title="加载中…" description="正在读取回收站中的已删除账号" />
                    </div>
                ) : accounts.length === 0 ? (
                    <div className="group">
                        <EmptyState
                            icon="trash"
                            title="回收站为空"
                            description="删除的账号会先暂存在这里，防止误删丢失数据与独立浏览器配置。"
                            action={onNavigateList && (
                                <button
                                    type="button"
                                    onClick={onNavigateList}
                                    className="btn mt-2"
                                >
                                    <FluentIcon name="chevLeft" size={14} />
                                    <span>返回账号列表</span>
                                </button>
                            )}
                        />
                    </div>
                ) : filteredAccounts.length === 0 ? (
                    <div className="group">
                        <EmptyState
                            icon="search"
                            title="没有匹配的已删除账号"
                            action={
                                <button
                                    type="button"
                                    onClick={() => setSearch('')}
                                    className="btn mt-2"
                                >
                                    清空筛选
                                </button>
                            }
                        />
                    </div>
                ) : (
                    <div className="group">
                        <ul className="rows flush" role="list" aria-label="已删除账号列表">
                            {filteredAccounts.map((acc) => {
                                const tags = splitGroupNameValues(acc.groupName, knownCategoryNames);
                                const isBusy = busyId === acc.id || purgingAll;
                                return (
                                    <li key={acc.id} role="listitem">
                                        <div className="row flex-wrap sm:flex-nowrap">
                                            <span
                                                className={`signal ${acc.status === 'pro' ? 'pro' : ''}`}
                                                style={{ marginTop: 0 }}
                                                aria-hidden="true"
                                            />
                                            <div className="od-field od-fill">
                                                <div className="flex items-center gap-2 flex-wrap min-w-0">
                                                    <span className="t od-truncate">{acc.email}</span>
                                                    {acc.status === 'pro' && <Chip tone="accent">Pro</Chip>}
                                                    {tags.slice(0, 3).map((tag) => (
                                                        <Chip key={tag}>{tag}</Chip>
                                                    ))}
                                                </div>
                                                <span className="s font-mono tabular-nums">
                                                    删除时间：{formatDbTimestamp(acc.deletedAt) || '-'}
                                                    {acc.remark ? ` · 备注：${acc.remark.split('\n')[0]}` : ''}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <button
                                                    type="button"
                                                    disabled={isBusy}
                                                    onClick={() => handleRestore(acc)}
                                                    className="btn"
                                                >
                                                    <FluentIcon name="restore" size={15} />
                                                    <span>恢复</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={isBusy}
                                                    onClick={() => handlePurge(acc)}
                                                    className="btn danger"
                                                >
                                                    永久删除
                                                </button>
                                            </div>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                )}
            </div>
        </>
    );
};

export default RecycleView;
