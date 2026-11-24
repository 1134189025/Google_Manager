use crate::agent::{
    self, AgentConnectionTestResult, AgentMessageItem, AgentSettingsInput, AgentSettingsView,
    AgentStreamManager,
};
use crate::ai_quota::{
    self, AiOAuthManager, AntigravityQuotaResult, GeminiOAuthConfigInput, GeminiOAuthConfigView,
    OAuthStartInfo, OAuthStatusInfo,
};
use crate::assets_db::{
    self, AiSubscription, AiSubscriptionInput, AppMonitorSettings, CloudflareConnectionInput,
    CloudflareConnectionView, DomainInput, DomainItem, PaymentCard, PaymentCardInput, Reminder,
    ReminderInput, RenewalsSummary, ServerInput, ServerItem, ServerProbeUpdate,
    VaultBatchImportResult, VaultFolder, VaultFolderInput, VaultItem, VaultItemInput,
    WorkspaceOverview,
};
use crate::cloudflare::{CloudflareDnsRecord, CloudflareZone, DnsRecordInput};
use crate::database::Database;
use crate::fx::{self, ExchangeRateInfo};
use crate::ssh_client::{self, SftpDirListing, SshSessionInfo, SshSessionManager};
use std::path::Path;
use tauri::{AppHandle, State};

const MAX_TEXT_FILE_BYTES: usize = 10 * 1024 * 1024;

/// 获取实时 USD -> CNY 汇率（6 小时内复用本地缓存，网络等待期间不持有数据库锁）
#[tauri::command]
pub async fn get_usd_cny_rate(
    db: State<'_, Database>,
    force_refresh: Option<bool>,
) -> Result<ExchangeRateInfo, String> {
    let force = force_refresh.unwrap_or(false);
    let cached = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        fx::read_cached_rate(&conn)
    };

    if !force {
        if let Some(ref info) = cached {
            if fx::is_cache_fresh(info, chrono::Utc::now()) {
                return Ok(info.clone());
            }
        }
    }

    match fx::fetch_live_usd_cny_rate().await {
        Ok((rate, source)) => {
            let fresh = ExchangeRateInfo {
                rate,
                updated_at: chrono::Utc::now().to_rfc3339(),
                source,
                is_fallback: false,
            };
            if let Ok(conn) = db.0.lock() {
                let _ = fx::save_cached_rate(&conn, &fresh);
            }
            Ok(fresh)
        }
        Err(_) => Ok(fx::fallback_rate_info(cached)),
    }
}

#[tauri::command]
pub fn get_workspace_overview(db: State<Database>) -> Result<WorkspaceOverview, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::get_workspace_overview(&conn, assets_db::today_local())
}

#[tauri::command]
pub fn get_renewals_summary(
    db: State<Database>,
    within_days: Option<i64>,
) -> Result<RenewalsSummary, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let days = within_days.unwrap_or(90).clamp(1, 3650);
    assets_db::get_renewals_summary(&conn, days, assets_db::today_local())
}

#[tauri::command]
pub fn advance_renewal(
    db: State<Database>,
    kind: String,
    id: i64,
) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::advance_renewal(&conn, &kind, id)
}

#[tauri::command]
pub fn get_reminders(db: State<Database>) -> Result<Vec<Reminder>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::query_reminders(&conn)
}

#[tauri::command]
pub fn create_reminder(db: State<Database>, reminder: ReminderInput) -> Result<Reminder, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::create_reminder(&conn, &reminder)
}

#[tauri::command]
pub fn update_reminder(
    db: State<Database>,
    id: i64,
    reminder: ReminderInput,
) -> Result<Reminder, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::update_reminder(&conn, id, &reminder)
}

#[tauri::command]
pub fn delete_reminder(db: State<Database>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::delete_reminder(&conn, id)
}

#[tauri::command]
pub fn complete_reminder(db: State<Database>, id: i64) -> Result<Reminder, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::complete_reminder(&conn, id, assets_db::today_local())
}

