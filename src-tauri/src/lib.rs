mod agent;
mod ai_quota;
mod app_paths;
mod asset_commands;
mod assets_db;
mod browser;
mod cloudflare;
mod commands;
mod database;
mod domain_probe;
mod fx;
mod sms;
mod ssh_client;
mod totp;
mod tray;

pub use database::{init_database, Database};

use std::sync::Mutex;

/// 启动桌面应用（自用版：无 HTTP 服务、无登录、无加密）
pub fn run() {
    let conn = init_database().expect("Failed to initialize database");
    if let Err(e) = database::create_backup(&conn, Some("startup")) {
        log::warn!("启动自动备份失败: {}", e);
    }
    let db = Database(Mutex::new(conn));

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // 在线更新：从 GitHub Releases 的 latest.json 检查新版本，安装包须带签名（公钥在 tauri.conf.json）
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(db)
        .manage(sms::SmsService::new())
        .manage(ai_quota::AiOAuthManager::new())
        .manage(ssh_client::SshSessionManager::new())
        .manage(agent::AgentStreamManager::new())
        .manage(tray::AppCloseState::new())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            if let Err(err) = tray::setup_tray(app.handle()) {
                log::warn!("初始化系统托盘失败: {}", err);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                tray::handle_window_close_requested(window, api);
            }
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
            commands::export_accounts_to_file,
            commands::fetch_sms_code,
            commands::open_account_browser,
            commands::get_browser_statuses,
            commands::clear_browser_cache,
            commands::delete_browser_profiles,
            commands::get_browser_settings,
            commands::save_browser_settings,
            commands::get_browser_usage,
            commands::open_browser_profile_dir,
            asset_commands::get_workspace_overview,
            asset_commands::get_usd_cny_rate,
            asset_commands::get_renewals_summary,
            asset_commands::advance_renewal,
            asset_commands::get_reminders,
            asset_commands::create_reminder,
            asset_commands::update_reminder,
            asset_commands::delete_reminder,
            asset_commands::complete_reminder,
            asset_commands::write_text_file,
            asset_commands::read_text_file,
            asset_commands::open_external_url,
            asset_commands::get_vault_folders,
            asset_commands::create_vault_folder,
            asset_commands::update_vault_folder,
            asset_commands::delete_vault_folder,
            asset_commands::get_vault_items,
            asset_commands::create_vault_item,
            asset_commands::update_vault_item,
            asset_commands::delete_vault_item,
            asset_commands::batch_import_vault_items,
            asset_commands::get_payment_cards,
            asset_commands::create_payment_card,
            asset_commands::update_payment_card,
            asset_commands::delete_payment_card,
            asset_commands::get_domains,
            asset_commands::create_domain,
            asset_commands::update_domain,
            asset_commands::delete_domain,
            asset_commands::probe_domain,
            asset_commands::get_cloudflare_connections,
            asset_commands::save_cloudflare_connection,
            asset_commands::delete_cloudflare_connection,
            asset_commands::list_cloudflare_zones,
            asset_commands::import_cloudflare_zones,
            asset_commands::list_domain_dns_records,
            asset_commands::apply_domain_dns_record,
            asset_commands::get_ai_subscriptions,
            asset_commands::create_ai_subscription,
            asset_commands::update_ai_subscription,
            asset_commands::delete_ai_subscription,
            asset_commands::get_gemini_oauth_config,
            asset_commands::save_gemini_oauth_config,
            asset_commands::start_ai_oauth,
            asset_commands::get_ai_oauth_status,
            asset_commands::complete_ai_oauth,
            asset_commands::cancel_ai_oauth,
            asset_commands::disconnect_ai_oauth,
            asset_commands::refresh_ai_subscription_quota,
            asset_commands::read_antigravity_cli_quota,
            asset_commands::get_servers,
            asset_commands::create_server,
            asset_commands::update_server,
            asset_commands::delete_server,
            asset_commands::probe_server,
            asset_commands::reset_server_host_fingerprint,
            asset_commands::get_app_monitor_settings,
            asset_commands::save_app_monitor_settings,
            asset_commands::ssh_open_session,
            asset_commands::ssh_write_session,
            asset_commands::ssh_resize_session,
            asset_commands::ssh_close_session,
            asset_commands::ssh_list_sessions,
            asset_commands::sftp_list_dir,
            asset_commands::sftp_download_file,
            asset_commands::sftp_upload_file,
            asset_commands::sftp_mkdir,
            asset_commands::sftp_remove,
            asset_commands::get_agent_settings,
            asset_commands::save_agent_settings,
            asset_commands::test_agent_connection,
            asset_commands::get_agent_messages,
            asset_commands::clear_agent_messages,
            asset_commands::send_agent_message,
            asset_commands::cancel_agent_stream,
            asset_commands::apply_agent_proposal,
            asset_commands::reject_agent_proposal,
            asset_commands::get_window_close_settings,
            asset_commands::save_window_close_settings,
            asset_commands::handle_window_close,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = event {
            tray::show_main_window(app_handle);
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (app_handle, event);
    });
}
