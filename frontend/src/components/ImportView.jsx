import React, { useState, useCallback, useRef, useEffect } from 'react';
import { UserPlus, FileText, Plus, Activity, Loader2 } from 'lucide-react';
import { parseImportText } from '../utils/importParser';
import { normalizePhoneNumber } from '../utils/phoneUtils';
import { describeSmsUrl, extractPhoneAndSmsUrl, normalizeSmsUrlInput } from '../utils/smsUtils';

/**
 * 防抖 Hook - 延迟执行函数，避免频繁调用
 * 包含 cleanup 逻辑以防止内存泄漏
 */
const useDebounce = (callback, delay = 300) => {
    const timeoutRef = useRef(null);

    // 组件卸载时清理定时器
    useEffect(() => {
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, []);

    const debouncedCallback = useCallback((...args) => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = setTimeout(() => {
            callback(...args);
        }, delay);
    }, [callback, delay]);
    return debouncedCallback;
};

const IMPORT_FORMAT_LINES = [
    '邮箱----密码----恢复邮箱----2FA密钥',
    '邮箱|密码|恢复邮箱|2FA密钥',
    '卡号：邮箱密码：密码----2FA密钥',
];

const IMPORT_EXTRA_RULE = '尾字段会自动识别手机号（默认+86）、注册年份（2015-2030）、国家、2FA链接。';

const IMPORT_PLACEHOLDER = `示例：
example@gmail.com----password123----recovery@example.com----JBSWY3DPEHPK3PXP
user@gmail.com|pass123|backup@gmail.com|5AMG4HOE2ZBVS2R5
demo@gmail.com----Pass@123----+8613812345678----2022----China----https://2fa.live/tok/jbswy3dpehpk3pxp
卡号：test@gmail.com密码：Pass@123----3TKXUZWOGOZRBFES`;

/**
 * 导入视图组件
 */
