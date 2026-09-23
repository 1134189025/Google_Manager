import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * 账号独立浏览器的配置目录状态轮询
 *
 * - 只查当前页账号（一次批量请求），默认 3 秒一轮
 * - 页面隐藏时暂停，恢复可见时立即刷新一次
 * - 状态表以原始邮箱为键：none / created / running
 */
const DEFAULT_INTERVAL_MS = 3000;

const sameStatuses = (a, b) => {
    const aKeys = Object.keys(a);
    if (aKeys.length !== Object.keys(b).length) return false;
    return aKeys.every(key => a[key] === b[key]);
};

const useBrowserStatus = ({
    accounts = [],
    getBrowserStatuses,
    intervalMs = DEFAULT_INTERVAL_MS,
    enabled = true,
} = {}) => {
    const [statuses, setStatuses] = useState({});

    const emailsKey = useMemo(
        () => (accounts || []).map(account => account?.email).filter(Boolean).join('\n'),
        [accounts]
    );

    const emailsRef = useRef([]);
    const fetcherRef = useRef(getBrowserStatuses);
    const requestIdRef = useRef(0);
    const inFlightRef = useRef(false);
    const visibleRef = useRef(true);
    const mountedRef = useRef(true);

    emailsRef.current = emailsKey ? emailsKey.split('\n') : [];
    fetcherRef.current = getBrowserStatuses;

    /** 立即查询一次；较新的请求会让较早的响应作废 */
    const refresh = useCallback(async () => {
        const emails = emailsRef.current;
        const fetcher = fetcherRef.current;
        if (emails.length === 0 || typeof fetcher !== 'function') return null;

        const requestId = ++requestIdRef.current;
        inFlightRef.current = true;
        try {
            const result = await fetcher(emails);
            if (!mountedRef.current || requestId !== requestIdRef.current) return null;
            if (result?.success && result.data) {
                setStatuses(prev => (sameStatuses(prev, result.data) ? prev : result.data));
            }
            return result?.data ?? null;
        } catch (error) {
            console.error('查询浏览器状态失败:', error);
            return null;
        } finally {
            if (requestId === requestIdRef.current) inFlightRef.current = false;
        }
    }, []);

    // 当前页变化：丢弃旧状态，立即查询并开始轮询
    useEffect(() => {
        if (!enabled || !emailsKey) {
            setStatuses(prev => (Object.keys(prev).length === 0 ? prev : {}));
            return undefined;
        }

        if (visibleRef.current) refresh();
        const timer = setInterval(() => {
            if (!visibleRef.current || inFlightRef.current) return;
            refresh();
        }, Number(intervalMs) > 0 ? Number(intervalMs) : DEFAULT_INTERVAL_MS);

        return () => clearInterval(timer);
    }, [enabled, emailsKey, intervalMs, refresh]);

    useEffect(() => {
        if (typeof document === 'undefined') return undefined;

        visibleRef.current = document.visibilityState !== 'hidden';
        const handleVisibilityChange = () => {
            visibleRef.current = document.visibilityState !== 'hidden';
            if (visibleRef.current) refresh();
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [refresh]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            requestIdRef.current += 1;
        };
    }, []);

    return { browserStatuses: statuses, refresh };
};

export { DEFAULT_INTERVAL_MS };
export default useBrowserStatus;
