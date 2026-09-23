import { useState, useEffect, useCallback } from 'react';

/**
 * 账号多选 Hook
 * 管理 Ctrl+点击、Shift+范围选择、拖拽选择逻辑
 */
const useAccountSelection = () => {
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [isSelecting, setIsSelecting] = useState(false);
    const [selectionStart, setSelectionStart] = useState(null);

    // 监听鼠标松开事件以结束拖动选择
    useEffect(() => {
        const handleMouseUp = () => {
            setIsSelecting(false);
        };
        document.addEventListener('mouseup', handleMouseUp);
        return () => document.removeEventListener('mouseup', handleMouseUp);
    }, []);

    // 处理行鼠标按下事件
    const handleRowMouseDown = useCallback((e, accountId, paginatedData, editingCell) => {
        if (e.target.type === 'checkbox') return;
        if (e.button !== 0 || editingCell) return;

        if (e.ctrlKey || e.metaKey) {
            // Ctrl/Cmd + click: toggle selection
            setIsSelecting(false);
            setSelectedIds(prevSelected => {
                const newSelected = new Set(prevSelected);
                if (newSelected.has(accountId)) {
                    newSelected.delete(accountId);
                } else {
                    newSelected.add(accountId);
                }
                return newSelected;
            });
            setSelectionStart(accountId);
        } else if (e.shiftKey && selectionStart !== null) {
            // Shift + click: range selection
            const startIndex = paginatedData.findIndex(a => a.id === selectionStart);
            const endIndex = paginatedData.findIndex(a => a.id === accountId);
            if (startIndex === -1 || endIndex === -1) return;
            const [from, to] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
            setIsSelecting(false);
            setSelectedIds(prevSelected => {
                const newSelected = new Set(prevSelected);
                for (let i = from; i <= to; i++) {
                    newSelected.add(paginatedData[i].id);
                }
                return newSelected;
            });
        } else {
            // Normal click: select only current item, start drag selection
            setIsSelecting(true);
            setSelectionStart(accountId);
            const newSelected = new Set();
            newSelected.add(accountId);
            setSelectedIds(newSelected);
        }
    }, [selectionStart]);

    // 处理行鼠标进入事件（拖拽选择）
    const handleRowMouseEnter = useCallback((accountId, paginatedData) => {
        if (isSelecting && selectionStart !== null) {
            const startIndex = paginatedData.findIndex(a => a.id === selectionStart);
            const endIndex = paginatedData.findIndex(a => a.id === accountId);
            if (startIndex === -1 || endIndex === -1) return;
            const [from, to] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
            const rangeIds = new Set();
            for (let i = from; i <= to; i++) {
                rangeIds.add(paginatedData[i].id);
            }
            setSelectedIds(prevSelected => {
                // 避免不必要的 state 更新
                if (rangeIds.size === prevSelected.size && [...rangeIds].every(id => prevSelected.has(id))) {
                    return prevSelected;
                }
                return rangeIds;
            });
        }
    }, [isSelecting, selectionStart]);

    // 切换单个复选框
    const toggleCheckbox = useCallback((accountId) => {
        setSelectedIds(prevSelected => {
            const newSelected = new Set(prevSelected);
            if (newSelected.has(accountId)) {
                newSelected.delete(accountId);
            } else {
                newSelected.add(accountId);
            }
            return newSelected;
        });
    }, []);

    // 全选/全不选当前页
    const toggleSelectAll = useCallback((paginatedData) => {
        const currentPageIds = paginatedData.map(acc => acc.id);
        if (currentPageIds.length === 0) return;

        setSelectedIds(prevSelected => {
            const allCurrentPageSelected = currentPageIds.every(id => prevSelected.has(id));
            const newSelected = new Set(prevSelected);

            if (allCurrentPageSelected) {
                currentPageIds.forEach(id => newSelected.delete(id));
            } else {
                currentPageIds.forEach(id => newSelected.add(id));
            }

            return newSelected;
        });
    }, []);

    // 全选当前筛选结果（跨分页）
    const selectAllCurrentResult = useCallback((currentResultAccountIds) => {
        setSelectedIds(new Set(currentResultAccountIds));
    }, []);

    // 清理不在当前筛选结果内的残留选中 ID
    const keepOnlyCurrentResultIds = useCallback((currentResultAccountIds) => {
        const validIdSet = new Set(currentResultAccountIds);

        setSelectedIds(prevSelected => {
            if (prevSelected.size === 0) return prevSelected;

            const filteredSelected = new Set(
                [...prevSelected].filter(id => validIdSet.has(id))
            );

            if (
                filteredSelected.size === prevSelected.size &&
                [...filteredSelected].every(id => prevSelected.has(id))
            ) {
                return prevSelected;
            }

            return filteredSelected;
        });

        setSelectionStart(prevStart => (validIdSet.has(prevStart) ? prevStart : null));
    }, []);

    // 取消选择
    const clearSelection = useCallback(() => {
        setIsSelecting(false);
        setSelectionStart(null);
        setSelectedIds(new Set());
    }, []);

    return {
        selectedIds,
        isSelecting,
        handleRowMouseDown,
        handleRowMouseEnter,
        toggleCheckbox,
        toggleSelectAll,
        selectAllCurrentResult,
        keepOnlyCurrentResultIds,
        clearSelection,
    };
};

export default useAccountSelection;
