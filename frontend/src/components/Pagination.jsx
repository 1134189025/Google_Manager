import React from 'react';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { FluentIcon } from './glass';

/**
 * 分页组件（液态玻璃胶囊导航风格）
 * - 完整保留页码、首末页、上下页与每页条数切换
 */
const Pagination = ({
    currentPage,
    totalPages,
    totalItems,
    pageSize,
    onPageChange,
    onPageSizeChange,
    hasNextPage,
    hasPrevPage,
}) => {
    const getPageNumbers = () => {
        const pages = [];
        const maxVisible = 5;

        if (totalPages <= maxVisible) {
            for (let i = 1; i <= totalPages; i++) {
                pages.push(i);
            }
        } else {
            pages.push(1);

            let start = Math.max(2, currentPage - 1);
            let end = Math.min(totalPages - 1, currentPage + 1);

            if (currentPage <= 3) {
                end = 4;
            } else if (currentPage >= totalPages - 2) {
                start = totalPages - 3;
            }

            if (start > 2) {
                pages.push('...');
            }

            for (let i = start; i <= end; i++) {
                pages.push(i);
            }

            if (end < totalPages - 1) {
                pages.push('...');
            }

            pages.push(totalPages);
        }

        return pages;
    };

    const pageSizeOptions = [100, 200, 500];

    return (
        <div className="gm-pagination-bar flex flex-col sm:flex-row items-center justify-between gap-3">
            {/* 左侧：显示信息 */}
            <div className="text-[12.5px] muted tabular-nums">
                共 <span className="font-semibold" style={{ color: 'var(--text)' }}>{totalItems}</span> 条记录，
                第 <span className="font-semibold" style={{ color: 'var(--text)' }}>{currentPage}</span> / {totalPages} 页
            </div>

            {/* 中间：页码导航 */}
            <div className="flex items-center gap-1">
                <button
                    type="button"
                    onClick={() => onPageChange(1)}
                    disabled={!hasPrevPage}
                    className="gbtn icon"
                    style={{ width: 32, height: 32, minWidth: 32 }}
                    title="首页"
                    aria-label="首页"
                >
                    <ChevronsLeft size={15} />
                </button>

                <button
                    type="button"
                    onClick={() => onPageChange(currentPage - 1)}
                    disabled={!hasPrevPage}
                    className="gbtn icon"
                    style={{ width: 32, height: 32, minWidth: 32 }}
                    title="上一页"
                    aria-label="上一页"
                >
                    <FluentIcon name="chevLeft" size={16} />
                </button>

                <div className="flex items-center gap-0.5 mx-1 gm-seg">
                    {getPageNumbers().map((page, index) =>
                        page === '...' ? (
                            <span key={`ellipsis-${index}`} className="px-2 text-xs muted">
                                ...
                            </span>
                        ) : (
                            <button
                                key={page}
                                type="button"
                                onClick={() => onPageChange(page)}
                                className={`min-w-[36px] h-7 px-2.5 rounded-full text-xs font-mono font-medium transition-all gm-seg-item ${page === currentPage ? 'active' : ''}`}
                            >
                                {page}
                            </button>
                        ),
                    )}
                </div>

                <button
                    type="button"
                    onClick={() => onPageChange(currentPage + 1)}
                    disabled={!hasNextPage}
                    className="gbtn icon"
                    style={{ width: 32, height: 32, minWidth: 32 }}
                    title="下一页"
                    aria-label="下一页"
                >
                    <FluentIcon name="chevRight" size={16} />
                </button>

                <button
                    type="button"
                    onClick={() => onPageChange(totalPages)}
                    disabled={!hasNextPage}
                    className="gbtn icon"
                    style={{ width: 32, height: 32, minWidth: 32 }}
                    title="末页"
                    aria-label="末页"
                >
                    <ChevronsRight size={15} />
                </button>
            </div>

            {/* 右侧：每页条数选择 */}
            <div className="flex items-center gap-2 text-[12.5px] muted">
                <span>每页</span>
                <select
                    value={pageSize}
                    onChange={(e) => onPageSizeChange(Number(e.target.value))}
                    className="gm-select"
                    aria-label="每页条数"
                >
                    {pageSizeOptions.map(size => (
                        <option key={size} value={size}>{size} 条</option>
                    ))}
                </select>
            </div>
        </div>
    );
};

export default Pagination;
