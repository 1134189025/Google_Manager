import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import useAccountSelection from '../hooks/useAccountSelection';

describe('useAccountSelection Hook', () => {
  const mockAccounts = [
    { id: 1, email: 'test1@gmail.com' },
    { id: 2, email: 'test2@gmail.com' },
    { id: 3, email: 'test3@gmail.com' },
    { id: 4, email: 'test4@gmail.com' },
    { id: 5, email: 'test5@gmail.com' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('初始状态', () => {
    it('返回正确的初始状态', () => {
      const { result } = renderHook(() => useAccountSelection());

      expect(result.current.selectedIds).toEqual(new Set());
      expect(result.current.isSelecting).toBe(false);
    });

    it('返回所有必需的函数', () => {
      const { result } = renderHook(() => useAccountSelection());

      expect(typeof result.current.handleRowMouseDown).toBe('function');
      expect(typeof result.current.handleRowMouseEnter).toBe('function');
      expect(typeof result.current.toggleCheckbox).toBe('function');
      expect(typeof result.current.toggleSelectAll).toBe('function');
      expect(typeof result.current.selectAllCurrentResult).toBe('function');
      expect(typeof result.current.keepOnlyCurrentResultIds).toBe('function');
      expect(typeof result.current.clearSelection).toBe('function');
    });
  });

  describe('handleRowMouseDown - 普通点击', () => {
    it('普通点击选中单个账号', () => {
      const { result } = renderHook(() => useAccountSelection());
      const mockEvent = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false, target: {} };

      act(() => {
        result.current.handleRowMouseDown(mockEvent, 1, mockAccounts, null);
      });

      expect(result.current.selectedIds).toEqual(new Set([1]));
      expect(result.current.isSelecting).toBe(true);
    });

    it('普通点击时清除之前的选择', () => {
      const { result } = renderHook(() => useAccountSelection());
      const mockEvent = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false, target: {} };

      // 先选中账号 1
      act(() => {
        result.current.handleRowMouseDown(mockEvent, 1, mockAccounts, null);
      });

      // 再点击账号 2
      act(() => {
        result.current.handleRowMouseDown(mockEvent, 2, mockAccounts, null);
      });

      expect(result.current.selectedIds).toEqual(new Set([2]));
    });

    it('点击复选框时不触发行选择', () => {
      const { result } = renderHook(() => useAccountSelection());
      const mockEvent = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false, target: { type: 'checkbox' } };

      act(() => {
        result.current.handleRowMouseDown(mockEvent, 1, mockAccounts, null);
      });

      expect(result.current.selectedIds).toEqual(new Set());
      expect(result.current.isSelecting).toBe(false);
    });

    it('非左键点击不触发选择', () => {
      const { result } = renderHook(() => useAccountSelection());
      const mockEvent = { button: 1, ctrlKey: false, metaKey: false, shiftKey: false, target: {} };

      act(() => {
        result.current.handleRowMouseDown(mockEvent, 1, mockAccounts, null);
      });

      expect(result.current.selectedIds).toEqual(new Set());
    });

    it('编辑状态中不触发选择', () => {
      const { result } = renderHook(() => useAccountSelection());
      const mockEvent = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false, target: {} };
      const editingCell = { accountId: 1, field: 'email' };

      act(() => {
        result.current.handleRowMouseDown(mockEvent, 1, mockAccounts, editingCell);
      });

      expect(result.current.selectedIds).toEqual(new Set());
    });
  });

  describe('handleRowMouseDown - Ctrl/Cmd 点击', () => {
    it('Ctrl+点击切换选择状态', () => {
      const { result } = renderHook(() => useAccountSelection());
      const mockEvent = { button: 0, ctrlKey: true, metaKey: false, shiftKey: false, target: {} };

      // 第一次点击选中
      act(() => {
        result.current.handleRowMouseDown(mockEvent, 1, mockAccounts, null);
      });

      expect(result.current.selectedIds).toEqual(new Set([1]));

      // 第二次点击取消选中
      act(() => {
        result.current.handleRowMouseDown(mockEvent, 1, mockAccounts, null);
      });

      expect(result.current.selectedIds).toEqual(new Set());
    });

    it('Cmd+点击切换选择状态（Mac）', () => {
      const { result } = renderHook(() => useAccountSelection());
      const mockEvent = { button: 0, ctrlKey: false, metaKey: true, shiftKey: false, target: {} };

      act(() => {
        result.current.handleRowMouseDown(mockEvent, 1, mockAccounts, null);
      });

      expect(result.current.selectedIds).toEqual(new Set([1]));

      act(() => {
        result.current.handleRowMouseDown(mockEvent, 1, mockAccounts, null);
      });

      expect(result.current.selectedIds).toEqual(new Set());
    });

    it('Ctrl+点击添加到现有选择', () => {
      const { result } = renderHook(() => useAccountSelection());
      const mockEvent = { button: 0, ctrlKey: true, metaKey: false, shiftKey: false, target: {} };

      act(() => {
        result.current.handleRowMouseDown(mockEvent, 1, mockAccounts, null);
      });

      act(() => {
        result.current.handleRowMouseDown(mockEvent, 3, mockAccounts, null);
      });

      expect(result.current.selectedIds).toEqual(new Set([1, 3]));
    });

    it('Ctrl+点击时不启动拖拽选择', () => {
      const { result } = renderHook(() => useAccountSelection());
      const mockEvent = { button: 0, ctrlKey: true, metaKey: false, shiftKey: false, target: {} };

      act(() => {
        result.current.handleRowMouseDown(mockEvent, 1, mockAccounts, null);
      });

      expect(result.current.isSelecting).toBe(false);
    });
  });

  describe('handleRowMouseDown - Shift 范围选择', () => {
    it('Shift+点击选择连续范围', () => {
      const { result } = renderHook(() => useAccountSelection());
      const normalEvent = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false, target: {} };
      const shiftEvent = { button: 0, ctrlKey: false, metaKey: false, shiftKey: true, target: {} };

      // 先选中账号 2
      act(() => {
        result.current.handleRowMouseDown(normalEvent, 2, mockAccounts, null);
      });

      // Shift+点击账号 4
      act(() => {
        result.current.handleRowMouseDown(shiftEvent, 4, mockAccounts, null);
      });

      expect(result.current.selectedIds).toEqual(new Set([2, 3, 4]));
    });

    it('Shift+点击反向选择范围', () => {
      const { result } = renderHook(() => useAccountSelection());
      const normalEvent = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false, target: {} };
      const shiftEvent = { button: 0, ctrlKey: false, metaKey: false, shiftKey: true, target: {} };

      // 先选中账号 4
      act(() => {
        result.current.handleRowMouseDown(normalEvent, 4, mockAccounts, null);
      });

      // Shift+点击账号 2
      act(() => {
        result.current.handleRowMouseDown(shiftEvent, 2, mockAccounts, null);
      });

      expect(result.current.selectedIds).toEqual(new Set([2, 3, 4]));
    });

    it('没有初始选择时 Shift+点击会走 else 分支选中当前项', () => {
      const { result } = renderHook(() => useAccountSelection());
      const shiftEvent = { button: 0, ctrlKey: false, metaKey: false, shiftKey: true, target: {} };

      act(() => {
        result.current.handleRowMouseDown(shiftEvent, 3, mockAccounts, null);
      });

      // 源码逻辑：shiftKey && selectionStart !== null 为 false，会走 else 分支
      // else 分支会选中当前项并开始拖拽
      expect(result.current.selectedIds).toEqual(new Set([3]));
    });

    it('Shift+点击保留现有选择', () => {
      const { result } = renderHook(() => useAccountSelection());
      const ctrlEvent = { button: 0, ctrlKey: true, metaKey: false, shiftKey: false, target: {} };
      const normalEvent = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false, target: {} };
      const shiftEvent = { button: 0, ctrlKey: false, metaKey: false, shiftKey: true, target: {} };

      // Ctrl+点击账号 1
      act(() => {
        result.current.handleRowMouseDown(ctrlEvent, 1, mockAccounts, null);
      });

      // 普通点击账号 3（设置范围起点）
      act(() => {
        result.current.handleRowMouseDown(normalEvent, 3, mockAccounts, null);
      });

      // Shift+点击账号 5（扩展选择）
      act(() => {
        result.current.handleRowMouseDown(shiftEvent, 5, mockAccounts, null);
      });

      expect(result.current.selectedIds).toEqual(new Set([3, 4, 5]));
    });
  });

  describe('handleRowMouseEnter - 拖拽选择', () => {
    it('鼠标拖拽时选择范围内的账号', () => {
      const { result } = renderHook(() => useAccountSelection());
      const mockEvent = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false, target: {} };

      // 按下鼠标在账号 2
      act(() => {
        result.current.handleRowMouseDown(mockEvent, 2, mockAccounts, null);
      });

      expect(result.current.isSelecting).toBe(true);

      // 拖拽到账号 4
      act(() => {
        result.current.handleRowMouseEnter(4, mockAccounts);
      });

      expect(result.current.selectedIds).toEqual(new Set([2, 3, 4]));
    });

    it('反向拖拽选择', () => {
      const { result } = renderHook(() => useAccountSelection());
      const mockEvent = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false, target: {} };

      // 按下鼠标在账号 4
      act(() => {
        result.current.handleRowMouseDown(mockEvent, 4, mockAccounts, null);
      });

      // 拖拽到账号 2
      act(() => {
        result.current.handleRowMouseEnter(2, mockAccounts);
      });

      expect(result.current.selectedIds).toEqual(new Set([2, 3, 4]));
    });

    it('未处于选择状态时鼠标进入不生效', () => {
      const { result } = renderHook(() => useAccountSelection());

      act(() => {
        result.current.handleRowMouseEnter(3, mockAccounts);
      });

      expect(result.current.selectedIds).toEqual(new Set());
    });

    it('拖拽过程中每次移动都更新选择范围', () => {
      const { result } = renderHook(() => useAccountSelection());
      const mockEvent = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false, target: {} };

      // 按下鼠标在账号 1
      act(() => {
        result.current.handleRowMouseDown(mockEvent, 1, mockAccounts, null);
      });

      // 拖拽到账号 3
      act(() => {
        result.current.handleRowMouseEnter(3, mockAccounts);
      });

      expect(result.current.selectedIds).toEqual(new Set([1, 2, 3]));

      // 继续拖拽到账号 5
      act(() => {
        result.current.handleRowMouseEnter(5, mockAccounts);
      });

      expect(result.current.selectedIds).toEqual(new Set([1, 2, 3, 4, 5]));

      // 向回拖拽到账号 2
      act(() => {
        result.current.handleRowMouseEnter(2, mockAccounts);
      });

      expect(result.current.selectedIds).toEqual(new Set([1, 2]));
    });
  });

  describe('全局 mouseup 事件监听', () => {
    it('鼠标松开时结束拖拽选择', () => {
      const { result } = renderHook(() => useAccountSelection());
      const mockEvent = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false, target: {} };

      // 开始拖拽
      act(() => {
        result.current.handleRowMouseDown(mockEvent, 1, mockAccounts, null);
      });

      expect(result.current.isSelecting).toBe(true);

      // 触发全局 mouseup
      act(() => {
        const mouseUpEvent = new MouseEvent('mouseup', { bubbles: true });
        document.dispatchEvent(mouseUpEvent);
      });

      expect(result.current.isSelecting).toBe(false);
    });

    it('unmount 时移除事件监听器', () => {
      const { unmount } = renderHook(() => useAccountSelection());
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));

      removeEventListenerSpy.mockRestore();
    });
  });

  describe('toggleCheckbox - 切换单个复选框', () => {
    it('选中未选中的账号', () => {
      const { result } = renderHook(() => useAccountSelection());

      act(() => {
        result.current.toggleCheckbox(1);
      });

      expect(result.current.selectedIds).toEqual(new Set([1]));
    });

    it('取消选中已选中的账号', () => {
      const { result } = renderHook(() => useAccountSelection());

      act(() => {
        result.current.toggleCheckbox(1);
      });

      act(() => {
        result.current.toggleCheckbox(1);
      });

      expect(result.current.selectedIds).toEqual(new Set());
    });

    it('可以添加到现有选择', () => {
      const { result } = renderHook(() => useAccountSelection());

      act(() => {
        result.current.toggleCheckbox(1);
      });

      act(() => {
        result.current.toggleCheckbox(3);
      });

      expect(result.current.selectedIds).toEqual(new Set([1, 3]));
    });
  });

  describe('toggleSelectAll - 全选/全不选', () => {
    it('全选当前页所有账号', () => {
      const { result } = renderHook(() => useAccountSelection());

      act(() => {
        result.current.toggleSelectAll(mockAccounts);
      });

      expect(result.current.selectedIds).toEqual(new Set([1, 2, 3, 4, 5]));
    });

    it('全选后再次点击清空选择', () => {
      const { result } = renderHook(() => useAccountSelection());

      act(() => {
        result.current.toggleSelectAll(mockAccounts);
      });

      act(() => {
        result.current.toggleSelectAll(mockAccounts);
      });

      expect(result.current.selectedIds).toEqual(new Set());
    });

    it('部分选中时点击全选', () => {
      const { result } = renderHook(() => useAccountSelection());

      act(() => {
        result.current.toggleCheckbox(1);
      });

      act(() => {
        result.current.toggleCheckbox(3);
      });

      act(() => {
        result.current.toggleSelectAll(mockAccounts);
      });

      expect(result.current.selectedIds).toEqual(new Set([1, 2, 3, 4, 5]));
    });

    it('空数组时不报错', () => {
      const { result } = renderHook(() => useAccountSelection());

      expect(() => {
        act(() => {
          result.current.toggleSelectAll([]);
        });
      }).not.toThrow();

      expect(result.current.selectedIds).toEqual(new Set());
    });

    it('只切换当前页，不影响其他页已选中项', () => {
      const { result } = renderHook(() => useAccountSelection());

      // 模拟其他分页已选中的账号
      act(() => {
        result.current.toggleCheckbox(99);
      });

      // 全选当前页
      act(() => {
        result.current.toggleSelectAll(mockAccounts);
      });

      expect(result.current.selectedIds).toEqual(new Set([99, 1, 2, 3, 4, 5]));

      // 再次点击仅取消当前页，保留其他页
      act(() => {
        result.current.toggleSelectAll(mockAccounts);
      });

      expect(result.current.selectedIds).toEqual(new Set([99]));
    });
  });

  describe('跨分页全选与结果裁剪', () => {
    it('selectAllCurrentResult 可一键选中当前结果全部账号', () => {
      const { result } = renderHook(() => useAccountSelection());

      act(() => {
        result.current.toggleCheckbox(1);
      });

      act(() => {
        result.current.selectAllCurrentResult([1, 2, 3, 4, 5, 6, 7, 8]);
      });

      expect(result.current.selectedIds).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8]));
    });

    it('keepOnlyCurrentResultIds 会清理不在当前结果中的残留 ID', () => {
      const { result } = renderHook(() => useAccountSelection());

      act(() => {
        result.current.selectAllCurrentResult([1, 2, 3, 4, 5]);
      });

      act(() => {
        result.current.keepOnlyCurrentResultIds([2, 4]);
      });

      expect(result.current.selectedIds).toEqual(new Set([2, 4]));
    });
  });

  describe('clearSelection - 清空选择', () => {
    it('清空所有选择', () => {
      const { result } = renderHook(() => useAccountSelection());

      // 先选中几个账号（每次 act 独立调用）
      act(() => {
        result.current.toggleCheckbox(1);
      });

      act(() => {
        result.current.toggleCheckbox(3);
      });

      act(() => {
        result.current.toggleCheckbox(5);
      });

      expect(result.current.selectedIds).toEqual(new Set([1, 3, 5]));

      act(() => {
        result.current.clearSelection();
      });

      expect(result.current.selectedIds).toEqual(new Set());
    });

    it('空选择时调用不报错', () => {
      const { result } = renderHook(() => useAccountSelection());

      expect(() => {
        act(() => {
          result.current.clearSelection();
        });
      }).not.toThrow();

      expect(result.current.selectedIds).toEqual(new Set());
    });
  });

  describe('边界情况', () => {
    it('处理不存在的账号 ID', () => {
      const { result } = renderHook(() => useAccountSelection());
      const mockEvent = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false, target: {} };

      expect(() => {
        act(() => {
          result.current.handleRowMouseDown(mockEvent, 999, mockAccounts, null);
        });
      }).not.toThrow();
    });

    it('空账号列表时操作不报错', () => {
      const { result } = renderHook(() => useAccountSelection());
      const mockEvent = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false, target: {} };

      expect(() => {
        act(() => {
          result.current.handleRowMouseDown(mockEvent, 1, [], null);
        });
      }).not.toThrow();
    });

    it('单个账号列表的范围选择', () => {
      const { result } = renderHook(() => useAccountSelection());
      const singleAccount = [{ id: 1, email: 'test@gmail.com' }];
      const normalEvent = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false, target: {} };
      const shiftEvent = { button: 0, ctrlKey: false, metaKey: false, shiftKey: true, target: {} };

      act(() => {
        result.current.handleRowMouseDown(normalEvent, 1, singleAccount, null);
      });

      act(() => {
        result.current.handleRowMouseDown(shiftEvent, 1, singleAccount, null);
      });

      expect(result.current.selectedIds).toEqual(new Set([1]));
    });
  });
});