const ImportView = ({ onImport, onCancel, importing = false }) => {
    const [importMode, setImportMode] = useState('single');
    const [text, setText] = useState('');
    const [preview, setPreview] = useState([]);
    const [detectedFormats, setDetectedFormats] = useState([]);
    const [showFormatConfirm, setShowFormatConfirm] = useState(false);
    const [isParsing, setIsParsing] = useState(false);

    // 单个账号导入的表单状态
    const [singleForm, setSingleForm] = useState({
        email: '',
        password: '',
        recovery: '',
        phone: '',
        secret: '',
        sms_url: '',
        reg_year: '',
        country: '',
        group_name: '',
    });

    // 实际解析函数
    const parseAndSetPreview = useCallback((val) => {
        const { parsed, detectedFormats: formats } = parseImportText(val);
        setPreview(parsed);

        if (formats.length > 0) {
            setDetectedFormats(formats);
            setShowFormatConfirm(true);
        } else {
            setDetectedFormats([]);
            setShowFormatConfirm(false);
        }
        setIsParsing(false);
    }, []);

    // 防抖版本的解析函数（300ms 延迟）
    const debouncedParse = useDebounce(parseAndSetPreview, 300);

    const handleParse = (val) => {
        setText(val);
        // 仅在有内容时才显示解析状态，避免空输入时也显示 PARSING
        if (val.trim()) {
            setIsParsing(true);
            debouncedParse(val);
        } else {
            setPreview([]);
            setIsParsing(false);
            setDetectedFormats([]);
            setShowFormatConfirm(false);
        }
    };

    /**
     * 手机号 / 接码地址输入支持整串粘贴 `手机号|接码地址`
     * 粘贴这类内容时自动拆到两个字段，避免 URL 里的数字混进手机号
     */
    const handleSingleFormChange = (field, value) => {
        if (field === 'phone' || field === 'sms_url') {
            const combined = extractPhoneAndSmsUrl(value);
            if (combined.smsUrl || (combined.phone && value.includes('|'))) {
                setSingleForm(prev => ({
                    ...prev,
                    phone: combined.phone ? (normalizePhoneNumber(combined.phone) || combined.phone) : prev.phone,
                    sms_url: combined.smsUrl || prev.sms_url,
                }));
                return;
            }
        }
        setSingleForm(prev => ({ ...prev, [field]: value }));
    };

    const handleSingleImport = () => {
        if (importing) return;
        if (!singleForm.email.trim() || !singleForm.password.trim()) return;

        // 提交前再解析一次，保证整串粘贴的内容一定被拆开
        const combined = extractPhoneAndSmsUrl(singleForm.sms_url);
        const phoneFromSmsField = combined.phone;
        const smsUrl = combined.smsUrl || normalizeSmsUrlInput(singleForm.sms_url);

        onImport([{
            email: singleForm.email.trim(),
            password: singleForm.password.trim(),
            recovery: singleForm.recovery.trim(),
            phone: normalizePhoneNumber(singleForm.phone.trim() || phoneFromSmsField || '') || '',
            secret: singleForm.secret.trim().replace(/\s/g, ''),
            sms_url: smsUrl,
            reg_year: singleForm.reg_year.trim(),
            country: singleForm.country.trim(),
            group_name: '',
            remark: '',
        }]);
    };

    const isSingleFormValid = singleForm.email.trim() && singleForm.password.trim();

    const renderSingleFormField = (label, field, type, placeholder, required, hint) => (
        <div>
            <label className="block text-sm font-medium gm-text-2 mb-2">
                {label} {required
                    ? <span style={{ color: 'var(--danger)' }}>*</span>
                    : <span className="gm-text-3 text-xs">(可选)</span>}
            </label>
            <input
                type={type}
                value={singleForm[field]}
                onChange={(e) => handleSingleFormChange(field, e.target.value)}
                disabled={importing}
                placeholder={placeholder}
                className={`gm-input ${importing ? 'opacity-60 cursor-not-allowed' : ''}`}
            />
            {hint && <p className="mt-1 text-xs gm-text-3">{hint}</p>}
        </div>
    );

    const renderPreviewItem = (item, idx, isSingle) => (
        <div key={idx} className={`gm-solid ${isSingle ? 'p-4' : 'p-3'} ${isSingle ? '' : 'text-xs'}`}>
            <div className={`flex justify-between ${isSingle ? 'mb-3' : 'mb-1'}`}>
                <span className={`font-bold ${isSingle ? 'text-lg' : ''}`} style={{ color: 'var(--primary)' }}>{item.email || '未知账号'}</span>
                <span className="gm-text-3">#{idx + 1}</span>
            </div>
            {isSingle ? (
                <div className="grid grid-cols-1 gap-2 text-sm">
                    {[
                        ['密码', '•'.repeat(item.password?.length || 0), !!item.password],
                        ['恢复邮箱', item.recovery || '未设置', !!item.recovery],
                        ['手机号', item.phone || '未设置', !!item.phone],
                        ['手机验证码', describeSmsUrl(item.sms_url || item.smsUrl) ? `已配置（${describeSmsUrl(item.sms_url || item.smsUrl)}）` : '未设置', !!(item.sms_url || item.smsUrl)],
                        ['2FA密钥', item.secret ? '已设置' : '未设置', !!item.secret],
                        ['注册年份', item.reg_year || '未设置', !!item.reg_year],
                        ['国家', item.country || '未设置', !!item.country],
                    ].map(([label, value, hasValue], i, arr) => (
                        <div key={label} className={`flex justify-between ${i < arr.length - 1 ? 'border-b' : ''} pb-2 pt-1`} style={i < arr.length - 1 ? { borderColor: 'var(--border-light)' } : undefined}>
                            <span className="gm-text-3">{label}:</span>
                            <span className={hasValue
                                ? (label === '2FA密钥' ? 'gm-text-1' : (label === '密码' ? 'gm-text-2 font-mono' : 'gm-text-1'))
                                : 'gm-text-3 italic'}
                                style={hasValue && label === '2FA密钥' ? { color: 'var(--success)' } : undefined}>{value}</span>
                        </div>
                    ))}
                    <div className="flex justify-between pt-1">
                        <span className="gm-text-3">状态:</span>
                        <span style={{ color: 'var(--warning)' }}>未开启 (默认)</span>
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-1 gm-text-2 mt-2">
                    <div className="flex justify-between border-b pb-1 pt-1" style={{ borderColor: 'var(--border-light)' }}>
                        <span className="gm-text-3">手机验证码:</span>
                        <span className={describeSmsUrl(item.sms_url || item.smsUrl) ? '' : 'gm-text-3'}>
                            {describeSmsUrl(item.sms_url || item.smsUrl) ? `已配置（${describeSmsUrl(item.sms_url || item.smsUrl)}）` : '未设置'}
                        </span>
                    </div>
                    <div className="flex justify-between border-b pb-1 pt-1" style={{ borderColor: 'var(--border-light)' }}>
                        <span className="gm-text-3">状态:</span> <span className="gm-text-2">未开启 (默认)</span>
                    </div>
                    <div className="flex justify-between border-b pb-1 pt-1" style={{ borderColor: 'var(--border-light)' }}>
                        <span className="gm-text-3">备注:</span> <span style={{ color: 'var(--success)' }}>{item.remark || '无'}</span>
                    </div>
                </div>
            )}
        </div>
    );

    return (
        <div className="max-w-4xl mx-auto animate-in fade-in zoom-in-95 duration-500">
            <div className="mb-8">
                <h1 className="gm-title">导入账号</h1>
                <p className="gm-subtitle">导入后状态默认设为"未开启"</p>
            </div>

            {/* 切换标签 */}
            <div className="gm-seg mb-6 w-fit">
                {[
                    { key: 'single', icon: <UserPlus size={18} />, label: '单个导入' },
                    { key: 'batch', icon: <FileText size={18} />, label: '批量导入' },
                ].map(({ key, icon, label }) => (
                    <button
                        key={key}
                        disabled={importing}
                        onClick={() => setImportMode(key)}
                        className={`gm-seg-item flex items-center gap-2 ${importMode === key ? 'active' : ''} ${importMode === key
                            ? 'shadow-sm text-[color:var(--primary)]'
                            : 'gm-text-2 hover:text-[color:var(--text-primary)]'} ${importing ? 'opacity-60 cursor-not-allowed' : ''}`}
                    >
                        {icon}
                        {label}
                    </button>
                ))}
            </div>

            {importMode === 'single' ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="space-y-4">
                        <div className="gm-card p-6">
                            <div className="flex items-center gap-2 mb-6" style={{ color: 'var(--primary)' }}>
                                <UserPlus size={20} />
                                <h2 className="font-bold">单个账号信息</h2>
                            </div>
                            <div className="space-y-4">
                                {renderSingleFormField('邮箱账号', 'email', 'email', 'example@gmail.com', true)}
                                {renderSingleFormField('登录密码', 'password', 'text', '输入密码', true)}
                                {renderSingleFormField('恢复邮箱', 'recovery', 'email', 'recovery@example.com', false)}
                                {renderSingleFormField('手机号', 'phone', 'text', '默认+86，可填 +12192731268', false)}
                                {renderSingleFormField(
                                    '手机接码地址',
                                    'sms_url',
                                    'text',
                                    'https://sms6688.com/api/sms/recordText?token=...&tpl=1',
                                    false,
                                    '粘贴「手机号|接码地址」会自动拆分到手机号与这里，用于实时获取短信验证码'
                                )}
                                {renderSingleFormField('2FA 密钥', 'secret', 'text', 'TOTP密钥', false)}
                                <div className="grid grid-cols-2 gap-4">
                                    {renderSingleFormField('注册年份', 'reg_year', 'text', '2021', false)}
                                    {renderSingleFormField('国家', 'country', 'text', 'China / Japan / USA', false)}
                                </div>
                            </div>
                        </div>
                        <div className="gm-solid p-4">
                            <p className="text-xs font-semibold gm-text-1 mb-2">行格式参考（与批量解析一致）</p>
                            <div className="text-xs gm-text-2 space-y-1">
                                {IMPORT_FORMAT_LINES.map((line) => (
                                    <p key={line}>• {line}</p>
                                ))}
                                <p>{IMPORT_EXTRA_RULE}</p>
                            </div>
                        </div>
                        <div className="flex gap-4">
                            <button
                                onClick={onCancel}
                                disabled={importing}
                                className="gm-btn gm-btn-secondary flex-1 py-4 font-bold"
                            >
                                返回列表
                            </button>
                            <button
                                disabled={!isSingleFormValid || importing}
                                onClick={handleSingleImport}
                                className="gm-btn gm-btn-primary flex-1 py-4 px-8 font-bold"
                            >
                                {importing ? (
                                    <>
                                        <Loader2 size={20} className="animate-spin" />
                                        导入中...
                                    </>
                                ) : (
                                    <>
                                        <Plus size={20} />
                                        立即导入
                                    </>
                                )}
                            </button>
                        </div>
                        {importing && (
                            <p className="text-xs px-1" style={{ color: 'var(--primary)' }}>正在导入账号，请勿重复点击...</p>
                        )}
                    </div>

                    <div className="space-y-4">
                        <div className="gm-panel p-6 h-[516px] flex flex-col">
                            <div className="flex items-center gap-2 mb-6 border-b pb-4" style={{ borderColor: 'var(--border-light)' }}>
                                <div className={`w-2 h-2 rounded-full ${isSingleFormValid ? 'animate-pulse' : 'gm-text-3'}`} style={isSingleFormValid ? { background: 'var(--success)' } : { background: 'var(--text-muted)' }}></div>
                                <h2 className="font-bold gm-text-1">实时预览 (Real-time Preview)</h2>
                            </div>
                            {isSingleFormValid ? (
                                <div className="flex-1 overflow-y-auto space-y-3 pr-2">
                                    {renderPreviewItem(singleForm, 0, true)}
                                </div>
                            ) : (
                                <div className="gm-empty flex-1 flex flex-col items-center justify-center">
                                    <UserPlus size={48} className="mb-4 opacity-10" />
                                    <p>请填写账号信息</p>
                                    <p className="text-xs mt-2 italic gm-text-3">邮箱和密码为必填项</p>
                                </div>
                            )}
                            <div className="mt-4 pt-4 border-t text-[10px] gm-text-3 flex justify-between uppercase tracking-widest" style={{ borderColor: 'var(--border-light)' }}>
                                <span>Status: {isSingleFormValid ? 'READY' : 'WAITING'}</span>
                                <span>Count: {isSingleFormValid ? 1 : 0}</span>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="space-y-4">
                        <div className="gm-card p-6">
                            <div className="flex items-center gap-2 mb-4" style={{ color: 'var(--primary)' }}>
                                <FileText size={20} />
                                <h2 className="font-bold">粘贴数据区域</h2>
                            </div>
                            <p className="text-xs gm-text-3 mb-3 p-3 rounded-lg border border-dashed" style={{ borderColor: 'var(--border)' }}>
                                支持多种格式：<br/>
                                • {IMPORT_FORMAT_LINES[0]}<br/>
                                • {IMPORT_FORMAT_LINES[1]}<br/>
                                • {IMPORT_FORMAT_LINES[2]}<br/>
                                支持分隔符：| ---- —— --- --<br/>
                                {IMPORT_EXTRA_RULE}
                            </p>
                            <textarea
                                className="gm-input h-80 text-sm resize-none"
                                placeholder={IMPORT_PLACEHOLDER}
                                disabled={importing}
                                value={text} onChange={(e) => handleParse(e.target.value)}
                            />
                        </div>
                        <div className="flex gap-4">
                            <button
                                onClick={onCancel}
                                disabled={importing}
                                className="gm-btn gm-btn-secondary flex-1 py-4 font-bold"
                            >
                                返回列表
                            </button>
                            {/* 解析防抖期间预览还是旧文本的结果，此时禁止导入，保证导入的就是看到的 */}
                            <button
                                disabled={preview.length === 0 || importing || isParsing}
                                onClick={() => {
                                    if (!importing && !isParsing) onImport(preview);
                                }}
                                className="gm-btn gm-btn-primary flex-2 py-4 px-8 font-bold"
                            >
                                {importing ? (
                                    <>
                                        <Loader2 size={20} className="animate-spin" />
                                        导入中...
                                    </>
                                ) : (
                                    <>
                                        <Plus size={20} />
                                        {`立即导入 ${preview.length > 0 ? `(${preview.length}条)` : ''}`}
                                    </>
                                )}
                            </button>
                        </div>
                        {importing && (
                            <p className="text-xs px-1" style={{ color: 'var(--primary)' }}>导入进行中，完成后将自动返回列表。</p>
                        )}
                    </div>

                    <div className="space-y-4">
                        <div className="gm-panel p-6 h-[516px] flex flex-col">
                            <div className="flex items-center gap-2 mb-6 border-b pb-4" style={{ borderColor: 'var(--border-light)' }}>
                                <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--success)' }}></div>
                                <h2 className="font-bold gm-text-1">实时预览 (Real-time Preview)</h2>
                            </div>
                            {preview.length > 0 ? (
                                <div className="flex-1 overflow-y-auto space-y-3 pr-2 scrollbar-thin">
                                    {preview.map((item, idx) => renderPreviewItem(item, idx, false))}
                                </div>
                            ) : (
                                <div className="gm-empty flex-1 flex flex-col items-center justify-center">
                                    <Activity size={48} className="mb-4 opacity-10" />
                                    <p>等待解析数据...</p>
                                    <p className="text-xs mt-2 italic gm-text-3">所有导入项初始状态均为"未开启"</p>
                                </div>
                            )}
                            <div className="mt-4 pt-4 border-t text-[10px] gm-text-3 flex justify-between uppercase tracking-widest" style={{ borderColor: 'var(--border-light)' }}>
                                <span>Status: {isParsing ? 'PARSING...' : 'OK'}</span>
                                <span>Count: {preview.length}</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 格式确认对话框 */}
            {showFormatConfirm && (
                <div className="gm-overlay">
                    <div className="gm-modal max-w-md mx-4 animate-in zoom-in-95 duration-200">
                        <div className="gm-modal-body">
                            <h3 className="text-lg font-bold gm-text-1 mb-4">检测到多种导入格式</h3>
                            <p className="gm-text-2 mb-4">系统检测到您的导入文本包含多种不同的格式规则：</p>
                            <ul className="list-disc list-inside text-sm gm-text-2 mb-4 space-y-1 gm-solid p-4">
                                {detectedFormats.map((format, i) => (
                                    <li key={i} className="gm-text-1">{format}</li>
                                ))}
                            </ul>
                            <p className="gm-text-2 mb-6 text-sm">请确认解析结果是否正确，或返回修改导入文本使用统一格式。</p>
                            <div className="flex gap-3 justify-end">
                                <button
                                    onClick={() => { setShowFormatConfirm(false); setText(''); setPreview([]); setDetectedFormats([]); }}
                                    className="gm-btn gm-btn-secondary"
                                >
                                    返回修改
                                </button>
                                <button
                                    onClick={() => setShowFormatConfirm(false)}
                                    className="gm-btn gm-btn-primary"
                                >
                                    确认导入
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ImportView;
