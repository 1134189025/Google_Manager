mod app_paths;
mod browser;
mod commands;
mod database;
mod sms;
mod totp;

pub use database::{init_database, Database};

use std::sync::Mutex;

/// 启动桌面应用（自用版：无 HTTP 服务、无登录、无加密）
pub fn run() {
    let conn = init_database().expect("Failed to initialize database");
    if let Err(e) = database::create_backup(&conn, Some("startup")) {
        log::warn!("启动自动备份失败: {}", e);
    }
    let db = Database(Mutex::new(conn));

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(db)
        .manage(sms::SmsService::new())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_accounts,
            commands::create_account,
            commands::update_account,
            commands::delete_account,
            commands::delete_all_accounts,
            commands::get_deleted_accounts,
            commands::restore_account,
            commands::purge_account,
            commands::purge_all_deleted,
            commands::create_backup,
            commands::list_backups,
            commands::restore_backup,
            commands::toggle_status,
            commands::get_account_history,
            commands::get_account_by_id,
            commands::generate_totp,
            commands::batch_import,
            commands::export_accounts_text,
            commands::fetch_sms_code,
            commands::open_account_browser,
            commands::get_browser_statuses,
            commands::clear_browser_cache,
            commands::delete_browser_profiles,
            commands::get_browser_settings,
            commands::save_browser_settings,
            commands::get_browser_usage,
            commands::open_browser_profile_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
