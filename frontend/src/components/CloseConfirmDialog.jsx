import { useEffect, useState } from 'react';
import { X, Minimize2, LogOut } from 'lucide-react';
import api from '../services/api';
import { renderInBody } from '../utils/portal';

/**
 * 关闭主窗口确认弹窗：让用户选择「最小化至托盘」或「直接退出」，支持记住选择
 */
const CloseConfirmDialog = ({ isOpen, onClose, onNotify }) => {
    const [rememberChoice, setRememberChoice] = useState(false);
    const [submittingAction, setSubmittingAction] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        if (!isOpen) return undefined;
        setRememberChoice(false);
        setSubmittingAction('');
        setError('');

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onClose?.();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const handleAction = async (action) => {
        if (submittingAction) return;
        setError('');
        setSubmittingAction(action);
        try {
            const res = await api.handleWindowClose(action, rememberChoice);
            if (!res?.success) {
                const msg = res?.message || '执行窗口关闭操作失败';
                setError(msg);
                onNotify?.(msg, 'error');
                setSubmittingAction('');
                return;
            }
            onClose?.();
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err || '执行窗口关闭操作失败');
            setError(msg);
            onNotify?.(msg, 'error');
            setSubmittingAction('');
        }
    };

    const busy = Boolean(submittingAction);

    return renderInBody(
        <div
            className="gm-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="关闭窗口确认"
            onClick={() => !busy && onClose?.()}
        >
            <div
                className="gm-modal glass w-full max-w-md p-6 space-y-4"
                data-lens="sheet"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2">
                            <span
                                className="inline-block w-2 h-2 rounded-[2px]"
                                style={{ background: 'var(--primary)' }}
                                aria-hidden="true"
                            />
                            <h2 className="text-[15.5px] font-semibold text-[var(--text-primary)]">
                                关闭 GoogleManager
                            </h2>
                        </div>
                        <p className="text-[12px] text-[var(--text-secondary)]">
                            请选择关闭主窗口时的操作方式，最小化后可从系统托盘随时恢复。
                        </p>
                    </div>
                    <button
                        type="button"
                        className="gm-btn gm-btn-ghost p-1"
                        onClick={() => !busy && onClose?.()}
                        aria-label="取消关闭"
                        disabled={busy}
                    >
                        <X size={16} />
                    </button>
                </div>

                <div className="grid grid-cols-1 gap-2.5">
                    <button
                        type="button"
                        onClick={() => handleAction('minimize')}
                        disabled={busy}
                        className="w-full text-left p-3.5 rounded-xl border transition-all flex items-center gap-3.5 cursor-pointer group"
                        style={{
                            background: 'var(--bg-elevated)',
                            borderColor: 'var(--primary-border, var(--border))',
                        }}
                    >
                        <div
                            className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                            style={{
                                background: 'var(--primary-light)',
                                color: 'var(--primary)',
                            }}
                        >
                            <Minimize2 size={18} />
                        </div>
                        <div className="min-w-0 flex-1 space-y-0.5">
                            <div className="flex items-center gap-2">
                                <span className="text-[13.5px] font-semibold text-[var(--text-primary)]">
                                    {submittingAction === 'minimize' ? '正在最小化至托盘…' : '最小化至托盘'}
                                </span>
                                <span className="gm-chip gm-chip-accent">后台保活</span>
                            </div>
                            <div className="text-[11.5px] text-[var(--text-secondary)] leading-snug">
                                隐藏主窗口并在系统托盘驻留，单击托盘图标可快速恢复窗口
                            </div>
                        </div>
                    </button>

                    <button
                        type="button"
                        onClick={() => handleAction('quit')}
                        disabled={busy}
                        className="w-full text-left p-3.5 rounded-xl border transition-all flex items-center gap-3.5 cursor-pointer"
                        style={{
                            background: 'var(--bg-elevated)',
                            borderColor: 'var(--border)',
                        }}
                    >
                        <div
                            className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                            style={{
                                background: 'var(--danger-soft)',
                                color: 'var(--danger)',
                            }}
                        >
                            <LogOut size={18} />
                        </div>
                        <div className="min-w-0 flex-1 space-y-0.5">
                            <div className="text-[13.5px] font-semibold text-[var(--text-primary)]">
                                {submittingAction === 'quit' ? '正在退出应用…' : '直接退出'}
                            </div>
                            <div className="text-[11.5px] text-[var(--text-secondary)] leading-snug">
                                彻底关闭 GoogleManager 并断开已打开的 SSH 终端会话
                            </div>
                        </div>
                    </button>
                </div>

                {error && (
                    <div
                        role="alert"
                        className="rounded-lg px-3 py-2 text-[12px]"
                        style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
                    >
                        {error}
                    </div>
                )}

                <div className="flex items-center justify-between gap-3 pt-1 border-t border-[var(--border-subtle)]">
                    <label className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)] cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={rememberChoice}
                            onChange={(e) => setRememberChoice(e.target.checked)}
                            disabled={busy}
                        />
                        <span>记住我的选择，下次不再询问</span>
                    </label>
                    <button
                        type="button"
                        onClick={() => onClose?.()}
                        disabled={busy}
                        className="gm-btn gm-btn-ghost gm-btn-sm"
                    >
                        取消
                    </button>
                </div>
                <p className="text-[11px] text-[var(--text-tertiary)] -mt-2">
                    提示：记住后仍可随时在「系统设置 → 常规与托盘」中改回每次询问。
                </p>
            </div>
        </div>,
    );
};

export default CloseConfirmDialog;