/// 将前端生成的文本（如 .ics / CSV）直接写入绝对路径文件
#[tauri::command]
pub async fn write_text_file(path: String, content: String) -> Result<String, String> {
    if content.len() > MAX_TEXT_FILE_BYTES {
        return Err("文件内容超过 10 MiB 限制".to_string());
    }
    let trimmed = path.trim().to_string();
    let target = Path::new(&trimmed).to_path_buf();
    if !target.is_absolute() {
        return Err(format!("导出路径必须是绝对路径：{}", target.display()));
    }
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::write(&target, content)
            .map_err(|e| format!("写入文件失败 {}：{}", target.display(), e))?;
        Ok(target.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| format!("后台任务失败: {}", e))?
}

/// 读取用户选中的文本文件（如浏览器导出的密码 CSV，上限 10 MiB）
#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, String> {
    let trimmed = path.trim().to_string();
    let target = Path::new(&trimmed).to_path_buf();
    if !target.is_absolute() {
        return Err(format!("读取路径必须是绝对路径：{}", target.display()));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let meta = std::fs::metadata(&target)
            .map_err(|e| format!("无法访问文件 {}：{}", target.display(), e))?;
        if meta.len() as usize > MAX_TEXT_FILE_BYTES {
            return Err("文件大小不能超过 10 MiB".to_string());
        }
        std::fs::read_to_string(&target)
            .map_err(|e| format!("读取文件失败 {}：{}", target.display(), e))
    })
    .await
    .map_err(|e| format!("后台任务失败: {}", e))?
}

/// 在系统默认浏览器中打开外部 HTTPS 链接（如 OAuth 授权页）
#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if !trimmed.starts_with("https://") {
        return Err("仅允许打开 https:// 开头的安全链接".to_string());
    }
    if trimmed.chars().any(|c| c.is_control()) {
        return Err("链接包含非法控制字符".to_string());
    }
    open_external_url_os(trimmed)
}

#[cfg(target_os = "windows")]
fn open_external_url_os(url: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", url])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("打开系统浏览器失败: {}", e))
}

#[cfg(target_os = "macos")]
fn open_external_url_os(url: &str) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("打开系统浏览器失败: {}", e))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_external_url_os(url: &str) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("打开系统浏览器失败: {}", e))
}

// ─── 账号与密钥库命令 ──────────────────────────────────────────────

#[tauri::command]
pub fn get_vault_folders(db: State<Database>) -> Result<Vec<VaultFolder>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::query_vault_folders(&conn)
}

#[tauri::command]
pub fn create_vault_folder(
    db: State<Database>,
    folder: VaultFolderInput,
) -> Result<VaultFolder, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::create_vault_folder(&conn, &folder)
}

#[tauri::command]
pub fn update_vault_folder(
    db: State<Database>,
    id: i64,
    folder: VaultFolderInput,
) -> Result<VaultFolder, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::update_vault_folder(&conn, id, &folder)
}

#[tauri::command]
pub fn delete_vault_folder(db: State<Database>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::delete_vault_folder(&conn, id)
}

#[tauri::command]
pub fn get_vault_items(
    db: State<Database>,
    search: Option<String>,
) -> Result<Vec<VaultItem>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::query_vault_items(&conn, search.as_deref())
}

#[tauri::command]
pub fn create_vault_item(db: State<Database>, item: VaultItemInput) -> Result<VaultItem, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::create_vault_item(&conn, &item)
}

#[tauri::command]
pub fn update_vault_item(
    db: State<Database>,
    id: i64,
    item: VaultItemInput,
) -> Result<VaultItem, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::update_vault_item(&conn, id, &item)
}

#[tauri::command]
pub fn delete_vault_item(db: State<Database>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::delete_vault_item(&conn, id)
}

#[tauri::command]
pub fn batch_import_vault_items(
    db: State<Database>,
    items: Vec<VaultItemInput>,
) -> Result<VaultBatchImportResult, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::batch_import_vault_items(&conn, &items)
}

// ─── U 卡与支付卡命令 ──────────────────────────────────────────────

#[tauri::command]
pub fn get_payment_cards(db: State<Database>) -> Result<Vec<PaymentCard>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::query_payment_cards(&conn)
}

