import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateSync } from 'otplib';
import useTwoFA from '../hooks/useTwoFA';

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const accounts = [{ id: 1, secret: SECRET }];

describe('useTwoFA 2FA 验证码', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:10Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('生成当前周期的验证码与剩余秒数', () => {
        const { result } = renderHook(() => useTwoFA(accounts));
        expect(result.current.twoFACodes[1].code).toBe(generateSync({ secret: SECRET }));
        expect(result.current.twoFACodes[1].expiry).toBe(20);
    });

    it('同一周期内只更新倒计时', () => {
        const { result } = renderHook(() => useTwoFA(accounts));
        const before = result.current.twoFACodes[1].code;

        act(() => {
            vi.advanceTimersByTime(3000);
        });

        expect(result.current.twoFACodes[1].code).toBe(before);
        expect(result.current.twoFACodes[1].expiry).toBe(17);
    });

    it('错过「剩余 30 秒」那一刻（睡眠唤醒 / 定时器被节流）后仍会换成新验证码', () => {
        const { result } = renderHook(() => useTwoFA(accounts));
        const before = result.current.twoFACodes[1].code;

        // 墙钟前进 45 秒，期间没有任何定时器触发，然后恢复正常 tick
        vi.setSystemTime(new Date('2026-01-01T00:00:55Z'));
        act(() => {
            vi.advanceTimersByTime(1000);
        });

        const expected = generateSync({ secret: SECRET });
        expect(expected).not.toBe(before);
        expect(result.current.twoFACodes[1].code).toBe(expected);
        expect(result.current.twoFACodes[1].expiry).toBe(4);
    });

    it('窗口恢复可见时立即重算，不等下一次定时器', () => {
        const { result } = renderHook(() => useTwoFA(accounts));

        vi.setSystemTime(new Date('2026-01-01T00:00:55Z'));
        act(() => {
            document.dispatchEvent(new Event('visibilitychange'));
        });

        expect(result.current.twoFACodes[1].code).toBe(generateSync({ secret: SECRET }));
        expect(result.current.twoFACodes[1].expiry).toBe(5);
    });

    it('无效密钥不生成验证码', () => {
        const invalidAccounts = [{ id: 2, secret: 'not-base32!' }];
        const { result } = renderHook(() => useTwoFA(invalidAccounts));
        expect(result.current.twoFACodes[2]).toBeUndefined();
    });
});
