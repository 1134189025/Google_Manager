import {
    Search,
    Edit3,
    Trash2,
    Copy,
    Link2,
    History,
    ArrowDown,
    ArrowUp,
    ArrowUpDown,
    Globe,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import { splitPhoneParts, formatCountryDisplay } from '../utils/phoneUtils';
import { isMultilineField, splitMultiValueLines } from '../utils/multiValueField';
import { describeSmsUrl } from '../utils/smsUtils';
import { formatDbTimestamp } from '../utils/timeUtils';
import SmsCodeCell from './SmsCodeCell';

const BROWSER_STATUS_LABELS = {
    none: '未创建',
    created: '已创建',
    running: '运行中',
};

const BROWSER_STATUS_TITLES = {
    none: '打开浏览器（首次打开会新建独立配置并进入 Google 登录页）',
    created: '打开浏览器（使用该账号的独立配置）',
    running: '浏览器运行中，点击切换到该窗口',
};

/** 账号独立浏览器按钮：颜色表示配置目录状态 */
const BrowserButton = ({ account, status, opening, onOpen }) => {
    const browserStatus = BROWSER_STATUS_LABELS[status] ? status : 'none';
    return (
        <button
            onClick={() => onOpen(account)}
            onMouseDown={(e) => e.stopPropagation()}
            className="gm-icon-btn gm-browser-btn"
            data-status={browserStatus}
            style={{ width: 26, height: 26 }}
            title={opening ? '正在打开浏览器…' : BROWSER_STATUS_TITLES[browserStatus]}
            aria-label={`打开浏览器（${BROWSER_STATUS_LABELS[browserStatus]}）`}
            disabled={opening}
        >
            <Globe size={15} />
        </button>
    );
};

const splitDateTime = (value) => {
    // 数据库存的是 UTC，先换算成本机时间再拆分
    const raw = formatDbTimestamp(value);
    if (!raw) return { date: '-', time: '' };

    const normalized = raw.replace('T', ' ');
    const match = normalized.match(/^(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}:\d{2}))?/);
    if (match) {
        return {
            date: match[1],
            time: match[2] || '--:--:--',
        };
    }

    const ts = Date.parse(raw);
    if (Number.isNaN(ts)) return { date: raw, time: '--:--:--' };
    const date = new Date(ts);
    return {
        date: date.toISOString().slice(0, 10),
        time: date.toTimeString().slice(0, 8),
    };
};

/**
 * 账号表格组件 - 渲染表头和表体
 */
