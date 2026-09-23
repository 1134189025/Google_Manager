import { renderHook, act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useBrowserStatus from '../hooks/useBrowserStatus';

const accounts = [
    { id: 1, email: 'a@gmail.com' },
    { id: 2, email: 'rec_b@gmail.com' },
];

const ok = (data) => ({ success: true, data });

let visibility = 'visible';
const setVisibility = (state) => {
    visibility = state;
    document.dispatchEvent(new Event('visibilitychange'));
};

describe('useBrowserStatus 状态轮询', () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        visibility = 'visible';
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => visibility,
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('当前页账号一次批量查询，状态以原始邮箱为键', async () => {
        const fetcher = vi.fn().mockResolvedValue(ok({ 'a@gmail.com': 'running', 'rec_b@gmail.com': 'none' }));
        const { result } = renderHook(() => useBrowserStatus({ accounts, getBrowserStatuses: fetcher }));

        await waitFor(() => {
            expect(result.current.browserStatuses['a@gmail.com']).toBe('running');
        });
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fetcher).toHaveBeenCalledWith(['a@gmail.com', 'rec_b@gmail.com']);
        expect(result.current.browserStatuses['rec_b@gmail.com']).toBe('none');
    });

    it('没有账号时不发请求', async () => {
        const fetcher = vi.fn().mockResolvedValue(ok({}));
        renderHook(() => useBrowserStatus({ accounts: [], getBrowserStatuses: fetcher }));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(7000);
        });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('按间隔轮询；页面隐藏时暂停，恢复可见立即刷新', async () => {
        const fetcher = vi.fn().mockResolvedValue(ok({ 'a@gmail.com': 'created' }));
        renderHook(() => useBrowserStatus({ accounts, getBrowserStatuses: fetcher, intervalMs: 3000 }));

        await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

        await act(async () => {
            await vi.advanceTimersByTimeAsync(3100);
        });
        expect(fetcher).toHaveBeenCalledTimes(2);

        act(() => setVisibility('hidden'));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(9000);
        });
        expect(fetcher).toHaveBeenCalledTimes(2);

        act(() => setVisibility('visible'));
        await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    });

    it('refresh 立即查询，较早返回的旧响应被丢弃', async () => {
        let resolveFirst;
        const fetcher = vi.fn()
            .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
            .mockResolvedValueOnce(ok({ 'a@gmail.com': 'running' }));

        const { result } = renderHook(() => useBrowserStatus({ accounts, getBrowserStatuses: fetcher }));
        await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

        await act(async () => {
            await result.current.refresh();
        });
        expect(result.current.browserStatuses['a@gmail.com']).toBe('running');

        await act(async () => {
            resolveFirst(ok({ 'a@gmail.com': 'none' }));
            await Promise.resolve();
        });
        expect(result.current.browserStatuses['a@gmail.com']).toBe('running');
    });

    it('查询失败时保留原状态', async () => {
        const fetcher = vi.fn()
            .mockResolvedValueOnce(ok({ 'a@gmail.com': 'created' }))
            .mockResolvedValueOnce({ success: false, data: {}, message: 'boom' });

        const { result } = renderHook(() => useBrowserStatus({ accounts, getBrowserStatuses: fetcher }));
        await waitFor(() => expect(result.current.browserStatuses['a@gmail.com']).toBe('created'));

        await act(async () => {
            await result.current.refresh();
        });
        expect(result.current.browserStatuses['a@gmail.com']).toBe('created');
    });
});