#[tauri::command]
pub fn create_payment_card(
    db: State<Database>,
    card: PaymentCardInput,
) -> Result<PaymentCard, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::create_payment_card(&conn, &card)
}

#[tauri::command]
pub fn update_payment_card(
    db: State<Database>,
    id: i64,
    card: PaymentCardInput,
) -> Result<PaymentCard, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::update_payment_card(&conn, id, &card)
}

#[tauri::command]
pub fn delete_payment_card(db: State<Database>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::delete_payment_card(&conn, id)
}

// ─── 域名管理与 Cloudflare DNS 命令 ───────────────────────────────

#[tauri::command]
pub fn get_domains(db: State<Database>) -> Result<Vec<DomainItem>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::query_domains(&conn)
}

#[tauri::command]
pub fn create_domain(db: State<Database>, domain: DomainInput) -> Result<DomainItem, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::create_domain(&conn, &domain)
}

#[tauri::command]
pub fn update_domain(
    db: State<Database>,
    id: i64,
    domain: DomainInput,
) -> Result<DomainItem, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::update_domain(&conn, id, &domain)
}

#[tauri::command]
pub fn delete_domain(db: State<Database>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::delete_domain(&conn, id)
}

#[tauri::command]
pub async fn probe_domain(db: State<'_, Database>, id: i64) -> Result<DomainItem, String> {
    let domain_name = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        assets_db::get_domain_by_id(&conn, id)?.name
    };
    let res = crate::domain_probe::probe_domain(&domain_name).await;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    match res {
        Ok(ref info) => assets_db::save_domain_probe_result(&conn, id, Ok(info)),
        Err(ref err) => assets_db::save_domain_probe_result(&conn, id, Err(err)),
    }
}

#[tauri::command]
pub fn get_cloudflare_connections(
    db: State<Database>,
) -> Result<Vec<CloudflareConnectionView>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::query_cloudflare_connections(&conn)
}

#[tauri::command]
pub async fn save_cloudflare_connection(
    db: State<'_, Database>,
    id: Option<i64>,
    connection: CloudflareConnectionInput,
) -> Result<CloudflareConnectionView, String> {
    let token_to_verify = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        if let Some(t) = assets_db::normalize_optional(connection.api_token.as_deref()) {
            crate::cloudflare::validate_cf_token(&t)?
        } else if let Some(eid) = id {
            assets_db::get_cloudflare_connection(&conn, eid)?.api_token
        } else {
            return Err("请填写 Cloudflare API Token".to_string());
        }
    };

    let (_zones, summary) = crate::cloudflare::list_cloudflare_zones(&token_to_verify).await?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::save_cloudflare_connection(&conn, id, &connection, summary.as_deref())
}

#[tauri::command]
pub fn delete_cloudflare_connection(db: State<Database>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::delete_cloudflare_connection(&conn, id)
}

#[tauri::command]
pub async fn list_cloudflare_zones(
    db: State<'_, Database>,
    connection_id: i64,
) -> Result<Vec<CloudflareZone>, String> {
    let token = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        assets_db::get_cloudflare_connection(&conn, connection_id)?.api_token
    };
    let (zones, summary) = crate::cloudflare::list_cloudflare_zones(&token).await?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::update_cloudflare_sync_summary(&conn, connection_id, summary.as_deref())?;
    Ok(zones)
}

#[tauri::command]
pub fn import_cloudflare_zones(
    db: State<Database>,
    connection_id: i64,
    zones: Vec<CloudflareZone>,
) -> Result<usize, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::upsert_cloudflare_domains(&conn, connection_id, &zones)
}

#[tauri::command]
pub async fn list_domain_dns_records(
    db: State<'_, Database>,
    domain_id: i64,
) -> Result<Vec<CloudflareDnsRecord>, String> {
    let (token, zone_id) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let domain = assets_db::get_domain_by_id(&conn, domain_id)?;
        let cf_id = domain
            .cf_connection_id
            .ok_or_else(|| "该域名未绑定 Cloudflare 连接".to_string())?;
        let zone_id = domain
            .cf_zone_id
            .filter(|z| !z.trim().is_empty())
            .ok_or_else(|| "该域名缺少 Cloudflare Zone ID".to_string())?;
        let cf = assets_db::get_cloudflare_connection(&conn, cf_id)?;
        (cf.api_token, zone_id)
    };
    crate::cloudflare::list_dns_records(&token, &zone_id).await
}

