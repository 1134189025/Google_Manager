import { act, render, renderHook, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import useAppUpdater, { AUTO_CHECK_DELAY_MS, SKIPPED_VERSION_KEY } from '../hooks/useAppUpdater';
import UpdateDialog from '../components/UpdateDialog';
import api from '../services/api';

vi.mock('../services/api', () => ({
    default: { createBackup: vi.fn() },
}));

const buildUpdate = (overrides = {}) => ({
    version: '0.3.1',
    currentVersion: '0.3.0',
    body: '修复导出\n新增在线更新',
    date: '2026-11-10T00:00:00Z',
    downloadAndInstall: vi.fn(async (onEvent) => {
        onEvent({ event: 'Started', data: { contentLength: 200 } });
        onEvent({ event: 'Progress', data: { chunkLength: 50 } });
        onEvent({ event: 'Progress', data: { chunkLength: 150 } });
        onEvent({ event: 'Finished' });
    }),
    ...overrides,
});

const flush = () => act(async () => {});

describe('useAppUpdater', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.mocked(check).mockReset().mockResolvedValue(null);
        vi.mocked(relaunch).mockReset().mockResolvedValue(undefined);
        vi.mocked(api.createBackup).mockReset().mockResolvedValue({ success: true, data: '/x.db' });
        localStorage.clear();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('启动后延迟自动检查，有新版本时弹窗', async () => {
        vi.mocked(check).mockResolvedValue(buildUpdate());
        const { result } = renderHook(() => useAppUpdater());

        expect(check).not.toHaveBeenCalled();
        await act(async () => { vi.advanceTimersByTime(AUTO_CHECK_DELAY_MS); });
        await flush();

        expect(check).toHaveBeenCalledTimes(1);
        expect(result.current.status).toBe('available');
        expect(result.current.open).toBe(true);
        expect(result.current.version).toBe('0.3.1');
        expect(result.current.notes).toContain('新增在线更新');
        expect(result.current.hasUpdate).toBe(true);
    });

    it('自动检查失败或已是最新时不打扰用户', async () => {
        vi.mocked(check).mockRejectedValue(new Error('network'));
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { result } = renderHook(() => useAppUpdater());
        await act(async () => { vi.advanceTimersByTime(AUTO_CHECK_DELAY_MS); });
        await flush();

        expect(result.current.open).toBe(false);
        expect(result.current.status).toBe('idle');
    });

    it('跳过的版本自动检查时不弹窗，手动检查仍会显示', async () => {
        localStorage.setItem(SKIPPED_VERSION_KEY, '0.3.1');
        vi.mocked(check).mockResolvedValue(buildUpdate());
        const { result } = renderHook(() => useAppUpdater());
        await act(async () => { vi.advanceTimersByTime(AUTO_CHECK_DELAY_MS); });
        await flush();
        expect(result.current.open).toBe(false);
        expect(result.current.hasUpdate).toBe(true);

        await act(async () => { await result.current.checkNow(); });
        expect(result.current.open).toBe(true);
        expect(result.current.status).toBe('available');
    });

    it('手动检查：已是最新 / 失败时都给出结果', async () => {
        const { result } = renderHook(() => useAppUpdater({ autoCheck: false }));
        await act(async () => { await result.current.checkNow(); });
        expect(result.current.status).toBe('upToDate');
        expect(result.current.open).toBe(true);

        vi.mocked(check).mockRejectedValue(new Error('timeout'));
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        await act(async () => { await result.current.checkNow(); });
        expect(result.current.status).toBe('error');
        expect(result.current.error).toBe('检查更新失败：timeout');
    });

    it('立即更新：先备份，再下载安装并重启', async () => {
        const update = buildUpdate();
        vi.mocked(check).mockResolvedValue(update);
        const { result } = renderHook(() => useAppUpdater({ autoCheck: false }));
        await act(async () => { await result.current.checkNow(); });

        await act(async () => { await result.current.install(); });

        expect(api.createBackup).toHaveBeenCalledWith('before_update');
        expect(update.downloadAndInstall).toHaveBeenCalled();
        expect(vi.mocked(api.createBackup).mock.invocationCallOrder[0])
            .toBeLessThan(update.downloadAndInstall.mock.invocationCallOrder[0]);
        expect(relaunch).toHaveBeenCalled();
        expect(result.current.status).toBe('installing');
        expect(result.current.progress).toBe(1);
    });

    it('备份失败时不安装并显示原因', async () => {
        const update = buildUpdate();
        vi.mocked(check).mockResolvedValue(update);
        vi.mocked(api.createBackup).mockResolvedValue({ success: false, message: '磁盘已满' });
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { result } = renderHook(() => useAppUpdater({ autoCheck: false }));
        await act(async () => { await result.current.checkNow(); });
        await act(async () => { await result.current.install(); });

        expect(update.downloadAndInstall).not.toHaveBeenCalled();
        expect(result.current.status).toBe('error');
        expect(result.current.error).toBe('更新失败：更新前备份失败：磁盘已满');
    });

    it('跳过此版本会记住版本号并关闭', async () => {
        vi.mocked(check).mockResolvedValue(buildUpdate());
        const { result } = renderHook(() => useAppUpdater({ autoCheck: false }));
        await act(async () => { await result.current.checkNow(); });
        act(() => { result.current.skipVersion(); });

        expect(localStorage.getItem(SKIPPED_VERSION_KEY)).toBe('0.3.1');
        expect(result.current.open).toBe(false);
        expect(result.current.hasUpdate).toBe(false);
    });
});

