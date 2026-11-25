import { useEffect, useState } from 'react';
import {
    Brain,
    X,
    Plus,
    Trash2,
    Pencil,
    Check,
    FolderOpen,
    ShieldCheck,
    FileText,
    List,
} from 'lucide-react';
import api from '../services/api';
import { confirmDialog } from '../utils/dialogs';
import { renderInBody } from '../utils/portal';

const TAB_CONFIG = [
    {
        id: 'user',
        title: '用户画像',
        file: 'USER.md',
        placeholder: '例如：偏好统一用人民币（CNY）汇总账单；喜欢先给结论再附表格。',
        desc: '记录您的称呼、汇率/汇报习惯与个人偏好，每轮对话自动冻结注入 System Prompt。',
    },
    {
        id: 'memory',
        title: '工作区笔记',
        file: 'MEMORY.md',
        placeholder: '例如：香港主力节点「讯猫」用于主博客反代；Cloudflare 主域名每季度检查 DNS。',
        desc: '沉淀服务器角色分工、域名用途与长期运维约束，跨对话持久保留且自动镜像到本地 Markdown 文件。',
    },
];

const AgentMemoryDialog = ({
    isOpen,
    snapshot,
    onClose,
    onSnapshotChange,
    onNotify,
    onOpenAiSettings,
}) => {
    const [activeTab, setActiveTab] = useState('user');
    const [viewMode, setViewMode] = useState('list'); // 'list' | 'markdown'
    const [newContent, setNewContent] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [editingText, setEditingText] = useState('');
    const [busyId, setBusyId] = useState(null);
    const [clearing, setClearing] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setNewContent('');
        setEditingId(null);
        setEditingText('');
    }, [isOpen]);

    if (!isOpen) return null;

    const currentMeta = TAB_CONFIG.find(t => t.id === activeTab) || TAB_CONFIG[0];
    const entries = activeTab === 'user'
        ? (snapshot?.userEntries || [])
        : (snapshot?.memoryEntries || []);
    const usedChars = activeTab === 'user'
        ? (snapshot?.userUsedChars || 0)
        : (snapshot?.memoryUsedChars || 0);
    const budgetChars = activeTab === 'user'
        ? (snapshot?.userBudget || 1500)
        : (snapshot?.memoryBudget || 2500);
    const markdownText = activeTab === 'user'
        ? (snapshot?.userMarkdown || '')
        : (snapshot?.memoryMarkdown || '');
    const pct = Math.min(100, Math.round((usedChars / Math.max(1, budgetChars)) * 100));
    const anyMutationBusy = submitting || clearing || busyId !== null;

    const handleAdd = async (e) => {
        e.preventDefault();
        const trimmed = newContent.trim();
        if (!trimmed || anyMutationBusy) return;
        if (typeof api?.addAgentMemoryEntry !== 'function') {
            onNotify?.('当前环境暂不支持写入本地记忆', 'error');
            return;
        }
        setSubmitting(true);
        try {
            const res = await api.addAgentMemoryEntry(activeTab, trimmed);
            if (!res?.success || !res.data) {
                onNotify?.(res?.message || '写入本地记忆失败', 'error');
                return;
            }
            onSnapshotChange?.(res.data);
            setNewContent('');
            onNotify?.(`已写入 ${currentMeta.file}`);
        } catch (err) {
            onNotify?.(err?.message || '写入本地记忆失败', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    const handleSaveEdit = async (id) => {
        const trimmed = editingText.trim();
        if (!trimmed || busyId !== null || clearing) return;
        if (typeof api?.updateAgentMemoryEntry !== 'function') {
            onNotify?.('当前环境暂不支持更新本地记忆', 'error');
            return;
        }
        setBusyId(id);
        try {
            const res = await api.updateAgentMemoryEntry(id, trimmed);
            if (!res?.success || !res.data) {
                onNotify?.(res?.message || '更新记忆失败', 'error');
                return;
            }
            onSnapshotChange?.(res.data);
            setEditingId(null);
            setEditingText('');
            onNotify?.('记忆条目已更新');
        } catch (err) {
            onNotify?.(err?.message || '更新记忆失败', 'error');
        } finally {
            setBusyId(null);
        }
    };

    const handleDelete = async (id) => {
        if (busyId !== null || clearing) return;
        if (typeof api?.deleteAgentMemoryEntry !== 'function') {
            onNotify?.('当前环境暂不支持删除本地记忆', 'error');
            return;
        }
        setBusyId(id);
        try {
            const res = await api.deleteAgentMemoryEntry(id);
            if (!res?.success || !res.data) {
                onNotify?.(res?.message || '删除记忆失败', 'error');
                return;
            }
            onSnapshotChange?.(res.data);
            onNotify?.('已删除该记忆条目');
        } catch (err) {
            onNotify?.(err?.message || '删除记忆失败', 'error');
        } finally {
            setBusyId(null);
        }
    };

    const handleClearTab = async () => {
        if (entries.length === 0 || clearing || busyId !== null) return;
        if (typeof api?.clearAgentMemory !== 'function') {
            onNotify?.('当前环境暂不支持清空本地记忆', 'error');
            return;
        }
        const targetTab = activeTab;
        const targetTitle = currentMeta.title;
        const targetFile = currentMeta.file;
        setClearing(true);
        try {
            const ok = await confirmDialog(
                `确定清空「${targetTitle} (${targetFile})」全部 ${entries.length} 条记忆吗？清空后对应 Markdown 文件也将同步更新。`,
                { title: '清空分区记忆', okLabel: '确认清空', cancelLabel: '取消', kind: 'warning' },
            );
            if (!ok) return;
            const res = await api.clearAgentMemory(targetTab);
            if (!res?.success || !res.data) {
                onNotify?.(res?.message || '清空记忆失败', 'error');
                return;
            }
            onSnapshotChange?.(res.data);
            setEditingId(null);
            setEditingText('');
            onNotify?.(`已清空 ${targetFile}`);
        } catch (err) {
            onNotify?.(err?.message || '清空记忆失败', 'error');
        } finally {
            setClearing(false);
        }
    };

    const handleOpenDir = async () => {
        if (typeof api?.openAgentMemoryDir !== 'function') {
            onNotify?.('当前环境暂不支持打开记忆目录', 'error');
            return;
        }
        try {
            const res = await api.openAgentMemoryDir();
            if (!res?.success) {
                onNotify?.(res?.message || '打开记忆目录失败', 'error');
            }
        } catch (err) {
            onNotify?.(err?.message || '打开记忆目录失败', 'error');
        }
    };

    return renderInBody(
        <div className="gm-overlay" role="dialog" aria-modal="true" aria-label="Hermes 本地长期记忆">
            <div className="gm-modal glass w-full max-w-2xl max-h-[90vh] flex flex-col p-6 space-y-4" data-lens="sheet">
                <div className="flex items-center justify-between gap-2">
                    <div>
                        <h2 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2">
                            <Brain size={18} className="text-[var(--primary)]" />
                            <span>Hermes 本地长期记忆</span>
                            <span className="gm-pixel-tag is-accent">USER + MEMORY</span>
                        </h2>
                        <p className="text-[11.5px] text-[var(--text-secondary)] mt-0.5">
                            高信噪比双区有界记忆：每轮以冻结快照注入 System Prompt，保证缓存稳定与跨对话延续。
                        </p>
                    </div>
                    <button
                        type="button"
                        className="gm-btn gm-btn-ghost p-1"
                        onClick={() => onClose?.()}
                        aria-label="关闭记忆弹窗"
                    >
                        <X size={16} />
                    </button>
                </div>

                {snapshot && snapshot.memoryEnabled === false && (
                    <div
                        className="rounded-lg px-3 py-2 text-xs flex items-center justify-between gap-2 border border-[var(--warning)]"
                        style={{ background: 'var(--warning-soft)', color: 'var(--text-primary)' }}
                    >
                        <span>当前已在 AI 配置中暂停自动记忆注入，您仍可预设条目。</span>
                        <button
                            type="button"
                            className="gm-btn gm-btn-ghost text-[11px] py-1 px-2"
                            onClick={() => {
                                onClose?.();
                                onOpenAiSettings?.();
                            }}
                        >
                            前往开启
                        </button>
                    </div>
                )}

                {/* 分区 Tab + 视图模式切换 */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2.5">
                    <div className="flex items-center gap-1.5">
                        {TAB_CONFIG.map(tab => {
                            const count = tab.id === 'user'
                                ? (snapshot?.userEntries?.length || 0)
                                : (snapshot?.memoryEntries?.length || 0);
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => {
                                        setActiveTab(tab.id);
                                        setEditingId(null);
                                    }}
                                    className={`gm-btn text-xs ${
                                        activeTab === tab.id ? 'gm-btn-primary' : 'gm-btn-ghost'
                                    }`}
                                >
                                    <span>{tab.title}</span>
                                    <span className="font-mono opacity-80">({tab.file} · {count})</span>
                                </button>
                            );
                        })}
                    </div>

                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => setViewMode('list')}
                            className={`gm-btn text-[11px] py-1 px-2 ${
                                viewMode === 'list' ? 'gm-btn-primary' : 'gm-btn-ghost'
                            }`}
                        >
                            <List size={12} />
                            条目管理
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode('markdown')}
                            className={`gm-btn text-[11px] py-1 px-2 ${
                                viewMode === 'markdown' ? 'gm-btn-primary' : 'gm-btn-ghost'
                            }`}
                        >
                            <FileText size={12} />
                            Markdown 预览
                        </button>
                    </div>
                </div>

                {/* 字符预算与说明 */}
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-[var(--text-secondary)]">{currentMeta.desc}</span>
                        <span className="font-mono text-[11px] text-[var(--text-primary)] shrink-0 tabular-nums">
                            {usedChars} / {budgetChars} 字符 ({pct}%)
                        </span>
                    </div>
                    <div className="gm-memory-meter" aria-hidden="true">
                        <div
                            className={`gm-memory-meter-fill ${
                                pct >= 85 ? 'is-high' : pct >= 60 ? 'is-warn' : ''
                            }`}
                            style={{ width: `${pct}%` }}
                        />
                    </div>
                </div>

                {/* 主体内容 */}
                <div className="flex-1 overflow-y-auto space-y-3 text-xs min-h-[180px]">
                    {viewMode === 'markdown' ? (
                        <pre className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3.5 text-[11.5px] font-mono leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap overflow-x-auto m-0">
                            {markdownText || '（暂无内容）'}
                        </pre>
                    ) : (
                        <>
                            <form onSubmit={handleAdd} className="flex items-center gap-2">
                                <input
                                    type="text"
                                    maxLength={300}
                                    className="gm-input flex-1 text-xs"
                                    value={newContent}
                                    onChange={e => setNewContent(e.target.value)}
                                    placeholder={currentMeta.placeholder}
                                    disabled={anyMutationBusy}
                                />
                                <button
                                    type="submit"
                                    className="gm-btn gm-btn-primary text-xs shrink-0"
                                    disabled={anyMutationBusy || !newContent.trim()}
                                >
                                    <Plus size={14} />
                                    <span>{submitting ? '写入中...' : '添加记忆'}</span>
                                </button>
                            </form>

                            {entries.length === 0 ? (
                                <div className="py-8 text-center text-[var(--text-secondary)] border border-dashed border-[var(--border)] rounded-lg">
                                    暂无 {currentMeta.file} 条目，可在上方手动添加，或在对话中告诉助手「记住…」。
                                </div>
                            ) : (
                                <ul className="space-y-2 m-0 p-0 list-none">
                                    {entries.map(entry => {
                                        const isEditing = editingId === entry.id;
                                        const busy = busyId !== null || clearing;
                                        return (
                                            <li
                                                key={entry.id}
                                                className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2.5 flex items-start justify-between gap-2"
                                            >
                                                <div className="flex-1 min-w-0 space-y-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-mono text-[10.5px] gm-text-3">
                                                            #{entry.id}
                                                        </span>
                                                    </div>
                                                    {isEditing ? (
                                                        <div className="flex items-center gap-1.5">
                                                            <input
                                                                type="text"
                                                                maxLength={300}
                                                                className="gm-input flex-1 text-xs"
                                                                value={editingText}
                                                                onChange={e => setEditingText(e.target.value)}
                                                                onKeyDown={e => {
                                                                    if (e.key === 'Enter') {
                                                                        e.preventDefault();
                                                                        handleSaveEdit(entry.id);
                                                                    } else if (e.key === 'Escape') {
                                                                        e.preventDefault();
                                                                        setEditingId(null);
                                                                        setEditingText('');
                                                                    }
                                                                }}
                                                                aria-label={`编辑记忆 #${entry.id}`}
                                                            />
                                                            <button
                                                                type="button"
                                                                className="gm-btn gm-btn-primary text-[11px] py-1 px-2"
                                                                onClick={() => handleSaveEdit(entry.id)}
                                                                disabled={busy || !editingText.trim()}
                                                                aria-label={`保存记忆 #${entry.id}`}
                                                            >
                                                                <Check size={12} />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="gm-btn gm-btn-ghost text-[11px] py-1 px-2"
                                                                onClick={() => {
                                                                    setEditingId(null);
                                                                    setEditingText('');
                                                                }}
                                                                disabled={busy}
                                                            >
                                                                取消
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <p className="text-[var(--text-primary)] leading-relaxed m-0 break-words">
                                                            {entry.content}
                                                        </p>
                                                    )}
                                                </div>
                                                {!isEditing && (
                                                    <div className="flex items-center gap-1 shrink-0">
                                                        <button
                                                            type="button"
                                                            className="gm-btn gm-btn-ghost p-1"
                                                            title="编辑条目"
                                                            aria-label={`编辑条目 #${entry.id}`}
                                                            onClick={() => {
                                                                setEditingId(entry.id);
                                                                setEditingText(entry.content);
                                                            }}
                                                            disabled={busy}
                                                        >
                                                            <Pencil size={13} />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="gm-btn gm-btn-ghost p-1 text-[var(--danger)]"
                                                            title="删除条目"
                                                            aria-label={`删除条目 #${entry.id}`}
                                                            onClick={() => handleDelete(entry.id)}
                                                            disabled={busy}
                                                        >
                                                            <Trash2 size={13} />
                                                        </button>
                                                    </div>
                                                )}
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </>
                    )}
                </div>

                {/* 底部安全守卫声明与本地目录操作 */}
                <div className="pt-2 border-t border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--text-secondary)]">
                    <span className="inline-flex items-center gap-1.5">
                        <ShieldCheck size={13} className="text-[var(--primary)] shrink-0" />
                        <span>已启用隐私守卫：自动拦截密码、API Key、2FA、卡号与私钥。</span>
                    </span>
                    <div className="flex items-center gap-2">
                        {entries.length > 0 && (
                            <button
                                type="button"
                                className="gm-btn gm-btn-ghost text-[11px] text-[var(--danger)] py-1 px-2"
                                onClick={handleClearTab}
                                disabled={clearing || busyId !== null}
                            >
                                <Trash2 size={12} />
                                {clearing ? '清空中...' : `清空 ${currentMeta.file}`}
                            </button>
                        )}
                        <button
                            type="button"
                            className="gm-btn gm-btn-ghost text-[11px] py-1 px-2"
                            onClick={handleOpenDir}
                            title={snapshot?.memoryDir || ''}
                        >
                            <FolderOpen size={12} />
                            打开本地目录
                        </button>
                    </div>
                </div>
            </div>
        </div>,
    );
};

export default AgentMemoryDialog;