#[tauri::command]
pub async fn apply_domain_dns_record(
    db: State<'_, Database>,
    domain_id: i64,
    action: String,
    record_id: Option<String>,
    record: Option<DnsRecordInput>,
) -> Result<Option<CloudflareDnsRecord>, String> {
    let (token, zone_id) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let domain = assets_db::get_domain_by_id(&conn, domain_id)?;
        let cf_id = domain
            .cf_connection_id
            .ok_or_else(|| "该域名未绑定 Cloudflare 连接".to_string())?;
        let zone_id = domain
            .cf_zone_id
            .filter(|z| !z.trim().is_empty())
            .ok_or_else(|| "该域名缺少 Cloudflare Zone ID".to_string())?;
        let cf = assets_db::get_cloudflare_connection(&conn, cf_id)?;
        (cf.api_token, zone_id)
    };
    crate::cloudflare::apply_dns_record(
        &token,
        &zone_id,
        &action,
        record_id.as_deref(),
        record.as_ref(),
    )
    .await
}

// ─── AI 订阅与 OAuth / CLI 额度命令 ────────────────────────────────

#[tauri::command]
pub fn get_ai_subscriptions(db: State<Database>) -> Result<Vec<AiSubscription>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::query_ai_subscriptions(&conn)
}

#[tauri::command]
pub fn create_ai_subscription(
    db: State<Database>,
    subscription: AiSubscriptionInput,
) -> Result<AiSubscription, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::create_ai_subscription(&conn, &subscription)
}

#[tauri::command]
pub fn update_ai_subscription(
    db: State<Database>,
    id: i64,
    subscription: AiSubscriptionInput,
) -> Result<AiSubscription, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::update_ai_subscription(&conn, id, &subscription)
}

#[tauri::command]
pub fn delete_ai_subscription(db: State<Database>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::delete_ai_subscription(&conn, id)
}

#[tauri::command]
pub fn get_gemini_oauth_config(db: State<Database>) -> Result<GeminiOAuthConfigView, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    Ok(ai_quota::get_gemini_oauth_config(&conn))
}

#[tauri::command]
pub fn save_gemini_oauth_config(
    db: State<Database>,
    config: GeminiOAuthConfigInput,
) -> Result<GeminiOAuthConfigView, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    ai_quota::save_gemini_oauth_config(&conn, &config)
}

#[tauri::command]
pub async fn start_ai_oauth(
    db: State<'_, Database>,
    oauth: State<'_, AiOAuthManager>,
    provider: String,
    subscription_id: i64,
) -> Result<OAuthStartInfo, String> {
    let gemini_override = if provider == "gemini" {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        ai_quota::load_gemini_oauth_override(&conn)
    } else {
        None
    };
    let info = ai_quota::start_oauth_session(
        &oauth,
        &provider,
        subscription_id,
        gemini_override.as_ref(),
    )
    .await?;
    open_external_url(info.authorize_url.clone())?;
    Ok(info)
}

#[tauri::command]
pub fn get_ai_oauth_status(
    db: State<Database>,
    oauth: State<AiOAuthManager>,
    session_id: String,
) -> Result<OAuthStatusInfo, String> {
    let status = oauth.get_status(&session_id);
    if status.status == "connected" {
        if let Some((sub_id, provider, tokens)) = oauth.take_tokens(&session_id) {
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            assets_db::save_ai_oauth_tokens(&conn, sub_id, &provider, &tokens)?;
        }
    }
    Ok(status)
}

#[tauri::command]
pub async fn complete_ai_oauth(
    db: State<'_, Database>,
    oauth: State<'_, AiOAuthManager>,
    session_id: String,
    callback_input: String,
) -> Result<AiSubscription, String> {
    let (sub_id, provider, tokens) =
        ai_quota::complete_oauth_manual(&oauth, &session_id, &callback_input).await?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::save_ai_oauth_tokens(&conn, sub_id, &provider, &tokens)
}

