import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Plus } from 'lucide-react';
import { extractPhoneAndSmsUrl, normalizeSmsUrlInput } from '../utils/smsUtils';
import { normalizePhoneNumber } from '../utils/phoneUtils';
import { renderInBody } from '../utils/portal';
import {
    getCategoryColorMeta,
    joinMultiValueLines,
    splitDelimitedGroupNames,
} from '../utils/multiValueField';

const textareaClassName = 'gm-input resize-y min-h-[100px] leading-6';
const inputClassName = 'gm-input';

const EditModal = ({ account, accountCategories = [], onCreateCategory, onClose, onSubmit }) => {
    const phoneRef = useRef(null);
    const smsUrlRef = useRef(null);
    const [smsError, setSmsError] = useState('');
    const [groupText, setGroupText] = useState(account?.groupName || '');
    const [quickCatName, setQuickCatName] = useState('');
    const [quickCatError, setQuickCatError] = useState('');
    const [addingQuickCat, setAddingQuickCat] = useState(false);

    useEffect(() => {
        setGroupText(account?.groupName || '');
        setQuickCatName('');
        setQuickCatError('');
        setSmsError('');
    }, [account?.id, account?.groupName]);

    const activeTags = useMemo(
        () => splitDelimitedGroupNames(groupText),
        [groupText],
    );

    if (!account) return null;

    const hasTag = (catName) => {
        const lower = String(catName || '').toLowerCase();
        return activeTags.some(t => t.toLowerCase() === lower);
    };

    const toggleCategory = (catName) => {
        const lower = String(catName || '').toLowerCase();
        if (hasTag(catName)) {
            setGroupText(joinMultiValueLines(activeTags.filter(t => t.toLowerCase() !== lower)));
        } else {
            setGroupText(joinMultiValueLines([...activeTags, catName]));
        }
    };

    const handleQuickCreateCategory = async () => {
        const trimmed = quickCatName.trim();
        if (!trimmed || addingQuickCat || typeof onCreateCategory !== 'function') return;
        setQuickCatError('');
        setAddingQuickCat(true);
        try {
            const res = await onCreateCategory({ name: trimmed, color: 'blue' });
            if (res?.success && res.data?.name) {
                const nextTags = hasTag(res.data.name) ? activeTags : [...activeTags, res.data.name];
                setGroupText(joinMultiValueLines(nextTags));
                setQuickCatName('');
            } else {
                setQuickCatError(res?.message || '添加分类失败');
            }
        } finally {
            setAddingQuickCat(false);
        }
    };

    const handlePaste = (event) => {
        const text = event.clipboardData?.getData('text') || '';
        if (!text.includes('|') && !/https?:\/\//i.test(text)) return;

        const { phone, smsUrl } = extractPhoneAndSmsUrl(text);
        if (!phone && !smsUrl) return;

        event.preventDefault();
        if (phone && phoneRef.current) {
            phoneRef.current.value = phone;
        }
        if (smsUrl && smsUrlRef.current) {
            smsUrlRef.current.value = smsUrl;
            setSmsError('');
        }
    };

    const handleSubmit = (event) => {
        const rawSmsInput = smsUrlRef.current?.value ?? '';
        const normalizedSmsUrl = normalizeSmsUrlInput(rawSmsInput);

        const parsed = extractPhoneAndSmsUrl(rawSmsInput);
        const finalSmsUrl = normalizedSmsUrl || parsed.smsUrl;

        if (rawSmsInput.trim() && !finalSmsUrl) {
            setSmsError('接码地址必须是 https 链接');
            event.preventDefault();
            return;
        }

        if (parsed.phone && phoneRef.current) {
            const currentPhone = phoneRef.current.value.trim();
            if (!currentPhone || currentPhone !== parsed.phone) {
                phoneRef.current.value = normalizePhoneNumber(parsed.phone) || parsed.phone;
            }
        }
        if (finalSmsUrl && smsUrlRef.current) {
            smsUrlRef.current.value = finalSmsUrl;
        }
        setSmsError('');
        onSubmit(event);
    };

    return renderInBody(
        <div className="gm-overlay">
            <div className="gm-modal w-full max-w-2xl" role="dialog" aria-label="编辑账号信息">
                <div className="gm-modal-header">
                    <h3 className="gm-title text-base">编辑账号信息</h3>
                    <button onClick={onClose} className="gm-icon-btn" style={{ width: 30, height: 30 }} aria-label="关闭">
                        <X size={16} />
                    </button>
                </div>
                <form onSubmit={handleSubmit}>
                    <div className="gm-modal-body space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                            <div>
                                <label className="block text-xs font-medium gm-text-2 mb-1">邮箱账号</label>
                                <input name="email" defaultValue={account.email} required className={inputClassName} />
                            </div>
                            <div>
                                <label className="block text-xs font-medium gm-text-2 mb-1">登录密码</label>
                                <input name="password" defaultValue={account.password} required className={inputClassName} />
                            </div>
                            <div>
                                <label className="block text-xs font-medium gm-text-2 mb-1">恢复邮箱</label>
                                <input name="recovery" defaultValue={account.recovery} className={inputClassName} />
                            </div>
                            <div>
                                <label className="block text-xs font-medium gm-text-2 mb-1">2FA 密钥</label>
                                <input name="secret" defaultValue={account.secret} className={inputClassName} />
                            </div>
                            <div>
                                <label className="block text-xs font-medium gm-text-2 mb-1">手机号</label>
                                <input
                                    ref={phoneRef}
                                    name="phone"
                                    defaultValue={account.phone}
                                    onPaste={handlePaste}
                                    placeholder="如：+12192731268，或直接粘贴 手机号|接码地址"
                                    className={inputClassName}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium gm-text-2 mb-1">手机接码地址</label>
                                <input
                                    ref={smsUrlRef}
                                    name="smsUrl"
                                    defaultValue={account.smsUrl || ''}
                                    onPaste={handlePaste}
                                    placeholder="https://sms6688.com/api/sms/recordText?token=...&tpl=1"
                                    className={inputClassName}
                                />
                                {smsError
                                    ? <p className="mt-1 text-xs" style={{ color: 'var(--danger)' }}>{smsError}</p>
                                    : <p className="mt-1 text-[11px] gm-text-3">粘贴「手机号|接码地址」会自动拆分。</p>}
                            </div>
                            <div>
                                <label className="block text-xs font-medium gm-text-2 mb-1">注册年份</label>
                                <input name="regYear" defaultValue={account.regYear} placeholder="如：2021" className={inputClassName} />
                            </div>
                            <div>
                                <label className="block text-xs font-medium gm-text-2 mb-1">国家</label>
                                <input name="country" defaultValue={account.country} placeholder="如：China" className={inputClassName} />
                            </div>
                            <div>
                                <label className="block text-xs font-medium gm-text-2 mb-1">分类 / 标签</label>
                                {accountCategories.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 mb-2" role="group" aria-label="快捷选择分类">
                                        {accountCategories.map(cat => {
                                            const active = hasTag(cat.name);
                                            const meta = getCategoryColorMeta(cat.color);
                                            return (
                                                <button
                                                    key={cat.id}
                                                    type="button"
                                                    onClick={() => toggleCategory(cat.name)}
                                                    className={`gm-filter-pill inline-flex items-center gap-1.5 ${active ? 'is-active' : ''}`}
                                                    style={active ? {
                                                        background: meta.bg,
                                                        borderColor: meta.border,
                                                        color: meta.text,
                                                    } : undefined}
                                                >
                                                    <span
                                                        className="w-1.5 h-1.5 rounded-[1px]"
                                                        style={{ background: meta.dot }}
                                                        aria-hidden="true"
                                                    />
                                                    <span>{cat.name}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                                {typeof onCreateCategory === 'function' && (
                                    <div className="mb-2 space-y-1">
                                        <div className="flex items-center gap-1.5">
                                            <input
                                                type="text"
                                                maxLength={40}
                                                value={quickCatName}
                                                onChange={(e) => {
                                                    setQuickCatName(e.target.value);
                                                    if (quickCatError) setQuickCatError('');
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        handleQuickCreateCategory();
                                                    }
                                                }}
                                                placeholder="输入新分类名快速添加..."
                                                className="gm-input flex-1 h-8 text-xs"
                                            />
                                            <button
                                                type="button"
                                                onClick={handleQuickCreateCategory}
                                                disabled={addingQuickCat || !quickCatName.trim()}
                                                className="gm-btn gm-btn-secondary gm-btn-sm shrink-0"
                                            >
                                                <Plus size={12} />
                                                <span>添加分类</span>
                                            </button>
                                        </div>
                                        {quickCatError && (
                                            <p role="alert" className="text-xs" style={{ color: 'var(--danger)' }}>
                                                {quickCatError}
                                            </p>
                                        )}
                                    </div>
                                )}
                                <textarea
                                    name="groupName"
                                    value={groupText}
                                    onChange={(e) => setGroupText(e.target.value)}
                                    placeholder="每行一个分类或标签，支持点击上方快捷勾选"
                                    className={textareaClassName}
                                />
                                <p className="mt-1 text-[11px] gm-text-3">每行一个分类/标签，保存时自动去空、去重。</p>
                            </div>
                            <div>
                                <label className="block text-xs font-medium gm-text-2 mb-1">备注信息</label>
                                <textarea
                                    name="remark"
                                    defaultValue={account.remark || ''}
                                    placeholder="每行一条备注，例如：推特绑定、备用机登录等"
                                    className={textareaClassName}
                                />
                                <p className="mt-1 text-[11px] gm-text-3">每行一条，便于逐项管理和后续查看。</p>
                            </div>
                        </div>
                    </div>
                    <div className="gm-modal-footer">
                        <button type="button" onClick={onClose} className="gm-btn gm-btn-secondary flex-1">取消</button>
                        <button type="submit" className="gm-btn gm-btn-primary flex-1">确认保存</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default EditModal;
