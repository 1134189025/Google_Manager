use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use url::Url;

use crate::assets_db;
use crate::database;

pub const SETTING_AGENT_BASE_URL: &str = "agent.base_url";
pub const SETTING_AGENT_API_KEY: &str = "agent.api_key";
pub const SETTING_AGENT_MODEL: &str = "agent.model";
pub const SETTING_AGENT_MAX_TOKENS: &str = "agent.max_tokens";

const DEFAULT_MAX_TOKENS: u32 = 2048;
const MAX_TOOL_STEPS: usize = 4;
const AGENT_HTTP_TIMEOUT_SECS: u64 = 60;
const HISTORY_CONTEXT_LIMIT: usize = 12;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSettingsView {
    pub base_url: String,
    pub model: String,
    pub max_tokens: u32,
    pub has_api_key: bool,
    pub api_key_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSettingsInput {
    pub base_url: String,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub clear_api_key: Option<bool>,
    pub model: String,
    #[serde(default)]
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConnectionTestResult {
    pub ok: bool,
    pub model: String,
    pub latency_ms: u64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentProposalDiffRow {
    pub field: String,
    pub label: String,
    pub before: Value,
    pub after: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentProposal {
    pub id: String,
    pub kind: String, // "create_reminder" | "update_asset"
    pub target_label: String,
    pub reason: String,
    pub status: String, // "pending" | "applied" | "rejected"
    pub payload: Value,
    pub diffs: Vec<AgentProposalDiffRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMessageItem {
    pub id: i64,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub proposals: Vec<AgentProposal>,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct LoadedAgentConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub max_tokens: u32,
}

pub fn validate_agent_base_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("AI 接口地址不能为空".to_string());
    }
    let parsed = Url::parse(trimmed).map_err(|_| "模型接口地址不是合法的 URL".to_string())?;
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("模型接口地址不能包含用户名或密码凭据".to_string());
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("模型接口地址不能包含查询参数或片段".to_string());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "模型接口地址缺少主机名".to_string())?;
    let is_local = matches!(host, "localhost" | "127.0.0.1" | "::1" | "[::1]");
    match parsed.scheme() {
        "https" => {}
        "http" if is_local => {}
        "http" => {
            return Err("远程模型地址必须使用 HTTPS（仅 localhost / 127.0.0.1 / ::1 允许 HTTP）".to_string());
        }
        _ => {
            return Err("模型接口地址仅支持 HTTPS 或本机 HTTP 协议".to_string());
        }
    }
    Ok(parsed.as_str().trim_end_matches('/').to_string())
}

pub fn mask_api_key(key: &str) -> String {
    let chars: Vec<char> = key.trim().chars().collect();
    if chars.len() <= 8 {
        return "***".to_string();
    }
    let prefix: String = chars.iter().take(4).collect();
    let suffix: String = chars[chars.len() - 4..].iter().collect();
    format!("{}***{}", prefix, suffix)
}

pub fn get_agent_settings(conn: &Connection) -> Result<AgentSettingsView, String> {
    let base_url = database::get_setting(conn, SETTING_AGENT_BASE_URL)?.unwrap_or_default();
    let model = database::get_setting(conn, SETTING_AGENT_MODEL)?.unwrap_or_default();
    let max_tokens = database::get_setting(conn, SETTING_AGENT_MAX_TOKENS)?
        .and_then(|s| s.trim().parse::<u32>().ok())
        .map(|v| v.clamp(256, 16384))
        .unwrap_or(DEFAULT_MAX_TOKENS);
    let key_raw = database::get_setting(conn, SETTING_AGENT_API_KEY)?
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    Ok(AgentSettingsView {
        base_url,
        model,
        max_tokens,
        has_api_key: key_raw.is_some(),
        api_key_hint: key_raw.as_deref().map(mask_api_key),
    })
}

pub fn load_agent_config(conn: &Connection) -> Result<LoadedAgentConfig, String> {
    let view = get_agent_settings(conn)?;
    if view.base_url.trim().is_empty() {
        return Err("请先在「系统设置 -> AI 模型配置」填写兼容 OpenAI 的接口地址".to_string());
    }
    let base_url = validate_agent_base_url(&view.base_url)?;
    if view.model.trim().is_empty() {
        return Err("请先在「系统设置 -> AI 模型配置」填写模型名称".to_string());
    }
    let api_key = database::get_setting(conn, SETTING_AGENT_API_KEY)?
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    Ok(LoadedAgentConfig {
        base_url,
        api_key,
        model: view.model,
        max_tokens: view.max_tokens,
    })
}

pub fn save_agent_settings(
    conn: &Connection,
    input: &AgentSettingsInput,
) -> Result<AgentSettingsView, String> {
    let base_trimmed = input.base_url.trim();
    if base_trimmed.is_empty() {
        database::set_setting(conn, SETTING_AGENT_BASE_URL, None)?;
    } else {
        let normalized = validate_agent_base_url(base_trimmed)?;
        database::set_setting(conn, SETTING_AGENT_BASE_URL, Some(&normalized))?;
    }

    let model_trimmed = input.model.trim();
    let model_capped: String = model_trimmed.chars().take(200).collect();
    if model_capped.is_empty() {
        database::set_setting(conn, SETTING_AGENT_MODEL, None)?;
    } else {
        database::set_setting(conn, SETTING_AGENT_MODEL, Some(&model_capped))?;
    }

    let max_tokens = input.max_tokens.unwrap_or(DEFAULT_MAX_TOKENS).clamp(256, 16384);
    database::set_setting(
        conn,
        SETTING_AGENT_MAX_TOKENS,
        Some(&max_tokens.to_string()),
    )?;

    if input.clear_api_key == Some(true) {
        database::set_setting(conn, SETTING_AGENT_API_KEY, None)?;
    } else if let Some(ref key) = input.api_key {
        let k = key.trim();
        if !k.is_empty() {
            database::set_setting(conn, SETTING_AGENT_API_KEY, Some(k))?;
        }
    }

    get_agent_settings(conn)
}

// ─── 严格允许字段白名单脱敏结构体 ──────────────────────────────────
// 安全边界：任何密码、密钥、2FA secret、SMS 接码 URL、卡号/CVV、OAuth token、SSH 凭据/口令、CF Token
// 都不允许出现在这些结构体中，保证底层结构上无法被序列化发送给模型。

#[derive(Debug, Clone, Serialize)]
pub struct SanitizedGoogleAccount {
    pub id: i64,
    pub email: String,
    pub status: String,
    pub reg_year: Option<String>,
    pub country: Option<String>,
    pub group_name: Option<String>,
    pub has_2fa: bool,
    pub has_sms_url: bool,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SanitizedVaultItem {
    pub id: i64,
    pub kind: String,
    pub name: String,
    pub url_host: Option<String>,
    pub folder_id: Option<i64>,
    pub google_account_id: Option<i64>,
    pub tags: Option<String>,
    pub has_totp: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SanitizedPaymentCard {
    pub id: i64,
    pub name: String,
    pub issuer: Option<String>,
    pub bank_code: Option<String>,
    pub network: Option<String>,
    pub funding: Option<String>,
    pub form_factor: Option<String>,
    pub region: Option<String>,
    pub region_group: String,
    pub last4: Option<String>,
    pub expiry_month: Option<String>,
    pub billing_amount: Option<f64>,
    pub billing_currency: String,
    pub billing_cycle: String,
    pub expires_at: Option<String>,
    pub tags: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SanitizedQuotaWindow {
    pub label: String,
    pub used_pct: Option<f64>,
    pub remaining_pct: Option<f64>,
    pub resets_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SanitizedAiSubscription {
    pub id: i64,
    pub name: String,
    pub provider: String,
    pub plan: Option<String>,
    pub account_email: Option<String>,
    pub billing_amount: Option<f64>,
    pub billing_currency: String,
    pub billing_cycle: String,
    pub renews_at: Option<String>,
    pub oauth_connected: bool,
    pub usage_summary: Vec<SanitizedQuotaWindow>,
    pub tags: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SanitizedContainerSummary {
    pub name: String,
    pub image: String,
    pub state: String,
    pub health: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SanitizedServer {
    pub id: i64,
    pub name: String,
    pub host: String,
    pub port: i64,
    pub region: Option<String>,
    pub os: Option<String>,
    pub kernel: Option<String>,
    pub collect_enabled: bool,
    pub billing_amount: Option<f64>,
    pub billing_currency: String,
    pub billing_cycle: String,
    pub expires_at: Option<String>,
    pub status: String,
    pub cpu: Option<f64>,
    pub memory: Option<f64>,
    pub disk: Option<f64>,
    pub loadavg: Option<String>,
    pub uptime: Option<String>,
    pub ports_count: usize,
    pub containers_summary: Vec<SanitizedContainerSummary>,
    pub tags: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SanitizedDomain {
    pub id: i64,
    pub name: String,
    pub registrar: Option<String>,
    pub nameservers: Vec<String>,
    pub auto_renew: bool,
    pub billing_amount: Option<f64>,
    pub billing_currency: String,
    pub billing_cycle: String,
    pub expires_at: Option<String>,
    pub cf_linked: bool,
    pub server_id: Option<i64>,
    pub tags: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SanitizedReminder {
    pub id: i64,
    pub title: String,
    pub note: Option<String>,
    pub due_at: String,
    pub repeat: String,
    pub lead_days: i64,
    pub done: bool,
    pub ref_kind: Option<String>,
    pub ref_id: Option<i64>,
}

fn parse_url_host_only(raw: Option<&str>) -> Option<String> {
    let trimmed = raw?.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(parsed) = Url::parse(trimmed) {
        return parsed.host_str().map(str::to_string);
    }
    if let Ok(parsed) = Url::parse(&format!("https://{}", trimmed)) {
        return parsed.host_str().map(str::to_string);
    }
    None
}

fn sanitize_server(srv: &assets_db::ServerItem) -> SanitizedServer {
    let mut ports_count = 0usize;
    let mut containers_summary = Vec::new();
    if let Some(ref raw) = srv.services_json {
        if let Ok(snap) = serde_json::from_str::<crate::ssh_client::ServerServicesSnapshot>(raw) {
            ports_count = snap.ports.len();
            containers_summary = snap
                .containers
                .into_iter()
                .take(20)
                .map(|c| SanitizedContainerSummary {
                    name: c.name,
                    image: c.image,
                    state: c.state,
                    health: c.health,
                })
                .collect();
        }
    }
    SanitizedServer {
        id: srv.id,
        name: srv.name.clone(),
        host: srv.host.clone(),
        port: srv.port,
        region: srv.region.clone(),
        os: srv.os.clone(),
        kernel: srv.kernel.clone(),
        collect_enabled: srv.collect_enabled,
        billing_amount: srv.billing_amount,
        billing_currency: srv.billing_currency.clone(),
        billing_cycle: srv.billing_cycle.clone(),
        expires_at: srv.expires_at.clone(),
        status: srv.status.clone(),
        cpu: srv.cpu,
        memory: srv.memory,
        disk: srv.disk,
        loadavg: srv.loadavg.clone(),
        uptime: srv.uptime.clone(),
        ports_count,
        containers_summary,
        tags: srv.tags.clone(),
        notes: srv.notes.clone(),
    }
}

pub fn execute_get_workspace_summary(conn: &Connection) -> Result<Value, String> {
    let overview = assets_db::get_workspace_overview(conn, assets_db::today_local())?;
    let spend = assets_db::get_renewals_summary(conn, 30, assets_db::today_local())?;
    Ok(json!({
        "overview": overview,
        "upcoming_30d_count": spend.timeline.len(),
        "spend": spend.spend,
    }))
}

pub fn execute_search_assets(
    conn: &Connection,
    query: &str,
    kind: Option<&str>,
) -> Result<Value, String> {
    let kw = query.trim().to_ascii_lowercase();
    let kind_filter = kind
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_ascii_lowercase);
    let matches_kw = |fields: &[Option<&str>]| -> bool {
        if kw.is_empty() {
            return true;
        }
        fields
            .iter()
            .flatten()
            .any(|v| v.to_ascii_lowercase().contains(&kw))
    };
    let wants = |target: &str| -> bool {
        kind_filter
            .as_deref()
            .map(|f| f == target || f == "all")
            .unwrap_or(true)
    };

    const MAX_RESULTS: usize = 30;
    let mut total = 0usize;
    let mut results = Map::new();

    if wants("google") && total < MAX_RESULTS {
        let mut stmt = conn
            .prepare(
                "SELECT id, email, status, reg_year, country, group_name,
                        COALESCE(NULLIF(TRIM(secret), ''), '') != '' AS has_2fa,
                        COALESCE(NULLIF(TRIM(sms_url), ''), '') != '' AS has_sms_url,
                        updated_at
                 FROM accounts WHERE deleted_at IS NULL ORDER BY id DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(SanitizedGoogleAccount {
                    id: r.get(0)?,
                    email: r.get(1)?,
                    status: r.get::<_, Option<String>>(2)?.unwrap_or_else(|| "inactive".to_string()),
                    reg_year: r.get(3)?,
                    country: r.get(4)?,
                    group_name: r.get(5)?,
                    has_2fa: r.get::<_, i64>(6)? != 0,
                    has_sms_url: r.get::<_, i64>(7)? != 0,
                    updated_at: r.get(8)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut matched = Vec::new();
        for item in rows {
            let item = item.map_err(|e| e.to_string())?;
            if matches_kw(&[
                Some(item.email.as_str()),
                Some(item.status.as_str()),
                item.country.as_deref(),
                item.group_name.as_deref(),
            ]) {
                matched.push(item);
                total += 1;
                if total >= MAX_RESULTS {
                    break;
                }
            }
        }
        if !matched.is_empty() {
            results.insert("google_accounts".to_string(), json!(matched));
        }
    }

    if wants("vault") && total < MAX_RESULTS {
        let items = assets_db::query_vault_items(conn, None)?;
        let mut matched = Vec::new();
        for v in items {
            let url_host = parse_url_host_only(v.url.as_deref());
            if matches_kw(&[
                Some(v.name.as_str()),
                Some(v.kind.as_str()),
                url_host.as_deref(),
                v.tags.as_deref(),
            ]) {
                matched.push(SanitizedVaultItem {
                    id: v.id,
                    kind: v.kind,
                    name: v.name,
                    url_host,
                    folder_id: v.folder_id,
                    google_account_id: v.google_account_id,
                    tags: v.tags,
                    has_totp: v
                        .totp_secret
                        .as_deref()
                        .map(|s| !s.trim().is_empty())
                        .unwrap_or(false),
                });
                total += 1;
                if total >= MAX_RESULTS {
                    break;
                }
            }
        }
        if !matched.is_empty() {
            results.insert("vault_items".to_string(), json!(matched));
        }
    }

    if wants("card") && total < MAX_RESULTS {
        let cards = assets_db::query_payment_cards(conn)?;
        let mut matched = Vec::new();
        for c in cards {
            if matches_kw(&[
                Some(c.name.as_str()),
                c.issuer.as_deref(),
                c.network.as_deref(),
                c.region.as_deref(),
                c.last4.as_deref(),
                c.tags.as_deref(),
            ]) {
                matched.push(SanitizedPaymentCard {
                    id: c.id,
                    name: c.name,
                    issuer: c.issuer,
                    bank_code: c.bank_code,
                    network: c.network,
                    funding: c.funding,
                    form_factor: c.form_factor,
                    region: c.region,
                    region_group: c.region_group,
                    last4: c.last4,
                    expiry_month: c.expiry_month,
                    billing_amount: c.billing_amount,
                    billing_currency: c.billing_currency,
                    billing_cycle: c.billing_cycle,
                    expires_at: c.expires_at,
                    tags: c.tags,
                });
                total += 1;
                if total >= MAX_RESULTS {
                    break;
                }
            }
        }
        if !matched.is_empty() {
            results.insert("payment_cards".to_string(), json!(matched));
        }
    }

    if wants("ai") && total < MAX_RESULTS {
        let subs = assets_db::query_ai_subscriptions(conn)?;
        let mut matched = Vec::new();
        for s in subs {
            if matches_kw(&[
                Some(s.name.as_str()),
                Some(s.provider.as_str()),
                s.plan.as_deref(),
                s.account_email.as_deref(),
                s.tags.as_deref(),
                s.notes.as_deref(),
            ]) {
                let usage_summary = s
                    .usage
                    .map(|u| {
                        u.windows
                            .into_iter()
                            .map(|w| SanitizedQuotaWindow {
                                label: w.label,
                                used_pct: w.used_percent,
                                remaining_pct: w
                                    .used_percent
                                    .map(|u| (100.0 - u).clamp(0.0, 100.0))
                                    .or(w.remaining),
                                resets_at: w.resets_at,
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                matched.push(SanitizedAiSubscription {
                    id: s.id,
                    name: s.name,
                    provider: s.provider,
                    plan: s.plan,
                    account_email: s.account_email,
                    billing_amount: s.billing_amount,
                    billing_currency: s.billing_currency,
                    billing_cycle: s.billing_cycle,
                    renews_at: s.renews_at,
                    oauth_connected: s.oauth_connected,
                    usage_summary,
                    tags: s.tags,
                    notes: s.notes,
                });
                total += 1;
                if total >= MAX_RESULTS {
                    break;
                }
            }
        }
        if !matched.is_empty() {
            results.insert("ai_subscriptions".to_string(), json!(matched));
        }
    }

    if wants("server") && total < MAX_RESULTS {
        let servers = assets_db::query_servers(conn, None)?;
        let mut matched = Vec::new();
        for s in servers {
            if matches_kw(&[
                Some(s.name.as_str()),
                Some(s.host.as_str()),
                s.region.as_deref(),
                s.os.as_deref(),
                s.tags.as_deref(),
                s.notes.as_deref(),
            ]) {
                matched.push(sanitize_server(&s));
                total += 1;
                if total >= MAX_RESULTS {
                    break;
                }
            }
        }
        if !matched.is_empty() {
            results.insert("servers".to_string(), json!(matched));
        }
    }

    if wants("domain") && total < MAX_RESULTS {
        let domains = assets_db::query_domains(conn)?;
        let mut matched = Vec::new();
        for d in domains {
            if matches_kw(&[
                Some(d.name.as_str()),
                d.registrar.as_deref(),
                d.tags.as_deref(),
                d.notes.as_deref(),
            ]) {
                matched.push(SanitizedDomain {
                    id: d.id,
                    name: d.name,
                    registrar: d.registrar,
                    nameservers: d.nameservers,
                    auto_renew: d.auto_renew,
                    billing_amount: d.billing_amount,
                    billing_currency: d.billing_currency,
                    billing_cycle: d.billing_cycle,
                    expires_at: d.expires_at,
                    cf_linked: d.cf_connection_id.is_some(),
                    server_id: d.server_id,
                    tags: d.tags,
                    notes: d.notes,
                });
                total += 1;
                if total >= MAX_RESULTS {
                    break;
                }
            }
        }
        if !matched.is_empty() {
            results.insert("domains".to_string(), json!(matched));
        }
    }

    if wants("reminder") && total < MAX_RESULTS {
        let reminders = assets_db::query_reminders(conn)?;
        let mut matched = Vec::new();
        for r in reminders {
            if matches_kw(&[Some(r.title.as_str()), r.note.as_deref(), Some(r.due_at.as_str())]) {
                matched.push(SanitizedReminder {
                    id: r.id,
                    title: r.title,
                    note: r.note,
                    due_at: r.due_at,
                    repeat: r.repeat,
                    lead_days: r.lead_days,
                    done: r.done,
                    ref_kind: r.ref_kind,
                    ref_id: r.ref_id,
                });
                total += 1;
                if total >= MAX_RESULTS {
                    break;
                }
            }
        }
        if !matched.is_empty() {
            results.insert("reminders".to_string(), json!(matched));
        }
    }

    Ok(json!({
        "total_returned": total,
        "truncated": total >= MAX_RESULTS,
        "results": results,
    }))
}

pub fn execute_get_renewals_and_spend(
    conn: &Connection,
    within_days: Option<i64>,
) -> Result<Value, String> {
    let days = within_days.unwrap_or(30).clamp(1, 365);
    let summary = assets_db::get_renewals_summary(conn, days, assets_db::today_local())?;
    serde_json::to_value(summary).map_err(|e| e.to_string())
}

pub fn execute_get_server_status(
    conn: &Connection,
    server_id: Option<i64>,
) -> Result<Value, String> {
    if let Some(id) = server_id {
        let server = assets_db::require_server_by_id(conn, id)?;
        return Ok(json!({ "servers": [sanitize_server(&server)] }));
    }
    let servers: Vec<SanitizedServer> = assets_db::query_servers(conn, None)?
        .iter()
        .map(sanitize_server)
        .collect();
    Ok(json!({ "servers": servers }))
}

// ─── 可确认写提案构造与事务落地 ───────────────────────────────────

const ALLOWED_PATCH_FIELDS: &[&str] = &[
    "billing_amount",
    "billing_currency",
    "billing_cycle",
    "expires_at",
    "renews_at",
    "notes",
    "tags",
];

fn field_label(field: &str) -> &'static str {
    match field {
        "billing_amount" => "费用金额",
        "billing_currency" => "币种",
        "billing_cycle" => "计费周期",
        "expires_at" => "到期日期",
        "renews_at" => "下次续费日",
        "notes" => "备注",
        "tags" => "标签",
        "title" => "提醒标题",
        "due_at" => "提醒日期",
        "repeat" => "重复周期",
        "lead_days" => "提前天数",
        "note" => "提醒备注",
        _ => "字段",
    }
}

pub fn build_create_reminder_proposal(args: &Value) -> Result<AgentProposal, String> {
    let title = args
        .get("title")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "提案缺少有效的提醒标题".to_string())?;
    if title.chars().count() > 80 {
        return Err("提醒标题不能超过 80 个字符".to_string());
    }
    let due_at_raw = args
        .get("due_at")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "提案缺少 due_at (YYYY-MM-DD)".to_string())?;
    let due_at = assets_db::validate_calendar_day(due_at_raw)?;
    let repeat = match args.get("repeat").and_then(|v| v.as_str()).map(str::trim) {
        None | Some("") | Some("none") => "none".to_string(),
        Some("week") => "week".to_string(),
        Some("month") => "month".to_string(),
        Some("year") => "year".to_string(),
        Some(other) => return Err(format!("不支持的重复周期：{}", other)),
    };
    let lead_days = args
        .get("lead_days")
        .and_then(|v| v.as_i64())
        .unwrap_or(3)
        .clamp(0, 90);
    let note = args
        .get("note")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.chars().take(1000).collect::<String>());
    let reason = args
        .get("reason")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("AI 助手建议新增备忘提醒")
        .to_string();

    let payload = json!({
        "title": title,
        "due_at": due_at,
        "repeat": repeat,
        "lead_days": lead_days,
        "note": note,
    });
    let mut diffs = vec![
        AgentProposalDiffRow {
            field: "title".to_string(),
            label: field_label("title").to_string(),
            before: Value::Null,
            after: json!(title),
        },
        AgentProposalDiffRow {
            field: "due_at".to_string(),
            label: field_label("due_at").to_string(),
            before: Value::Null,
            after: json!(due_at),
        },
        AgentProposalDiffRow {
            field: "repeat".to_string(),
            label: field_label("repeat").to_string(),
            before: Value::Null,
            after: json!(repeat),
        },
    ];
    if let Some(ref n) = note {
        diffs.push(AgentProposalDiffRow {
            field: "note".to_string(),
            label: field_label("note").to_string(),
            before: Value::Null,
            after: json!(n),
        });
    }

    Ok(AgentProposal {
        id: uuid::Uuid::new_v4().to_string(),
        kind: "create_reminder".to_string(),
        target_label: format!("备忘提醒：{}", title),
        reason,
        status: "pending".to_string(),
        payload,
        diffs,
    })
}

pub fn build_update_asset_proposal(
    conn: &Connection,
    args: &Value,
) -> Result<AgentProposal, String> {
    let asset_kind = args
        .get("asset_kind")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .ok_or_else(|| "提案缺少 asset_kind".to_string())?;
    let asset_id = args
        .get("asset_id")
        .and_then(|v| v.as_i64())
        .ok_or_else(|| "提案缺少 asset_id".to_string())?;
    let raw_patch = args
        .get("patch")
        .and_then(|v| v.as_object())
        .ok_or_else(|| "提案缺少 patch 对象".to_string())?;
    if raw_patch.is_empty() {
        return Err("patch 不能为空".to_string());
    }

    let allow_set: HashSet<&str> = ALLOWED_PATCH_FIELDS.iter().copied().collect();
    for key in raw_patch.keys() {
        if !allow_set.contains(key.as_str()) {
            return Err(format!("禁止通过 AI 提案修改敏感或未授权字段：{}", key));
        }
    }

    // 加载目标资产当前值（只取允许修改的元数据字段）
    let (target_label, current_map): (String, HashMap<&str, Value>) = match asset_kind {
        "server" => {
            let s = assets_db::require_server_by_id(conn, asset_id)?;
            let mut m = HashMap::new();
            m.insert("billing_amount", json!(s.billing_amount));
            m.insert("billing_currency", json!(s.billing_currency));
            m.insert("billing_cycle", json!(s.billing_cycle));
            m.insert("expires_at", json!(s.expires_at));
            m.insert("tags", json!(s.tags));
            m.insert("notes", json!(s.notes));
            (format!("服务器：{}", s.name), m)
        }
        "domain" => {
            let d = assets_db::get_domain_by_id(conn, asset_id)?;
            let mut m = HashMap::new();
            m.insert("billing_amount", json!(d.billing_amount));
            m.insert("billing_currency", json!(d.billing_currency));
            m.insert("billing_cycle", json!(d.billing_cycle));
            m.insert("expires_at", json!(d.expires_at));
            m.insert("tags", json!(d.tags));
            m.insert("notes", json!(d.notes));
            (format!("域名：{}", d.name), m)
        }
        "ai" => {
            let a = assets_db::get_ai_subscription_by_id(conn, asset_id)?;
            let mut m = HashMap::new();
            m.insert("billing_amount", json!(a.billing_amount));
            m.insert("billing_currency", json!(a.billing_currency));
            m.insert("billing_cycle", json!(a.billing_cycle));
            m.insert("renews_at", json!(a.renews_at));
            m.insert("tags", json!(a.tags));
            m.insert("notes", json!(a.notes));
            (format!("AI 订阅：{}", a.name), m)
        }
        "card" => {
            let cards = assets_db::query_payment_cards(conn)?;
            let c = cards
                .into_iter()
                .find(|x| x.id == asset_id)
                .ok_or_else(|| "支付卡不存在".to_string())?;
            let mut m = HashMap::new();
            m.insert("billing_amount", json!(c.billing_amount));
            m.insert("billing_currency", json!(c.billing_currency));
            m.insert("billing_cycle", json!(c.billing_cycle));
            m.insert("expires_at", json!(c.expires_at));
            m.insert("tags", json!(c.tags));
            (format!("支付卡：{}", c.name), m)
        }
        other => return Err(format!("不支持修改的资产类型：{}", other)),
    };

    let mut clean_patch = Map::new();
    let mut diffs = Vec::new();
    for (k, v) in raw_patch {
        let normalized_val = match k.as_str() {
            "billing_amount" => {
                if v.is_null() {
                    Value::Null
                } else {
                    let n = v
                        .as_f64()
                        .filter(|x| x.is_finite() && *x >= 0.0)
                        .ok_or_else(|| "billing_amount 必须是非负数字".to_string())?;
                    json!(n)
                }
            }
            "billing_currency" => {
                let s = v
                    .as_str()
                    .map(str::trim)
                    .map(str::to_ascii_uppercase)
                    .ok_or_else(|| "billing_currency 必须是字符串".to_string())?;
                if s != "CNY" && s != "USD" {
                    return Err("billing_currency 只支持 CNY 或 USD".to_string());
                }
                json!(s)
            }
            "billing_cycle" => {
                let s = v
                    .as_str()
                    .map(str::trim)
                    .map(str::to_ascii_lowercase)
                    .ok_or_else(|| "billing_cycle 必须是字符串".to_string())?;
                if !matches!(s.as_str(), "month" | "year" | "once") {
                    return Err("billing_cycle 只支持 month / year / once".to_string());
                }
                json!(s)
            }
            "expires_at" | "renews_at" => {
                if k == "expires_at" && asset_kind == "ai" {
                    return Err("AI 订阅请使用 renews_at 更新续费日".to_string());
                }
                if k == "renews_at" && asset_kind != "ai" {
                    return Err("非 AI 订阅资产请使用 expires_at 更新到期日".to_string());
                }
                if v.is_null() {
                    Value::Null
                } else {
                    let s = v
                        .as_str()
                        .ok_or_else(|| format!("{} 必须是 YYYY-MM-DD 字符串", k))?;
                    let day = assets_db::validate_calendar_day(s)?;
                    json!(day)
                }
            }
            "notes" => {
                if asset_kind == "card" {
                    return Err("支付卡备注不可通过 AI 提案修改".to_string());
                }
                if v.is_null() {
                    Value::Null
                } else {
                    let s: String = v
                        .as_str()
                        .ok_or_else(|| "notes 必须是字符串".to_string())?
                        .trim()
                        .chars()
                        .take(2000)
                        .collect();
                    json!(s)
                }
            }
            "tags" => {
                if v.is_null() {
                    Value::Null
                } else {
                    let s: String = v
                        .as_str()
                        .ok_or_else(|| "tags 必须是字符串".to_string())?
                        .trim()
                        .chars()
                        .take(500)
                        .collect();
                    json!(s)
                }
            }
            _ => return Err(format!("不允许的字段：{}", k)),
        };

        let before = current_map.get(k.as_str()).cloned().unwrap_or(Value::Null);
        clean_patch.insert(k.clone(), normalized_val.clone());
        diffs.push(AgentProposalDiffRow {
            field: k.clone(),
            label: field_label(k).to_string(),
            before,
            after: normalized_val,
        });
    }

    let reason = args
        .get("reason")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("AI 助手建议更新资产元数据")
        .to_string();

    Ok(AgentProposal {
        id: uuid::Uuid::new_v4().to_string(),
        kind: "update_asset".to_string(),
        target_label,
        reason,
        status: "pending".to_string(),
        payload: json!({
            "asset_kind": asset_kind,
            "asset_id": asset_id,
            "patch": clean_patch,
        }),
        diffs,
    })
}

pub fn query_agent_messages(conn: &Connection) -> Result<Vec<AgentMessageItem>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, role, content, proposals_json, created_at
             FROM agent_messages
             WHERE session_id = 'default'
             ORDER BY id ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let proposals_raw: Option<String> = row.get(4)?;
            let proposals = proposals_raw
                .and_then(|raw| serde_json::from_str::<Vec<AgentProposal>>(&raw).ok())
                .unwrap_or_default();
            Ok(AgentMessageItem {
                id: row.get(0)?,
                session_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                proposals,
                created_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn clear_agent_messages(conn: &Connection) -> Result<(), String> {
    conn.execute("DELETE FROM agent_messages WHERE session_id = 'default'", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn insert_agent_message(
    conn: &Connection,
    role: &str,
    content: &str,
    proposals: &[AgentProposal],
) -> Result<AgentMessageItem, String> {
    let proposals_json = if proposals.is_empty() {
        None
    } else {
        Some(serde_json::to_string(proposals).map_err(|e| e.to_string())?)
    };
    conn.execute(
        "INSERT INTO agent_messages (session_id, role, content, proposals_json)
         VALUES ('default', ?1, ?2, ?3)",
        params![role, content, proposals_json],
    )
    .map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    conn.query_row(
        "SELECT id, session_id, role, content, proposals_json, created_at
         FROM agent_messages WHERE id = ?1",
        [id],
        |row| {
            let raw: Option<String> = row.get(4)?;
            let parsed = raw
                .and_then(|s| serde_json::from_str::<Vec<AgentProposal>>(&s).ok())
                .unwrap_or_default();
            Ok(AgentMessageItem {
                id: row.get(0)?,
                session_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                proposals: parsed,
                created_at: row.get(5)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

fn load_message_with_proposals(conn: &Connection, message_id: i64) -> Result<AgentMessageItem, String> {
    conn.query_row(
        "SELECT id, session_id, role, content, proposals_json, created_at
         FROM agent_messages WHERE id = ?1",
        [message_id],
        |row| {
            let raw: Option<String> = row.get(4)?;
            let parsed = raw
                .and_then(|s| serde_json::from_str::<Vec<AgentProposal>>(&s).ok())
                .unwrap_or_default();
            Ok(AgentMessageItem {
                id: row.get(0)?,
                session_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                proposals: parsed,
                created_at: row.get(5)?,
            })
        },
    )
    .map_err(|_| "对话消息不存在".to_string())
}

fn execute_allowed_patch_in_tx(
    tx: &rusqlite::Transaction<'_>,
    asset_kind: &str,
    asset_id: i64,
    patch: &Map<String, Value>,
) -> Result<(), String> {
    let table = match asset_kind {
        "server" => "servers",
        "domain" => "domains",
        "ai" => "ai_subscriptions",
        "card" => "payment_cards",
        other => return Err(format!("不支持的资产类型：{}", other)),
    };

    for (key, val) in patch {
        if !ALLOWED_PATCH_FIELDS.contains(&key.as_str()) {
            return Err(format!("拒绝写入未授权字段：{}", key));
        }
        let column = match (table, key.as_str()) {
            ("servers", "billing_amount" | "billing_currency" | "billing_cycle" | "expires_at" | "notes" | "tags") => key.as_str(),
            ("domains", "billing_amount" | "billing_currency" | "billing_cycle" | "expires_at" | "notes" | "tags") => key.as_str(),
            ("ai_subscriptions", "billing_amount" | "billing_currency" | "billing_cycle" | "renews_at" | "notes" | "tags") => key.as_str(),
            ("payment_cards", "billing_amount" | "billing_currency" | "billing_cycle" | "expires_at" | "tags") => key.as_str(),
            _ => return Err(format!("字段 {} 不适用于资产类型 {}", key, asset_kind)),
        };

        let sql = format!(
            "UPDATE {} SET {} = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
            table, column
        );
        let changed = match val {
            Value::Null => tx.execute(&sql, params![Option::<String>::None, asset_id]),
            Value::Number(n) => tx.execute(&sql, params![n.as_f64(), asset_id]),
            Value::String(s) => tx.execute(&sql, params![s, asset_id]),
            _ => return Err(format!("字段 {} 值类型不合法", key)),
        }
        .map_err(|e| format!("更新字段失败: {}", e))?;
        if changed == 0 {
            return Err("目标资产已不存在，无法写入".to_string());
        }
    }
    Ok(())
}

pub fn apply_agent_proposal(
    conn: &Connection,
    message_id: i64,
    proposal_id: &str,
) -> Result<AgentMessageItem, String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let mut msg = load_message_with_proposals(&tx, message_id)?;
    let idx = msg
        .proposals
        .iter()
        .position(|p| p.id == proposal_id)
        .ok_or_else(|| "提案不存在".to_string())?;
    if msg.proposals[idx].status != "pending" {
        return Err("该提案已被处理，不能重复执行".to_string());
    }

    let proposal_kind = msg.proposals[idx].kind.clone();
    let payload = msg.proposals[idx].payload.clone();

    match proposal_kind.as_str() {
        "create_reminder" => {
            let title = payload
                .get("title")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "提案缺少 title".to_string())?
                .to_string();
            let due_at = payload
                .get("due_at")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "提案缺少 due_at".to_string())?
                .to_string();
            let repeat = payload
                .get("repeat")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            let lead_days = payload.get("lead_days").and_then(|v| v.as_i64());
            let note = payload
                .get("note")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            assets_db::create_reminder(
                &tx,
                &assets_db::ReminderInput {
                    title,
                    note,
                    due_at,
                    repeat,
                    lead_days,
                    ref_kind: None,
                    ref_id: None,
                },
            )?;
        }
        "update_asset" => {
            let asset_kind = payload
                .get("asset_kind")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "提案缺少 asset_kind".to_string())?;
            let asset_id = payload
                .get("asset_id")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| "提案缺少 asset_id".to_string())?;
            let patch = payload
                .get("patch")
                .and_then(|v| v.as_object())
                .ok_or_else(|| "提案缺少 patch".to_string())?;
            execute_allowed_patch_in_tx(&tx, asset_kind, asset_id, patch)?;
        }
        other => return Err(format!("未知提案类型：{}", other)),
    }

    msg.proposals[idx].status = "applied".to_string();
    let next_json = serde_json::to_string(&msg.proposals).map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE agent_messages SET proposals_json = ?1 WHERE id = ?2",
        params![next_json, message_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    load_message_with_proposals(conn, message_id)
}

pub fn reject_agent_proposal(
    conn: &Connection,
    message_id: i64,
    proposal_id: &str,
) -> Result<AgentMessageItem, String> {
    let mut msg = load_message_with_proposals(conn, message_id)?;
    let idx = msg
        .proposals
        .iter()
        .position(|p| p.id == proposal_id)
        .ok_or_else(|| "提案不存在".to_string())?;
    if msg.proposals[idx].status != "pending" {
        return Err("该提案已被处理".to_string());
    }
    msg.proposals[idx].status = "rejected".to_string();
    let next_json = serde_json::to_string(&msg.proposals).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE agent_messages SET proposals_json = ?1 WHERE id = ?2",
        params![next_json, message_id],
    )
    .map_err(|e| e.to_string())?;
    load_message_with_proposals(conn, message_id)
}

// ─── OpenAI 兼容 Tool-Calling 循环与测试连接 ────────────────────────

pub fn agent_system_prompt() -> &'static str {
    "你是 GoogleManager 个人数字资产工作区的本地 AI 助手，请始终使用中文回复。
安全与隐私硬边界：
1. 你只能访问经过严格脱敏的白名单元数据和统计工具，永远无法读取密码、2FA 密钥、短信接码地址、银行卡号/CVV、OAuth Token、SSH 凭据或 API Token。若用户索要上述敏感值，请明确说明隐私隔离限制，提示其在对应管理页本地查看。
2. 所有写入（新增备忘提醒、修改资产非敏感元数据）都必须调用 propose_create_reminder 或 propose_update_asset 生成待审核提案，绝不假装已经直接保存，需提示用户在对话卡片上点击「确认写入」后才生效。
3. 只陈述工具返回中真实存在的事实、数字和资产名称，不编造未知信息。"
}

pub fn agent_tool_definitions() -> Value {
    json!([
        {
            "type": "function",
            "function": {
                "name": "get_workspace_summary",
                "description": "获取工作区资产概览统计与最近 30 天续费支出聚合（不含任何敏感凭据）。",
                "parameters": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "search_assets",
                "description": "按关键词搜索脱敏后的各类资产元数据（google/vault/card/ai/server/domain/reminder），最多返回 30 条。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": { "type": "string", "description": "搜索关键词，留空可列出最近记录" },
                        "kind": {
                            "type": "string",
                            "enum": ["all", "google", "vault", "card", "ai", "server", "domain", "reminder"]
                        }
                    },
                    "required": ["query"],
                    "additionalProperties": false
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "get_renewals_and_spend",
                "description": "获取未来 N 天内的续费时间线与 CNY/USD 月度及年度固定支出。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "within_days": { "type": "integer", "minimum": 1, "maximum": 365 }
                    },
                    "additionalProperties": false
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "get_server_status",
                "description": "查询已配置服务器的在线状态、系统版本、CPU/内存/磁盘指标及容器摘要（不含用户名与凭据）。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "server_id": { "type": "integer" }
                    },
                    "additionalProperties": false
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "propose_create_reminder",
                "description": "生成一个新增备忘提醒的待确认提案。不会直接写入数据库，需要用户在界面确认后才生效。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "title": { "type": "string", "maxLength": 80 },
                        "due_at": { "type": "string", "description": "YYYY-MM-DD" },
                        "repeat": { "type": "string", "enum": ["none", "week", "month", "year"] },
                        "lead_days": { "type": "integer", "minimum": 0, "maximum": 90 },
                        "note": { "type": "string", "maxLength": 1000 },
                        "reason": { "type": "string", "maxLength": 500 }
                    },
                    "required": ["title", "due_at", "reason"],
                    "additionalProperties": false
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "propose_update_asset",
                "description": "生成更新资产非敏感元数据的待确认提案（仅允许 billing_amount/billing_currency/billing_cycle/expires_at/renews_at/notes/tags）。需要用户确认后才生效。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "asset_kind": { "type": "string", "enum": ["server", "domain", "ai", "card"] },
                        "asset_id": { "type": "integer" },
                        "patch": {
                            "type": "object",
                            "properties": {
                                "billing_amount": { "type": ["number", "null"] },
                                "billing_currency": { "type": "string", "enum": ["CNY", "USD"] },
                                "billing_cycle": { "type": "string", "enum": ["month", "year", "once"] },
                                "expires_at": { "type": ["string", "null"] },
                                "renews_at": { "type": ["string", "null"] },
                                "notes": { "type": ["string", "null"] },
                                "tags": { "type": ["string", "null"] }
                            },
                            "additionalProperties": false
                        },
                        "reason": { "type": "string", "maxLength": 500 }
                    },
                    "required": ["asset_kind", "asset_id", "patch", "reason"],
                    "additionalProperties": false
                }
            }
        }
    ])
}

pub fn dispatch_agent_tool(
    conn: &Connection,
    tool_name: &str,
    args: &Value,
    proposals: &mut Vec<AgentProposal>,
) -> Value {
    let result = match tool_name {
        "get_workspace_summary" => execute_get_workspace_summary(conn),
        "search_assets" => {
            let query = args.get("query").and_then(|v| v.as_str()).unwrap_or("");
            let kind = args.get("kind").and_then(|v| v.as_str());
            execute_search_assets(conn, query, kind)
        }
        "get_renewals_and_spend" => {
            let days = args.get("within_days").and_then(|v| v.as_i64());
            execute_get_renewals_and_spend(conn, days)
        }
        "get_server_status" => {
            let server_id = args.get("server_id").and_then(|v| v.as_i64());
            execute_get_server_status(conn, server_id)
        }
        "propose_create_reminder" => match build_create_reminder_proposal(args) {
            Ok(prop) => {
                let id = prop.id.clone();
                let label = prop.target_label.clone();
                proposals.push(prop);
                Ok(json!({
                    "queued_for_confirmation": true,
                    "proposal_id": id,
                    "target": label,
                    "note": "提案已放入待确认卡片，尚未写入数据库。"
                }))
            }
            Err(e) => Err(e),
        },
        "propose_update_asset" => match build_update_asset_proposal(conn, args) {
            Ok(prop) => {
                let id = prop.id.clone();
                let label = prop.target_label.clone();
                proposals.push(prop);
                Ok(json!({
                    "queued_for_confirmation": true,
                    "proposal_id": id,
                    "target": label,
                    "note": "提案已放入待确认卡片，尚未写入数据库。"
                }))
            }
            Err(e) => Err(e),
        },
        other => Err(format!("未知工具：{}", other)),
    };

    match result {
        Ok(val) => val,
        Err(err) => json!({ "error": err }),
    }
}

pub fn recent_history_messages(conn: &Connection) -> Result<Vec<Value>, String> {
    let all = query_agent_messages(conn)?;
    let start = all.len().saturating_sub(HISTORY_CONTEXT_LIMIT);
    Ok(all[start..]
        .iter()
        .filter(|m| m.role == "user" || m.role == "assistant")
        .map(|m| json!({ "role": m.role, "content": m.content }))
        .collect())
}

async fn call_chat_completions(
    client: &reqwest::Client,
    cfg: &LoadedAgentConfig,
    messages: &[Value],
    with_tools: bool,
    max_tokens_override: Option<u32>,
) -> Result<Value, String> {
    let endpoint = format!("{}/chat/completions", cfg.base_url.trim_end_matches('/'));
    let mut body = json!({
        "model": cfg.model,
        "messages": messages,
        "max_tokens": max_tokens_override.unwrap_or(cfg.max_tokens),
        "temperature": 0.2,
    });
    if with_tools {
        if let Some(obj) = body.as_object_mut() {
            obj.insert("tools".to_string(), agent_tool_definitions());
            obj.insert("tool_choice".to_string(), json!("auto"));
        }
    }

    let mut req = client.post(&endpoint).json(&body);
    if !cfg.api_key.is_empty() {
        req = req.bearer_auth(&cfg.api_key);
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("请求 AI 模型接口失败: {}", e))?;
    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取模型响应失败: {}", e))?;
    if !status.is_success() {
        let snippet: String = text.chars().take(240).collect();
        return Err(format!("AI 接口返回错误 ({}): {}", status.as_u16(), snippet));
    }
    serde_json::from_str::<Value>(&text).map_err(|e| format!("解析模型响应 JSON 失败: {}", e))
}

pub async fn test_agent_connection(
    cfg: &LoadedAgentConfig,
) -> Result<AgentConnectionTestResult, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let start = Instant::now();
    let messages = vec![json!({ "role": "user", "content": "请回复 OK" })];
    let resp = call_chat_completions(&client, cfg, &messages, false, Some(16)).await?;
    let model = resp
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or(&cfg.model)
        .to_string();
    let latency_ms = start.elapsed().as_millis() as u64;
    Ok(AgentConnectionTestResult {
        ok: true,
        model: model.clone(),
        latency_ms,
        message: format!("连接成功（模型 {}，耗时 {} ms）", model, latency_ms),
    })
}

pub async fn run_agent_chat_turn(
    db: &crate::database::Database,
    cfg: LoadedAgentConfig,
    history_before_user: Vec<Value>,
    user_text: &str,
) -> Result<AgentMessageItem, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(AGENT_HTTP_TIMEOUT_SECS))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;

    let mut messages: Vec<Value> = Vec::new();
    messages.push(json!({ "role": "system", "content": agent_system_prompt() }));
    messages.extend(history_before_user);
    messages.push(json!({ "role": "user", "content": user_text }));

    let mut proposals: Vec<AgentProposal> = Vec::new();
    let mut final_text = String::new();

    for step in 0..=MAX_TOOL_STEPS {
        let allow_tools = step < MAX_TOOL_STEPS;
        let response = call_chat_completions(&client, &cfg, &messages, allow_tools, None).await?;
        let choice_msg = response
            .pointer("/choices/0/message")
            .ok_or_else(|| "模型未返回 choices[0].message".to_string())?;

        let content_str = choice_msg
            .get("content")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();

        let tool_calls = choice_msg
            .get("tool_calls")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        if tool_calls.is_empty() || !allow_tools {
            final_text = if !content_str.is_empty() {
                content_str
            } else if !proposals.is_empty() {
                "已为您生成以下变更提案，请核对差异并确认写入。".to_string()
            } else {
                "模型未返回文本内容。".to_string()
            };
            break;
        }

        messages.push(choice_msg.clone());

        // 短暂加锁执行本地只读工具与提案构造方法，绝不在 .await 期间持有锁
        let tool_outputs: Vec<(String, String)> = {
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            tool_calls
                .iter()
                .map(|tc| {
                    let call_id = tc
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("call")
                        .to_string();
                    let fn_name = tc
                        .pointer("/function/name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let raw_args = tc
                        .pointer("/function/arguments")
                        .and_then(|v| v.as_str())
                        .unwrap_or("{}");
                    let args = serde_json::from_str::<Value>(raw_args).unwrap_or_else(|_| json!({}));
                    let out = dispatch_agent_tool(&conn, fn_name, &args, &mut proposals);
                    (call_id, serde_json::to_string(&out).unwrap_or_else(|_| "{}".to_string()))
                })
                .collect()
        };

        for (call_id, out_json) in tool_outputs {
            messages.push(json!({
                "role": "tool",
                "tool_call_id": call_id,
                "content": out_json,
            }));
        }
    }

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    insert_agent_message(&conn, "assistant", &final_text, &proposals)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::init_database_at_for_test;

    fn open_temp_db(dir: &std::path::Path) -> Connection {
        init_database_at_for_test(&dir.join("data.db"), &dir.join("backups")).unwrap()
    }

    #[test]
    fn test_validate_agent_base_url_rules() {
        assert_eq!(
            validate_agent_base_url("https://api.openai.com/v1/").unwrap(),
            "https://api.openai.com/v1"
        );
        assert_eq!(
            validate_agent_base_url("http://127.0.0.1:11434/v1").unwrap(),
            "http://127.0.0.1:11434/v1"
        );
        assert_eq!(
            validate_agent_base_url("http://localhost:8000/v1/").unwrap(),
            "http://localhost:8000/v1"
        );
        assert!(validate_agent_base_url("http://example.com/v1").is_err());
        assert!(validate_agent_base_url("https://user:pass@api.openai.com/v1").is_err());
        assert!(validate_agent_base_url("https://api.openai.com/v1?k=1").is_err());
    }

    #[test]
    fn test_strict_redaction_never_leaks_any_sentinel_secret() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = open_temp_db(tmp.path());

        let sentinels = [
            "SENTINEL_GOOGLE_PASS_9182",
            "SENTINEL_GOOGLE_2FA_SECRET_3746",
            "SENTINEL_GOOGLE_SMS_TOKEN_5521",
            "SENTINEL_GOOGLE_RECOVERY_4410",
            "SENTINEL_GOOGLE_PHONE_9911",
            "SENTINEL_VAULT_USER_1001",
            "SENTINEL_VAULT_SECRET_1002",
            "SENTINEL_VAULT_TOTP_1003",
            "SENTINEL_VAULT_NOTES_1004",
            "SENTINEL_VAULT_URL_SECRET_TOKEN_1005",
            "SENTINEL_CARD_NUMBER_4111222233334455",
            "SENTINEL_CARD_CVV_899",
            "SENTINEL_CARD_HOLDER_2003",
            "SENTINEL_CARD_ADDR_2004",
            "SENTINEL_CARD_NOTES_2005",
            "SENTINEL_AI_KEY_HINT_3001",
            "SENTINEL_AI_OAUTH_TOKEN_3002",
            "SENTINEL_AI_OAUTH_ACCOUNT_3003",
            "SENTINEL_SERVER_SSH_USER_4001",
            "SENTINEL_SERVER_SSH_CRED_4002",
            "SENTINEL_SERVER_PASSPHRASE_4003",
            "SENTINEL_SERVER_FINGERPRINT_4004",
            "SENTINEL_CF_API_TOKEN_5001",
            "SENTINEL_AGENT_API_KEY_6001",
        ];

        conn.execute(
            "INSERT INTO accounts (email, password, recovery, phone, secret, sms_url, status, group_name)
             VALUES ('alpha@gmail.com', 'SENTINEL_GOOGLE_PASS_9182', 'SENTINEL_GOOGLE_RECOVERY_4410',
                     'SENTINEL_GOOGLE_PHONE_9911', 'SENTINEL_GOOGLE_2FA_SECRET_3746',
                     'https://sms.example/api?t=SENTINEL_GOOGLE_SMS_TOKEN_5521', 'pro', 'work')",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO vault_items (kind, name, url, username, secret_value, totp_secret, tags, notes)
             VALUES ('api', 'alpha-api', 'https://u:p@api.vendor.dev/v1?secret=SENTINEL_VAULT_URL_SECRET_TOKEN_1005',
                     'SENTINEL_VAULT_USER_1001', 'SENTINEL_VAULT_SECRET_1002', 'SENTINEL_VAULT_TOTP_1003',
                     'alpha', 'SENTINEL_VAULT_NOTES_1004')",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO payment_cards (name, issuer, last4, card_number, cvv, cardholder, billing_address,
                                        billing_amount, billing_currency, billing_cycle, expires_at, notes)
             VALUES ('alpha-card', 'VisaBank', '4455', 'SENTINEL_CARD_NUMBER_4111222233334455',
                     'SENTINEL_CARD_CVV_899', 'SENTINEL_CARD_HOLDER_2003', 'SENTINEL_CARD_ADDR_2004',
                     10.0, 'USD', 'year', '2026-12-10', 'SENTINEL_CARD_NOTES_2005')",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO ai_subscriptions (name, provider, plan, key_hint, oauth_provider, oauth_account_id,
                                           oauth_token_json, billing_amount, billing_currency, billing_cycle, renews_at)
             VALUES ('alpha-ai', 'OpenAI', 'Plus', 'SENTINEL_AI_KEY_HINT_3001', 'codex',
                     'SENTINEL_AI_OAUTH_ACCOUNT_3003', '{\"access_token\":\"SENTINEL_AI_OAUTH_TOKEN_3002\"}',
                     20.0, 'USD', 'month', '2026-12-05')",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO servers (name, host, port, username, auth_kind, credential, passphrase, host_fingerprint,
                                  status, cpu, memory, disk, billing_amount, billing_currency, billing_cycle, expires_at)
             VALUES ('alpha-vps', '10.10.0.1', 22, 'SENTINEL_SERVER_SSH_USER_4001', 'key',
                     'SENTINEL_SERVER_SSH_CRED_4002', 'SENTINEL_SERVER_PASSPHRASE_4003',
                     'SENTINEL_SERVER_FINGERPRINT_4004', 'online', 15.0, 40.0, 50.0,
                     5.0, 'USD', 'month', '2026-12-01')",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO cloudflare_connections (name, api_token) VALUES ('alpha-cf', 'SENTINEL_CF_API_TOKEN_5001')",
            [],
        )
        .unwrap();
        let cf_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO domains (name, registrar, billing_amount, billing_currency, billing_cycle, expires_at, cf_connection_id)
             VALUES ('alpha.dev', 'Cloudflare', 12.0, 'USD', 'year', '2026-12-12', ?1)",
            [cf_id],
        )
        .unwrap();

        database::set_setting(&conn, SETTING_AGENT_API_KEY, Some("SENTINEL_AGENT_API_KEY_6001")).unwrap();

        let outputs = vec![
            execute_get_workspace_summary(&conn).unwrap(),
            execute_search_assets(&conn, "alpha", None).unwrap(),
            execute_search_assets(&conn, "", Some("all")).unwrap(),
            execute_get_renewals_and_spend(&conn, Some(365)).unwrap(),
            execute_get_server_status(&conn, None).unwrap(),
        ];
        let combined = serde_json::to_string(&outputs).unwrap();

        // 确认正常脱敏后的资产名称确实有返回，避免测试空跑
        assert!(combined.contains("alpha@gmail.com"));
        assert!(combined.contains("api.vendor.dev"));
        assert!(combined.contains("alpha-vps"));
        assert!(combined.contains("alpha.dev"));

        for sentinel in sentinels {
            assert!(
                !combined.contains(sentinel),
                "发现敏感字段泄露哨兵值: {}",
                sentinel
            );
        }
    }

    #[test]
    fn test_proposal_validation_and_transactional_apply_reject() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = open_temp_db(tmp.path());

        let srv = assets_db::create_server(
            &conn,
            assets_db::ServerInput {
                name: "SG-1".to_string(),
                host: "1.1.1.1".to_string(),
                port: Some(22),
                username: Some("root".to_string()),
                auth_kind: Some("password".to_string()),
                credential: Some("my-secret".to_string()),
                passphrase: None,
                region: None,
                os: None,
                kernel: None,
                collect_enabled: None,
                billing_amount: Some(5.0),
                billing_currency: Some("USD".to_string()),
                billing_cycle: Some("month".to_string()),
                expires_at: Some("2026-12-01".to_string()),
                tags: None,
                notes: None,
            },
        )
        .unwrap();

        // 拒绝修改敏感字段
        let forbidden = build_update_asset_proposal(
            &conn,
            &json!({
                "asset_kind": "server",
                "asset_id": srv.id,
                "patch": { "credential": "hacked" },
                "reason": "test"
            }),
        );
        assert!(forbidden.is_err());

        // 合法提案队列：新增提醒 + 修改费用与到期日
        let p1 = build_create_reminder_proposal(&json!({
            "title": "检查 SG-1 续费",
            "due_at": "2026-12-20",
            "repeat": "month",
            "reason": "定期提醒"
        }))
        .unwrap();
        let p2 = build_update_asset_proposal(
            &conn,
            &json!({
                "asset_kind": "server",
                "asset_id": srv.id,
                "patch": { "billing_amount": 8.5, "expires_at": "2027-01-01", "tags": "prod,sg" },
                "reason": "续费调价"
            }),
        )
        .unwrap();

        let msg = insert_agent_message(&conn, "assistant", "已生成提案", &[p1.clone(), p2.clone()]).unwrap();
        // 确认尚未点击确认前并未写入数据库
        assert_eq!(assets_db::query_reminders(&conn).unwrap().len(), 0);
        assert_eq!(assets_db::require_server_by_id(&conn, srv.id).unwrap().billing_amount, Some(5.0));

        // 确认应用 p2
        let after_apply = apply_agent_proposal(&conn, msg.id, &p2.id).unwrap();
        assert_eq!(after_apply.proposals[1].status, "applied");
        let updated_srv = assets_db::require_server_by_id(&conn, srv.id).unwrap();
        assert_eq!(updated_srv.billing_amount, Some(8.5));
        assert_eq!(updated_srv.expires_at.as_deref(), Some("2027-01-01"));
        assert_eq!(updated_srv.tags.as_deref(), Some("prod,sg"));
        // 凭据原封不动
        assert_eq!(updated_srv.credential.as_deref(), Some("my-secret"));

        // 禁止重复应用
        assert!(apply_agent_proposal(&conn, msg.id, &p2.id).is_err());

        // 忽略 p1
        let after_reject = reject_agent_proposal(&conn, msg.id, &p1.id).unwrap();
        assert_eq!(after_reject.proposals[0].status, "rejected");
        assert_eq!(assets_db::query_reminders(&conn).unwrap().len(), 0);
    }
}