#[tauri::command]
pub fn cancel_ai_oauth(oauth: State<AiOAuthManager>, session_id: String) -> Result<(), String> {
    oauth.cancel(&session_id);
    Ok(())
}

#[tauri::command]
pub fn disconnect_ai_oauth(db: State<Database>, id: i64) -> Result<AiSubscription, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::disconnect_ai_oauth(&conn, id)
}

#[tauri::command]
pub async fn refresh_ai_subscription_quota(
    db: State<'_, Database>,
    id: i64,
) -> Result<AiSubscription, String> {
    let (provider, tokens, gemini_override) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let (provider, tokens) = assets_db::get_ai_oauth_credentials(&conn, id)?;
        let ov = if provider == "gemini" {
            ai_quota::load_gemini_oauth_override(&conn)
        } else {
            None
        };
        (provider, tokens, ov)
    };
    let (updated_tokens, usage_res) =
        ai_quota::fetch_provider_usage(&provider, tokens, gemini_override.as_ref()).await;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    match usage_res {
        Ok(ref usage) => assets_db::save_ai_usage_result(&conn, id, &updated_tokens, Ok(usage)),
        Err(ref err) => assets_db::save_ai_usage_result(&conn, id, &updated_tokens, Err(err)),
    }
}

#[tauri::command]
pub async fn read_antigravity_cli_quota() -> Result<AntigravityQuotaResult, String> {
    ai_quota::read_antigravity_quota().await
}

// ─── 服务器台账、SSH 探针、交互式终端与 SFTP ─────────────────────

fn load_server_snapshot(db: &State<'_, Database>, server_id: i64) -> Result<ServerItem, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::require_server_by_id(&conn, server_id)
}

fn persist_pinned_fingerprint(
    db: &State<'_, Database>,
    server_id: i64,
    pinned: Option<String>,
) -> Result<(), String> {
    if let Some(fp) = pinned {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        assets_db::set_server_host_fingerprint(&conn, server_id, &fp)?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_servers(db: State<Database>, search: Option<String>) -> Result<Vec<ServerItem>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::query_servers(&conn, search.as_deref())
}

#[tauri::command]
pub fn create_server(db: State<Database>, server: ServerInput) -> Result<ServerItem, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::create_server(&conn, server)
}

#[tauri::command]
pub fn update_server(
    db: State<Database>,
    id: i64,
    server: ServerInput,
) -> Result<ServerItem, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::update_server(&conn, id, server)
}

#[tauri::command]
pub fn delete_server(db: State<Database>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::delete_server(&conn, id)
}

#[tauri::command]
pub async fn probe_server(db: State<'_, Database>, id: i64) -> Result<ServerItem, String> {
    let server = load_server_snapshot(&db, id)?;
    match ssh_client::probe_server_remote(&server).await {
        Ok((probe_update, pinned)) => {
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            if let Some(fp) = pinned {
                assets_db::set_server_host_fingerprint(&conn, id, &fp)?;
            }
            assets_db::save_server_probe_result(&conn, id, &probe_update)
        }
        Err(err) => {
            let is_host_key_changed = err.starts_with("HOST_KEY_CHANGED:");
            let offline_update = ServerProbeUpdate {
                status: "offline".to_string(),
                os: None,
                kernel: None,
                cpu: None,
                memory: None,
                disk: None,
                mem_total_kb: None,
                disk_total_kb: None,
                loadavg: None,
                uptime: None,
                services_json: None,
                probe_error: Some(err.clone()),
            };
            let saved = {
                let conn = db.0.lock().map_err(|e| e.to_string())?;
                assets_db::save_server_probe_result(&conn, id, &offline_update)
            };
            if is_host_key_changed {
                Err(err)
            } else {
                saved
            }
        }
    }
}

#[tauri::command]
pub fn reset_server_host_fingerprint(
    db: State<Database>,
    id: i64,
) -> Result<ServerItem, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::reset_server_host_fingerprint(&conn, id)
}

#[tauri::command]
pub fn get_app_monitor_settings(db: State<Database>) -> Result<AppMonitorSettings, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::get_app_monitor_settings(&conn)
}

