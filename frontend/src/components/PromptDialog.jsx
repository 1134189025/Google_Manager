import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { renderInBody } from '../utils/portal';

/**
 * 应用内输入框（替代 `window.prompt`：macOS 的 WebView 没有实现它，调用直接返回 null）
 *
 * onSubmit(value) 返回字符串时作为错误提示显示并保持打开；返回其他值则由调用方负责关闭。
 */
const PromptDialog = ({
    isOpen,
    title,
    description = '',
    label = '',
    placeholder = '',
    defaultValue = '',
    submitLabel = '确定',
    onSubmit,
    onCancel,
}) => {
    const [value, setValue] = useState(defaultValue);
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const inputRef = useRef(null);

    useEffect(() => {
        if (!isOpen) return;
        setValue(defaultValue);
        setError('');
        setSubmitting(false);
        // 等弹窗渲染后再聚焦
        const timer = setTimeout(() => inputRef.current?.focus(), 0);
        return () => clearTimeout(timer);
    }, [isOpen, defaultValue]);

    if (!isOpen) return null;

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (submitting) return;
        setSubmitting(true);
        try {
            const result = await onSubmit(value);
            if (typeof result === 'string' && result) setError(result);
        } finally {
            setSubmitting(false);
        }
    };

    const handleKeyDown = (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
        }
    };

    return renderInBody(
        <div className="gm-overlay" onKeyDown={handleKeyDown}>
            <div className="gm-modal w-full max-w-md animate-in zoom-in-95 duration-200" role="dialog" aria-label={title}>
                <div className="gm-modal-header">
                    <h3 className="gm-title">{title}</h3>
                    <button type="button" onClick={onCancel} className="gm-icon-btn" aria-label="关闭">
                        <X size={20} />
                    </button>
                </div>
                <form onSubmit={handleSubmit}>
                    <div className="gm-modal-body space-y-3">
                        {description && <p className="text-sm gm-text-2">{description}</p>}
                        <div>
                            {label && (
                                <label htmlFor="gm-prompt-input" className="block text-sm font-medium gm-text-2 mb-1">{label}</label>
                            )}
                            <input
                                id="gm-prompt-input"
                                ref={inputRef}
                                value={value}
                                onChange={(event) => { setValue(event.target.value); setError(''); }}
                                placeholder={placeholder}
                                aria-label={label || title}
                                className="gm-input w-full"
                            />
                        </div>
                        {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
                    </div>
                    <div className="gm-modal-footer">
                        <button type="button" onClick={onCancel} className="gm-btn gm-btn-secondary flex-1">取消</button>
                        <button type="submit" disabled={submitting} className="gm-btn gm-btn-primary flex-1">
                            {submitting ? '处理中…' : submitLabel}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default PromptDialog;
