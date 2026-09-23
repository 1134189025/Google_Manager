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
        const remaining = 30 - (now % 30);

        // 如果即将过期（剩余 < 5 秒），强制重新生成
        const forceRegenerate = remaining < 5;

        const newCodes = {};
        accountsList.forEach(acc => {
            if (!acc.secret) return;
            const cleanSecret = acc.secret.replace(/\s/g, '').toUpperCase();
            // 过滤明显无效的 secret，避免重复报错阻塞
            if (cleanSecret.length < 16 || !/^[A-Z2-7]+$/.test(cleanSecret)) return;

            const cacheKey = `${acc.id}_${cleanSecret}_${Math.floor(now / 30)}`; // 30 秒一个缓存周期

            // 检查缓存
            if (!forceRegenerate && codeCache.current.has(cacheKey)) {
                newCodes[acc.id] = codeCache.current.get(cacheKey);
                return;
            }

            try {
                const code = generateSync({ secret: cleanSecret });
                const result = { code, expiry: remaining };
                newCodes[acc.id] = result;

                // 缓存结果（30 秒有效）
                codeCache.current.set(cacheKey, result);

                // 清理旧缓存（保留最近 100 个）
                if (codeCache.current.size > 100) {
                    const entries = Array.from(codeCache.current.entries());
                    entries.slice(0, 50).forEach(([key]) => {
                        codeCache.current.delete(key);
                    });
                }
            } catch {
                // secret 解析失败时静默跳过，避免每次循环打印错误日志
            }
        });

        return newCodes;
    }, []);

    const generateAll2FACodes = useCallback((accountsList) => {
        setTwoFACodes(generate2FACodes(accountsList));
    }, [generate2FACodes]);

    useEffect(() => {
        if (accounts.length === 0) {
            setTwoFACodes({});
            return;
        }

        // 增量计算：只计算可见页，且仅处理有 secret 的账号
        const accountsToProcess = getAccountsToProcess(accounts).filter(acc => Boolean(acc.secret));
        if (accountsToProcess.length === 0) {
            setTwoFACodes({});
            return;
        }

        generateAll2FACodes(accountsToProcess);

        const timer = setInterval(() => {
            setTwoFACodes(prev => {
                const now = Math.floor(Date.now() / 1000);
                const remaining = 30 - (now % 30);

                // 每 30 秒重新生成一次代码
                if (remaining === 30) {
                    const accountsToRegenerate = getAccountsToProcess(accounts).filter(acc => Boolean(acc.secret));
                    return generate2FACodes(accountsToRegenerate);
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

        return () => clearInterval(timer);
    }, [accounts, generateAll2FACodes, generate2FACodes, getAccountsToProcess]);

    return { twoFACodes, generateAll2FACodes };
};

export default useTwoFA;
