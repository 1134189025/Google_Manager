import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * 手机短信验证码管理 Hook
 *
 * 设计要点：
 * - 只轮询「当前页 + 已配置接码地址」的账号，不请求整库；
 * - 每 1 秒 tick 一次，按各账号自己的 nextRefreshAt 决定是否发起请求；
 * - 账号越多，单账号周期自动拉长（最少 5 秒），把整体请求速率压在约 1 次/秒，
 *   避免一页上百个账号把对方接码服务打满；
 * - 并发最多 3 个，同一账号不重叠请求，同一链接在后端还有去重；
 * - 失败按 10/20/40/60 秒退避；链接失效（NO|...）暂停自动重试，需手动刷新；
 * - 页面隐藏/最小化时暂停调度，恢复可见时立即刷新一次；
 * - 配置（手机号/接码地址）变更、账号离开当前页时提升「代次」，
 *   迟到的响应会被丢弃，旧号码的验证码不会串到新配置上；
 * - 短信验证码只存在于内存，不写数据库、不写账号历史。
 */

const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_MAX_CONCURRENT = 3;
// 失败退避（毫秒），按连续失败次数递增
const BACKOFF_STEPS_MS = [10000, 20000, 40000, 60000];
// 自动暂停自动重试的状态：链接失效/未配置
const PAUSED_STATUSES = new Set(['invalid_link', 'no_config']);

const normalizeSmsUrl = (value) => String(value || '').trim();

const getSmsUrl = (account) => normalizeSmsUrl(account?.smsUrl);

const buildConfigKey = (account) => `${account?.id}::${getSmsUrl(account)}`;

const buildInitialEntry = (configKey) => ({
    configKey,
    status: 'loading',
    code: null,
    message: null,
    error: null,
    fetchedAt: null,
    loading: true,
    stale: false,
    autoPaused: false,
    failureStreak: 0,
    nextRefreshAt: 0,
    secondsLeft: 0,
});

const isSameEntry = (a, b) => {
    if (!a || !b) return false;
    return a.status === b.status
        && a.code === b.code
        && a.message === b.message
        && a.error === b.error
        && a.fetchedAt === b.fetchedAt
        && a.configKey === b.configKey
        && a.loading === b.loading
        && a.stale === b.stale
        && a.autoPaused === b.autoPaused
        && a.secondsLeft === b.secondsLeft;
};

const secondsUntil = (target, now) => {
    if (!target) return 0;
    return Math.max(0, Math.ceil((target - now) / 1000));
};

/**
 * @param {Object} options
 * @param {Array} options.accounts - 当前页账号列表（只这一页会被请求）
 * @param {(accountId: number) => Promise<Object>} options.fetchSmsCode - 取码方法
 * @param {number} [options.intervalMs] - 单账号最小刷新周期（毫秒）
 * @param {number} [options.maxConcurrent] - 并发上限
 * @param {boolean} [options.enabled] - 是否启用轮询
 */
