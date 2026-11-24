import { useEffect, useRef, useState } from 'react';
import { FolderPlus, Edit3, Trash2, Check, X, Tag } from 'lucide-react';
import { renderInBody } from '../utils/portal';
import { confirmDialog } from '../utils/dialogs';
import { CATEGORY_COLORS, getCategoryColorMeta } from '../utils/multiValueField';

/**
 * 谷歌账号自定义分类管理弹窗（新建、重命名、配色、删除、收录已有标签）
 */
const AccountCategoryDialog = ({
    isOpen,
    categories = [],
    categoryCounts = {},
    adHocTags = [],
    onCreateCategory,
    onUpdateCategory,
    onDeleteCategory,
    onClose,
}) => {
    const [newName, setNewName] = useState('');
    const [newColor, setNewColor] = useState('blue');
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState('');

    const [editingId, setEditingId] = useState(null);
    const [editingName, setEditingName] = useState('');
    const [editingColor, setEditingColor] = useState('blue');
    const [savingEdit, setSavingEdit] = useState(false);

    const inputRef = useRef(null);
    const onCloseRef = useRef(onClose);
    const editingIdRef = useRef(editingId);
    onCloseRef.current = onClose;
    editingIdRef.current = editingId;

    useEffect(() => {
        if (!isOpen) return undefined;
        setNewName('');
        setNewColor('blue');
        setError('');
        setEditingId(null);
        setEditingName('');
        const timer = setTimeout(() => {
            inputRef.current?.focus();
        }, 30);
        return () => {
            clearTimeout(timer);
        };
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return undefined;
        const onKeyDown = (e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            if (editingIdRef.current != null) {
                setEditingId(null);
                setEditingName('');
                return;
            }
            onCloseRef.current?.();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [isOpen]);

    if (!isOpen) return null;

    const handleCreate = async (e) => {
        e.preventDefault();
        const trimmed = newName.trim();
        if (!trimmed || creating) return;
        setError('');
        setCreating(true);
        try {
            const res = await onCreateCategory?.({ name: trimmed, color: newColor });
            if (res?.success) {
                setNewName('');
                inputRef.current?.focus();
            } else {
                setError(res?.message || '添加分类失败');
            }
        } finally {
            setCreating(false);
        }
    };

    const handlePromoteAdHoc = async (tagName) => {
        if (creating) return;
        setError('');
        setCreating(true);
        try {
            const res = await onCreateCategory?.({ name: tagName, color: 'blue' });
            if (!res?.success) {
                setError(res?.message || '收录分类失败');
            }
        } finally {
            setCreating(false);
        }
    };

    const startEdit = (cat) => {
        setError('');
        setEditingId(cat.id);
        setEditingName(cat.name);
        setEditingColor(cat.color || 'blue');
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditingName('');
    };

    const handleSaveEdit = async (e) => {
        e.preventDefault();
        const trimmed = editingName.trim();
        if (!trimmed || savingEdit || editingId == null) return;
        setError('');
        setSavingEdit(true);
        try {
            const res = await onUpdateCategory?.(editingId, {
                name: trimmed,
                color: editingColor,
            });
            if (res?.success) {
                setEditingId(null);
                setEditingName('');
            } else {
                setError(res?.message || '更新分类失败');
            }
        } finally {
            setSavingEdit(false);
        }
    };

    const handleDelete = async (cat) => {
        const count = categoryCounts[cat.name] || 0;
        const msg = count > 0
            ? `确定删除分类「${cat.name}」吗？该分类下 ${count} 个谷歌账号不会被删除，仅从该分类移出。`
            : `确定删除分类「${cat.name}」吗？`;
        const ok = await confirmDialog(msg, {
            title: '删除分类',
            kind: 'warning',
            okLabel: '删除',
        });
        if (!ok) return;
        setError('');
        const res = await onDeleteCategory?.(cat.id, cat.name);
        if (res && !res.success) {
            setError(res.message || '删除分类失败');
        }
    };

    return renderInBody(
        <div
            className="gm-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="管理账号分类"
            onClick={() => onClose?.()}
        >
            <div
                className="gm-modal w-full max-w-lg max-h-[88vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="gm-modal-header">
                    <div className="flex items-center gap-2">
                        <FolderPlus size={16} style={{ color: 'var(--primary)' }} />
                        <h3 className="gm-title text-base">谷歌邮箱分类管理</h3>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="gm-icon-btn"
                        style={{ width: 30, height: 30 }}
                        aria-label="关闭分类管理"
                    >
                        <X size={16} />
                    </button>
                </div>

                <div className="gm-modal-body space-y-4 overflow-y-auto">
                    {/* 新建自定义分类 */}
                    <form onSubmit={handleCreate} className="space-y-3 p-3.5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-light)]">
                        <label className="block space-y-1.5">
                            <span className="text-xs font-medium gm-text-2">添加新分类（自定义分类名）</span>
                            <div className="flex items-center gap-2">
                                <input
                                    ref={inputRef}
                                    type="text"
                                    maxLength={40}
                                    value={newName}
                                    onChange={(e) => {
                                        setNewName(e.target.value);
                                        if (error) setError('');
                                    }}
                                    placeholder="如：主号、AI 订阅、美区小号、待养号..."
                                    className="gm-input flex-1"
                                />
                                <button
                                    type="submit"
                                    disabled={creating || !newName.trim()}
                                    className="gm-btn gm-btn-primary shrink-0"
                                >
                                    <FolderPlus size={14} />
                                    <span>{creating ? '添加中…' : '添加分类'}</span>
                                </button>
                            </div>
                        </label>

                        <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] gm-text-3">像素标记色</span>
                            <div className="flex items-center gap-1.5" role="radiogroup" aria-label="选择分类颜色">
                                {CATEGORY_COLORS.map(color => (
                                    <button
                                        key={color.id}
                                        type="button"
                                        role="radio"
                                        aria-checked={newColor === color.id}
                                        onClick={() => setNewColor(color.id)}
                                        aria-label={`颜色 ${color.label}`}
                                        title={color.label}
                                        className="w-5 h-5 rounded-[4px] flex items-center justify-center transition-transform cursor-pointer"
                                        style={{
                                            background: color.dot,
                                            outline: newColor === color.id ? '2px solid var(--text-primary)' : 'none',
                                            outlineOffset: '2px',
                                            transform: newColor === color.id ? 'scale(1.08)' : 'scale(1)',
                                        }}
                                    />
                                ))}
                            </div>
                        </div>
                    </form>

                    {error && (
                        <div
                            role="alert"
                            className="rounded-lg px-3 py-2 text-xs"
                            style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
                        >
                            {error}
                        </div>
                    )}

                    {/* 已有自定义分类列表 */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-medium gm-text-2">
                                已有自定义分类（{categories.length}）
                            </span>
                            <span className="text-[11px] gm-text-3">重命名会自动同步关联账号</span>
                        </div>

                        {categories.length === 0 ? (
                            <div className="p-6 text-center text-xs gm-text-3 rounded-xl border border-dashed border-[var(--border)]">
                                还没有自定义分类，在上方输入分类名即可添加。
                            </div>
                        ) : (
                            <div className="space-y-1.5">
                                {categories.map((cat) => {
                                    const meta = getCategoryColorMeta(cat.color);
                                    const count = categoryCounts[cat.name] || 0;
                                    const isEditing = editingId === cat.id;

                                    if (isEditing) {
                                        return (
                                            <form
                                                key={cat.id}
                                                onSubmit={handleSaveEdit}
                                                className="p-2.5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--primary)] space-y-2"
                                            >
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="text"
                                                        maxLength={40}
                                                        value={editingName}
                                                        onChange={(e) => setEditingName(e.target.value)}
                                                        className="gm-input flex-1 h-8 text-xs"
                                                        aria-label="修改分类名称"
                                                        autoFocus
                                                    />
                                                    <button
                                                        type="submit"
                                                        disabled={savingEdit || !editingName.trim()}
                                                        className="gm-btn gm-btn-primary gm-btn-sm"
                                                    >
                                                        <Check size={13} />
                                                        <span>保存</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={cancelEdit}
                                                        className="gm-btn gm-btn-ghost gm-btn-sm"
                                                    >
                                                        取消
                                                    </button>
                                                </div>
                                                <div className="flex items-center gap-1.5" role="radiogroup" aria-label="编辑分类颜色">
                                                    {CATEGORY_COLORS.map(color => (
                                                        <button
                                                            key={color.id}
                                                            type="button"
                                                            role="radio"
                                                            aria-checked={editingColor === color.id}
                                                            onClick={() => setEditingColor(color.id)}
                                                            aria-label={`编辑颜色 ${color.label}`}
                                                            className="w-4 h-4 rounded-[3px] cursor-pointer"
                                                            style={{
                                                                background: color.dot,
                                                                outline: editingColor === color.id ? '2px solid var(--text-primary)' : 'none',
                                                                outlineOffset: '1px',
                                                            }}
                                                        />
                                                    ))}
                                                </div>
                                            </form>
                                        );
                                    }

                                    return (
                                        <div
                                            key={cat.id}
                                            className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-light)]"
                                        >
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <span
                                                    className="w-2.5 h-2.5 rounded-[2px] shrink-0"
                                                    style={{ background: meta.dot }}
                                                    aria-hidden="true"
                                                />
                                                <span className="text-[13px] font-medium gm-text-1 truncate">
                                                    {cat.name}
                                                </span>
                                                <span className="text-[11px] font-mono gm-text-3 shrink-0">
                                                    {count} 个账号
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-1 shrink-0">
                                                <button
                                                    type="button"
                                                    onClick={() => startEdit(cat)}
                                                    className="gm-btn gm-btn-ghost p-1.5"
                                                    aria-label={`重命名分类 ${cat.name}`}
                                                    title="重命名或更改颜色"
                                                >
                                                    <Edit3 size={13} />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDelete(cat)}
                                                    className="gm-btn gm-btn-ghost p-1.5 hover:text-[var(--danger)]"
                                                    aria-label={`删除分类 ${cat.name}`}
                                                    title="删除分类"
                                                >
                                                    <Trash2 size={13} />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* 已有账号中的未收录自由标签（可一键转为正式自定义分类） */}
                    {adHocTags.length > 0 && (
                        <div className="space-y-2 pt-2 border-t border-[var(--border-subtle)]">
                            <div className="text-xs gm-text-3 flex items-center gap-1.5">
                                <Tag size={12} />
                                <span>账号中已有但尚未收录为自定义分类的标签</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {adHocTags.map(tag => (
                                    <button
                                        key={tag}
                                        type="button"
                                        onClick={() => handlePromoteAdHoc(tag)}
                                        disabled={creating}
                                        className="gm-filter-pill inline-flex items-center gap-1.5"
                                        title={`将「${tag}」收录为正式分类`}
                                    >
                                        <span>{tag}</span>
                                        <span className="text-[10.5px]" style={{ color: 'var(--primary)' }}>+ 收录</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div className="gm-modal-footer">
                    <button type="button" onClick={onClose} className="gm-btn gm-btn-secondary w-full">
                        完成
                    </button>
                </div>
            </div>
        </div>,
    );
};

export default AccountCategoryDialog;