#[tauri::command]
pub fn save_app_monitor_settings(
    db: State<Database>,
    server_monitor_minutes: u64,
) -> Result<AppMonitorSettings, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    assets_db::save_app_monitor_settings(&conn, server_monitor_minutes)
}

#[tauri::command]
pub async fn ssh_open_session(
    app: AppHandle,
    db: State<'_, Database>,
    ssh: State<'_, SshSessionManager>,
    server_id: i64,
    cols: Option<u32>,
    rows: Option<u32>,
) -> Result<SshSessionInfo, String> {
    let server = load_server_snapshot(&db, server_id)?;
    let (info, pinned) = ssh
        .open_session(app, &server, cols.unwrap_or(100), rows.unwrap_or(30))
        .await?;
    persist_pinned_fingerprint(&db, server_id, pinned)?;
    Ok(info)
}

#[tauri::command]
pub async fn ssh_write_session(
    ssh: State<'_, SshSessionManager>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    ssh.write_session(&session_id, &data).await
}

#[tauri::command]
pub async fn ssh_resize_session(
    ssh: State<'_, SshSessionManager>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    ssh.resize_session(&session_id, cols, rows).await
}

#[tauri::command]
pub async fn ssh_close_session(
    ssh: State<'_, SshSessionManager>,
    session_id: String,
) -> Result<(), String> {
    ssh.close_session(&session_id).await
}

#[tauri::command]
pub async fn ssh_list_sessions(
    ssh: State<'_, SshSessionManager>,
) -> Result<Vec<SshSessionInfo>, String> {
    Ok(ssh.list_sessions().await)
}

#[tauri::command]
pub async fn sftp_list_dir(
    db: State<'_, Database>,
    server_id: i64,
    path: Option<String>,
) -> Result<SftpDirListing, String> {
    let server = load_server_snapshot(&db, server_id)?;
    let (listing, pinned) = ssh_client::sftp_list_dir(&server, path).await?;
    persist_pinned_fingerprint(&db, server_id, pinned)?;
    Ok(listing)
}

#[tauri::command]
pub async fn sftp_download_file(
    db: State<'_, Database>,
    server_id: i64,
    remote_path: String,
    local_path: String,
) -> Result<u64, String> {
    let server = load_server_snapshot(&db, server_id)?;
    let (bytes, pinned) =
        ssh_client::sftp_download_file(&server, &remote_path, &local_path).await?;
    persist_pinned_fingerprint(&db, server_id, pinned)?;
    Ok(bytes)
}

#[tauri::command]
pub async fn sftp_upload_file(
    db: State<'_, Database>,
    server_id: i64,
    local_path: String,
    remote_path: String,
) -> Result<u64, String> {
    let server = load_server_snapshot(&db, server_id)?;
    let (bytes, pinned) =
        ssh_client::sftp_upload_file(&server, &local_path, &remote_path).await?;
    persist_pinned_fingerprint(&db, server_id, pinned)?;
    Ok(bytes)
}

#[tauri::command]
pub async fn sftp_mkdir(
    db: State<'_, Database>,
    server_id: i64,
    remote_path: String,
) -> Result<(), String> {
    let server = load_server_snapshot(&db, server_id)?;
    let pinned = ssh_client::sftp_mkdir(&server, &remote_path).await?;
    persist_pinned_fingerprint(&db, server_id, pinned)?;
    Ok(())
}

#[tauri::command]
pub async fn sftp_remove(
    db: State<'_, Database>,
    server_id: i64,
    remote_path: String,
    is_dir: bool,
) -> Result<(), String> {
    let server = load_server_snapshot(&db, server_id)?;
    let pinned = ssh_client::sftp_remove(&server, &remote_path, is_dir).await?;
    persist_pinned_fingerprint(&db, server_id, pinned)?;
    Ok(())
}

// ─── AI 助手（严格脱敏 + 可确认写提案）────────────────────────────

#[tauri::command]
pub fn get_agent_settings(db: State<Database>) -> Result<AgentSettingsView, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    agent::get_agent_settings(&conn)
}

