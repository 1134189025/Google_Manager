/**
 * 确认框 / 提示框
 *
 * 不要直接用 `window.confirm` / `window.prompt`：
 * - Tauri 的对话框插件会把 `window.confirm` 换成**异步**版本（返回 Promise），
 *   `if (!window.confirm(...))` 拿到的 Promise 永远为真，用户还没选就继续执行了；
 * - macOS 的 WebView（WKWebView）没有实现 `window.prompt`，调用直接返回 null。
 *
 * 桌面环境用对话框插件的系统原生对话框；非桌面环境（单元测试、直接用浏览器打开前端）
 * 退回浏览器原生实现。输入框请用 `components/PromptDialog.jsx`。
 */
import { ask, message } from '@tauri-apps/plugin-dialog';
import { isTauriRuntime } from './tauriRuntime';

const APP_TITLE = 'Google 账号管理器';

/**
 * 确认框，返回用户是否点了确定
 * @param {string} text
 * @param {{ title?: string, kind?: 'info' | 'warning' | 'error', okLabel?: string, cancelLabel?: string }} [options]
 * @returns {Promise<boolean>}
 */
export const confirmDialog = async (text, options = {}) => {
    const { title = APP_TITLE, kind = 'warning', okLabel = '确定', cancelLabel = '取消' } = options;
    if (isTauriRuntime()) {
        return Boolean(await ask(text, { title, kind, okLabel, cancelLabel }));
    }
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
        return Boolean(await window.confirm(text));
    }
    return true;
};

/**
 * 提示框（等待用户关闭）
 * @param {string} text
 * @param {{ title?: string, kind?: 'info' | 'warning' | 'error' }} [options]
 * @returns {Promise<void>}
 */
export const messageDialog = async (text, options = {}) => {
    const { title = APP_TITLE, kind = 'info' } = options;
    if (isTauriRuntime()) {
        await message(text, { title, kind });
        return;
    }
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert(text);
    }
};
