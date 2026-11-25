import { FluentIcon } from './glass';

/**
 * 悬浮液态玻璃批量操作条 (.floatbar.glass)
 * - 采用上下双行布局（首行：选中计数/全选与删除/取消；次行：批量字段编辑与缓存清理）
 * - 完整保留全部批量操作：全选当前结果、批量设置分类/手机号/国家/年份、清理浏览器缓存、批量删除、取消选择
 */
const BatchToolbar = ({
    selectedCount,
    totalResultCount,
    canSelectAllCurrentResult,
    isBatchProcessing,
    onSelectAllCurrentResult,
    onBatchEdit,
    onBatchDelete,
    onBatchClearBrowserCache,
    onClearSelection,
}) => {
    if (selectedCount === 0) return null;

    const btnClass = `gbtn ${isBatchProcessing ? 'opacity-50 cursor-not-allowed' : ''}`;

    return (
        <div
            className="floatbar glass"
            data-lens="cap"
            role="toolbar"
            aria-label="批量操作"
        >
            <div className="floatbar-row floatbar-row-head">
                <div className="floatbar-group">
                    <span className="count">已选中 {selectedCount} 个账号</span>

                    {canSelectAllCurrentResult && (
                        <button
                            type="button"
                            onClick={onSelectAllCurrentResult}
                            disabled={isBatchProcessing}
                            className={btnClass}
                            title={`一键选中当前结果全部 ${totalResultCount} 个账号`}
                        >
                            <FluentIcon name="checkCircle" size={15} />
                            <span>全选当前结果（{totalResultCount}）</span>
                        </button>
                    )}
                </div>

                <div className="floatbar-group">
                    <button
                        type="button"
                        onClick={onBatchDelete}
                        disabled={isBatchProcessing}
                        className={`gbtn danger ${isBatchProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
                        title="删除选中的账号"
                    >
                        <FluentIcon name="trash" size={15} />
                        <span>批量删除</span>
                    </button>

                    <button
                        type="button"
                        onClick={onClearSelection}
                        className="gbtn"
                        title="取消选择"
                    >
                        <FluentIcon name="dismiss" size={14} />
                        <span>取消选择</span>
                    </button>
                </div>
            </div>

            <div className="floatbar-divider" aria-hidden="true" />

            <div className="floatbar-row floatbar-row-actions">
                <button
                    type="button"
                    onClick={() => onBatchEdit('groupName', '分类 / 标签')}
                    disabled={isBatchProcessing}
                    className={btnClass}
                    title="为选中账号设置标签"
                >
                    <FluentIcon name="tag" size={15} />
                    <span>批量设置分类</span>
                </button>

                <button
                    type="button"
                    onClick={() => onBatchEdit('phone', '手机号')}
                    disabled={isBatchProcessing}
                    className={btnClass}
                    title="为选中账号设置手机号"
                >
                    <FluentIcon name="phone" size={15} />
                    <span>批量设置手机号</span>
                </button>

                <button
                    type="button"
                    onClick={() => onBatchEdit('country', '国家')}
                    disabled={isBatchProcessing}
                    className={btnClass}
                    title="为选中账号设置国家"
                >
                    <FluentIcon name="globe" size={15} />
                    <span>批量设置国家</span>
                </button>

                <button
                    type="button"
                    onClick={() => onBatchEdit('regYear', '注册年份')}
                    disabled={isBatchProcessing}
                    className={btnClass}
                    title="为选中账号设置注册年份"
                >
                    <FluentIcon name="calendar" size={15} />
                    <span>批量设置年份</span>
                </button>

                {onBatchClearBrowserCache && (
                    <button
                        type="button"
                        onClick={onBatchClearBrowserCache}
                        disabled={isBatchProcessing}
                        className={btnClass}
                        title="清理选中账号的浏览器缓存（不影响登录状态，运行中的会跳过）"
                    >
                        <FluentIcon name="browser" size={15} />
                        <span>清理浏览器缓存</span>
                    </button>
                )}
            </div>
        </div>
    );
};

export default BatchToolbar;
