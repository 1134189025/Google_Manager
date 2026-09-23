import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import usePagination from '../hooks/usePagination';

const buildData = (count) => Array.from({ length: count }, (_, index) => ({
  id: index + 1,
  email: `test${index + 1}@gmail.com`,
}));

describe('usePagination Hook', () => {
  it('默认每页显示 100 条，并返回第一页数据', () => {
    const { result } = renderHook(() => usePagination(buildData(120)));

    expect(result.current.currentPage).toBe(1);
    expect(result.current.pageSize).toBe(100);
    expect(result.current.totalPages).toBe(2);
    expect(result.current.paginatedData).toHaveLength(100);
    expect(result.current.paginatedData[0].id).toBe(1);
    expect(result.current.paginatedData[99].id).toBe(100);
  });

  it('goToPage 会将页码裁剪到有效范围内', () => {
    const { result } = renderHook(() => usePagination(buildData(250)));

    act(() => {
      result.current.goToPage(999);
    });
    expect(result.current.currentPage).toBe(3);

    act(() => {
      result.current.goToPage(0);
    });
    expect(result.current.currentPage).toBe(1);
  });

  it('changePageSize 会重置到第一页', () => {
    const { result } = renderHook(() => usePagination(buildData(250)));

    act(() => {
      result.current.goToPage(3);
    });
    expect(result.current.currentPage).toBe(3);

    act(() => {
      result.current.changePageSize(200);
    });

    expect(result.current.currentPage).toBe(1);
    expect(result.current.pageSize).toBe(200);
    expect(result.current.totalPages).toBe(2);
    expect(result.current.paginatedData).toHaveLength(200);
  });

  it('数据缩小时，当前页会自动回退到有效页', async () => {
    const { result, rerender } = renderHook(
      ({ data }) => usePagination(data),
      { initialProps: { data: buildData(250) } }
    );

    act(() => {
      result.current.goToPage(3);
    });
    expect(result.current.currentPage).toBe(3);

    rerender({ data: buildData(120) });

    await waitFor(() => {
      expect(result.current.currentPage).toBe(2);
    });
    expect(result.current.totalPages).toBe(2);
    expect(result.current.paginatedData).toHaveLength(20);
    expect(result.current.paginatedData[0].id).toBe(101);
  });
});
