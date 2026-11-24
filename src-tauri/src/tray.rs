use std::sync::atomic::{AtomicBool, Ordering};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, CloseRequestApi, Emitter, Manager, Runtime, Window};

use crate::database::{self, Database};

pub const SETTING_WINDOW_CLOSE_BEHAVIOR: &str = "window.close_behavior";
pub const TRAY_ID: &str = "main-tray";
pub const MENU_SHOW_ID: &str = "tray_show_main";
pub const MENU_QUIT_ID: &str = "tray_quit_app";
pub const EVENT_WINDOW_CLOSE_REQUESTED: &str = "window-close-requested";

pub const CLOSE_BEHAVIOR_ASK: &str = "ask";
pub const CLOSE_BEHAVIOR_MINIMIZE: &str = "minimize";
pub const CLOSE_BEHAVIOR_QUIT: &str = "quit";

/// 记录应用是否已获准真正退出，避免 `app.exit(0)` 被 `CloseRequested` 再次拦截
pub struct AppCloseState {
    allow_exit: AtomicBool,
}

impl AppCloseState {
    pub fn new() -> Self {
        Self {
            allow_exit: AtomicBool::new(false),
        }
    }

    pub fn allow_exit(&self) {
        self.allow_exit.store(true, Ordering::SeqCst);
    }

    pub fn is_exit_allowed(&self) -> bool {
        self.allow_exit.load(Ordering::SeqCst)
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct WindowCloseSettings {
    pub close_behavior: String,
}

pub fn normalize_close_behavior(raw: Option<&str>) -> String {
    match raw.map(|s| s.trim().to_ascii_lowercase()).as_deref() {
        Some(CLOSE_BEHAVIOR_MINIMIZE) => CLOSE_BEHAVIOR_MINIMIZE.to_string(),
        Some(CLOSE_BEHAVIOR_QUIT) => CLOSE_BEHAVIOR_QUIT.to_string(),
        _ => CLOSE_BEHAVIOR_ASK.to_string(),
    }
}

pub fn validate_close_behavior(raw: &str) -> Result<String, String> {
    match raw.trim().to_ascii_lowercase().as_str() {
        CLOSE_BEHAVIOR_ASK => Ok(CLOSE_BEHAVIOR_ASK.to_string()),
        CLOSE_BEHAVIOR_MINIMIZE => Ok(CLOSE_BEHAVIOR_MINIMIZE.to_string()),
        CLOSE_BEHAVIOR_QUIT => Ok(CLOSE_BEHAVIOR_QUIT.to_string()),
        _ => Err("不支持的关闭行为，仅允许 ask / minimize / quit".to_string()),
    }
}

pub fn get_window_close_settings(conn: &Connection) -> Result<WindowCloseSettings, String> {
    let raw = database::get_setting(conn, SETTING_WINDOW_CLOSE_BEHAVIOR)?;
    Ok(WindowCloseSettings {
        close_behavior: normalize_close_behavior(raw.as_deref()),
    })
}

pub fn save_window_close_settings(
    conn: &Connection,
    behavior: &str,
) -> Result<WindowCloseSettings, String> {
    let normalized = validate_close_behavior(behavior)?;
    database::set_setting(conn, SETTING_WINDOW_CLOSE_BEHAVIOR, Some(&normalized))?;
    Ok(WindowCloseSettings {
        close_behavior: normalized,
    })
}

pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn hide_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

pub fn quit_app<R: Runtime>(app: &AppHandle<R>) {
    if let Some(state) = app.try_state::<AppCloseState>() {
        state.allow_exit();
    }
    app.exit(0);
}

/// 初始化系统托盘图标与右键菜单（Windows 左键点击直接恢复主窗口，右键打开菜单）
pub fn setup_tray<R: Runtime>(app: &AppHandle<R>) -> Result<(), tauri::Error> {
    let show_item = MenuItem::with_id(app, MENU_SHOW_ID, "显示主窗口", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, MENU_QUIT_ID, "退出 GoogleManager", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &separator, &quit_item])?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("GoogleManager · 个人数字资产工作区")
        .menu(&menu)
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_SHOW_ID => show_main_window(app),
            MENU_QUIT_ID => quit_app(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            }
            | TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } => {
                if !cfg!(target_os = "macos") {
                    show_main_window(tray.app_handle());
                }
            }
            _ => {}
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

/// 拦截主窗口关闭事件：根据用户偏好决定直接最小化到托盘、直接退出，或弹窗询问
pub fn handle_window_close_requested(window: &Window, api: &CloseRequestApi) {
    if window.label() != "main" {
        return;
    }

    let app = window.app_handle();
    if let Some(state) = app.try_state::<AppCloseState>() {
        if state.is_exit_allowed() {
            return;
        }
    }

    let behavior = app
        .try_state::<Database>()
        .and_then(|db| {
            let conn = db.0.lock().ok()?;
            get_window_close_settings(&conn).ok()
        })
        .map(|s| s.close_behavior)
        .unwrap_or_else(|| CLOSE_BEHAVIOR_ASK.to_string());

    match behavior.as_str() {
        CLOSE_BEHAVIOR_MINIMIZE => {
            api.prevent_close();
            let _ = window.hide();
        }
        CLOSE_BEHAVIOR_QUIT => {
            quit_app(app);
        }
        _ => {
            api.prevent_close();
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
            let _ = window.emit(EVENT_WINDOW_CLOSE_REQUESTED, ());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_window_close_settings_validation_and_persistence() {
        assert_eq!(normalize_close_behavior(None), "ask");
        assert_eq!(normalize_close_behavior(Some("MINIMIZE")), "minimize");
        assert_eq!(normalize_close_behavior(Some("quit")), "quit");
        assert_eq!(normalize_close_behavior(Some("invalid")), "ask");

        assert!(validate_close_behavior("ask").is_ok());
        assert!(validate_close_behavior("minimize").is_ok());
        assert!(validate_close_behavior("quit").is_ok());
        assert!(validate_close_behavior("destroy").is_err());

        let tmp = tempfile::tempdir().unwrap();
        let conn = database::init_database_at_for_test(
            &tmp.path().join("data.db"),
            &tmp.path().join("backups"),
        )
        .unwrap();

        let initial = get_window_close_settings(&conn).unwrap();
        assert_eq!(initial.close_behavior, "ask");

        let saved = save_window_close_settings(&conn, "minimize").unwrap();
        assert_eq!(saved.close_behavior, "minimize");
        assert_eq!(
            get_window_close_settings(&conn).unwrap().close_behavior,
            "minimize"
        );

        let reset = save_window_close_settings(&conn, "ask").unwrap();
        assert_eq!(reset.close_behavior, "ask");
    }
}
