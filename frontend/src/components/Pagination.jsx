import React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

/**
 * 分页组件
 */
const Pagination = ({
    currentPage,
    totalPages,
    totalItems,
    pageSize,
    onPageChange,
    onPageSizeChange,
    hasNextPage,
    hasPrevPage
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

    const navButtonClass = (enabled) =>
        `gm-icon-btn ${enabled ? '' : 'opacity-45 cursor-not-allowed'}`;

    return (
        <div className="gm-pagination-bar flex flex-col sm:flex-row items-center justify-between gap-3">
            {/* 左侧：显示信息 */}
            <div className="text-xs gm-text-2 font-mono">
                共 <span className="font-semibold gm-text-1">{totalItems}</span> 条记录，
                第 <span className="font-semibold gm-text-1">{currentPage}</span> / {totalPages} 页
            </div>

            {/* 中间：页码导航 */}
            <div className="flex items-center gap-1">
                <button
                    onClick={() => onPageChange(1)}
                    disabled={!hasPrevPage}
                    className={navButtonClass(hasPrevPage)}
                    style={{ width: 30, height: 30 }}
                    title="首页"
                >
                    <ChevronsLeft size={16} />
                </button>

                <button
                    onClick={() => onPageChange(currentPage - 1)}
                    disabled={!hasPrevPage}
                    className={navButtonClass(hasPrevPage)}
                    style={{ width: 30, height: 30 }}
                    title="上一页"
                >
                    <ChevronLeft size={16} />
                </button>

                <div className="flex items-center gap-0.5 mx-1.5 gm-seg">
                    {getPageNumbers().map((page, index) =>
                        page === '...' ? (
                            <span key={`ellipsis-${index}`} className="px-2 text-xs gm-text-3">
                                ...
                            </span>
                        ) : (
                            <button
                                key={page}
                                onClick={() => onPageChange(page)}
                                className={`min-w-[36px] h-7 px-2.5 rounded-md text-xs font-mono font-medium transition-all gm-seg-item ${page === currentPage ? 'active' : ''}`}
                            >
                                {page}
                            </button>
                        )
                    )}
                </div>

                <button
                    onClick={() => onPageChange(currentPage + 1)}
                    disabled={!hasNextPage}
                    className={navButtonClass(hasNextPage)}
                    style={{ width: 30, height: 30 }}
                    title="下一页"
                >
                    <ChevronRight size={16} />
                </button>

                <button
                    onClick={() => onPageChange(totalPages)}
                    disabled={!hasNextPage}
                    className={navButtonClass(hasNextPage)}
                    style={{ width: 30, height: 30 }}
                    title="末页"
                >
                    <ChevronsRight size={16} />
                </button>
            </div>

            {/* 右侧：每页条数选择 */}
            <div className="flex items-center gap-2 text-xs gm-text-2">
                <span>每页</span>
                <select
                    value={pageSize}
                    onChange={(e) => onPageSizeChange(Number(e.target.value))}
                    className="gm-select"
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
