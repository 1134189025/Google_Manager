import { useState, useEffect } from 'react';
import { X, ChevronUp, ChevronDown, FileText } from 'lucide-react';

const DEFAULT_CATEGORY_LABEL_TEMPLATE = '{index}. {groupField}: {groupValue}（共 {count} 条）';

const separatorOptions = [
    { value: '----', label: '四横线 (----)', description: '与导入格式兼容' },
    { value: '|', label: '竖线 (|)', description: '常用分隔符' },
    { value: '---', label: '三横线 (---)', description: '简洁分隔' },
    { value: '\t', label: 'Tab', description: 'TSV 格式' },
    { value: 'custom', label: '自定义', description: '输入自定义分隔符' },
];

const availableFields = [
    { value: 'email', label: '邮箱', defaultSelected: true },
    { value: 'password', label: '密码', defaultSelected: true },
    { value: 'recovery', label: '恢复邮箱', defaultSelected: true },
    { value: 'secret', label: '2FA密钥', defaultSelected: true },
    { value: 'phone', label: '手机号', defaultSelected: false },
    { value: 'reg_year', label: '注册年份', defaultSelected: false },
    { value: 'country', label: '国家', defaultSelected: false },
    { value: 'group_name', label: '标签', defaultSelected: false },
    { value: 'remark', label: '备注', defaultSelected: false },
    { value: 'status', label: '状态', defaultSelected: false },
];

const accountOrderFieldOptions = [
    { value: 'id', label: '导入序号(ID)' },
    { value: 'email', label: '邮箱' },
    { value: 'recovery', label: '恢复邮箱' },
    { value: 'phone', label: '手机号' },
    { value: 'reg_year', label: '注册年份' },
    { value: 'country', label: '国家' },
    { value: 'group_name', label: '标签' },
    { value: 'status', label: '状态' },
    { value: 'created_at', label: '创建时间' },
    { value: 'updated_at', label: '更新时间' },
];

const categorySortFieldOptions = [
    { value: '', label: '不分类（仅排序）' },
    { value: 'group_name', label: '标签' },
    { value: 'country', label: '国家' },
    { value: 'reg_year', label: '注册年份' },
    { value: 'status', label: '状态' },
];

const directionOptions = [
    { value: 'asc', label: '升序' },
    { value: 'desc', label: '降序' },
];

const fieldLabelMap = {
    id: '导入序号(ID)',
    email: '邮箱',
    password: '密码',
    recovery: '恢复邮箱',
    phone: '手机号',
    secret: '2FA密钥',
    reg_year: '注册年份',
    country: '国家',
    group_name: '标签',
    remark: '备注',
    status: '状态',
    created_at: '创建时间',
    updated_at: '更新时间',
};

/**
 * 导出配置对话框组件
 */
