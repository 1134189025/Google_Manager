import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { renderInBody } from '../utils/portal';

/**
 * 应用内输入框（替代 `window.prompt`）
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
            <div className="gm-modal w-full max-w-md" role="dialog" aria-label={title}>
                <div className="gm-modal-header">
                    <h3 className="gm-title text-base">{title}</h3>
                    <button type="button" onClick={onCancel} className="gm-icon-btn" style={{ width: 30, height: 30 }} aria-label="关闭">
                        <X size={16} />
                    </button>
                </div>
                <form onSubmit={handleSubmit}>
                    <div className="gm-modal-body space-y-3">
                        {description && <p className="text-xs gm-text-2">{description}</p>}
                        <div>
                            {label && (
                                <label htmlFor="gm-prompt-input" className="block text-xs font-medium gm-text-2 mb-1">{label}</label>
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
                        {error && <p className="text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
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
