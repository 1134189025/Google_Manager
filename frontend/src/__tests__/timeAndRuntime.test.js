import { afterEach, describe, expect, it } from 'vitest';
import { formatDbTimestamp } from '../utils/timeUtils';
import { isTauriRuntime } from '../utils/tauriRuntime';

const pad = (value) => String(value).padStart(2, '0');
const expectedLocal = (utcMs) => {
    const date = new Date(utcMs);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
        + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

describe('formatDbTimestamp 数据库时间换算', () => {
    it('把 SQLite 写入的 UTC 时间换算成本机时间', () => {
        expect(formatDbTimestamp('2026-01-01 16:30:05'))
            .toBe(expectedLocal(Date.UTC(2026, 0, 1, 16, 30, 5)));
    });

    it('也接受 T 分隔的同类格式', () => {
        expect(formatDbTimestamp('2026-01-01T16:30:05'))
            .toBe(expectedLocal(Date.UTC(2026, 0, 1, 16, 30, 5)));
    });

    it('空值返回空串，其他格式原样返回', () => {
        expect(formatDbTimestamp(null)).toBe('');
        expect(formatDbTimestamp('  ')).toBe('');
        expect(formatDbTimestamp('2024-01-01')).toBe('2024-01-01');
        expect(formatDbTimestamp('昨天')).toBe('昨天');
    });
});

describe('isTauriRuntime 桌面环境检测', () => {
    const original = {
        internals: window.__TAURI_INTERNALS__,
        isTauri: window.isTauri,
        globalTauri: window.__TAURI__,
    };

    afterEach(() => {
        window.__TAURI_INTERNALS__ = original.internals;
        window.isTauri = original.isTauri;
        window.__TAURI__ = original.globalTauri;
    });

    it('Tauri 2 总会注入的 __TAURI_INTERNALS__ 即可判定为桌面环境', () => {
        window.__TAURI__ = undefined;
        window.__TAURI_INTERNALS__ = {};
        expect(isTauriRuntime()).toBe(true);
    });

    it('isTauri 标记同样可以判定', () => {
        window.__TAURI_INTERNALS__ = undefined;
        window.isTauri = true;
        expect(isTauriRuntime()).toBe(true);
    });

    it('都没有时判定为非桌面环境', () => {
        window.__TAURI_INTERNALS__ = undefined;
        window.isTauri = undefined;
        expect(isTauriRuntime()).toBe(false);
    });
});
