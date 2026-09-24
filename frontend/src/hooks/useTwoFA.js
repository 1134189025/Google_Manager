import { useState, useEffect, useCallback, useRef } from 'react';
import { generateSync } from 'otplib';

/**
 * 2FA 验证码管理 Hook
 * 隔离每秒定时器，避免触发父组件重渲染
 *
 * @param {Array} accounts - 所有账号列表
 * @param {Array} visibleAccountIds - 当前可见页的账号 ID 列表（用于增量计算）
 */
const useTwoFA = (accounts, visibleAccountIds = null) => {
    const [twoFACodes, setTwoFACodes] = useState({});
    const codeCache = useRef(new Map()); // 缓存 30 秒内的计算结果

    const getAccountsToProcess = useCallback((accountList) => {
        if (!Array.isArray(visibleAccountIds)) {
            return accountList;
        }
        const visibleIdSet = new Set(visibleAccountIds);
        return accountList.filter(acc => visibleIdSet.has(acc.id));
    }, [visibleAccountIds]);

    const generate2FACodes = useCallback((accountsList) => {
        const now = Math.floor(Date.now() / 1000);
        const period = Math.floor(now / 30);
        const remaining = 30 - (now % 30);

        const newCodes = {};
        accountsList.forEach(acc => {
            if (!acc.secret) return;
            const cleanSecret = acc.secret.replace(/\s/g, '').toUpperCase();
            // 过滤明显无效的 secret，避免重复报错阻塞
            if (cleanSecret.length < 16 || !/^[A-Z2-7]+$/.test(cleanSecret)) return;

            const cacheKey = `${acc.id}_${cleanSecret}_${period}`; // 30 秒一个缓存周期

            let code = codeCache.current.get(cacheKey);
            if (code === undefined) {
                try {
                    code = generateSync({ secret: cleanSecret });
                } catch {
                    // secret 解析失败时静默跳过，避免每次循环打印错误日志
                    return;
                }
                codeCache.current.set(cacheKey, code);

                // 清理旧缓存（保留最近 100 个）
                if (codeCache.current.size > 100) {
                    const keys = Array.from(codeCache.current.keys());
                    keys.slice(0, 50).forEach(key => codeCache.current.delete(key));
                }
            }

            // period 记录验证码所属的 30 秒周期，定时器据此判断是否过期
            newCodes[acc.id] = { code, expiry: remaining, period };
        });

        return newCodes;
    }, []);

    const generateAll2FACodes = useCallback((accountsList) => {
        const next = generate2FACodes(accountsList);
        // 结果为空时沿用原对象，避免无意义的重渲染
        setTwoFACodes(prev => (Object.keys(next).length === 0 && Object.keys(prev).length === 0 ? prev : next));
    }, [generate2FACodes]);

    useEffect(() => {
        const clearCodes = () => setTwoFACodes(prev => (Object.keys(prev).length === 0 ? prev : {}));
        if (accounts.length === 0) {
            clearCodes();
            return;
        }

        // 增量计算：只计算可见页，且仅处理有 secret 的账号
        const accountsToProcess = getAccountsToProcess(accounts).filter(acc => Boolean(acc.secret));
        if (accountsToProcess.length === 0) {
            clearCodes();
            return;
        }

        generateAll2FACodes(accountsToProcess);

        const timer = setInterval(() => {
            setTwoFACodes(prev => {
                const now = Math.floor(Date.now() / 1000);
                const period = Math.floor(now / 30);
                const remaining = 30 - (now % 30);

                // 只要有验证码不属于当前 30 秒周期就整体重算。
                // 不能只在「剩余 30 秒」那一刻判断：电脑睡眠唤醒、窗口最小化导致定时器被节流、
                // 或某一秒被跳过时都会错过这一刻，界面会继续显示已过期的验证码
                if (Object.values(prev).some(info => info.period !== period)) {
                    return generate2FACodes(getAccountsToProcess(accounts).filter(acc => Boolean(acc.secret)));
                }

                // 仅更新过期时间，不重新计算代码
                const updated = {};
                let changed = false;
                for (const id in prev) {
                    if (prev[id].expiry !== remaining) {
                        updated[id] = { ...prev[id], expiry: remaining };
                        changed = true;
                    } else {
                        updated[id] = prev[id];
                    }
                }
                return changed ? updated : prev;
            });
        }, 1000);

        // 窗口恢复可见时立即重算，不等下一次定时器
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') return;
            generateAll2FACodes(getAccountsToProcess(accounts).filter(acc => Boolean(acc.secret)));
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            clearInterval(timer);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [accounts, generateAll2FACodes, generate2FACodes, getAccountsToProcess]);

    return { twoFACodes, generateAll2FACodes };
};

export default useTwoFA;