describe('UpdateDialog', () => {
    const baseUpdater = (overrides = {}) => ({
        open: true,
        status: 'available',
        version: '0.3.1',
        currentVersion: '0.3.0',
        notes: '修复导出',
        progress: null,
        error: '',
        install: vi.fn(),
        dismiss: vi.fn(),
        skipVersion: vi.fn(),
        checkNow: vi.fn(),
        ...overrides,
    });

    it('有新版本：显示版本与说明，按钮触发对应操作', () => {
        const updater = baseUpdater();
        render(<UpdateDialog updater={updater} />);

        expect(screen.getByText('发现新版本 v0.3.1')).toBeInTheDocument();
        expect(screen.getByText('当前版本 v0.3.0，最新版本 v0.3.1。')).toBeInTheDocument();
        expect(screen.getByLabelText('更新说明')).toHaveTextContent('修复导出');

        fireEvent.click(screen.getByRole('button', { name: '立即更新' }));
        fireEvent.click(screen.getByRole('button', { name: '稍后' }));
        fireEvent.click(screen.getByRole('button', { name: '跳过此版本' }));
        expect(updater.install).toHaveBeenCalled();
        expect(updater.dismiss).toHaveBeenCalled();
        expect(updater.skipVersion).toHaveBeenCalled();
    });

    it('下载中显示进度且不能关闭', () => {
        render(<UpdateDialog updater={baseUpdater({ status: 'downloading', progress: 0.42 })} />);
        expect(screen.getByText('正在下载 42%')).toBeInTheDocument();
        expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
        expect(screen.queryByRole('button', { name: '关闭' })).not.toBeInTheDocument();
    });

    it('出错时显示原因与手动下载地址，可重试', () => {
        const updater = baseUpdater({ status: 'error', version: '', error: '检查更新失败：timeout' });
        render(<UpdateDialog updater={updater} />);
        expect(screen.getByText('检查更新失败：timeout')).toBeInTheDocument();
        expect(screen.getByText(/releases\/latest/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '重试' }));
        expect(updater.checkNow).toHaveBeenCalled();
    });

    it('已是最新', () => {
        render(<UpdateDialog updater={baseUpdater({ status: 'upToDate', version: '' })} />);
        expect(screen.getByText('当前已是最新版本。')).toBeInTheDocument();
    });

    it('关闭状态不渲染', () => {
        render(<UpdateDialog updater={baseUpdater({ open: false })} />);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
});