#[tauri::command]
pub fn save_agent_settings(
    db: State<Database>,
    settings: AgentSettingsInput,
) -> Result<AgentSettingsView, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    agent::save_agent_settings(&conn, &settings)
}

#[tauri::command]
pub async fn test_agent_connection(
    db: State<'_, Database>,
    base_url: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
) -> Result<AgentConnectionTestResult, String> {
    let cfg = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let saved_key = crate::database::get_setting(&conn, agent::SETTING_AGENT_API_KEY)?
            .unwrap_or_default();
        let saved_url = crate::database::get_setting(&conn, agent::SETTING_AGENT_BASE_URL)?
            .unwrap_or_default();
        let saved_model = crate::database::get_setting(&conn, agent::SETTING_AGENT_MODEL)?
            .unwrap_or_default();

        let effective_url = base_url
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(saved_url.trim());
        let normalized_url = agent::validate_agent_base_url(effective_url)?;
        let effective_model = model
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(saved_model.trim())
            .to_string();
        if effective_model.is_empty() {
            return Err("请填写要测试的模型名称".to_string());
        }
        let effective_key = api_key
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(saved_key.trim())
            .to_string();

        agent::LoadedAgentConfig {
            base_url: normalized_url,
            api_key: effective_key,
            model: effective_model,
            max_tokens: 16,
        }
    };
    agent::test_agent_connection(&cfg).await
}

#[tauri::command]
pub fn get_agent_messages(db: State<Database>) -> Result<Vec<AgentMessageItem>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    agent::query_agent_messages(&conn)
}

#[tauri::command]
pub fn clear_agent_messages(db: State<Database>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    agent::clear_agent_messages(&conn)
}

#[tauri::command]
pub async fn send_agent_message(
    app: AppHandle,
    db: State<'_, Database>,
    streams: State<'_, AgentStreamManager>,
    message: String,
) -> Result<Vec<AgentMessageItem>, String> {
    use tauri::Emitter;

    let trimmed = message.trim().to_string();
    if trimmed.is_empty() || trimmed.chars().count() > 32000 {
        return Err("提问内容不能为空且不能超过 32000 个字符".to_string());
    }
    let (cfg, history, user_msg) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let cfg = agent::load_agent_config(&conn)?;
        let history = agent::recent_history_messages(&conn)?;
        let user_msg = agent::insert_agent_message(&conn, "user", &trimmed, &[])?;
        (cfg, history, user_msg)
    };

    let stream_id = uuid::Uuid::new_v4().to_string();
    let cancel_flag = streams.register(&stream_id);
    let _ = app.emit(
        "agent-stream",
        serde_json::json!({
            "stream_id": stream_id,
            "type": "start",
            "user_message": user_msg,
        }),
    );

    let turn_res = agent::run_agent_chat_turn(
        Some(&app),
        &db,
        cfg,
        history,
        &trimmed,
        &stream_id,
        &cancel_flag,
    )
    .await;
    streams.remove(&stream_id);

    if let Err(err) = turn_res {
        let _ = app.emit(
            "agent-stream",
            serde_json::json!({
                "stream_id": stream_id,
                "type": "error",
                "error": err,
            }),
        );
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let _ = agent::insert_agent_message(
            &conn,
            "assistant",
            &format!("请求失败：{}", err),
            &[],
        );
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    agent::query_agent_messages(&conn)
}

#[tauri::command]
pub fn cancel_agent_stream(
    streams: State<AgentStreamManager>,
    stream_id: Option<String>,
) -> Result<bool, String> {
    Ok(streams.cancel(stream_id.as_deref()))
}

#[tauri::command]
pub fn apply_agent_proposal(
    db: State<Database>,
    message_id: i64,
    proposal_id: String,
) -> Result<AgentMessageItem, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    agent::apply_agent_proposal(&conn, message_id, &proposal_id)
}

#[tauri::command]
pub fn reject_agent_proposal(
    db: State<Database>,
    message_id: i64,
    proposal_id: String,
) -> Result<AgentMessageItem, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    agent::reject_agent_proposal(&conn, message_id, &proposal_id)
}