const AccountTable = ({
    paginatedData,
    pagination,
    loading,
    sortConfig,
    onSortChange,
    // 选择相关
    selectedIds,
    onToggleSelectAll,
    onToggleCheckbox,
    onRowMouseDown,
    onRowMouseEnter,
    // 编辑相关
    editingCell,
    editValue,
    setEditValue,
    inputRef,
    showSuggestions,
    filteredSuggestions,
    onCellClick,
    onCellDoubleClick,
    onEditableInputBlur,
    onKeyDown,
    onSelectSuggestion,
    // 操作相关
    toggleStatus,
    onEdit,
    onDelete,
    copyToClipboard,
    copyAllInfo,
    copyPhoneWithSmsUrl,
    openHistoryDrawer,
    twoFACodes,
    // 手机验证码（短信）
    smsCodes,
    onSmsRefresh,
    onSmsCopy,
    // 账号独立浏览器
    browserStatuses,
    openingBrowserIds,
    onOpenBrowser,
}) => {
    const selectAllCheckboxRef = useRef(null);
    const currentPageSelectedCount = paginatedData.reduce(
        (count, account) => count + (selectedIds.has(account.id) ? 1 : 0),
        0
    );
    const allCurrentPageSelected = paginatedData.length > 0 && currentPageSelectedCount === paginatedData.length;
    const partiallySelectedCurrentPage = currentPageSelectedCount > 0 && !allCurrentPageSelected;

    useEffect(() => {
        if (selectAllCheckboxRef.current) {
            selectAllCheckboxRef.current.indeterminate = partiallySelectedCurrentPage;
        }
    }, [partiallySelectedCurrentPage]);

    const primaryColorStyle = { color: 'var(--primary)' };

    const renderSortIcon = (key) => {
        if (!sortConfig || sortConfig.key !== key) {
            return <ArrowUpDown size={12} className="gm-text-3" />;
        }
        if (sortConfig.direction === 'asc') {
            return <ArrowUp size={12} style={primaryColorStyle} />;
        }
        return <ArrowDown size={12} style={primaryColorStyle} />;
    };

    const renderSortableHeader = (label, key, className, align = 'left') => (
        <th className={className}>
            <button
                type="button"
                onClick={() => onSortChange?.(key)}
                className={`w-full flex items-center gap-1 font-semibold transition-colors gm-text-2 hover:text-[color:var(--primary)] ${align === 'center' ? 'justify-center' : 'justify-start'}`}
                title={`按${label}排序`}
            >
                <span>{label}</span>
                {renderSortIcon(key)}
            </button>
        </th>
    );

    const renderSuggestionPanel = () => {
        if (!showSuggestions || !filteredSuggestions?.length) return null;
        return (
            <div className="gm-panel absolute z-20 mt-1 w-full max-h-40 overflow-y-auto">
                {filteredSuggestions.map((item) => (
                    <button
                        key={item}
                        type="button"
                        onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onSelectSuggestion?.(item);
                        }}
                        className="gm-cell text-sm"
                    >
                        {item}
                    </button>
                ))}
            </div>
        );
    };

    const wrappedPreviewStyle = {
        display: '-webkit-box',
        WebkitBoxOrient: 'vertical',
        WebkitLineClamp: 2,
        overflow: 'hidden',
        whiteSpace: 'normal',
        wordBreak: 'break-all',
    };

    const focusEditorToEnd = () => {
        queueMicrotask(() => {
            if (!inputRef.current || typeof inputRef.current.setSelectionRange !== 'function') return;
            const length = String(inputRef.current.value || '').length;
            inputRef.current.focus();
            inputRef.current.setSelectionRange(length, length);
        });
    };

    const appendLineForEditing = () => {
        setEditValue((previous) => {
            const current = String(previous || '');
            if (!current.trim()) return current;
            return current.endsWith('\n') ? current : `${current}\n`;
        });
        focusEditorToEnd();
    };

    const singleLineEditorConfig = {
        default: { minWidth: 220, maxWidth: 520, minChars: 18, align: 'left' },
        email: { minWidth: 280, maxWidth: 680, minChars: 28, align: 'left' },
        password: { minWidth: 240, maxWidth: 560, minChars: 22, align: 'left' },
        recovery: { minWidth: 280, maxWidth: 680, minChars: 28, align: 'left' },
        secret: { minWidth: 260, maxWidth: 620, minChars: 24, align: 'right' },
        phone: { minWidth: 280, maxWidth: 620, minChars: 24, align: 'right' },
        regYear: { minWidth: 120, maxWidth: 180, minChars: 10, align: 'right' },
        country: { minWidth: 160, maxWidth: 320, minChars: 12, align: 'right' },
    };

    const getSingleLineEditorStyle = (field, currentValue, placeholder = '') => {
        const config = singleLineEditorConfig[field] || singleLineEditorConfig.default;
        const contentLength = Math.max(
            String(currentValue || '').trim().length,
            String(placeholder || '').trim().length,
            config.minChars,
        );
        const widthPx = Math.min(Math.max(contentLength * 9 + 44, config.minWidth), config.maxWidth);

        return {
            top: '-4px',
            ...(config.align === 'right' ? { right: 0 } : { left: 0 }),
            width: `${widthPx}px`,
            minWidth: `${config.minWidth}px`,
            maxWidth: `min(calc(100vw - 32px), ${config.maxWidth}px)`,
        };
    };

    const renderEditingInput = (field, placeholder = '') => {
        const multiline = isMultilineField(field);

        if (multiline) {
            return (
                <div className="relative z-20">
                    <div className="gm-panel min-w-full w-[min(42vw,520px)] px-2.5 py-2 shadow-xl">
                        <textarea
                            ref={inputRef}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={onKeyDown}
                            onBlur={onEditableInputBlur}
                            onMouseDown={(e) => e.stopPropagation()}
                            rows={4}
                            className="gm-input w-full min-h-[96px] resize-none overflow-hidden text-sm leading-6"
                            placeholder={placeholder}
                        />
                        <div className="mt-2 flex items-center justify-between gap-3">
                            <button
                                type="button"
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    appendLineForEditing();
                                }}
                                className="gm-btn gm-btn-ghost gm-btn-sm text-xs font-medium"
                            >
                                + 添加一行
                            </button>
                            <span className="text-[11px] gm-text-3">
                                {field === 'groupName' ? '每行一个标签' : '每行一条备注'}，`Ctrl/Cmd + Enter` 保存
                            </span>
                        </div>
                    </div>
                    {renderSuggestionPanel()}
                </div>
            );
        }

        const editorStyle = getSingleLineEditorStyle(field, editValue, placeholder);

        return (
            <div className="relative z-30 min-h-[52px] overflow-visible">
                <div
                    className="absolute"
                    style={editorStyle}
                    data-inline-editor-field={field}
                >
                    <div className="gm-panel px-2 py-2 shadow-xl">
                        <input
                            ref={inputRef}
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={onKeyDown}
                            onBlur={onEditableInputBlur}
                            onMouseDown={(e) => e.stopPropagation()}
                            className="gm-input block h-9 w-full text-sm leading-5"
                            placeholder={placeholder}
                        />
                    </div>
                    {renderSuggestionPanel()}
                </div>
            </div>
        );
    };

    const renderEditableCell = (acc, field, value, label, maxWidth = '200px', placeholder = '') => {
        const isEditing = editingCell?.accountId === acc.id && editingCell?.field === field;
        const allowWrappedPreview = field === 'recovery';

        if (isEditing) {
            return renderEditingInput(field, placeholder);
        }

        return (
            <span
                onClick={() => onCellClick(value, label)}
                onDoubleClick={(e) => onCellDoubleClick(e, acc.id, field, value)}
                onMouseDown={(e) => e.stopPropagation()}
                className={`gm-cell block w-full ${allowWrappedPreview
                    ? 'min-h-[36px] py-1 leading-5 whitespace-normal break-all'
                    : 'truncate leading-5 min-h-[20px]'}`}
                style={allowWrappedPreview ? { maxWidth, ...wrappedPreviewStyle } : { maxWidth }}
                title={`单击复制，双击编辑：${value || '无'}`}
            >
                {value || <span className="gm-text-3 italic">无</span>}
            </span>
        );
    };

    const renderGroupNameCell = (acc) => {
        const isEditing = editingCell?.accountId === acc.id && editingCell?.field === 'groupName';
        const tags = splitMultiValueLines('groupName', acc.groupName);

        return isEditing ? (
            renderEditingInput('groupName', '每行一个标签，支持逗号或换行粘贴')
        ) : (
            <div className="flex flex-col gap-1">
                {tags.length > 0 ? (
                    tags.map((tag, i) => (
                        <button
                            key={`${acc.id}-tag-${i}-${tag}`}
                            type="button"
                            onClick={() => onCellClick(tag, '标签')}
                            onDoubleClick={(e) => onCellDoubleClick(e, acc.id, 'groupName', acc.groupName)}
                            onMouseDown={(e) => e.stopPropagation()}
                            className="gm-cell text-xs"
                            title="单击复制该标签，双击编辑全部标签"
                        >
                            {tag}
                        </button>
                    ))
                ) : (
                    <button
                        type="button"
                        onDoubleClick={(e) => onCellDoubleClick(e, acc.id, 'groupName', '')}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="gm-cell h-7 italic gm-text-3"
                        title="双击添加标签"
                    >
                        无
                    </button>
                )}
            </div>
        );
    };

    const renderRemarkCell = (acc) => {
        const isEditing = editingCell?.accountId === acc.id && editingCell?.field === 'remark';
        const lines = splitMultiValueLines('remark', acc.remark);

        if (isEditing) {
            return renderEditingInput('remark', '每行一条备注，便于逐条查看和编辑');
        }

        if (lines.length === 0) {
            return (
                <button
                    type="button"
                    onDoubleClick={(e) => onCellDoubleClick(e, acc.id, 'remark', '')}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="gm-cell h-7 italic gm-text-3"
                    title="双击添加备注"
                >
                    无
                </button>
            );
        }

        return (
            <div className="flex flex-col gap-1">
                {lines.map((line, index) => (
                    <button
                        key={`${acc.id}-remark-${index}`}
                        type="button"
                        onClick={() => onCellClick(line, '备注')}
                        onDoubleClick={(e) => onCellDoubleClick(e, acc.id, 'remark', acc.remark)}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="gm-cell text-xs leading-5 break-words"
                        title="单击复制该条备注，双击编辑全部备注"
                    >
                        {line}
                    </button>
                ))}
            </div>
        );
    };

    const renderPhoneCell = (acc) => {
        const isEditing = editingCell?.accountId === acc.id && editingCell?.field === 'phone';
        if (isEditing) {
            return renderEditingInput('phone', '支持格式：+86 138 1234 5678 / 13812345678 / 0086...');
        }

        if (!acc.phone) {
            return (
                <button
                    type="button"
                    onDoubleClick={(e) => onCellDoubleClick(e, acc.id, 'phone', '')}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="gm-cell h-7 italic gm-text-3"
                    title="双击编辑手机号"
                >
                    无
                </button>
            );
        }

        const { countryCode, localNumber, normalized } = splitPhoneParts(acc.phone);
        const numberOnly = localNumber || normalized.replace(/^\+/, '');

        return (
            <div className="flex flex-col gap-1">
                <button
                    type="button"
                    onClick={() => onCellClick(normalized || acc.phone, '国别+手机号')}
                    onDoubleClick={(e) => onCellDoubleClick(e, acc.id, 'phone', acc.phone)}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="gm-cell h-7 text-xs select-none truncate flex items-center gm-text-2"
                    title="单击复制国别+手机号，双击编辑"
                >
                    {formatCountryDisplay(countryCode || '+86')}
                </button>
                <button
                    type="button"
                    onClick={() => onCellClick(numberOnly, '手机号')}
                    onDoubleClick={(e) => onCellDoubleClick(e, acc.id, 'phone', acc.phone)}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="gm-cell min-h-[36px] py-1 text-sm font-medium select-none whitespace-normal break-all"
                    style={wrappedPreviewStyle}
                    title="单击仅复制手机号，双击编辑"
                >
                    {numberOnly}
                </button>
            </div>
        );
    };

    /**
     * 手机验证码单元格
     * 接码地址的编辑走 inlineEdit 的 smsUrl 字段（双击单元格进入配置）
     */
    const renderSmsCell = (acc) => {
        const isEditing = editingCell?.accountId === acc.id && editingCell?.field === 'smsUrl';
        if (isEditing) {
            return renderEditingInput('smsUrl', '粘贴 https://sms6688.com/... 或 手机号|接码地址');
        }

        const smsUrl = String(acc.smsUrl || '').trim();

        return (
            <SmsCodeCell
                account={acc}
                entry={smsCodes?.[acc.id]}
                host={describeSmsUrl(smsUrl)}
                hasUrl={Boolean(smsUrl)}
                onCopy={onSmsCopy}
                onEdit={(event, account) => onCellDoubleClick?.(event, account.id, 'smsUrl', smsUrl)}
                onRefresh={onSmsRefresh}
            />
        );
    };

    const renderTwoFACell = (acc) => {
        const isEditing = editingCell?.accountId === acc.id && editingCell?.field === 'secret';
        if (isEditing) {
            return renderEditingInput('secret', '输入 2FA 密钥');
        }

        if (!acc.secret) {
            return (
                <button
                    type="button"
                    onDoubleClick={(e) => onCellDoubleClick(e, acc.id, 'secret', '')}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="gm-cell h-7 italic gm-text-3"
                    title="双击编辑2FA密钥"
                >
                    无
                </button>
            );
        }

        const codeInfo = twoFACodes[acc.id];

        return (
            <div className="flex flex-col gap-1">
                <button
                    type="button"
                    onClick={() => onCellClick(acc.secret, '2FA密钥')}
                    onDoubleClick={(e) => onCellDoubleClick(e, acc.id, 'secret', acc.secret)}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="gm-cell min-h-[36px] py-1 text-xs font-mono select-none whitespace-normal break-all"
                    style={wrappedPreviewStyle}
                    title="单击复制2FA密钥，双击编辑"
                >
                    {acc.secret}
                </button>
                {codeInfo ? (
                    <button
                        type="button"
                        onClick={() => onCellClick(codeInfo.code, '2FA验证码')}
                        onDoubleClick={(e) => onCellDoubleClick(e, acc.id, 'secret', acc.secret)}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="gm-cell h-7 text-sm font-mono font-semibold select-none flex items-center gap-1.5"
                        style={{ color: 'var(--success)' }}
                        title="单击复制2FA验证码，双击编辑密钥"
                    >
                        <span>{codeInfo.code}</span>
                        <span className="text-[11px] opacity-70">{codeInfo.expiry}s</span>
                    </button>
                ) : (
                    <span className="gm-text-3 text-xs px-1.5 py-1">
                        验证码生成中...
                    </span>
                )}
            </div>
        );
    };

    const renderAccountLine = (acc, field, value, label, maxWidth, placeholder = '', variant = 'email') => {
        const isEditing = editingCell?.accountId === acc.id && editingCell?.field === field;
        const allowWrappedPreview = field === 'email' || field === 'password';
        if (isEditing) {
            return renderEditingInput(field, placeholder);
        }

        const textValue = String(value || '').trim();
        if (!textValue) {
            return (
                <button
                    type="button"
                    onDoubleClick={(e) => onCellDoubleClick(e, acc.id, field, '')}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="gm-cell h-7 italic gm-text-3"
                    title={`双击编辑${label}`}
                >
                    无
                </button>
            );
        }

        const variantClass = variant === 'password'
            ? 'text-xs font-mono gm-text-2'
            : 'text-sm';

        return (
            <button
                type="button"
                onClick={() => onCellClick(textValue, label)}
                onDoubleClick={(e) => onCellDoubleClick(e, acc.id, field, textValue)}
                onMouseDown={(e) => e.stopPropagation()}
                className={`gm-cell select-none ${allowWrappedPreview
                    ? `min-h-[36px] py-1 whitespace-normal break-all ${variantClass}`
                    : `h-7 truncate flex items-center ${variantClass}`}`}
                style={allowWrappedPreview ? { maxWidth, ...wrappedPreviewStyle } : { maxWidth }}
                title={`单击复制，双击编辑：${textValue}`}
            >
                {textValue}
            </button>
        );
    };

    const renderCreatedAtCell = (createdAt) => {
        const { date, time } = splitDateTime(createdAt);
        return (
            <div className="flex flex-col gap-1 leading-tight">
                <span className="text-sm whitespace-nowrap gm-text-2">
                    {date}
                </span>
                <span className="text-xs whitespace-nowrap gm-text-3">
                    {time || '-'}
                </span>
            </div>
        );
    };
    return (
        <div className="gm-table-wrap">
            {/* 列宽与窄窗口下按优先级隐藏的列见 components.css「表格列宽」 */}
            <div className="overflow-x-auto">
                <table className="gm-table w-full text-left table-fixed">
                    <thead>
                        <tr>
                            <th className="px-2 py-2.5 !text-center w-[36px]">
                                <input
                                    ref={selectAllCheckboxRef}
                                    type="checkbox"
                                    checked={allCurrentPageSelected}
                                    onChange={() => onToggleSelectAll(paginatedData)}
                                    className="w-4 h-4 rounded"
                                    style={{ accentColor: 'var(--primary)' }}
                                />
                            </th>
                            {renderSortableHeader('序号', 'id', 'gm-col-id px-2 py-2.5 !text-center w-[44px]', 'center')}
                            {renderSortableHeader('账号', 'email', 'px-3 py-2.5 w-[190px]')}
                            {renderSortableHeader('恢复', 'recovery', 'gm-col-recovery px-2 py-2.5 w-[120px]')}
                            {renderSortableHeader('2FA', 'secret', 'px-2 py-2.5 w-[84px]')}
                            {renderSortableHeader('手机', 'phone', 'px-2 py-2.5 w-[96px]')}
                            <th className="px-2 py-2.5 w-[116px]" title="短信验证码：双击配置接码地址">手机验证码</th>
                            {renderSortableHeader('标签', 'groupName', 'gm-col-tags px-2 py-2.5 w-[96px]')}
                            {/* 备注不设宽度：占用其余全部空间 */}
                            {renderSortableHeader('备注', 'remark', 'px-3 py-2.5')}
                            {renderSortableHeader('状态', 'status', 'px-2 py-2.5 !text-center w-[64px]', 'center')}
                            {renderSortableHeader('年份', 'regYear', 'gm-col-year px-2 py-2.5 !text-center w-[60px]', 'center')}
                            {renderSortableHeader('国家', 'country', 'gm-col-country px-2 py-2.5 !text-center w-[84px]', 'center')}
                            <th className="px-2 py-2.5 !text-center w-[150px]">操作</th>
                            {renderSortableHeader('导入', 'createdAt', 'gm-col-created px-2 py-2.5 w-[96px]')}
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan="14">
                                    <div className="gm-empty flex flex-col items-center">
                                        <div
                                            className="animate-spin rounded-full h-8 w-8 mb-4"
                                            style={{ border: '2px solid var(--border)', borderTopColor: 'var(--primary)' }}
                                        ></div>
                                        <p className="text-lg font-medium">加载中...</p>
                                    </div>
                                </td>
                            </tr>
                        ) : paginatedData.length > 0 ? paginatedData.map((acc, index) => (
                            <tr key={acc.id}
                                className={`transition-colors group ${selectedIds.has(acc.id) ? 'is-selected' : ''}`}
                                onMouseDown={(e) => onRowMouseDown(e, acc.id)}
                                onMouseEnter={() => onRowMouseEnter(acc.id)}
                            >
                                {/* 复选框 */}
                                <td className="px-2 py-2.5 text-center">
                                    <input
                                        type="checkbox"
                                        checked={selectedIds.has(acc.id)}
                                        onChange={(e) => {
                                            e.stopPropagation();
                                            onToggleCheckbox(acc.id);
                                        }}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        className="w-4 h-4 rounded"
                                        style={{ accentColor: 'var(--primary)' }}
                                    />
                                </td>
                                {/* 序号 */}
                                <td className="gm-col-id px-2 py-2.5 text-center">
                                    <span
                                        className="inline-flex items-center justify-center w-6 h-6 text-xs font-bold"
                                        style={{
                                            padding: 0,
                                            borderRadius: 'var(--radius-sm)',
                                            background: 'var(--bg-hover)',
                                            color: 'var(--text-secondary)',
                                        }}
                                    >
                                        {(pagination.currentPage - 1) * pagination.pageSize + index + 1}
                                    </span>
                                </td>
                                {/* 账号 */}
                                <td className="px-3 py-2.5 align-top">
                                    <div className="flex flex-col gap-1">
                                        <div className="flex items-center gap-1">
                                            <div className="flex-1 min-w-0">
                                                {renderAccountLine(acc, 'email', acc.email, '邮箱', '170px', 'example@gmail.com', 'email')}
                                            </div>
                                            <button
                                                onClick={() => openHistoryDrawer(acc)}
                                                onMouseDown={(e) => e.stopPropagation()}
                                                className="gm-icon-btn flex-shrink-0"
                                                style={{ width: 22, height: 22 }}
                                                title="查看修改历史"
                                            >
                                                <History size={12} />
                                            </button>
                                        </div>
                                        {renderAccountLine(acc, 'password', acc.password, '密码', '180px', 'password123', 'password')}
                                    </div>
                                </td>
                                {/* 恢复邮箱 */}
                                <td className="gm-col-recovery px-2 py-2.5 align-top">
                                    {renderEditableCell(acc, 'recovery', acc.recovery, '恢复邮箱', '100%', 'recovery@example.com')}
                                </td>
                                {/* 2FA密钥 */}
                                <td className="px-2 py-2.5 align-top">
                                    {renderTwoFACell(acc)}
                                </td>
                                {/* 手机号 */}
                                <td className="px-2 py-2.5 align-top">
                                    {renderPhoneCell(acc)}
                                </td>
                                {/* 手机验证码（短信） */}
                                <td className="px-2 py-2.5 align-top">
                                    {renderSmsCell(acc)}
                                </td>
                                {/* 标签 */}
                                <td className="gm-col-tags px-2 py-2.5 align-top">
                                    {renderGroupNameCell(acc)}
                                </td>
                                {/* 备注 */}
                                <td className="px-3 py-2.5 align-top">
                                    {renderRemarkCell(acc)}
                                </td>
                                {/* 状态（Pro / 普通） */}
                                <td className="px-2 py-2.5 text-center">
                                    <div className="flex flex-col items-center gap-1">
                                        <button onClick={() => toggleStatus(acc.id)}
                                            onMouseDown={(e) => e.stopPropagation()}
                                            title="点击切换 Pro 状态"
                                            className={`gm-badge transition-all duration-300 transform active:scale-95 whitespace-nowrap ${acc.status === 'pro' ? 'gm-badge-on' : 'gm-badge-off'}`}
                                        >
                                            {acc.status === 'pro' ? 'Pro' : '普通'}
                                        </button>
                                    </div>
                                </td>
                                {/* 年份 */}
                                <td className="gm-col-year px-2 py-2.5 text-center align-top">
                                    {renderEditableCell(acc, 'regYear', acc.regYear, '注册年份', '100%')}
                                </td>
                                {/* 国家 */}
                                <td className="gm-col-country px-2 py-2.5 text-center align-top">
                                    {renderEditableCell(acc, 'country', acc.country, '国家', '100%')}
                                </td>
                                {/* 操作 */}
                                <td className="gm-col-actions px-2 py-2.5">
                                    <div className="flex items-center justify-center gap-0.5">
                                        {onOpenBrowser && (
                                            <BrowserButton
                                                account={acc}
                                                status={browserStatuses?.[acc.email]}
                                                opening={openingBrowserIds?.has(acc.id)}
                                                onOpen={onOpenBrowser}
                                            />
                                        )}
                                        <button onClick={() => onEdit(acc)} onMouseDown={(e) => e.stopPropagation()} className="gm-icon-btn" style={{ width: 26, height: 26 }} title="编辑">
                                            <Edit3 size={15} />
                                        </button>
                                        <button onClick={() => onDelete(acc.id)} onMouseDown={(e) => e.stopPropagation()} className="gm-icon-btn" style={{ width: 26, height: 26 }} title="删除">
                                            <Trash2 size={15} />
                                        </button>
                                        <button onClick={() => copyAllInfo(acc)} onMouseDown={(e) => e.stopPropagation()} className="gm-icon-btn" style={{ width: 26, height: 26 }} title="复制全部信息">
                                            <Copy size={15} />
                                        </button>
                                        <button onClick={() => copyPhoneWithSmsUrl(acc)} onMouseDown={(e) => e.stopPropagation()} className="gm-icon-btn" style={{ width: 26, height: 26 }} title="复制号码与接码地址" disabled={!acc.smsUrl}>
                                            <Link2 size={15} />
                                        </button>
                                    </div>
                                </td>
                                {/* 导入时间 */}
                                <td className="gm-col-created px-2 py-2.5 align-top">
                                    {renderCreatedAtCell(acc.createdAt)}
                                </td>
                            </tr>
                        )) : (
                            <tr>
                                <td colSpan="14">
                                    <div className="gm-empty flex flex-col items-center">
                                        <Search size={48} className="mb-4 opacity-20" />
                                        <p className="text-lg font-medium">未找到相关账号</p>
                                        <p className="text-sm">尝试更换关键词或导入新账号</p>
                                    </div>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default AccountTable;
