import {
    Tag,
    Phone,
    Globe,
    Calendar,
    Trash2,
    X,
    CheckSquare,
    ListChecks,
} from 'lucide-react';

/**
 * 批量操作工具栏组件
 */
const BatchToolbar = ({
    selectedCount,
    totalResultCount,
    canSelectAllCurrentResult,
    isBatchProcessing,
    onSelectAllCurrentResult,
    onBatchEdit,
    onBatchDelete,
    onClearSelection,
}) => {
    if (selectedCount === 0) return null;

    const btnBase = `gm-btn gm-btn-secondary gm-btn-sm ${isBatchProcessing ? 'opacity-50 cursor-not-allowed' : ''}`;

    return (
        <div className="gm-card p-4 animate-in slide-in-from-top-2">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <CheckSquare size={20} style={{ color: 'var(--primary)' }} />
                    <span className="text-sm font-semibold gm-text-1">
                        已选中 {selectedCount} 个账号
                    </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {canSelectAllCurrentResult && (
                        <button
                            onClick={onSelectAllCurrentResult}
                            disabled={isBatchProcessing}
                            className={`gm-btn gm-btn-ghost gm-btn-sm ${isBatchProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
                            title={`一键选中当前结果全部 ${totalResultCount} 个账号`}
                        >
                            <ListChecks size={16} />
                            <span>全选当前结果（{totalResultCount}）</span>
                        </button>
                    )}

                    <button
                        onClick={() => onBatchEdit('groupName', '标签')}
                        disabled={isBatchProcessing}
                        className={btnBase}
                        title="为选中账号设置标签"
                    >
                        <Tag size={16} />
                        <span>批量设置标签</span>
                    </button>

                    <button
                        onClick={() => onBatchEdit('phone', '手机号')}
                        disabled={isBatchProcessing}
                        className={btnBase}
                        title="为选中账号设置手机号"
                    >
                        <Phone size={16} />
                        <span>批量设置手机号</span>
                    </button>

                    <button
                        onClick={() => onBatchEdit('country', '国家')}
                        disabled={isBatchProcessing}
                        className={btnBase}
                        title="为选中账号设置国家"
                    >
                        <Globe size={16} />
                        <span>批量设置国家</span>
                    </button>

                    <button
                        onClick={() => onBatchEdit('regYear', '注册年份')}
                        disabled={isBatchProcessing}
                        className={btnBase}
                        title="为选中账号设置注册年份"
                    >
                        <Calendar size={16} />
                        <span>批量设置年份</span>
                    </button>

                    <div className="h-8 w-[1px]" style={{ background: 'var(--border)' }}></div>

                    <button
                        onClick={onBatchDelete}
                        disabled={isBatchProcessing}
                        className={`gm-btn gm-btn-danger gm-btn-sm ${isBatchProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
                        title="删除选中的账号"
                    >
                        <Trash2 size={16} />
                        <span>批量删除</span>
                    </button>

                    <button
                        onClick={onClearSelection}
                        className="gm-btn gm-btn-secondary gm-btn-sm"
                        title="取消选择"
                    >
                        <X size={16} />
                        <span>取消选择</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default BatchToolbar;
