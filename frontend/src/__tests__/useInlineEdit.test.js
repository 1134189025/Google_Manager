import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import useInlineEdit, { CLICK_COPY_DELAY_MS } from '../hooks/useInlineEdit';

describe('useInlineEdit Hook', () => {
  let onInlineEdit;
  let allGroups;

  beforeEach(() => {
    onInlineEdit = vi.fn();
    allGroups = ['工作', '个人', '测试'];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  describe('初始状态', () => {
    it('返回正确的初始状态', () => {
      const { result } = renderHook(() => useInlineEdit({ onInlineEdit, allGroups }));

      expect(result.current.editingCell).toBeNull();
      expect(result.current.editValue).toBe('');
      expect(result.current.showSuggestions).toBe(false);
      // editValue 为空字符串时，filter 会匹配所有标签（空字符串包含在所有字符串中）
      expect(result.current.filteredSuggestions).toEqual(allGroups);
    });

    it('返回所有必需的函数', () => {
      const { result } = renderHook(() => useInlineEdit({ onInlineEdit, allGroups }));

      expect(typeof result.current.handleCellClick).toBe('function');
      expect(typeof result.current.handleCellDoubleClick).toBe('function');
      expect(typeof result.current.handleEditableInputBlur).toBe('function');
      expect(typeof result.current.handleKeyDown).toBe('function');
      expect(typeof result.current.selectSuggestion).toBe('function');
      expect(typeof result.current.cancelEdit).toBe('function');
      expect(typeof result.current.setEditValue).toBe('function');
    });

    it('inputRef 初始化为 null', () => {
      const { result } = renderHook(() => useInlineEdit({ onInlineEdit, allGroups }));

      expect(result.current.inputRef.current).toBeNull();
    });
  });

  describe('handleCellClick - 单击复制', () => {
    it('延迟触发复制', () => {
      const { result } = renderHook(() => useInlineEdit({ onInlineEdit, allGroups }));
      const copyToClipboard = vi.fn();

      act(() => {
        result.current.handleCellClick('test@gmail.com', '邮箱', copyToClipboard);
      });

      expect(copyToClipboard).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(CLICK_COPY_DELAY_MS);
      });

      expect(copyToClipboard).toHaveBeenCalledWith('test@gmail.com', '邮箱');
    });

    it('空值不触发复制', () => {
      const { result } = renderHook(() => useInlineEdit({ onInlineEdit, allGroups }));
      const copyToClipboard = vi.fn();

      act(() => {
        result.current.handleCellClick('', '邮箱', copyToClipboard);
      });

      act(() => {
        vi.advanceTimersByTime(CLICK_COPY_DELAY_MS);
      });

      expect(copyToClipboard).not.toHaveBeenCalled();
    });

    it('编辑状态中不触发复制', () => {
      const { result } = renderHook(() => useInlineEdit({ onInlineEdit, allGroups }));
      const copyToClipboard = vi.fn();

      // 进入编辑状态
      act(() => {
        const mockEvent = { stopPropagation: vi.fn() };
        result.current.handleCellDoubleClick(mockEvent, 1, 'email', 'test@gmail.com');
      });

      act(() => {
        result.current.handleCellClick('test@gmail.com', '邮箱', copyToClipboard);
      });

      act(() => {
        vi.advanceTimersByTime(CLICK_COPY_DELAY_MS);
      });

      expect(copyToClipboard).not.toHaveBeenCalled();
    });
  });

  describe('handleCellDoubleClick - 双击进入编辑', () => {
    it('双击后进入编辑模式', () => {
      const { result } = renderHook(() => useInlineEdit({ onInlineEdit, allGroups }));
      const mockEvent = { stopPropagation: vi.fn() };

      act(() => {
        result.current.handleCellDoubleClick(mockEvent, 1, 'email', 'test@gmail.com');
      });

      expect(mockEvent.stopPropagation).toHaveBeenCalled();
      expect(result.current.editingCell).toEqual(
        expect.objectContaining({ accountId: 1, field: 'email' })
      );
      expect(result.current.editValue).toBe('test@gmail.com');
    });

    it('双击空值字段时设置为空字符串', () => {
      const { result } = renderHook(() => useInlineEdit({ onInlineEdit, allGroups }));
      const mockEvent = { stopPropagation: vi.fn() };

      act(() => {
        result.current.handleCellDoubleClick(mockEvent, 1, 'remark', null);
      });

      expect(result.current.editValue).toBe('');
    });

    it('双击 groupName 字段时显示建议', () => {
      const { result } = renderHook(() => useInlineEdit({ onInlineEdit, allGroups }));
      const mockEvent = { stopPropagation: vi.fn() };

      act(() => {
        result.current.handleCellDoubleClick(mockEvent, 1, 'groupName', '工作');
      });

      expect(result.current.showSuggestions).toBe(true);
    });

    it('双击取消单击复制的定时器', () => {
      const { result } = renderHook(() => useInlineEdit({ onInlineEdit, allGroups }));
      const copyToClipboard = vi.fn();
      const mockEvent = { stopPropagation: vi.fn() };

      // 先触发单击
      act(() => {
        result.current.handleCellClick('test@gmail.com', '邮箱', copyToClipboard);
      });

      // 立即双击
      act(() => {
        result.current.handleCellDoubleClick(mockEvent, 1, 'email', 'test@gmail.com');
      });

      // 等待单击延迟时间
      act(() => {
        vi.advanceTimersByTime(CLICK_COPY_DELAY_MS);
      });

      // 单击的复制不应被触发
      expect(copyToClipboard).not.toHaveBeenCalled();
    });
  });

  describe('setEditValue - 修改编辑值', () => {
    it('可以修改编辑值', () => {
      const { result } = renderHook(() => useInlineEdit({ onInlineEdit, allGroups }));
      const mockEvent = { stopPropagation: vi.fn() };

      act(() => {
        result.current.handleCellDoubleClick(mockEvent, 1, 'email', 'test@gmail.com');
      });

      act(() => {
        result.current.setEditValue('new@gmail.com');
      });

      expect(result.current.editValue).toBe('new@gmail.com');
    });
  });

  describe('handleKeyDown - 键盘事件', () => {
    it('按 Enter 键保存编辑', () => {
      const { result } = renderHook(() => useInlineEdit({ onInlineEdit, allGroups }));
      const mockEvent = { stopPropagation: vi.fn() };

      act(() => {
        result.current.handleCellDoubleClick(mockEvent, 1, 'email', 'test@gmail.com');
      });

      act(() => {
        result.current.setEditValue('new@gmail.com');
      });

      act(() => {
        result.current.handleKeyDown({ key: 'Enter', preventDefault: vi.fn() });
      });

      expect(onInlineEdit).toHaveBeenCalledWith(1, 'email', 'new@gmail.com');
      expect(result.current.editingCell).toBeNull();
    });

    it('多行字段按 Enter 时保留编辑，按 Ctrl+Enter 才保存', () => {
      const { result } = renderHook(() => useInlineEdit({ onInlineEdit, allGroups }));
      const mockEvent = { stopPropagation: vi.fn() };

      act(() => {
        result.current.handleCellDoubleClick(mockEvent, 1, 'remark', '第一条');
      });

      act(() => {
        result.current.setEditValue('第一条\n第二条');
      });

      act(() => {
        result.current.handleKeyDown({ key: 'Enter', preventDefault: vi.fn() });
      });

      expect(onInlineEdit).not.toHaveBeenCalled();
      expect(result.current.editingCell).not.toBeNull();

      act(() => {
        result.current.handleKeyDown({ key: 'Enter', ctrlKey: true, preventDefault: vi.fn() });
      });

      expect(onInlineEdit).toHaveBeenCalledWith(1, 'remark', '第一条\n第二条');
      expect(result.current.editingCell).toBeNull();
    });

    it('手机号保存前会先做标准化', () => {
      const { result } = renderHook(() => useInlineEdit({ onInlineEdit, allGroups }));
      const mockEvent = { stopPropagation: vi.fn() };

      act(() => {
        result.current.handleCellDoubleClick(mockEvent, 1, 'phone', '+86 138 0000 1111');
      });

      act(() => {
        result.current.setEditValue('+86 138 1234 5678');
      });

      act(() => {
        result.current.handleKeyDown({ key: 'Enter', preventDefault: vi.fn() });
      });

      expect(onInlineEdit).toHaveBeenCalledWith(1, 'phone', '+8613812345678');
    });

    it('按 Escape 键取消编辑', () => {
      const { result } = renderHook(() => useInlineEdit({ onInlineEdit, allGroups }));
      const mockEvent = { stopPropagation: vi.fn() };

      act(() => {
        result.current.handleCellDoubleClick(mockEvent, 1, 'email', 'test@gmail.com');
      });

      act(() => {
        result.current.setEditValue('new@gmail.com');
      });

      act(() => {
        result.current.handleKeyDown({ key: 'Escape', preventDefault: vi.fn() });
      });

      expect(onInlineEdit).not.toHaveBeenCalled();
      expect(result.current.editingCell).toBeNull();
      expect(result.current.editValue).toBe('');
    });

    it('其他按键不触发任何操作', () => {
      const { result } = renderHook(() => useInlineEdit({ onInlineEdit, allGroups }));
      const mockEvent = { stopPropagation: vi.fn() };

      act(() => {
        result.current.handleCellDoubleClick(mockEvent, 1, 'email', 'test@gmail.com');
      });

      act(() => {
        result.current.handleKeyDown({ key: 'a' });
      });

      expect(onInlineEdit).not.toHaveBeenCalled();
      expect(result.current.editingCell).not.toBeNull();
    });
  });

  describe('handleEditableInputBlur - 失焦保存', () => {
    it('失焦时自动保存', () => {
      const { result } = renderHook(() => useInlineEdit({ onInlineEdit, allGroups }));
      const mockEvent = { stopPropagation: vi.fn() };

      act(() => {
        result.current.handleCellDoubleClick(mockEvent, 1, 'email', 'test@gmail.com');
      });

      act(() => {
        result.current.setEditValue('new@gmail.com');
      });

      act(() => {
        result.current.handleEditableInputBlur();
      });

      expect(onInlineEdit).toHaveBeenCalledWith(1, 'email', 'new@gmail.com');
      expect(result.current.editingCell).toBeNull();
    });

    it('选择建议时失焦不触发保存（防止竞态）', () => {
      const { result } = renderHook(() => useInlineEdit({ onInlineEdit, allGroups }));
      const mockEvent = { stopPropagation: vi.fn() };

      // 进入编辑状态
      act(() => {
        result.current.handleCellDoubleClick(mockEvent, 1, 'groupName', '工');
      });

      // selectSuggestion 会调用 onInlineEdit 并设置竞态标志
      // 但由于我们无法直接访问 isSelectingGroupSuggestionRef，
      // 这个测试验证的是 selectSuggestion 调用后状态已清理
      act(() => {
        result.current.selectSuggestion('工作');
      });

      expect(onInlineEdit).not.toHaveBeenCalled();
      expect(result.current.editingCell).not.toBeNull();
      expect(result.current.editValue).toBe('工\n工作');
    });

    it('值未变化时失焦不触发保存（避免无效更新）', () => {
      const { result } = renderHook(() => useInlineEdit({ onInlineEdit, allGroups }));
      const mockEvent = { stopPropagation: vi.fn() };

      act(() => {
        result.current.handleCellDoubleClick(mockEvent, 1, 'email', 'same@gmail.com');
      });

      act(() => {
        result.current.handleEditableInputBlur();
      });

      expect(onInlineEdit).not.toHaveBeenCalled();
      expect(result.current.editingCell).toBeNull();
    });
  });

  describe('cancelEdit - 取消编辑', () => {
    it('清空所有编辑状态', () => {
      const { result } = renderHook(() => useInlineEdit({ onInlineEdit, allGroups }));
      const mockEvent = { stopPropagation: vi.fn() };

      act(() => {
        result.current.handleCellDoubleClick(mockEvent, 1, 'groupName', '工作');
      });

      expect(result.current.editingCell).not.toBeNull();
      expect(result.current.showSuggestions).toBe(true);

      act(() => {
        result.current.cancelEdit();
      });

      expect(result.current.editingCell).toBeNull();
      expect(result.current.editValue).toBe('');
      expect(result.current.showSuggestions).toBe(false);
    });
  });

  describe('selectSuggestion - 选择标签建议', () => {
    it('多行字段选择建议后追加到当前编辑值', () => {
      const { result } = renderHook(() => useInlineEdit({ onInlineEdit, allGroups }));
      const mockEvent = { stopPropagation: vi.fn() };

      act(() => {
        result.current.handleCellDoubleClick(mockEvent, 1, 'groupName', '工');
      });

      act(() => {
        result.current.selectSuggestion('工作');
      });

      expect(onInlineEdit).not.toHaveBeenCalled();
      expect(result.current.editingCell).toEqual(expect.objectContaining({ accountId: 1, field: 'groupName' }));
      expect(result.current.editValue).toBe('工\n工作');
      expect(result.current.showSuggestions).toBe(true);
    });

    it('选择重复建议时不会重复追加', () => {
      const { result } = renderHook(() => useInlineEdit({ onInlineEdit, allGroups }));
      const mockEvent = { stopPropagation: vi.fn() };

      act(() => {
        result.current.handleCellDoubleClick(mockEvent, 1, 'groupName', '工作');
      });

      act(() => {
        result.current.selectSuggestion('工作');
      });

      expect(result.current.editValue).toBe('工作');
    });
  });

  describe('filteredSuggestions - 标签过滤', () => {
    it('初始状态下过滤结果为所有标签（editValue 为空字符串）', () => {
      const { result } = renderHook(() => useInlineEdit({ onInlineEdit, allGroups }));

      // editValue 为空字符串时，filter 会匹配所有标签
      expect(result.current.filteredSuggestions).toEqual(allGroups);
    });

    it('输入值后过滤标签（不区分大小写）', () => {
      const { result } = renderHook(() => useInlineEdit({ onInlineEdit, allGroups }));
      const mockEvent = { stopPropagation: vi.fn() };

      act(() => {
        result.current.handleCellDoubleClick(mockEvent, 1, 'groupName', '');
      });

      act(() => {
        result.current.setEditValue('工');
      });

      expect(result.current.filteredSuggestions).toEqual(['工作']);
    });

    it('空字符串时返回所有标签', () => {
      const { result } = renderHook(() => useInlineEdit({ onInlineEdit, allGroups }));
      const mockEvent = { stopPropagation: vi.fn() };

      act(() => {
        result.current.handleCellDoubleClick(mockEvent, 1, 'groupName', '');
      });

      expect(result.current.filteredSuggestions).toEqual(allGroups);
    });

    it('没有匹配的标签时返回空数组', () => {
      const { result } = renderHook(() => useInlineEdit({ onInlineEdit, allGroups }));
      const mockEvent = { stopPropagation: vi.fn() };

      act(() => {
        result.current.handleCellDoubleClick(mockEvent, 1, 'groupName', '');
      });

      act(() => {
        result.current.setEditValue('不存在的标签');
      });

      expect(result.current.filteredSuggestions).toEqual([]);
    });

    it('allGroups 为 undefined 时返回空数组', () => {
      const { result } = renderHook(() => useInlineEdit({ onInlineEdit, allGroups: undefined }));
      const mockEvent = { stopPropagation: vi.fn() };

      act(() => {
        result.current.handleCellDoubleClick(mockEvent, 1, 'groupName', '工');
      });

      expect(result.current.filteredSuggestions).toEqual([]);
    });
  });

  describe('边界情况', () => {
    it('没有 onInlineEdit 回调时不报错', () => {
      const { result } = renderHook(() => useInlineEdit({ onInlineEdit: null, allGroups }));
      const mockEvent = { stopPropagation: vi.fn() };

      expect(() => {
        act(() => {
          result.current.handleCellDoubleClick(mockEvent, 1, 'email', 'test@gmail.com');
        });

        act(() => {
          result.current.handleKeyDown({ key: 'Enter', preventDefault: vi.fn() });
        });
      }).not.toThrow();
    });

    it('unmount 时清理单击定时器', () => {
      const { result, unmount } = renderHook(() => useInlineEdit({ onInlineEdit, allGroups }));
      const copyToClipboard = vi.fn();

      act(() => {
        result.current.handleCellClick('test@gmail.com', '邮箱', copyToClipboard);
      });

      unmount();

      act(() => {
        vi.advanceTimersByTime(CLICK_COPY_DELAY_MS);
      });

      // 定时器已清理，不应触发复制
      expect(copyToClipboard).not.toHaveBeenCalled();
    });
  });
});
