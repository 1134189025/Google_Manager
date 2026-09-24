/**
 * 是否运行在 Tauri 桌面进程内
 *
 * 不能用 `window.__TAURI__` 判断：它只在 tauri.conf.json 开启 `app.withGlobalTauri` 时才注入，
 * 本项目没有开启。`__TAURI_INTERNALS__` 是 invoke 依赖的内部对象，Tauri 2 总会注入；
 * `isTauri` 是较新版本额外提供的标记，两者任一存在即可。
 */
export const isTauriRuntime = () => (
    typeof window !== 'undefined'
    && Boolean(window.__TAURI_INTERNALS__ || window.isTauri)
);