const useSmsCodes = ({
    accounts = [],
    fetchSmsCode,
    intervalMs = DEFAULT_INTERVAL_MS,
    maxConcurrent = DEFAULT_MAX_CONCURRENT,
    enabled = true,
} = {}) => {
    const [entries, setEntries] = useState({});

    // 调度状态放在 ref 里同步读写，避免「响应已到、state 还没提交」时重复发请求
    const scheduleRef = useRef(new Map());
    const accountsRef = useRef([]);
    const inFlightRef = useRef(new Set());
    const generationRef = useRef(new Map());
    const trackedKeyRef = useRef(new Map());
    const mountedRef = useRef(true);
    const visibleRef = useRef(true);

    const fetcherRef = useRef(fetchSmsCode);
    const intervalRef = useRef(intervalMs);
    const concurrentRef = useRef(maxConcurrent);
    const enabledRef = useRef(enabled);
    const effectiveIntervalRef = useRef(intervalMs);
    const tickRef = useRef(null);

    fetcherRef.current = fetchSmsCode;
    intervalRef.current = Number(intervalMs) > 0 ? Number(intervalMs) : DEFAULT_INTERVAL_MS;
    concurrentRef.current = Math.max(1, Number(maxConcurrent) || DEFAULT_MAX_CONCURRENT);
    enabledRef.current = enabled;

    const accountsKey = useMemo(
        () => (accounts || []).map(account => buildConfigKey(account)).join('|'),
        [accounts]
    );

    const updateEntry = useCallback((accountId, updater) => {
        setEntries(prev => {
            const current = prev[accountId];
            const next = typeof updater === 'function' ? updater(current) : updater;
            if (!next) {
                if (!current) return prev;
                const copy = { ...prev };
                delete copy[accountId];
                return copy;
            }
            if (isSameEntry(current, next)) return prev;
            return { ...prev, [accountId]: next };
        });
    }, []);

    /** 发起一次取码请求；调用方负责时机判断 */
    const requestFetch = useCallback(async (account) => {
        const accountId = account?.id;
        if (accountId === undefined || accountId === null || !getSmsUrl(account)) return null;

        const fetcher = fetcherRef.current;
        if (typeof fetcher !== 'function') return null;
        if (inFlightRef.current.has(accountId)) return null;
        if (inFlightRef.current.size >= concurrentRef.current) return null;

        const configKey = buildConfigKey(account);
        const generation = generationRef.current.get(accountId) || 0;
        const schedule = scheduleRef.current.get(accountId) || { configKey, nextRefreshAt: 0, failureStreak: 0 };

        inFlightRef.current.add(accountId);
        scheduleRef.current.set(accountId, { ...schedule, configKey, loading: true, autoPaused: false });
        updateEntry(accountId, current => (
            current && current.configKey === configKey
                ? { ...current, loading: true }
                : buildInitialEntry(configKey)
        ));

        /**
         * 记一次失败：按连续失败次数退避（服务端给了 Retry-After 时取较长者），
         * 保留上一次的验证码但标记为 stale，界面必须显示为「上次获取」
         */
        const recordFailure = (errorMessage, retryAfterMs = 0) => {
            const now = Date.now();
            const failureStreak = (schedule.failureStreak || 0) + 1;
            const backoff = BACKOFF_STEPS_MS[Math.min(failureStreak - 1, BACKOFF_STEPS_MS.length - 1)];
            const nextRefreshAt = now + Math.max(backoff, retryAfterMs);

            scheduleRef.current.set(accountId, {
                configKey,
                failureStreak,
                loading: false,
                autoPaused: false,
                nextRefreshAt,
            });

            updateEntry(accountId, current => {
                const base = current && current.configKey === configKey ? current : buildInitialEntry(configKey);
                return {
                    ...base,
                    configKey,
                    status: 'error',
                    code: base.code || null,
                    stale: Boolean(base.code),
                    error: errorMessage,
                    loading: false,
                    autoPaused: false,
                    failureStreak,
                    nextRefreshAt,
                    secondsLeft: secondsUntil(nextRefreshAt, now),
                };
            });
        };

        try {
            const result = await fetcher(accountId);

            // 账号已离开当前页 / 配置已变 / 组件已卸载 → 丢弃迟到结果
            if (!mountedRef.current || (generationRef.current.get(accountId) || 0) !== generation) {
                return null;
            }

            // api 门面返回 { success, data }；直接返回结果对象时也能用
            const payload = result && typeof result === 'object' && 'data' in result && result.data
                ? result.data
                : result;

            const status = String(payload?.status || 'error');
            // 服务端要求退避时优先遵守（防止把对方接口打爆）
            const retryAfterMs = Number(payload?.retryAfterSeconds) > 0
                ? Number(payload.retryAfterSeconds) * 1000
                : 0;

            // api 门面不会抛异常：网络错误、后端报错都以 status=error 正常返回，
            // 因此失败必须在这里识别，否则退避与「上次」标记都不会生效
            if (status === 'error') {
                recordFailure(
                    String(payload?.error || payload?.message || result?.message || '获取失败'),
                    retryAfterMs
                );
                return result;
            }

            const code = payload?.code ? String(payload.code) : null;
            const autoPaused = PAUSED_STATUSES.has(status);
            const now = Date.now();
            const waitMs = Math.max(effectiveIntervalRef.current, retryAfterMs);
            const nextRefreshAt = autoPaused ? 0 : now + waitMs;

            scheduleRef.current.set(accountId, {
                configKey,
                failureStreak: 0,
                loading: false,
                autoPaused,
                nextRefreshAt,
            });

            updateEntry(accountId, current => {
                const base = current && current.configKey === configKey ? current : buildInitialEntry(configKey);
                return {
                    ...base,
                    configKey,
                    status,
                    code,
                    message: payload?.message ? String(payload.message) : null,
                    error: payload?.error ? String(payload.error) : null,
                    fetchedAt: payload?.fetchedAt ? String(payload.fetchedAt) : new Date(now).toISOString(),
                    loading: false,
                    stale: false,
                    autoPaused,
                    failureStreak: 0,
                    nextRefreshAt,
                    secondsLeft: autoPaused ? 0 : secondsUntil(nextRefreshAt, now),
                };
            });

            return result;
        } catch (error) {
            if (!mountedRef.current || (generationRef.current.get(accountId) || 0) !== generation) {
                return null;
            }

            recordFailure(error instanceof Error ? error.message : String(error || '获取失败'));
            return null;
        } finally {
            inFlightRef.current.delete(accountId);
        }
    }, [updateEntry]);

    /** 每秒调度：补发到期请求 + 刷新倒计时 */
    const tick = useCallback(() => {
        if (!enabledRef.current) return;

        const now = Date.now();
        const tracked = (accountsRef.current || []).filter(account => getSmsUrl(account));

        // 账号越多，单账号周期越长：整体不超过约 1 次/秒
        effectiveIntervalRef.current = Math.max(intervalRef.current, tracked.length * 1000);

        for (const account of tracked) {
            if (inFlightRef.current.size >= concurrentRef.current) break;

            const schedule = scheduleRef.current.get(account.id);
            if (schedule) {
                if (schedule.loading) continue;
                if (schedule.autoPaused) continue;
                if (schedule.nextRefreshAt && now < schedule.nextRefreshAt) continue;
            }

            void requestFetch(account);
        }

        setEntries(prev => {
            let changed = false;
            const next = {};
            for (const [key, value] of Object.entries(prev)) {
                const remaining = (value.autoPaused || value.loading)
                    ? 0
                    : secondsUntil(value.nextRefreshAt, now);
                if (value.secondsLeft === remaining) {
                    next[key] = value;
                    continue;
                }
                next[key] = { ...value, secondsLeft: remaining };
                changed = true;
            }
            return changed ? next : prev;
        });
    }, [requestFetch]);

    tickRef.current = tick;

    // 账号或配置变化：提升变更账号的代次，丢弃不再跟踪的条目
    useEffect(() => {
        accountsRef.current = accounts || [];

        const trackedAccounts = (accounts || []).filter(account => getSmsUrl(account));
        const trackedIds = new Set(trackedAccounts.map(account => account.id));

        // 离开当前页 / 清空接码地址的账号
        for (const accountId of Array.from(trackedKeyRef.current.keys())) {
            if (!trackedIds.has(accountId)) {
                generationRef.current.set(accountId, (generationRef.current.get(accountId) || 0) + 1);
                trackedKeyRef.current.delete(accountId);
                scheduleRef.current.delete(accountId);
            }
        }

        // 配置发生变化的账号（换号或换链接）
        for (const account of trackedAccounts) {
            const key = buildConfigKey(account);
            const previousKey = trackedKeyRef.current.get(account.id);
            if (previousKey !== undefined && previousKey !== key) {
                generationRef.current.set(account.id, (generationRef.current.get(account.id) || 0) + 1);
                scheduleRef.current.delete(account.id);
            }
            trackedKeyRef.current.set(account.id, key);
        }

        setEntries(prev => {
            let changed = false;
            const next = {};
            for (const [key, value] of Object.entries(prev)) {
                const accountId = Number(key);
                if (!trackedIds.has(accountId) || trackedKeyRef.current.get(accountId) !== value.configKey) {
                    changed = true;
                    continue;
                }
                next[key] = value;
            }
            return changed ? next : prev;
        });
    }, [accountsKey, accounts]);

    // 主循环：账号集合变化时重建（先立刻跑一次，不等 1 秒）
    useEffect(() => {
        if (!enabled) return undefined;

        if (visibleRef.current) tickRef.current?.();
        const timer = setInterval(() => {
            if (!visibleRef.current) return;
            tickRef.current?.();
        }, 1000);

        return () => clearInterval(timer);
    }, [enabled, accountsKey]);

    // 页面隐藏时暂停；恢复可见时清除等待，立即刷新一次
    useEffect(() => {
        if (typeof document === 'undefined') return undefined;

        visibleRef.current = document.visibilityState !== 'hidden';

        const handleVisibilityChange = () => {
            const isVisible = document.visibilityState !== 'hidden';
            visibleRef.current = isVisible;
            if (!isVisible) return;

            for (const [accountId, schedule] of Array.from(scheduleRef.current.entries())) {
                if (schedule.autoPaused) continue;
                scheduleRef.current.set(accountId, { ...schedule, nextRefreshAt: 0 });
            }
            tickRef.current?.();
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, []);

    // 卸载：让所有在途响应失效
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            for (const accountId of Array.from(trackedKeyRef.current.keys())) {
                generationRef.current.set(accountId, (generationRef.current.get(accountId) || 0) + 1);
            }
            trackedKeyRef.current.clear();
            scheduleRef.current.clear();
            inFlightRef.current.clear();
        };
    }, []);

    /** 手动刷新单个账号：解除暂停并立即取码 */
    const refresh = useCallback((accountId) => {
        const account = (accountsRef.current || []).find(item => Number(item.id) === Number(accountId));
        if (!account || !getSmsUrl(account)) return Promise.resolve(null);

        scheduleRef.current.set(accountId, {
            configKey: buildConfigKey(account),
            failureStreak: 0,
            loading: false,
            autoPaused: false,
            nextRefreshAt: 0,
        });

        return requestFetch(account);
    }, [requestFetch]);

    /** 清空某个账号的运行时状态 */
    const reset = useCallback((accountId) => {
        generationRef.current.set(accountId, (generationRef.current.get(accountId) || 0) + 1);
        scheduleRef.current.delete(accountId);
        updateEntry(accountId, null);
    }, [updateEntry]);

    return { smsCodes: entries, refresh, reset };
};

export { DEFAULT_INTERVAL_MS, DEFAULT_MAX_CONCURRENT, PAUSED_STATUSES };
export default useSmsCodes;
