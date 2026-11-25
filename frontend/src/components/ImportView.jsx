import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { parseImportText } from '../utils/importParser';
import { normalizePhoneNumber } from '../utils/phoneUtils';
import { describeSmsUrl, extractPhoneAndSmsUrl, normalizeSmsUrlInput } from '../utils/smsUtils';
import { appendUniqueLine } from '../utils/multiValueField';
import { renderInBody } from '../utils/portal';
import { FluentIcon, PageToolbar, SegmentedControl } from './glass';

/**
 * 防抖 Hook - 延迟执行函数，避免频繁调用
 */
const useDebounce = (callback, delay = 300) => {
    const timeoutRef = useRef(null);

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
 * 导入视图组件（分组双列工作台 + 实体感通行证预览卡）
 */
const ImportView = ({
    onImport,
    onCancel,
    importing = false,
    accountCategories = [],
    onCreateCategory,
}) => {
    const [importMode, setImportMode] = useState('single');
    const [text, setText] = useState('');
    const [preview, setPreview] = useState([]);
    const [detectedFormats, setDetectedFormats] = useState([]);
    const [showFormatConfirm, setShowFormatConfirm] = useState(false);
    const [isParsing, setIsParsing] = useState(false);
    const [batchCategory, setBatchCategory] = useState('');
    const [quickCatName, setQuickCatName] = useState('');
    const [quickCatError, setQuickCatError] = useState('');
    const [addingQuickCat, setAddingQuickCat] = useState(false);

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

    const debouncedParse = useDebounce(parseAndSetPreview, 300);

    const handleParse = (val) => {
        setText(val);
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
            group_name: singleForm.group_name.trim(),
            remark: '',
        }]);
    };

    const handleQuickAddImportCategory = async (targetMode) => {
        const trimmed = quickCatName.trim();
        if (!trimmed || addingQuickCat || typeof onCreateCategory !== 'function') return;
        setQuickCatError('');
        setAddingQuickCat(true);
        try {
            const res = await onCreateCategory({ name: trimmed, color: 'blue' });
            if (res?.success && res.data?.name) {
                if (targetMode === 'single') {
                    setSingleForm(prev => ({ ...prev, group_name: res.data.name }));
                } else {
                    setBatchCategory(res.data.name);
                }
                setQuickCatName('');
            } else {
                setQuickCatError(res?.message || '添加分类失败');
            }
        } finally {
            setAddingQuickCat(false);
        }
    };

    const handleBatchImport = () => {
        if (importing || isParsing) return;
        const cat = batchCategory.trim();
        if (!cat) {
            onImport(preview);
            return;
        }
        const knownNames = accountCategories.map(c => c.name);
        onImport(preview.map(item => ({
            ...item,
            group_name: appendUniqueLine('groupName', item.group_name || '', cat, [...knownNames, cat]),
        })));
    };

    const isSingleFormValid = Boolean(singleForm.email.trim() && singleForm.password.trim());

    const filledSingleFields = [
        singleForm.email,
        singleForm.password,
        singleForm.recovery,
        singleForm.phone,
        singleForm.sms_url,
        singleForm.secret,
        singleForm.reg_year,
        singleForm.country,
    ].filter(v => String(v || '').trim().length > 0).length;

    const renderSingleFormField = (label, field, type, placeholder, required, hint) => (
        <div className="gm-field-cell">
            <label className="gm-field-label">
                <span>{label}</span>
                {required ? (
                    <span className="gm-field-req">*</span>
                ) : (
                    <span className="gm-field-opt">(可选)</span>
                )}
            </label>
            <input
                type={type}
                value={singleForm[field]}
                onChange={(e) => handleSingleFormChange(field, e.target.value)}
                disabled={importing}
                placeholder={placeholder}
                className={`gm-input ${importing ? 'opacity-60 cursor-not-allowed' : ''}`}
            />
            {hint && <p className="mt-1 text-[11px] gm-text-3 leading-snug">{hint}</p>}
        </div>
    );

    const renderPreviewItem = (item, idx, isSingle) => {
        const smsHost = describeSmsUrl(item.sms_url || item.smsUrl);
        if (isSingle) {
            return (
                <div key={idx} className="gm-pass-body">
                    <div className="gm-pass-identity">
                        <div className="gm-pass-avatar" aria-hidden="true">
                            {(item.email || '?').slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="font-semibold text-[14.5px] truncate gm-text-1">
                                {item.email || '未知账号'}
                            </p>
                            <p className="font-mono text-[11px] gm-text-3 mt-0.5">
                                #{idx + 1} · 未开启 (默认)
                            </p>
                        </div>
                    </div>

                    <div className="gm-pass-rows">
                        {[
                            ['密码', '•'.repeat(item.password?.length || 0), !!item.password],
                            ['恢复邮箱', item.recovery || '未设置', !!item.recovery],
                            ['手机号', item.phone || '未设置', !!item.phone],
                            ['手机验证码', smsHost ? `已配置（${smsHost}）` : '未设置', !!smsHost],
                            ['2FA密钥', item.secret ? '已设置' : '未设置', !!item.secret],
                            ['注册年份', item.reg_year || '未设置', !!item.reg_year],
                            ['国家', item.country || '未设置', !!item.country],
                        ].map(([label, value, hasValue]) => (
                            <div key={label} className="gm-pass-row">
                                <span className="gm-text-3">{label}:</span>
                                <span
                                    className={`truncate max-w-[68%] text-right ${hasValue
                                        ? (label === '密码' ? 'gm-text-2 font-mono' : 'gm-text-1')
                                        : 'gm-text-3 italic'}`}
                                    style={hasValue && label === '2FA密钥' ? { color: 'var(--success)' } : undefined}
                                >
                                    {value}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            );
        }

        return (
            <div key={idx} className="gm-batch-item">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="font-medium text-[13px] truncate gm-text-1">
                        {item.email || '未知账号'}
                    </span>
                    <span className="font-mono text-[10.5px] gm-text-3 shrink-0">#{idx + 1}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mb-2">
                    {item.secret && <span className="gm-chip gm-chip-success">2FA</span>}
                    {smsHost && <span className="gm-chip gm-chip-accent">{smsHost}</span>}
                    {item.country && <span className="gm-chip">{item.country}</span>}
                    {item.reg_year && <span className="gm-chip font-mono">{item.reg_year}</span>}
                    <span className="gm-chip">未开启 (默认)</span>
                </div>
                <div className="grid grid-cols-1 gap-1 text-[11.5px] gm-text-2">
                    <div className="flex justify-between gap-2">
                        <span className="gm-text-3">手机验证码:</span>
                        <span className={smsHost ? 'gm-text-1 truncate' : 'gm-text-3'}>
                            {smsHost ? `已配置（${smsHost}）` : '未设置'}
                        </span>
                    </div>
                    <div className="flex justify-between gap-2">
                        <span className="gm-text-3">状态:</span>
                        <span className="gm-text-2">未开启 (默认)</span>
                    </div>
                    <div className="flex justify-between gap-2">
                        <span className="gm-text-3">备注:</span>
                        <span className="truncate" style={{ color: item.remark ? 'var(--success)' : 'var(--text-muted)' }}>
                            {item.remark || '无'}
                        </span>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <>
            <PageToolbar
                title="导入账号"
                subtitle='导入后状态默认设为"未开启"'
                right={
                    <SegmentedControl
                        label="导入模式"
                        value={importMode}
                        onChange={(key) => {
                            if (importing) return;
                            setImportMode(key);
                            if (quickCatError) setQuickCatError('');
                        }}
                        options={[
                            { value: 'single', label: '单个导入', icon: 'personAdd', disabled: importing },
                            { value: 'batch', label: '批量导入', icon: 'textAdd', disabled: importing },
                        ]}
                    />
                }
            />

            <div className="page page-wide page-in">
                <div className="gm-import-shell">

            {importMode === 'single' ? (
                <div className="gm-import-grid">
                    {/* 左侧：无厚重外框的分组双列录入区 */}
                    <div className="gm-import-form-col">
                        <div className="gm-form-section">
                            <div className="gm-form-section-head">
                                <span className="gm-section-index">01</span>
                                <h2 className="gm-form-section-title">单个账号信息</h2>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                                {renderSingleFormField('邮箱账号', 'email', 'email', 'example@gmail.com', true)}
                                {renderSingleFormField('登录密码', 'password', 'text', '输入密码', true)}
                            </div>
                        </div>

                        <div className="gm-form-section">
                            <div className="gm-form-section-head">
                                <span className="gm-section-index">02</span>
                                <h3 className="gm-form-section-title">安全验证与接码</h3>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                                {renderSingleFormField('恢复邮箱', 'recovery', 'email', 'recovery@example.com', false)}
                                {renderSingleFormField('2FA 密钥', 'secret', 'text', 'TOTP密钥', false)}
                                {renderSingleFormField('手机号', 'phone', 'text', '默认+86，可填 +12192731268', false)}
                                {renderSingleFormField(
                                    '手机接码地址',
                                    'sms_url',
                                    'text',
                                    'https://sms6688.com/api/sms/recordText?token=...&tpl=1',
                                    false,
                                    '粘贴「手机号|接码地址」会自动拆分到手机号与这里，用于实时获取短信验证码'
                                )}
                            </div>
                        </div>

                        <div className="gm-form-section">
                            <div className="gm-form-section-head">
                                <span className="gm-section-index">03</span>
                                <h3 className="gm-form-section-title">归档属性</h3>
                            </div>
                            <div className="grid grid-cols-2 gap-3.5">
                                {renderSingleFormField('注册年份', 'reg_year', 'text', '2021', false)}
                                {renderSingleFormField('国家', 'country', 'text', 'China / Japan / USA', false)}
                            </div>
                            {(accountCategories.length > 0 || typeof onCreateCategory === 'function') && (
                                <div className="mt-3.5 space-y-2">
                                    <label className="gm-field-label">
                                        <span>归属分类</span>
                                        <span className="gm-field-opt">(可选)</span>
                                    </label>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <select
                                            aria-label="归属分类"
                                            value={singleForm.group_name}
                                            onChange={(e) => handleSingleFormChange('group_name', e.target.value)}
                                            disabled={importing}
                                            className="gm-input flex-1 min-w-[160px]"
                                        >
                                            <option value="">不指定分类</option>
                                            {accountCategories.map(cat => (
                                                <option key={cat.id} value={cat.name}>{cat.name}</option>
                                            ))}
                                        </select>
                                        {typeof onCreateCategory === 'function' && (
                                            <div className="flex items-center gap-1.5 flex-1 min-w-[180px]">
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
                                                            handleQuickAddImportCategory('single');
                                                        }
                                                    }}
                                                    placeholder="新建自定义分类名..."
                                                    className="gm-input flex-1"
                                                    disabled={importing || addingQuickCat}
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => handleQuickAddImportCategory('single')}
                                                    disabled={importing || addingQuickCat || !quickCatName.trim()}
                                                    className="gm-btn gm-btn-secondary shrink-0"
                                                >
                                                    <Plus size={13} />
                                                    <span>添加分类</span>
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                    {quickCatError && (
                                        <p role="alert" className="text-xs" style={{ color: 'var(--danger)' }}>
                                            {quickCatError}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* 精简行格式参考条 */}
                        <div className="gm-format-strip">
                            <p className="text-[11.5px] font-medium gm-text-2 mb-1.5">行格式参考（与批量解析一致）</p>
                            <div className="flex flex-wrap gap-1.5 mb-1.5">
                                {IMPORT_FORMAT_LINES.map((line) => (
                                    <span key={line} className="gm-format-code">• {line}</span>
                                ))}
                            </div>
                            <p className="text-[11px] gm-text-3">{IMPORT_EXTRA_RULE}</p>
                        </div>

                        <div className="flex items-center gap-3 pt-1">
                            <button
                                onClick={onCancel}
                                disabled={importing}
                                className="gm-btn gm-btn-secondary px-5"
                            >
                                返回列表
                            </button>
                            <button
                                disabled={!isSingleFormValid || importing}
                                onClick={handleSingleImport}
                                className="gm-btn gm-btn-primary flex-1 font-semibold"
                            >
                                {importing ? (
                                    <>
                                        <Loader2 size={16} className="animate-spin" />
                                        导入中...
                                    </>
                                ) : (
                                    <>
                                        <Plus size={16} />
                                        立即导入
                                    </>
                                )}
                            </button>
                        </div>
                        {importing && (
                            <p className="text-xs px-1" style={{ color: 'var(--primary)' }}>正在导入账号，请勿重复点击...</p>
                        )}
                    </div>

                    {/* 右侧：实体感账号通行证预览卡 */}
                    <div className="gm-import-preview-col">
                        <div className={`gm-pass-card ${isSingleFormValid ? 'is-ready' : ''}`}>
                            <div className="gm-pass-head">
                                <div className="flex items-center gap-2">
                                    <span
                                        className={`w-2 h-2 rounded-[1px] ${isSingleFormValid ? 'gm-pixel-status-pulse' : ''}`}
                                        style={{ background: isSingleFormValid ? 'var(--success)' : 'var(--text-muted)' }}
                                    />
                                    <h2 className="font-semibold text-[13px] gm-text-1">实时预览</h2>
                                </div>
                                <div className="gm-pass-meter" aria-hidden="true">
                                    {Array.from({ length: 8 }).map((_, idx) => (
                                        <span
                                            key={idx}
                                            className={`gm-pass-meter-dot ${idx < filledSingleFields ? 'is-on' : ''}`}
                                        />
                                    ))}
                                </div>
                            </div>

                            {isSingleFormValid ? (
                                <div className="flex-1 overflow-y-auto pr-0.5 scrollbar-thin">
                                    {renderPreviewItem(singleForm, 0, true)}
                                </div>
                            ) : (
                                <div className="gm-pass-empty">
                                    <FluentIcon name="personAdd" size={40} className="gm-text-3" />
                                    <p className="text-[13.5px] font-medium gm-text-2 mt-2">请填写账号信息</p>
                                    <p className="text-[12px] gm-text-3 mt-1">邮箱和密码为必填项</p>
                                </div>
                            )}

                            <div className="gm-pass-foot">
                                <span>Status: {isSingleFormValid ? 'READY' : 'WAITING'}</span>
                                <span>Count: {isSingleFormValid ? 1 : 0}</span>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="gm-import-grid">
                    {/* 左侧：终端输入台 */}
                    <div className="gm-import-form-col">
                        <div className="gm-terminal-deck">
                            <div className="gm-terminal-head">
                                <div className="flex items-center gap-2">
                                    <span className="gm-terminal-dots" aria-hidden="true">
                                        <i /><i /><i />
                                    </span>
                                    <h2 className="font-semibold text-[13px] gm-text-1">粘贴数据区域</h2>
                                </div>
                                <span className="font-mono text-[11px] gm-text-3">
                                    支持分隔符：| ---- —— --- --
                                </span>
                            </div>

                            <p className="gm-terminal-hint">
                                支持多种格式：
                                {' '}• {IMPORT_FORMAT_LINES[0]}
                                {' '}• {IMPORT_FORMAT_LINES[1]}
                                {' '}• {IMPORT_FORMAT_LINES[2]}
                                <span className="block mt-1 gm-text-3">{IMPORT_EXTRA_RULE}</span>
                            </p>

                            <textarea
                                className="gm-terminal-textarea"
                                placeholder={IMPORT_PLACEHOLDER}
                                disabled={importing}
                                value={text}
                                onChange={(e) => handleParse(e.target.value)}
                            />
                        </div>

                        {(accountCategories.length > 0 || typeof onCreateCategory === 'function') && (
                            <div className="gm-format-strip space-y-2">
                                <label className="text-[11.5px] font-medium gm-text-2 block">
                                    批量归属分类（可选，导入后统一归入该分类）
                                </label>
                                <div className="flex flex-wrap items-center gap-2">
                                    <select
                                        aria-label="批量归属分类"
                                        value={batchCategory}
                                        onChange={(e) => setBatchCategory(e.target.value)}
                                        disabled={importing}
                                        className="gm-input flex-1 min-w-[160px]"
                                    >
                                        <option value="">不指定分类</option>
                                        {accountCategories.map(cat => (
                                            <option key={cat.id} value={cat.name}>{cat.name}</option>
                                        ))}
                                    </select>
                                    {typeof onCreateCategory === 'function' && (
                                        <div className="flex items-center gap-1.5 flex-1 min-w-[180px]">
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
                                                        handleQuickAddImportCategory('batch');
                                                    }
                                                }}
                                                placeholder="新建自定义分类名..."
                                                className="gm-input flex-1"
                                                disabled={importing || addingQuickCat}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => handleQuickAddImportCategory('batch')}
                                                disabled={importing || addingQuickCat || !quickCatName.trim()}
                                                className="gm-btn gm-btn-secondary shrink-0"
                                            >
                                                <Plus size={13} />
                                                <span>添加分类</span>
                                            </button>
                                        </div>
                                    )}
                                </div>
                                {quickCatError && (
                                    <p role="alert" className="text-xs" style={{ color: 'var(--danger)' }}>
                                        {quickCatError}
                                    </p>
                                )}
                            </div>
                        )}

                        <div className="flex items-center gap-3 pt-1">
                            <button
                                onClick={onCancel}
                                disabled={importing}
                                className="gm-btn gm-btn-secondary px-5"
                            >
                                返回列表
                            </button>
                            <button
                                disabled={preview.length === 0 || importing || isParsing}
                                onClick={handleBatchImport}
                                className="gm-btn gm-btn-primary flex-1 font-semibold"
                            >
                                {importing ? (
                                    <>
                                        <Loader2 size={16} className="animate-spin" />
                                        导入中...
                                    </>
                                ) : (
                                    <>
                                        <Plus size={16} />
                                        {`立即导入 ${preview.length > 0 ? `(${preview.length}条)` : ''}`}
                                    </>
                                )}
                            </button>
                        </div>
                        {importing && (
                            <p className="text-xs px-1" style={{ color: 'var(--primary)' }}>导入进行中，完成后将自动返回列表。</p>
                        )}
                    </div>

                    {/* 右侧：解析结果流 */}
                    <div className="gm-import-preview-col">
                        <div className={`gm-pass-card ${preview.length > 0 ? 'is-ready' : ''}`}>
                            <div className="gm-pass-head">
                                <div className="flex items-center gap-2">
                                    <span
                                        className={`w-2 h-2 rounded-[1px] ${preview.length > 0 ? 'gm-pixel-status-pulse' : ''}`}
                                        style={{ background: preview.length > 0 ? 'var(--success)' : 'var(--text-muted)' }}
                                    />
                                    <h2 className="font-semibold text-[13px] gm-text-1">实时预览</h2>
                                </div>
                                <span className="font-mono text-[11px] gm-text-3 tabular-nums">
                                    {preview.length} 条待导入
                                </span>
                            </div>

                            {isParsing && preview.length === 0 ? (
                                <div className="gm-pass-empty">
                                    <Loader2 size={24} className="animate-spin gm-text-3" />
                                    <p className="text-[12.5px] gm-text-2 mt-2">解析数据中...</p>
                                </div>
                            ) : preview.length > 0 ? (
                                <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 scrollbar-thin">
                                    {preview.map((item, idx) => renderPreviewItem(item, idx, false))}
                                </div>
                            ) : (
                                <div className="gm-pass-empty">
                                    <FluentIcon name="inbox" size={40} className="gm-text-3" />
                                    <p className="text-[13.5px] font-medium gm-text-2 mt-2">等待解析数据...</p>
                                    <p className="text-[12px] gm-text-3 mt-1">所有导入项初始状态均为"未开启"</p>
                                </div>
                            )}

                            <div className="gm-pass-foot">
                                <span>Status: {isParsing ? 'PARSING...' : 'OK'}</span>
                                <span>Count: {preview.length}</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}
                </div>
            </div>

            {/* 格式确认对话框 */}
            {showFormatConfirm && renderInBody(
                <div className="gm-overlay">
                    <div className="gm-modal glass max-w-md mx-4" data-lens="sheet" role="dialog" aria-label="检测到多种导入格式">
                        <div className="gm-modal-header">
                            <h3 className="gm-title text-base">检测到多种导入格式</h3>
                        </div>
                        <div className="gm-modal-body space-y-3">
                            <p className="text-sm gm-text-2">系统检测到您的导入文本包含多种不同的格式规则：</p>
                            <ul className="list-disc list-inside text-xs gm-text-2 space-y-1 gm-solid p-3.5">
                                {detectedFormats.map((format, i) => (
                                    <li key={i} className="gm-text-1">{format}</li>
                                ))}
                            </ul>
                            <p className="text-xs gm-text-3">请确认解析结果是否正确，或返回修改导入文本使用统一格式。</p>
                        </div>
                        <div className="gm-modal-footer">
                            <button
                                onClick={() => { setShowFormatConfirm(false); setText(''); setPreview([]); setDetectedFormats([]); }}
                                className="gbtn glass"
                                data-lens="cap"
                            >
                                返回修改
                            </button>
                            <button
                                onClick={() => setShowFormatConfirm(false)}
                                className="gbtn glass prominent"
                                data-lens="cap"
                            >
                                确认导入
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default ImportView;
