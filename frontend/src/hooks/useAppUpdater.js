import { useCallback, useEffect, useRef, useState } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import api from '../services/api';
import { isTauriRuntime } from '../utils/tauriRuntime';

/** GitHub Releases 页面：检查或下载失败时引导用户手动下载 */
export const RELEASES_URL = 'https://github.com/1134189025/Google_Manager/releases/latest';

/** 启动后多久自动检查（不和首屏加载抢资源） */
export const AUTO_CHECK_DELAY_MS = 3000;

/** 记录「跳过此版本」的本地存储键 */
export const SKIPPED_VERSION_KEY = 'gm.updater.skippedVersion';

const readSkippedVersion = () => {
    try {
        return localStorage.getItem(SKIPPED_VERSION_KEY) || '';
    } catch {
        return '';
    }
};

const errorText = (error) => (error instanceof Error ? error.message : String(error || '未知错误'));

/**
 * 在线更新（GitHub Releases + Tauri updater 插件）
 *
 * status：
 * - idle        未检查 / 已关闭弹窗
 * - checking    检查中（仅手动检查时展示）
 * - available   有新版本，等待用户选择
 * - upToDate    已是最新（仅手动检查时提示）
 * - downloading 下载中，progress 为 0-1（总大小未知时为 null）
 * - installing  下载完成、安装中
 * - error       出错（仅手动检查或用户点了更新后才展示）
 *
 * 自动检查：启动 AUTO_CHECK_DELAY_MS 后检查一次；失败不打扰用户；用户选过「跳过此版本」的版本不再弹窗。
 * 安装前先做一次 before_update 备份；macOS 安装后调用 relaunch 重启，Windows 由安装程序自动重启应用。
 */
const useAppUpdater = ({ autoCheck = true } = {}) => {
    const [state, setState] = useState({
        status: 'idle',
        open: false,
        version: '',
        currentVersion: '',
        notes: '',
        date: '',
        progress: null,
        error: '',
    });
    const updateRef = useRef(null);
    const busyRef = useRef(false);

    const runCheck = useCallback(async ({ manual }) => {
        if (!isTauriRuntime() || busyRef.current) return;
        busyRef.current = true;
        if (manual) setState(prev => ({ ...prev, status: 'checking', open: true, error: '' }));
        try {
            const update = await check();
            if (!update) {
                updateRef.current = null;
                setState(prev => (manual
                    ? { ...prev, status: 'upToDate', open: true, version: '' }
                    : { ...prev, status: 'idle', version: '' }));
                return;
            }
            updateRef.current = update;
            const skipped = !manual && readSkippedVersion() === update.version;
            setState(prev => ({
                ...prev,
                status: 'available',
                open: !skipped,
                version: update.version,
                currentVersion: update.currentVersion || '',
                notes: update.body || '',
                date: update.date || '',
                progress: null,
                error: '',
            }));
        } catch (error) {
            console.warn('检查更新失败:', error);
            setState(prev => (manual
                ? { ...prev, status: 'error', open: true, error: `检查更新失败：${errorText(error)}` }
                : prev));
        } finally {
            busyRef.current = false;
        }
    }, []);

    const checkNow = useCallback(() => runCheck({ manual: true }), [runCheck]);

    useEffect(() => {
        if (!autoCheck || !isTauriRuntime()) return undefined;
        const timer = setTimeout(() => runCheck({ manual: false }), AUTO_CHECK_DELAY_MS);
        return () => clearTimeout(timer);
    }, [autoCheck, runCheck]);

    const install = useCallback(async () => {
        const update = updateRef.current;
        if (!update || busyRef.current) return;
        busyRef.current = true;
        setState(prev => ({ ...prev, status: 'downloading', progress: 0, error: '' }));
        try {
            const backup = await api.createBackup('before_update');
            if (!backup?.success) {
                throw new Error(`更新前备份失败：${backup?.message || '未知错误'}`);
            }

            let total = 0;
            let received = 0;
            await update.downloadAndInstall((event) => {
                if (event.event === 'Started') {
                    total = Number(event.data?.contentLength) || 0;
                    setState(prev => ({ ...prev, progress: total ? 0 : null }));
                } else if (event.event === 'Progress') {
                    received += Number(event.data?.chunkLength) || 0;
                    if (total) setState(prev => ({ ...prev, progress: Math.min(received / total, 1) }));
                } else if (event.event === 'Finished') {
                    setState(prev => ({ ...prev, status: 'installing', progress: 1 }));
                }
            });

            setState(prev => ({ ...prev, status: 'installing', progress: 1 }));
            await relaunch();
        } catch (error) {
            console.error('安装更新失败:', error);
            setState(prev => ({ ...prev, status: 'error', error: `更新失败：${errorText(error)}` }));
        } finally {
            busyRef.current = false;
        }
    }, []);

    const dismiss = useCallback(() => {
        setState(prev => ({
            ...prev,
            open: false,
            // 还有可用更新时保留 available，侧栏继续显示提示点
            status: updateRef.current ? 'available' : 'idle',
            error: '',
        }));
    }, []);

    const skipVersion = useCallback(() => {
        try {
            if (state.version) localStorage.setItem(SKIPPED_VERSION_KEY, state.version);
        } catch {
            // 本地存储不可用时只关闭弹窗
        }
        updateRef.current = null;
        setState(prev => ({ ...prev, open: false, status: 'idle' }));
    }, [state.version]);

    return {
        ...state,
        hasUpdate: Boolean(state.version) && ['available', 'downloading', 'installing', 'error'].includes(state.status),
        checkNow,
        install,
        dismiss,
        skipVersion,
    };
};

export default useAppUpdater;