const ExportDialog = ({
    isOpen,
    onClose,
    onExport,
    exportMode,
    exportScopeCounts = {},
    previewAccounts = [],
}) => {
    const defaultSelectedFields = availableFields
        .filter((field) => field.defaultSelected)
        .map((field) => field.value);

    const [separator, setSeparator] = useState('----');
    const [customSeparator, setCustomSeparator] = useState('');
    const [includeStats, setIncludeStats] = useState(true);
    const [selectedFields, setSelectedFields] = useState(defaultSelectedFields);
    const [accountOrderField, setAccountOrderField] = useState('id');
    const [accountOrderDirection, setAccountOrderDirection] = useState('desc');
    const [categorySortField, setCategorySortField] = useState('');
    const [categorySortDirection, setCategorySortDirection] = useState('asc');
    const [categoryLabelTemplate, setCategoryLabelTemplate] = useState(DEFAULT_CATEGORY_LABEL_TEMPLATE);

    const normalizeFieldValue = (value) => {
        if (value === null || value === undefined) {
            return '';
        }
        return String(value);
    };

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        setSeparator('----');
        setCustomSeparator('');
        setIncludeStats(true);
        setSelectedFields(defaultSelectedFields);
        setAccountOrderField('id');
        setAccountOrderDirection('desc');
        setCategorySortField('');
        setCategorySortDirection('asc');
        setCategoryLabelTemplate(DEFAULT_CATEGORY_LABEL_TEMPLATE);
    }, [isOpen]);

    if (!isOpen) return null;

    const getActualSeparator = () => {
        if (separator === 'custom') {
            return customSeparator || '----';
        }
        return separator;
    };

    const toggleField = (fieldValue) => {
        setSelectedFields((previousFields) => {
            if (previousFields.includes(fieldValue)) {
                return previousFields.filter((field) => field !== fieldValue);
            }
            return [...previousFields, fieldValue];
        });
    };

    const moveFieldUp = (fieldValue) => {
        const fieldIndex = selectedFields.indexOf(fieldValue);
        if (fieldIndex <= 0) {
            return;
        }

        const reorderedFields = [...selectedFields];
        [reorderedFields[fieldIndex - 1], reorderedFields[fieldIndex]] =
            [reorderedFields[fieldIndex], reorderedFields[fieldIndex - 1]];
        setSelectedFields(reorderedFields);
    };

    const moveFieldDown = (fieldValue) => {
        const fieldIndex = selectedFields.indexOf(fieldValue);
        if (fieldIndex < 0 || fieldIndex >= selectedFields.length - 1) {
            return;
        }

        const reorderedFields = [...selectedFields];
        [reorderedFields[fieldIndex], reorderedFields[fieldIndex + 1]] =
            [reorderedFields[fieldIndex + 1], reorderedFields[fieldIndex]];
        setSelectedFields(reorderedFields);
    };

    const getCurrentExportCount = () => {
        if (exportMode === 'selected') {
            return exportScopeCounts.selected ?? 0;
        }
        if (exportMode === 'filtered') {
            return exportScopeCounts.filtered ?? 0;
        }
        return exportScopeCounts.all ?? 0;
    };

    const getExportModeDescription = () => {
        const currentCount = getCurrentExportCount();
        if (exportMode === 'selected') {
            return `将导出选中的账号，共 ${currentCount} 条`;
        }
        if (exportMode === 'filtered') {
            return `将导出当前筛选结果，共 ${currentCount} 条`;
        }
        return `将导出全部账号，共 ${currentCount} 条`;
    };

    const getPreviewFieldValue = (account, field) => {
        switch (field) {
            case 'email':
                return normalizeFieldValue(account?.email);
            case 'password':
                return normalizeFieldValue(account?.password);
            case 'recovery':
                return normalizeFieldValue(account?.recovery);
            case 'secret':
                return normalizeFieldValue(account?.secret);
            case 'phone':
                return normalizeFieldValue(account?.phone);
            case 'reg_year':
                return normalizeFieldValue(account?.regYear ?? account?.reg_year);
            case 'country':
                return normalizeFieldValue(account?.country);
            case 'group_name':
                return normalizeFieldValue(account?.groupName ?? account?.group_name);
            case 'remark':
                return normalizeFieldValue(account?.remark);
            case 'status':
                return normalizeFieldValue(account?.status);
            case 'id':
                return normalizeFieldValue(account?.id);
            case 'created_at':
                return normalizeFieldValue(account?.createdAt ?? account?.created_at);
            case 'updated_at':
                return normalizeFieldValue(account?.updatedAt ?? account?.updated_at);
            default:
                return '';
        }
    };

    const buildCategoryLabelPreview = () => {
        if (!categorySortField) {
            return '未启用分类标签';
        }

        const sampleAccount = Array.isArray(previewAccounts) && previewAccounts.length > 0
            ? previewAccounts[0]
            : null;
        const categoryFieldLabel = fieldLabelMap[categorySortField] || categorySortField;
        const sampleGroupValue = getPreviewFieldValue(sampleAccount, categorySortField) || '未分类';
        const template = categoryLabelTemplate.trim() || DEFAULT_CATEGORY_LABEL_TEMPLATE;

        return template
            .replaceAll('{index}', '1')
            .replaceAll('{groupField}', categoryFieldLabel)
            .replaceAll('{groupValue}', sampleGroupValue)
            .replaceAll('{count}', String(getCurrentExportCount()));
    };

    const generatePreview = () => {
        if (selectedFields.length === 0) {
            return '(未选择任何字段)';
        }
        if (!Array.isArray(previewAccounts) || previewAccounts.length === 0) {
            return '(当前导出范围没有可预览账号)';
        }

        const actualSeparator = getActualSeparator();
        const previewLines = previewAccounts.slice(0, 2).map((account) => {
            const lineValues = selectedFields.map((field) => getPreviewFieldValue(account, field));
            return lineValues.join(actualSeparator);
        });

        return previewLines.join('\n');
    };

    const handleExport = () => {
        if (selectedFields.length === 0) {
            alert('请至少选择一个字段');
            return;
        }

        const normalizedCategoryLabelTemplate = categoryLabelTemplate.trim() || DEFAULT_CATEGORY_LABEL_TEMPLATE;

        const exportConfig = {
            separator: getActualSeparator(),
            fields: selectedFields,
            includeStats,
            accountOrder: {
                field: accountOrderField,
                direction: accountOrderDirection,
            },
            categorySort: {
                field: categorySortField,
                direction: categorySortDirection,
            },
            categoryLabelTemplate: normalizedCategoryLabelTemplate,
        };

        onExport(exportConfig);
    };
    return (
        <div className="gm-overlay">
            <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto gm-modal animate-in zoom-in-95 duration-200">
                <div className="sticky top-0 z-10 gm-modal-header" style={{ background: 'var(--bg-secondary)' }}>
                    <div>
                        <h2 className="gm-title">导出账号配置</h2>
                        <p className="text-sm mt-1 gm-text-2">
                            {getExportModeDescription()}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="关闭导出配置"
                        title="关闭导出配置"
                        className="gm-icon-btn"
                    >
                        <X size={24} />
                    </button>
                </div>

                <div className="p-4 sm:p-6 space-y-6">
                    <div>
                        <label className="block text-sm font-semibold gm-text-1 mb-3">分隔符</label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {separatorOptions.map((option) => (
                                <button
                                    key={option.value}
                                    onClick={() => setSeparator(option.value)}
                                    className={`p-3 text-left transition-all gm-solid ${
                                        separator === option.value
                                            ? 'text-[color:var(--text-primary)]'
                                            : 'hover:bg-[color:var(--bg-hover)]'
                                    }`}
                                    style={separator === option.value ? { borderColor: 'var(--primary)', background: 'var(--primary-light)' } : undefined}
                                >
                                    <div className="font-medium">{option.label}</div>
                                    <div className="text-xs mt-1 gm-text-3">
                                        {option.description}
                                    </div>
                                </button>
                            ))}
                        </div>
                        {separator === 'custom' && (
                            <input
                                type="text"
                                value={customSeparator}
                                onChange={(event) => setCustomSeparator(event.target.value)}
                                placeholder="输入自定义分隔符"
                                className="gm-input mt-3"
                            />
                        )}
                    </div>

                    <div className="flex items-center justify-between">
                        <div>
                            <label className="text-sm font-semibold gm-text-1">包含统计汇总</label>
                            <p className="text-xs mt-1 gm-text-2">
                                在文件开头显示账号统计信息
                            </p>
                        </div>
                        <button
                            onClick={() => setIncludeStats(!includeStats)}
                            aria-label="包含统计汇总"
                            className="relative w-12 h-6 rounded-full transition-colors"
                            style={{ background: includeStats ? 'var(--primary)' : 'var(--border)' }}
                        >
                            <div className={`absolute top-1 left-1 w-4 h-4 rounded-full transition-transform ${
                                includeStats ? 'translate-x-6' : ''
                            }`} style={{ background: '#ffffff' }} />
                        </button>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold gm-text-1 mb-3">账号顺序</label>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                                <label htmlFor="account-order-field" className="block text-xs gm-text-2 mb-1">账号顺序字段</label>
                                <select
                                    id="account-order-field"
                                    value={accountOrderField}
                                    onChange={(event) => setAccountOrderField(event.target.value)}
                                    className="gm-select w-full"
                                >
                                    {accountOrderFieldOptions.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label htmlFor="account-order-direction" className="block text-xs gm-text-2 mb-1">账号顺序方向</label>
                                <select
                                    id="account-order-direction"
                                    value={accountOrderDirection}
                                    onChange={(event) => setAccountOrderDirection(event.target.value)}
                                    className="gm-select w-full"
                                >
                                    {directionOptions.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold gm-text-1 mb-3">分类排序与标签格式</label>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                                <label htmlFor="category-sort-field" className="block text-xs gm-text-2 mb-1">分类字段</label>
                                <select
                                    id="category-sort-field"
                                    value={categorySortField}
                                    onChange={(event) => setCategorySortField(event.target.value)}
                                    className="gm-select w-full"
                                >
                                    {categorySortFieldOptions.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label htmlFor="category-sort-direction" className="block text-xs gm-text-2 mb-1">分类顺序</label>
                                <select
                                    id="category-sort-direction"
                                    value={categorySortDirection}
                                    onChange={(event) => setCategorySortDirection(event.target.value)}
                                    className="gm-select w-full"
                                >
                                    {directionOptions.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="mt-3">
                            <label htmlFor="category-label-template" className="block text-xs gm-text-2 mb-1">分类标签模板</label>
                            <input
                                id="category-label-template"
                                type="text"
                                value={categoryLabelTemplate}
                                onChange={(event) => setCategoryLabelTemplate(event.target.value)}
                                placeholder={DEFAULT_CATEGORY_LABEL_TEMPLATE}
                                className="gm-input"
                            />
                            <p className="text-xs mt-2 gm-text-2">
                                支持变量：{'{index}'} {'{groupField}'} {'{groupValue}'} {'{count}'}
                            </p>
                            <p className="text-xs mt-1 gm-text-1">
                                模板示例：{buildCategoryLabelPreview()}
                            </p>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold gm-text-1 mb-3">选择导出字段（可调整顺序）</label>
                        <div className="space-y-2">
                            {availableFields.map((field) => {
                                const isSelected = selectedFields.includes(field.value);
                                const selectedIndex = selectedFields.indexOf(field.value);

                                return (
                                    <div
                                        key={field.value}
                                        className="flex items-center gap-3 p-3 transition-all gm-solid"
                                        style={isSelected
                                            ? { borderColor: 'var(--primary)', background: 'var(--primary-light)' }
                                            : { borderColor: 'var(--border)' }}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => toggleField(field.value)}
                                            className="w-4 h-4"
                                        />
                                        <span className="flex-1 gm-text-1">{field.label}</span>
                                        {isSelected && (
                                            <div className="flex items-center gap-2">
                                                <span className="gm-chip font-bold">
                                                    #{selectedIndex + 1}
                                                </span>
                                                <button
                                                    onClick={() => moveFieldUp(field.value)}
                                                    disabled={selectedIndex === 0}
                                                    className={`p-1 rounded ${
                                                        selectedIndex === 0
                                                            ? 'opacity-30 cursor-not-allowed'
                                                            : 'hover:bg-[color:var(--bg-hover)]'
                                                    }`}
                                                >
                                                    <ChevronUp size={16} />
                                                </button>
                                                <button
                                                    onClick={() => moveFieldDown(field.value)}
                                                    disabled={selectedIndex === selectedFields.length - 1}
                                                    className={`p-1 rounded ${
                                                        selectedIndex === selectedFields.length - 1
                                                            ? 'opacity-30 cursor-not-allowed'
                                                            : 'hover:bg-[color:var(--bg-hover)]'
                                                    }`}
                                                >
                                                    <ChevronDown size={16} />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold gm-text-1 mb-3">预览（示例前1到2行）</label>
                        <div className="gm-solid p-4 font-mono text-sm whitespace-pre-wrap break-all gm-text-1">
                            {generatePreview()}
                        </div>
                    </div>
                </div>

                <div className="sticky bottom-0 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-3 gm-modal-footer">
                    <button
                        onClick={onClose}
                        className="gm-btn gm-btn-secondary w-full sm:w-auto"
                    >
                        取消
                    </button>
                    <button
                        onClick={handleExport}
                        className="gm-btn gm-btn-success w-full sm:w-auto"
                    >
                        <FileText size={18} />
                        导出
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ExportDialog;
