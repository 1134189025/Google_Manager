import React, { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { extractPhoneAndSmsUrl, normalizeSmsUrlInput } from '../utils/smsUtils';
import { normalizePhoneNumber } from '../utils/phoneUtils';

// 表单输入 / 文本域统一使用 cockpit 主题输入样式
const textareaClassName = 'gm-input resize-y min-h-[108px] leading-6';
const inputClassName = 'gm-input';

const EditModal = ({ account, onClose, onSubmit }) => {
    const phoneRef = useRef(null);
    const smsUrlRef = useRef(null);
    const [smsError, setSmsError] = useState('');

    if (!account) return null;

    /**
     * 粘贴 `手机号|接码地址` 时自动拆分到两个输入框
     * 这样用户既可以直接粘贴整串，也可以只填单个字段
     */
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

        // 只填了手机号|接码地址 这种整串时，交给粘贴处理；这里兜底再解析一次
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

    return (
        <div className="gm-overlay">
            <div className="gm-modal w-full max-w-2xl animate-in zoom-in-95 duration-200">
                <div className="gm-modal-header">
                    <h3 className="gm-title">编辑账号信息</h3>
                    <button onClick={onClose} className="gm-icon-btn">
                        <X size={20} />
                    </button>
                </div>
                <form onSubmit={handleSubmit}>
                    <div className="gm-modal-body space-y-4">
                        <div className="grid grid-cols-1 gap-4">
                            <div>
                                <label className="block text-sm font-medium gm-text-2 mb-1">邮箱账号</label>
                                <input name="email" defaultValue={account.email} required className={inputClassName} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium gm-text-2 mb-1">登录密码</label>
                                <input name="password" defaultValue={account.password} required className={inputClassName} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium gm-text-2 mb-1">恢复邮箱</label>
                                <input name="recovery" defaultValue={account.recovery} className={inputClassName} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium gm-text-2 mb-1">手机号</label>
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
                                <label className="block text-sm font-medium gm-text-2 mb-1">手机接码地址</label>
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
                                    : <p className="mt-1 text-xs gm-text-3">用于在列表「手机验证码」列实时获取短信验证码；粘贴「手机号|接码地址」会自动拆分到两个输入框。</p>}
                            </div>
                            <div>
                                <label className="block text-sm font-medium gm-text-2 mb-1">2FA 密钥</label>
                                <input name="secret" defaultValue={account.secret} className={inputClassName} />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium gm-text-2 mb-1">注册年份</label>
                                    <input name="regYear" defaultValue={account.regYear} placeholder="如：2021" className={inputClassName} />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium gm-text-2 mb-1">国家</label>
                                    <input name="country" defaultValue={account.country} placeholder="如：China" className={inputClassName} />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium gm-text-2 mb-1">标签</label>
                                <textarea
                                    name="groupName"
                                    defaultValue={account.groupName || ''}
                                    placeholder="每行一个标签，支持逗号或换行粘贴"
                                    className={textareaClassName}
                                />
                                <p className="mt-1 text-xs gm-text-3">每行一个标签，保存时会自动去空、去重。</p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium gm-text-2 mb-1">备注信息</label>
                                <textarea
                                    name="remark"
                                    defaultValue={account.remark || ''}
                                    placeholder="每行一条备注，例如：推特绑定、备用机登录等"
                                    className={textareaClassName}
                                />
                                <p className="mt-1 text-xs gm-text-3">每行一条，便于逐项管理和后续查看。</p>
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
