use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter};
use url::Url;

use crate::assets_db;
use crate::database;
use crate::fx;

pub const SETTING_AGENT_BASE_URL: &str = "agent.base_url";
pub const SETTING_AGENT_API_KEY: &str = "agent.api_key";
pub const SETTING_AGENT_MODEL: &str = "agent.model";
pub const SETTING_AGENT_MAX_TOKENS: &str = "agent.max_tokens";
pub const SETTING_AGENT_CONTEXT_WINDOW: &str = "agent.context_window";
pub const SETTING_AGENT_TEMPERATURE: &str = "agent.temperature";
pub const SETTING_AGENT_AUTO_COMPACT: &str = "agent.auto_compact";
pub const SETTING_AGENT_RESERVE_TOKENS: &str = "agent.reserve_tokens";
pub const SETTING_AGENT_KEEP_RECENT_TOKENS: &str = "agent.keep_recent_tokens";
pub const SETTING_AGENT_MEMORY_ENABLED: &str = "agent.memory_enabled";
pub const SETTING_AGENT_CUSTOM_SYSTEM_PROMPT: &str = "agent.custom_system_prompt";

pub const DEFAULT_MAX_TOKENS: u32 = 16384;
pub const MIN_EXPLICIT_MAX_TOKENS: u32 = 256;
pub const MAX_TOKENS_UPPER: u32 = 1_000_000;
pub const DEFAULT_CONTEXT_WINDOW: u32 = 128_000;
pub const MIN_CONTEXT_WINDOW: u32 = 4_096;
pub const MAX_CONTEXT_WINDOW: u32 = 2_000_000;
pub const DEFAULT_TEMPERATURE: f64 = 0.2;
pub const DEFAULT_RESERVE_TOKENS: u32 = 16_384;
pub const DEFAULT_KEEP_RECENT_TOKENS: u32 = 20_000;
pub const MAX_CUSTOM_SYSTEM_PROMPT_CHARS: usize = 4_000;
const MAX_TOOL_STEPS: usize = 6;
const AGENT_HTTP_TIMEOUT_SECS: u64 = 300;
#[allow(dead_code)]
const HISTORY_CONTEXT_LIMIT: usize = 20;

/// 0 表示不显式传 max_tokens（交由服务端/推理模型自动使用默认上限）；否则约束在 256..=1_000_000
pub fn normalize_max_tokens(raw: u32) -> u32 {
    if raw == 0 {
        0
    } else {
        raw.clamp(MIN_EXPLICIT_MAX_TOKENS, MAX_TOKENS_UPPER)
    }
}

pub fn normalize_context_window(raw: u32) -> u32 {
    if raw == 0 {
        DEFAULT_CONTEXT_WINDOW
    } else {
        raw.clamp(MIN_CONTEXT_WINDOW, MAX_CONTEXT_WINDOW)
    }
}

pub fn normalize_temperature(raw: f64) -> f64 {
    if !raw.is_finite() {
        DEFAULT_TEMPERATURE
    } else {
        let clamped = raw.clamp(0.0, 2.0);
        (clamped * 100.0).round() / 100.0
    }
}

pub fn normalize_reserve_tokens(raw: u32) -> u32 {
    if raw == 0 {
        DEFAULT_RESERVE_TOKENS
    } else {
        raw.clamp(1_024, 256_000)
    }
}

pub fn normalize_keep_recent_tokens(raw: u32) -> u32 {
    if raw == 0 {
        DEFAULT_KEEP_RECENT_TOKENS
    } else {
        raw.clamp(1_000, 500_000)
    }
}

fn parse_bool_setting(raw: Option<String>, default: bool) -> bool {
    match raw
        .as_deref()
        .map(str::trim)
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("1") | Some("true") | Some("yes") | Some("on") => true,
        Some("0") | Some("false") | Some("no") | Some("off") => false,
        _ => default,
    }
}

pub struct AgentStreamManager {
    active: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl AgentStreamManager {
    pub fn new() -> Self {
        Self {
            active: Mutex::new(HashMap::new()),
        }
    }

    pub fn register(&self, stream_id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        let mut guard = self.active.lock().unwrap_or_else(|e| e.into_inner());
        guard.insert(stream_id.to_string(), flag.clone());
        flag
    }

    pub fn remove(&self, stream_id: &str) {
        let mut guard = self.active.lock().unwrap_or_else(|e| e.into_inner());
        guard.remove(stream_id);
    }

    pub fn cancel(&self, stream_id: Option<&str>) -> bool {
        let guard = self.active.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(id) = stream_id {
            if let Some(flag) = guard.get(id) {
                flag.store(true, Ordering::SeqCst);
                return true;
            }
            return false;
        }
        let mut any = false;
        for flag in guard.values() {
            flag.store(true, Ordering::SeqCst);
            any = true;
        }
        any
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSettingsView {
    pub base_url: String,
    pub model: String,
    pub max_tokens: u32,
    pub has_api_key: bool,
    pub api_key_hint: Option<String>,
    pub context_window: u32,
    pub temperature: f64,
    pub auto_compact: bool,
    pub reserve_tokens: u32,
    pub keep_recent_tokens: u32,
    pub memory_enabled: bool,
    pub custom_system_prompt: String,
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
    #[serde(default)]
    pub context_window: Option<u32>,
    #[serde(default)]
    pub temperature: Option<f64>,
    #[serde(default)]
    pub auto_compact: Option<bool>,
    #[serde(default)]
    pub reserve_tokens: Option<u32>,
    #[serde(default)]
    pub keep_recent_tokens: Option<u32>,
    #[serde(default)]
    pub memory_enabled: Option<bool>,
    #[serde(default)]
    pub custom_system_prompt: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConnectionTestResult {
    pub ok: bool,
    pub model: String,
    pub latency_ms: u64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentModelInfo {
    pub id: String,
    pub owned_by: Option<String>,
    pub context_window: Option<u32>,
    pub max_output_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentModelListResult {
    pub models: Vec<AgentModelInfo>,
    pub source_url: String,
    pub fetched_count: usize,
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
    #[allow(dead_code)]
    pub context_window: u32,
    pub temperature: f64,
    pub auto_compact: bool,
    pub reserve_tokens: u32,
    pub keep_recent_tokens: u32,
    pub memory_enabled: bool,
    pub custom_system_prompt: String,
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
        .map(normalize_max_tokens)
        .unwrap_or(DEFAULT_MAX_TOKENS);
    let context_window = database::get_setting(conn, SETTING_AGENT_CONTEXT_WINDOW)?
        .and_then(|s| s.trim().parse::<u32>().ok())
        .map(normalize_context_window)
        .unwrap_or(DEFAULT_CONTEXT_WINDOW);
    let temperature = database::get_setting(conn, SETTING_AGENT_TEMPERATURE)?
        .and_then(|s| s.trim().parse::<f64>().ok())
        .map(normalize_temperature)
        .unwrap_or(DEFAULT_TEMPERATURE);
    let auto_compact = parse_bool_setting(
        database::get_setting(conn, SETTING_AGENT_AUTO_COMPACT)?,
        true,
    );
    let reserve_tokens = database::get_setting(conn, SETTING_AGENT_RESERVE_TOKENS)?
        .and_then(|s| s.trim().parse::<u32>().ok())
        .map(normalize_reserve_tokens)
        .unwrap_or(DEFAULT_RESERVE_TOKENS);
    let keep_recent_tokens = database::get_setting(conn, SETTING_AGENT_KEEP_RECENT_TOKENS)?
        .and_then(|s| s.trim().parse::<u32>().ok())
        .map(normalize_keep_recent_tokens)
        .unwrap_or(DEFAULT_KEEP_RECENT_TOKENS);
    let memory_enabled = parse_bool_setting(
        database::get_setting(conn, SETTING_AGENT_MEMORY_ENABLED)?,
        true,
    );
    let custom_system_prompt = database::get_setting(conn, SETTING_AGENT_CUSTOM_SYSTEM_PROMPT)?
        .unwrap_or_default();
    let key_raw = database::get_setting(conn, SETTING_AGENT_API_KEY)?
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    Ok(AgentSettingsView {
        base_url,
        model,
        max_tokens,
        has_api_key: key_raw.is_some(),
        api_key_hint: key_raw.as_deref().map(mask_api_key),
        context_window,
        temperature,
        auto_compact,
        reserve_tokens,
        keep_recent_tokens,
        memory_enabled,
        custom_system_prompt,
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
        context_window: view.context_window,
        temperature: view.temperature,
        auto_compact: view.auto_compact,
        reserve_tokens: view.reserve_tokens,
        keep_recent_tokens: view.keep_recent_tokens,
        memory_enabled: view.memory_enabled,
        custom_system_prompt: view.custom_system_prompt,
    })
}

pub fn save_agent_settings(
    conn: &Connection,
    input: &AgentSettingsInput,
) -> Result<AgentSettingsView, String> {
    let existing = get_agent_settings(conn)?;
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

    let max_tokens = normalize_max_tokens(input.max_tokens.unwrap_or(existing.max_tokens));
    database::set_setting(
        conn,
        SETTING_AGENT_MAX_TOKENS,
        Some(&max_tokens.to_string()),
    )?;

    if let Some(cw) = input.context_window {
        let normalized_cw = normalize_context_window(cw);
        database::set_setting(
            conn,
            SETTING_AGENT_CONTEXT_WINDOW,
            Some(&normalized_cw.to_string()),
        )?;
    }

    if let Some(temp) = input.temperature {
        let normalized_temp = normalize_temperature(temp);
        database::set_setting(
            conn,
            SETTING_AGENT_TEMPERATURE,
            Some(&format!("{:.2}", normalized_temp)),
        )?;
    }

    if let Some(auto_compact) = input.auto_compact {
        database::set_setting(
            conn,
            SETTING_AGENT_AUTO_COMPACT,
            Some(if auto_compact { "1" } else { "0" }),
        )?;
    }

    if let Some(reserve) = input.reserve_tokens {
        let normalized_reserve = normalize_reserve_tokens(reserve);
        database::set_setting(
            conn,
            SETTING_AGENT_RESERVE_TOKENS,
            Some(&normalized_reserve.to_string()),
        )?;
    }

    if let Some(keep) = input.keep_recent_tokens {
        let normalized_keep = normalize_keep_recent_tokens(keep);
        database::set_setting(
            conn,
            SETTING_AGENT_KEEP_RECENT_TOKENS,
            Some(&normalized_keep.to_string()),
        )?;
    }

    if let Some(mem_enabled) = input.memory_enabled {
        database::set_setting(
            conn,
            SETTING_AGENT_MEMORY_ENABLED,
            Some(if mem_enabled { "1" } else { "0" }),
        )?;
    }

    if let Some(ref custom_prompt) = input.custom_system_prompt {
        let trimmed = custom_prompt.trim();
        if trimmed.is_empty() {
            database::set_setting(conn, SETTING_AGENT_CUSTOM_SYSTEM_PROMPT, None)?;
        } else {
            let capped: String = trimmed.chars().take(MAX_CUSTOM_SYSTEM_PROMPT_CHARS).collect();
            database::set_setting(conn, SETTING_AGENT_CUSTOM_SYSTEM_PROMPT, Some(&capped))?;
        }
    }

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

fn json_u32(val: Option<&Value>) -> Option<u32> {
    let v = val?;
    if let Some(n) = v.as_u64() {
        return u32::try_from(n).ok().filter(|&x| x > 0);
    }
    if let Some(f) = v.as_f64() {
        if f.is_finite() && f >= 1.0 && f <= u32::MAX as f64 && f.fract() == 0.0 {
            return Some(f as u32);
        }
    }
    if let Some(s) = v.as_str() {
        let trimmed = s.trim();
        if let Ok(n) = trimmed.parse::<u32>() {
            return (n > 0).then_some(n);
        }
        if let Ok(f) = trimmed.parse::<f64>() {
            if f.is_finite() && f >= 1.0 && f <= u32::MAX as f64 && f.fract() == 0.0 {
                return Some(f as u32);
            }
        }
    }
    None
}

fn extract_api_error_message(val: &Value) -> Option<String> {
    let err = val.get("error")?;
    if err.is_null() || err == &Value::Bool(false) {
        return None;
    }
    let msg = err
        .as_str()
        .or_else(|| err.get("message").and_then(|v| v.as_str()))
        .or_else(|| err.get("detail").and_then(|v| v.as_str()))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.chars().take(240).collect::<String>())
        .unwrap_or_else(|| err.to_string().chars().take(240).collect::<String>());
    Some(msg)
}

pub fn parse_models_response(val: &Value) -> Vec<AgentModelInfo> {
    let items: Option<&Vec<Value>> = val
        .get("data")
        .and_then(|v| v.as_array())
        .or_else(|| val.get("models").and_then(|v| v.as_array()))
        .or_else(|| val.as_array());

    let Some(list) = items else {
        return Vec::new();
    };

    let mut seen: HashSet<String> = HashSet::new();
    let mut out: Vec<AgentModelInfo> = Vec::new();

    for item in list {
        let raw_id = if let Some(s) = item.as_str() {
            s
        } else if let Some(s) = item
            .get("id")
            .or_else(|| item.get("name"))
            .and_then(|v| v.as_str())
        {
            s
        } else {
            continue;
        };

        let id = raw_id.trim();
        if id.is_empty() || !seen.insert(id.to_string()) {
            continue;
        }

        let owned_by = item
            .get("owned_by")
            .or_else(|| item.get("provider"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);

        let context_window = json_u32(item.get("context_window"))
            .or_else(|| json_u32(item.get("context_length")))
            .or_else(|| json_u32(item.get("max_context_length")))
            .or_else(|| json_u32(item.get("input_token_limit")))
            .or_else(|| json_u32(item.pointer("/top_provider/context_length")));

        let max_output_tokens = json_u32(item.get("max_completion_tokens"))
            .or_else(|| json_u32(item.get("max_output_tokens")))
            .or_else(|| json_u32(item.get("output_token_limit")))
            .or_else(|| json_u32(item.pointer("/top_provider/max_completion_tokens")));

        out.push(AgentModelInfo {
            id: id.to_string(),
            owned_by,
            context_window,
            max_output_tokens,
        });
    }

    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

pub async fn fetch_agent_models(
    base_url: &str,
    api_key: &str,
) -> Result<AgentModelListResult, String> {
    let normalized = validate_agent_base_url(base_url)?;
    let endpoint = format!("{}/models", normalized.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = client.get(&endpoint).header("Accept", "application/json");
    let key = api_key.trim();
    if !key.is_empty() {
        req = req.bearer_auth(key);
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("拉取模型列表失败: {}", e))?;
    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取模型列表响应失败: {}", e))?;

    if !status.is_success() {
        let snippet: String = text.chars().take(240).collect();
        return Err(format!(
            "拉取模型列表失败 ({}): {}",
            status.as_u16(),
            snippet
        ));
    }

    let parsed = serde_json::from_str::<Value>(&text)
        .map_err(|e| format!("解析模型列表 JSON 失败: {}", e))?;
    let models = parse_models_response(&parsed);
    if models.is_empty() {
        if let Some(api_err) = extract_api_error_message(&parsed) {
            return Err(format!("拉取模型列表失败: {}", api_err));
        }
    }
    let fetched_count = models.len();
    Ok(AgentModelListResult {
        models,
        source_url: endpoint,
        fetched_count,
    })
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

fn current_usd_cny_rate(conn: &Connection) -> f64 {
    fx::read_cached_rate(conn)
        .map(|r| r.rate)
        .unwrap_or(fx::DEFAULT_USD_CNY_RATE)
}

pub fn execute_get_workspace_summary(conn: &Connection) -> Result<Value, String> {
    let overview = assets_db::get_workspace_overview(conn, assets_db::today_local())?;
    let spend = assets_db::get_renewals_summary(conn, 90, assets_db::today_local())?;
    let rate = current_usd_cny_rate(conn);
    let unified_cny_monthly = ((spend.spend.cny.monthly + spend.spend.usd.monthly * rate) * 100.0).round() / 100.0;
    let unified_cny_yearly = ((spend.spend.cny.yearly + spend.spend.usd.yearly * rate) * 100.0).round() / 100.0;
    Ok(json!({
        "today": assets_db::today_local().format("%Y-%m-%d").to_string(),
        "usd_cny_rate": rate,
        "unified_cny_monthly": unified_cny_monthly,
        "unified_cny_yearly": unified_cny_yearly,
        "overview": overview,
        "upcoming_90d_count": spend.timeline.len(),
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
    let days = within_days.unwrap_or(90).clamp(1, 365);
    let summary = assets_db::get_renewals_summary(conn, days, assets_db::today_local())?;
    let rate = current_usd_cny_rate(conn);
    let unified_cny_monthly = ((summary.spend.cny.monthly + summary.spend.usd.monthly * rate) * 100.0).round() / 100.0;
    let unified_cny_yearly = ((summary.spend.cny.yearly + summary.spend.usd.yearly * rate) * 100.0).round() / 100.0;
    Ok(json!({
        "today": assets_db::today_local().format("%Y-%m-%d").to_string(),
        "within_days": days,
        "usd_cny_rate": rate,
        "unified_cny_monthly": unified_cny_monthly,
        "unified_cny_yearly": unified_cny_yearly,
        "timeline": summary.timeline,
        "spend": summary.spend,
    }))
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
    conn.execute(
        "DELETE FROM agent_compactions WHERE session_id = 'default'",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ─── Hermes Agent 风格本地持久化记忆（USER.md + MEMORY.md）───────────────

pub const MEMORY_TARGET_USER: &str = "user";
pub const MEMORY_TARGET_MEMORY: &str = "memory";
pub const MEMORY_USER_CHAR_BUDGET: usize = 1_500;
pub const MEMORY_NOTES_CHAR_BUDGET: usize = 2_500;
pub const MEMORY_ENTRY_MAX_CHARS: usize = 300;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMemoryEntry {
    pub id: i64,
    pub target: String,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMemorySnapshot {
    pub memory_enabled: bool,
    pub memory_dir: String,
    pub user_budget: usize,
    pub memory_budget: usize,
    pub user_used_chars: usize,
    pub memory_used_chars: usize,
    pub user_entries: Vec<AgentMemoryEntry>,
    pub memory_entries: Vec<AgentMemoryEntry>,
    pub user_markdown: String,
    pub memory_markdown: String,
}

pub fn normalize_memory_target(raw: &str) -> Result<&'static str, String> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "user" | "user.md" => Ok(MEMORY_TARGET_USER),
        "memory" | "memory.md" | "notes" => Ok(MEMORY_TARGET_MEMORY),
        other => Err(format!("不支持的记忆分区（仅支持 user / memory）：{}", other)),
    }
}

fn memory_budget_for_target(target: &str) -> usize {
    if target == MEMORY_TARGET_USER {
        MEMORY_USER_CHAR_BUDGET
    } else {
        MEMORY_NOTES_CHAR_BUDGET
    }
}

fn normalize_memory_entry_text(raw: &str) -> Result<String, String> {
    let normalized = raw
        .replace(['\r', '\n', '\t'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let trimmed = normalized.trim();
    if trimmed.is_empty() {
        return Err("记忆内容不能为空".to_string());
    }
    if trimmed.chars().count() > MEMORY_ENTRY_MAX_CHARS {
        return Err(format!(
            "单条记忆不能超过 {} 个字符，请精简后再保存",
            MEMORY_ENTRY_MAX_CHARS
        ));
    }
    Ok(trimmed.to_string())
}

fn has_token_after_prefix(text: &str, prefix: &str, min_len: usize, allow_dash: bool) -> bool {
    let bytes = text.as_bytes();
    let mut search_from = 0usize;
    while let Some(pos) = text[search_from..].find(prefix) {
        let abs_pos = search_from + pos;
        let boundary_ok = abs_pos == 0 || {
            let prev = bytes[abs_pos - 1];
            !(prev.is_ascii_alphanumeric() || prev == b'_')
        };
        let after = &text[abs_pos + prefix.len()..];
        let tok_len = after
            .chars()
            .take_while(|c| {
                c.is_ascii_alphanumeric()
                    || *c == '_'
                    || (allow_dash && (*c == '-' || *c == '.'))
            })
            .count();
        if boundary_ok && tok_len >= min_len {
            return true;
        }
        search_from = abs_pos + prefix.len();
    }
    false
}

fn passes_luhn(digits: &[u8]) -> bool {
    if digits.len() < 13 || digits.len() > 19 || digits.iter().all(|&d| d == 0) {
        return false;
    }
    let mut sum = 0u32;
    let mut double = false;
    for &d in digits.iter().rev() {
        let mut v = d as u32;
        if double {
            v *= 2;
            if v > 9 {
                v -= 9;
            }
        }
        sum += v;
        double = !double;
    }
    sum.is_multiple_of(10)
}

fn contains_bank_card_pattern(text: &str) -> bool {
    let chars: Vec<char> = text.chars().collect();

    // 1. 完整连续 15~19 位数字且通过 Luhn 校验（避免误伤 16~32 位订单号、Snowflake ID、GCP ID）
    let mut idx = 0usize;
    while idx < chars.len() {
        if chars[idx].is_ascii_digit() {
            let start = idx;
            while idx < chars.len() && chars[idx].is_ascii_digit() {
                idx += 1;
            }
            let len = idx - start;
            if (15..=19).contains(&len) {
                let digits: Vec<u8> = chars[start..idx]
                    .iter()
                    .map(|c| *c as u8 - b'0')
                    .collect();
                if passes_luhn(&digits) {
                    return true;
                }
            }
        } else {
            idx += 1;
        }
    }

    // 2. 分组格式银行卡号：4-4-4-4 或 Amex 4-6-5（支持横杠/空格连接，含混用分隔符）
    let is_sep = |c: char| c == '-' || c == ' ';
    for i in 0..chars.len() {
        if !chars[i].is_ascii_digit() {
            continue;
        }
        if i > 0 && chars[i - 1].is_ascii_digit() {
            continue;
        }
        if i + 19 <= chars.len() {
            let slice = &chars[i..i + 19];
            if is_sep(slice[4])
                && is_sep(slice[9])
                && is_sep(slice[14])
                && slice[0..4].iter().all(|c| c.is_ascii_digit())
                && slice[5..9].iter().all(|c| c.is_ascii_digit())
                && slice[10..14].iter().all(|c| c.is_ascii_digit())
                && slice[15..19].iter().all(|c| c.is_ascii_digit())
            {
                let after_ok = i + 19 == chars.len() || !chars[i + 19].is_ascii_digit();
                if after_ok {
                    return true;
                }
            }
        }
        if i + 17 <= chars.len() {
            let slice = &chars[i..i + 17];
            if is_sep(slice[4])
                && is_sep(slice[11])
                && slice[0..4].iter().all(|c| c.is_ascii_digit())
                && slice[5..11].iter().all(|c| c.is_ascii_digit())
                && slice[12..17].iter().all(|c| c.is_ascii_digit())
            {
                let after_ok = i + 17 == chars.len() || !chars[i + 17].is_ascii_digit();
                if after_ok {
                    let digits: Vec<u8> = slice
                        .iter()
                        .filter(|c| c.is_ascii_digit())
                        .map(|c| *c as u8 - b'0')
                        .collect();
                    if passes_luhn(&digits) {
                        return true;
                    }
                }
            }
        }
    }
    false
}

fn contains_cvv_pattern(lower: &str) -> bool {
    let bytes = lower.as_bytes();
    for kw in ["cvv", "cvc"] {
        let mut from = 0usize;
        while let Some(pos) = lower[from..].find(kw) {
            let abs = from + pos;
            let before_ok = abs == 0 || {
                let prev = bytes[abs - 1];
                !(prev.is_ascii_alphanumeric() || prev == b'_')
            };
            if before_ok {
                let after = lower[abs + kw.len()..].trim_start_matches(|c: char| {
                    c == ':' || c == '=' || c == ' ' || c == '：'
                });
                let digits = after.chars().take_while(|c| c.is_ascii_digit()).count();
                if (3..=4).contains(&digits) {
                    let after_digits_ok = after[digits..]
                        .chars()
                        .next()
                        .map(|c| !(c.is_ascii_alphanumeric() || c == '_'))
                        .unwrap_or(true);
                    if after_digits_ok {
                        return true;
                    }
                }
            }
            from = abs + kw.len();
        }
    }
    false
}

fn contains_jwt_pattern(text: &str) -> bool {
    let is_b64url = |c: char| c.is_ascii_alphanumeric() || c == '-' || c == '_';
    for token in text.split(|c: char| !(is_b64url(c) || c == '.')) {
        if !token.starts_with("eyJ") {
            continue;
        }
        let mut parts = token.split('.');
        if let (Some(h), Some(p), Some(s), None) =
            (parts.next(), parts.next(), parts.next(), parts.next())
        {
            if h.len() >= 10
                && p.len() >= 10
                && s.len() >= 10
                && h.chars().all(is_b64url)
                && p.chars().all(is_b64url)
                && s.chars().all(is_b64url)
            {
                return true;
            }
        }
    }
    false
}

pub fn validate_memory_content_safety(content: &str) -> Result<(), String> {
    let lower = content.to_ascii_lowercase();
    let has_pem = lower.contains("-----begin ") && lower.contains("private key-----");
    let has_otp = lower.contains("otpauth://");
    let has_secret_prefix = has_token_after_prefix(&lower, "sk-", 20, true)
        || has_token_after_prefix(&lower, "gocspx-", 10, true)
        || has_token_after_prefix(&lower, "ghp_", 16, false)
        || has_token_after_prefix(&lower, "gho_", 16, false)
        || has_token_after_prefix(&lower, "github_pat_", 16, false)
        || has_token_after_prefix(&lower, "xoxb-", 12, true)
        || has_token_after_prefix(&lower, "xoxp-", 12, true)
        || has_token_after_prefix(&lower, "aiza", 25, true)
        || has_token_after_prefix(&lower, "xai-", 20, true)
        || has_token_after_prefix(&lower, "akia", 16, false)
        || has_token_after_prefix(&lower, "ya29.", 20, true)
        || has_token_after_prefix(&lower, "1//0", 20, true)
        || has_token_after_prefix(&lower, "bearer ", 20, true);

    if has_pem
        || has_otp
        || has_secret_prefix
        || contains_jwt_pattern(content)
        || contains_bank_card_pattern(content)
        || contains_cvv_pattern(&lower)
    {
        return Err(
            "为保护资产安全，本地记忆禁止保存私钥、API Key、OAuth 令牌、2FA 密钥或银行卡号等敏感凭据"
                .to_string(),
        );
    }
    Ok(())
}

pub fn query_memory_entries(
    conn: &Connection,
    target: Option<&str>,
) -> Result<Vec<AgentMemoryEntry>, String> {
    if let Some(t) = target {
        let normalized = normalize_memory_target(t)?;
        let mut stmt = conn
            .prepare(
                "SELECT id, target, content, created_at, updated_at
                 FROM agent_memory_entries
                 WHERE target = ?1
                 ORDER BY id ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([normalized], |row| {
                Ok(AgentMemoryEntry {
                    id: row.get(0)?,
                    target: row.get(1)?,
                    content: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT id, target, content, created_at, updated_at
                 FROM agent_memory_entries
                 ORDER BY target ASC, id ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(AgentMemoryEntry {
                    id: row.get(0)?,
                    target: row.get(1)?,
                    content: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }
}

pub fn memory_used_chars(entries: &[AgentMemoryEntry]) -> usize {
    if entries.is_empty() {
        return 0;
    }
    entries
        .iter()
        .enumerate()
        .map(|(idx, e)| e.content.chars().count() + 2 + usize::from(idx > 0))
        .sum()
}

pub fn render_memory_markdown(target: &str, entries: &[AgentMemoryEntry]) -> String {
    let title = if target == MEMORY_TARGET_USER {
        "# 用户偏好与档案 (USER.md)\n\n> Hermes 风格有界记忆：仅记录用户的称呼、偏好、币种/汇报习惯与工作准则，严禁保存敏感凭据。"
    } else {
        "# 工作区关键笔记 (MEMORY.md)\n\n> Hermes 风格有界记忆：沉淀资产拓扑、常用节点约定、域名用途与持续观察事项，严禁保存敏感凭据。"
    };
    if entries.is_empty() {
        return format!("{}\n\n（暂无记忆条目）\n", title);
    }
    let body = entries
        .iter()
        .map(|e| format!("- {}", e.content))
        .collect::<Vec<_>>()
        .join("\n");
    format!("{}\n\n{}\n", title, body)
}

fn require_memory_entry_by_id(conn: &Connection, id: i64) -> Result<AgentMemoryEntry, String> {
    conn.query_row(
        "SELECT id, target, content, created_at, updated_at
         FROM agent_memory_entries WHERE id = ?1",
        [id],
        |row| {
            Ok(AgentMemoryEntry {
                id: row.get(0)?,
                target: row.get(1)?,
                content: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        },
    )
    .map_err(|_| "记忆条目不存在".to_string())
}

pub fn add_memory_entry(
    conn: &Connection,
    target: &str,
    content: &str,
) -> Result<AgentMemoryEntry, String> {
    let normalized_target = normalize_memory_target(target)?;
    let normalized_content = normalize_memory_entry_text(content)?;
    validate_memory_content_safety(&normalized_content)?;

    let existing = query_memory_entries(conn, Some(normalized_target))?;
    if let Some(dup) = existing
        .iter()
        .find(|e| e.content.eq_ignore_ascii_case(&normalized_content))
    {
        return Ok(dup.clone());
    }

    let budget = memory_budget_for_target(normalized_target);
    let projected = if existing.is_empty() {
        normalized_content.chars().count() + 2
    } else {
        memory_used_chars(&existing) + 1 + 2 + normalized_content.chars().count()
    };
    if projected > budget {
        return Err(format!(
            "{} 分区字符预算已接近上限（{} / {} 字符），请先合并或删除旧记忆后再写入",
            if normalized_target == MEMORY_TARGET_USER {
                "USER.md"
            } else {
                "MEMORY.md"
            },
            projected,
            budget
        ));
    }

    conn.execute(
        "INSERT INTO agent_memory_entries (target, content) VALUES (?1, ?2)",
        params![normalized_target, normalized_content],
    )
    .map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    require_memory_entry_by_id(conn, id)
}

pub fn update_memory_entry(
    conn: &Connection,
    id: i64,
    content: &str,
) -> Result<AgentMemoryEntry, String> {
    let current = require_memory_entry_by_id(conn, id)?;
    let normalized_content = normalize_memory_entry_text(content)?;
    validate_memory_content_safety(&normalized_content)?;

    let all = query_memory_entries(conn, Some(&current.target))?;
    let simulated: Vec<AgentMemoryEntry> = all
        .into_iter()
        .map(|mut e| {
            if e.id == id {
                e.content = normalized_content.clone();
            }
            e
        })
        .collect();
    let budget = memory_budget_for_target(&current.target);
    let projected = memory_used_chars(&simulated);
    if projected > budget {
        return Err(format!(
            "{} 分区更新后超出字符预算（{} / {} 字符），请精简内容",
            if current.target == MEMORY_TARGET_USER {
                "USER.md"
            } else {
                "MEMORY.md"
            },
            projected,
            budget
        ));
    }

    conn.execute(
        "UPDATE agent_memory_entries
         SET content = ?1, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?2",
        params![normalized_content, id],
    )
    .map_err(|e| e.to_string())?;
    require_memory_entry_by_id(conn, id)
}

pub fn delete_memory_entry(conn: &Connection, id: i64) -> Result<(), String> {
    let affected = conn
        .execute("DELETE FROM agent_memory_entries WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    if affected == 0 {
        return Err("记忆条目不存在".to_string());
    }
    Ok(())
}

pub fn clear_memory_entries(conn: &Connection, target: Option<&str>) -> Result<usize, String> {
    let affected = if let Some(t) = target {
        let normalized = normalize_memory_target(t)?;
        conn.execute(
            "DELETE FROM agent_memory_entries WHERE target = ?1",
            [normalized],
        )
        .map_err(|e| e.to_string())?
    } else {
        conn.execute("DELETE FROM agent_memory_entries", [])
            .map_err(|e| e.to_string())?
    };
    Ok(affected)
}

fn find_memory_entry_for_tool(
    conn: &Connection,
    target: &str,
    match_text: Option<&str>,
    entry_id: Option<i64>,
) -> Result<AgentMemoryEntry, String> {
    if let Some(id) = entry_id {
        let found = require_memory_entry_by_id(conn, id)?;
        if found.target != target {
            return Err(format!("记忆条目 #{} 不属于 {} 分区", id, target));
        }
        return Ok(found);
    }
    let needle = match_text
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "替换或删除记忆时请提供 entry_id 或 match_text 子串".to_string())?
        .to_ascii_lowercase();
    let entries = query_memory_entries(conn, Some(target))?;
    let matches: Vec<AgentMemoryEntry> = entries
        .into_iter()
        .filter(|e| e.content.to_ascii_lowercase().contains(&needle))
        .collect();
    if matches.is_empty() {
        return Err(format!("未在 {} 分区找到包含「{}」的记忆条目", target, needle));
    }
    if matches.len() > 1 {
        return Err(format!(
            "匹配到 {} 条记忆，请提供更精确的 match_text 或直接传入 entry_id",
            matches.len()
        ));
    }
    Ok(matches.into_iter().next().unwrap())
}

pub fn replace_memory_entry_by_match(
    conn: &Connection,
    target: &str,
    match_text: Option<&str>,
    entry_id: Option<i64>,
    new_content: &str,
) -> Result<AgentMemoryEntry, String> {
    let normalized_target = normalize_memory_target(target)?;
    let existing = find_memory_entry_for_tool(conn, normalized_target, match_text, entry_id)?;
    update_memory_entry(conn, existing.id, new_content)
}

pub fn remove_memory_entry_by_match(
    conn: &Connection,
    target: &str,
    match_text: Option<&str>,
    entry_id: Option<i64>,
) -> Result<AgentMemoryEntry, String> {
    let normalized_target = normalize_memory_target(target)?;
    let existing = find_memory_entry_for_tool(conn, normalized_target, match_text, entry_id)?;
    delete_memory_entry(conn, existing.id)?;
    Ok(existing)
}

pub fn agent_memory_dir() -> std::path::PathBuf {
    crate::app_paths::data_dir().join("agent_memory")
}

pub fn sync_memory_files_to_dir(conn: &Connection, dir: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("创建本地记忆目录失败: {}", e))?;
    let user_entries = query_memory_entries(conn, Some(MEMORY_TARGET_USER))?;
    let memory_entries = query_memory_entries(conn, Some(MEMORY_TARGET_MEMORY))?;
    let user_md = render_memory_markdown(MEMORY_TARGET_USER, &user_entries);
    let memory_md = render_memory_markdown(MEMORY_TARGET_MEMORY, &memory_entries);
    std::fs::write(dir.join("USER.md"), user_md.as_bytes())
        .map_err(|e| format!("写入 USER.md 失败: {}", e))?;
    std::fs::write(dir.join("MEMORY.md"), memory_md.as_bytes())
        .map_err(|e| format!("写入 MEMORY.md 失败: {}", e))?;
    Ok(())
}

pub fn get_agent_memory_snapshot(
    conn: &Connection,
    dir: &std::path::Path,
) -> Result<AgentMemorySnapshot, String> {
    let settings = get_agent_settings(conn)?;
    let user_entries = query_memory_entries(conn, Some(MEMORY_TARGET_USER))?;
    let memory_entries = query_memory_entries(conn, Some(MEMORY_TARGET_MEMORY))?;
    let user_used_chars = memory_used_chars(&user_entries);
    let memory_used_chars = memory_used_chars(&memory_entries);
    let user_markdown = render_memory_markdown(MEMORY_TARGET_USER, &user_entries);
    let memory_markdown = render_memory_markdown(MEMORY_TARGET_MEMORY, &memory_entries);
    Ok(AgentMemorySnapshot {
        memory_enabled: settings.memory_enabled,
        memory_dir: dir.to_string_lossy().to_string(),
        user_budget: MEMORY_USER_CHAR_BUDGET,
        memory_budget: MEMORY_NOTES_CHAR_BUDGET,
        user_used_chars,
        memory_used_chars,
        user_entries,
        memory_entries,
        user_markdown,
        memory_markdown,
    })
}

pub fn build_frozen_memory_prompt_block(conn: &Connection) -> Result<String, String> {
    let user_entries = query_memory_entries(conn, Some(MEMORY_TARGET_USER))?;
    let memory_entries = query_memory_entries(conn, Some(MEMORY_TARGET_MEMORY))?;
    if user_entries.is_empty() && memory_entries.is_empty() {
        return Ok(String::new());
    }
    let mut parts: Vec<String> = Vec::new();
    parts.push("以下是本轮会话启动时注入的本地长期记忆冻结快照（Hermes 风格，条目前的数字为 entry_id）：".to_string());
    if !user_entries.is_empty() {
        let user_lines = user_entries
            .iter()
            .map(|e| format!("- [#{}] {}", e.id, e.content))
            .collect::<Vec<_>>()
            .join("\n");
        parts.push(format!("### 用户画像 (USER.md)\n{}", user_lines));
    }
    if !memory_entries.is_empty() {
        let note_lines = memory_entries
            .iter()
            .map(|e| format!("- [#{}] {}", e.id, e.content))
            .collect::<Vec<_>>()
            .join("\n");
        parts.push(format!("### 工作区笔记 (MEMORY.md)\n{}", note_lines));
    }
    Ok(parts.join("\n\n"))
}

// ─── Pi Agent 风格上下文估算与迭代压缩（Compaction）──────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCompactionItem {
    pub id: i64,
    pub session_id: String,
    pub summary: String,
    pub first_kept_message_id: i64,
    pub compacted_message_count: usize,
    pub tokens_before: u32,
    pub tokens_after: u32,
    pub custom_instructions: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentContextStatus {
    pub estimated_tokens: u32,
    pub context_window: u32,
    pub reserve_tokens: u32,
    pub keep_recent_tokens: u32,
    pub threshold_tokens: u32,
    pub usage_percent: f64,
    pub active_message_count: usize,
    pub total_message_count: usize,
    pub compacted_message_count: usize,
    pub auto_compact: bool,
    pub needs_compaction: bool,
    pub latest_compaction: Option<AgentCompactionItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCompactionResult {
    pub compaction: AgentCompactionItem,
    pub status: AgentContextStatus,
}

pub fn estimate_text_tokens(text: &str) -> u32 {
    if text.is_empty() {
        return 0;
    }
    let mut non_ascii = 0usize;
    let mut ascii_bytes = 0usize;
    for ch in text.chars() {
        if ch.is_ascii() {
            ascii_bytes += 1;
        } else {
            non_ascii += 1;
        }
    }
    let ascii_tokens = ascii_bytes.div_ceil(4);
    (non_ascii + ascii_tokens).max(1) as u32
}

pub fn effective_threshold_tokens(context_window: u32, reserve_tokens: u32) -> u32 {
    let cw = normalize_context_window(context_window);
    let effective_reserve = normalize_reserve_tokens(reserve_tokens).min(cw / 2);
    cw.saturating_sub(effective_reserve).max(2_048)
}

pub fn query_latest_compaction(conn: &Connection) -> Result<Option<AgentCompactionItem>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, summary, first_kept_message_id, compacted_message_count,
                    tokens_before, tokens_after, custom_instructions, created_at
             FROM agent_compactions
             WHERE session_id = 'default'
             ORDER BY id DESC
             LIMIT 1",
        )
        .map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query_map([], |row| {
            Ok(AgentCompactionItem {
                id: row.get(0)?,
                session_id: row.get(1)?,
                summary: row.get(2)?,
                first_kept_message_id: row.get(3)?,
                compacted_message_count: usize::try_from(row.get::<_, i64>(4)?.max(0)).unwrap_or(0),
                tokens_before: u32::try_from(row.get::<_, i64>(5)?.max(0)).unwrap_or(0),
                tokens_after: u32::try_from(row.get::<_, i64>(6)?.max(0)).unwrap_or(0),
                custom_instructions: row.get(7)?,
                created_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;
    match rows.next() {
        Some(res) => res.map(Some).map_err(|e| e.to_string()),
        None => Ok(None),
    }
}

fn split_messages_by_compaction(
    all_msgs: Vec<AgentMessageItem>,
    latest: Option<&AgentCompactionItem>,
) -> (Vec<AgentMessageItem>, Vec<AgentMessageItem>) {
    let Some(comp) = latest else {
        return (Vec::new(), all_msgs);
    };
    let mut compacted = Vec::new();
    let mut active = Vec::new();
    for m in all_msgs {
        if m.id < comp.first_kept_message_id {
            compacted.push(m);
        } else {
            active.push(m);
        }
    }
    (compacted, active)
}

fn estimate_context_tokens_breakdown(
    system_prompt: &str,
    active_msgs: &[AgentMessageItem],
) -> u32 {
    const TOOL_DEFS_OVERHEAD_TOKENS: u32 = 950;
    let sys_tokens = estimate_text_tokens(system_prompt);
    let msg_tokens: u32 = active_msgs
        .iter()
        .map(|m| estimate_text_tokens(&m.content) + 8)
        .sum();
    sys_tokens + TOOL_DEFS_OVERHEAD_TOKENS + msg_tokens
}

pub fn compute_agent_context_status(
    conn: &Connection,
    settings: &AgentSettingsView,
) -> Result<AgentContextStatus, String> {
    let all_msgs = query_agent_messages(conn)?;
    let total_message_count = all_msgs.len();
    let latest_compaction = query_latest_compaction(conn)?;
    let (compacted_msgs, active_msgs) =
        split_messages_by_compaction(all_msgs, latest_compaction.as_ref());

    let today_str = assets_db::today_local().format("%Y-%m-%d").to_string();
    let fx_rate = current_usd_cny_rate(conn);
    let frozen_memory = if settings.memory_enabled {
        build_frozen_memory_prompt_block(conn)?
    } else {
        String::new()
    };
    let sys_prompt = build_agent_system_prompt(
        &today_str,
        fx_rate,
        settings.memory_enabled,
        &frozen_memory,
        &settings.custom_system_prompt,
        latest_compaction.as_ref().map(|c| c.summary.as_str()),
    );

    let estimated_tokens = estimate_context_tokens_breakdown(&sys_prompt, &active_msgs);
    let threshold_tokens =
        effective_threshold_tokens(settings.context_window, settings.reserve_tokens);
    let cw = normalize_context_window(settings.context_window).max(1) as f64;
    let usage_percent = ((estimated_tokens as f64 / cw) * 1000.0).round() / 10.0;
    let needs_compaction = active_msgs.len() >= 2 && estimated_tokens > threshold_tokens;

    Ok(AgentContextStatus {
        estimated_tokens,
        context_window: normalize_context_window(settings.context_window),
        reserve_tokens: normalize_reserve_tokens(settings.reserve_tokens),
        keep_recent_tokens: normalize_keep_recent_tokens(settings.keep_recent_tokens),
        threshold_tokens,
        usage_percent,
        active_message_count: active_msgs.len(),
        total_message_count,
        compacted_message_count: compacted_msgs.len(),
        auto_compact: settings.auto_compact,
        needs_compaction,
        latest_compaction,
    })
}

const COMPACTION_TRANSCRIPT_MAX_CHARS: usize = 60_000;

/// Pi Agent 切分点算法：从末尾向回累计 keep_recent_tokens，确保切分点严格落在 user 消息边界（index >= 1）
pub fn select_compaction_cut_index(
    active_msgs: &[AgentMessageItem],
    keep_recent_tokens: u32,
    threshold_tokens: u32,
    force_manual: bool,
) -> Option<usize> {
    let _ = force_manual;
    if active_msgs.len() < 2 {
        return None;
    }
    let keep_budget = normalize_keep_recent_tokens(keep_recent_tokens)
        .min((threshold_tokens / 2).max(512))
        .max(512);

    let mut accumulated: u32 = 0;
    let mut cut_idx = active_msgs.len();
    for idx in (0..active_msgs.len()).rev() {
        let msg_tokens = estimate_text_tokens(&active_msgs[idx].content) + 8;
        if accumulated > 0 && accumulated.saturating_add(msg_tokens) > keep_budget {
            break;
        }
        accumulated = accumulated.saturating_add(msg_tokens);
        cut_idx = idx;
    }

    if cut_idx == 0 {
        let fallback_keep = if active_msgs.len() >= 4 { 2 } else { 1 };
        cut_idx = active_msgs.len().saturating_sub(fallback_keep);
    }

    if cut_idx >= active_msgs.len() {
        cut_idx = active_msgs.len() - 1;
    }

    // 严格对齐到 index >= 1 的 user 消息边界，避免保留孤立的 assistant 回复却失去对应问题
    if active_msgs[cut_idx].role != "user" {
        if let Some(rel) = active_msgs[cut_idx..]
            .iter()
            .position(|m| m.role == "user")
        {
            cut_idx += rel;
        } else {
            let prev = active_msgs[1..cut_idx]
                .iter()
                .rposition(|m| m.role == "user")?;
            cut_idx = 1 + prev;
        }
    }

    (cut_idx >= 1 && cut_idx < active_msgs.len() && active_msgs[cut_idx].role == "user")
        .then_some(cut_idx)
}

pub fn build_compaction_prompt(
    previous_summary: Option<&str>,
    to_compact: &[AgentMessageItem],
    custom_instructions: Option<&str>,
) -> Vec<Value> {
    let mut user_blocks: Vec<String> = Vec::new();
    if let Some(prev) = previous_summary.map(str::trim).filter(|s| !s.is_empty()) {
        user_blocks.push(format!(
            "## 既有压缩摘要（请在此基础上增量合并，保留仍有效的事实与 ID）\n{}",
            prev
        ));
    }

    // 优先保留最新待归档消息并限制总字符数，避免长期未压缩后摘要请求自身超出上下文窗口
    let mut kept_entries: Vec<String> = Vec::new();
    let mut total_chars = 0usize;
    let mut omitted_count = 0usize;
    for m in to_compact.iter().rev() {
        let role_label = if m.role == "user" { "用户" } else { "助手" };
        let clipped: String = m.content.chars().take(2_500).collect();
        let mut entry = format!("### [{} #{}]\n{}\n", role_label, m.id, clipped);
        if !m.proposals.is_empty() {
            let prop_notes: Vec<String> = m
                .proposals
                .iter()
                .map(|p| format!("{}（{}）", p.target_label, p.status))
                .collect();
            entry.push_str(&format!("关联提案：{}\n", prop_notes.join("；")));
        }
        entry.push('\n');
        let entry_chars = entry.chars().count();
        if !kept_entries.is_empty() && total_chars + entry_chars > COMPACTION_TRANSCRIPT_MAX_CHARS {
            omitted_count += 1;
            continue;
        }
        if kept_entries.is_empty() && entry_chars > COMPACTION_TRANSCRIPT_MAX_CHARS {
            let truncated: String = entry.chars().take(COMPACTION_TRANSCRIPT_MAX_CHARS).collect();
            total_chars += truncated.chars().count();
            kept_entries.push(truncated);
        } else {
            total_chars += entry_chars;
            kept_entries.push(entry);
        }
    }
    kept_entries.reverse();

    let mut transcript = String::new();
    if omitted_count > 0 {
        transcript.push_str(&format!(
            "（早期 {} 条更旧消息因超出压缩输入长度上限已省略，请优先结合既有压缩摘要与以下近期对话事实归纳）\n\n",
            omitted_count
        ));
    }
    for entry in kept_entries {
        transcript.push_str(&entry);
    }
    user_blocks.push(format!("## 需要归档压缩的历史对话\n{}", transcript.trim()));

    if let Some(inst) = custom_instructions.map(str::trim).filter(|s| !s.is_empty()) {
        user_blocks.push(format!("## 本次压缩补充聚焦要求\n{}", inst));
    }

    vec![
        json!({
            "role": "system",
            "content": "你是上下文压缩器，负责把多轮历史对话提炼为高信息密度的结构化交接摘要（中文）。
严格使用以下 5 个 Markdown 标题输出，保留所有关键实体名称、资产 ID、金额（CNY/USD）、日期、状态和待办约束，以便后续对话无缝接力：
## 目标与关注点
## 关键约束与偏好
## 已查证事实与进展
## 提案与决策记录
## 待办与下一步

安全禁令：摘要中绝对不得编造或记录任何密码、2FA 密钥、接码链接、卡号/CVV、OAuth 令牌或 SSH 私钥。如果历史对话已为空或某章节无内容，简写「无」。"
        }),
        json!({
            "role": "user",
            "content": user_blocks.join("\n\n"),
        }),
    ]
}

/// 压缩请求的输出上限：当用户显式设置 max_tokens == 0（交由推理模型/服务端自动决定上限）时不强行覆盖
fn compaction_max_tokens_override(cfg: &LoadedAgentConfig) -> Option<u32> {
    if cfg.max_tokens == 0 {
        None
    } else {
        let summary_cap = (cfg.reserve_tokens / 2).clamp(1_024, 4_096);
        Some(cfg.max_tokens.min(summary_cap).max(256))
    }
}

async fn await_with_cancel<T>(
    fut: impl std::future::Future<Output = Result<T, String>>,
    cancel_flag: Option<&AtomicBool>,
) -> Result<T, String> {
    let Some(flag) = cancel_flag else {
        return fut.await;
    };
    if flag.load(Ordering::SeqCst) {
        return Err("已手动停止生成".to_string());
    }
    let mut fut = std::pin::pin!(fut);
    let mut ticker = tokio::time::interval(Duration::from_millis(80));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    std::future::poll_fn(|cx| {
        if flag.load(Ordering::SeqCst) {
            return std::task::Poll::Ready(Err("已手动停止生成".to_string()));
        }
        if let std::task::Poll::Ready(res) = fut.as_mut().poll(cx) {
            return std::task::Poll::Ready(res);
        }
        while ticker.poll_tick(cx).is_ready() {
            if flag.load(Ordering::SeqCst) {
                return std::task::Poll::Ready(Err("已手动停止生成".to_string()));
            }
        }
        std::task::Poll::Pending
    })
    .await
}

fn persist_compaction_checked(
    conn: &Connection,
    prev_compaction_id: Option<i64>,
    first_kept_message_id: i64,
    summary_text: &str,
    tokens_before: u32,
    custom_clean: Option<&str>,
) -> Result<AgentCompactionResult, String> {
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("开启压缩写入事务失败: {}", e))?;

    let kept_exists: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM agent_messages WHERE session_id = 'default' AND id = ?1)",
            [first_kept_message_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !kept_exists {
        return Err("会话已清空或消息已变更，已放弃写入过期压缩摘要".to_string());
    }

    let current_latest_id = query_latest_compaction(&tx)?.map(|c| c.id);
    if current_latest_id != prev_compaction_id {
        return Err("检测到并发上下文压缩已完成，已放弃重复写入".to_string());
    }

    let total_compacted: i64 = tx
        .query_row(
            "SELECT COUNT(1) FROM agent_messages WHERE session_id = 'default' AND id < ?1",
            [first_kept_message_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO agent_compactions
         (session_id, summary, first_kept_message_id, compacted_message_count, tokens_before, tokens_after, custom_instructions)
         VALUES ('default', ?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            summary_text,
            first_kept_message_id,
            total_compacted,
            tokens_before as i64,
            0i64,
            custom_clean,
        ],
    )
    .map_err(|e| e.to_string())?;
    let compaction_id = tx.last_insert_rowid();

    let settings = get_agent_settings(&tx)?;
    let updated_status = compute_agent_context_status(&tx, &settings)?;
    tx.execute(
        "UPDATE agent_compactions SET tokens_after = ?1 WHERE id = ?2",
        params![updated_status.estimated_tokens as i64, compaction_id],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| format!("提交压缩事务失败: {}", e))?;

    let settings = get_agent_settings(conn)?;
    let refreshed_status = compute_agent_context_status(conn, &settings)?;
    let compaction = query_latest_compaction(conn)?
        .ok_or_else(|| "读取刚保存的压缩摘要失败".to_string())?;

    Ok(AgentCompactionResult {
        compaction,
        status: refreshed_status,
    })
}

pub async fn compact_agent_context(
    db: &crate::database::Database,
    cfg: &LoadedAgentConfig,
    custom_instructions: Option<&str>,
    force_manual: bool,
    cancel_flag: Option<&AtomicBool>,
) -> Result<AgentCompactionResult, String> {
    if cancel_flag.is_some_and(|flag| flag.load(Ordering::SeqCst)) {
        return Err("已手动停止生成".to_string());
    }

    let custom_clean = custom_instructions
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.chars().take(500).collect::<String>());

    let (prev_compaction_id, previous_summary, to_compact, first_kept_message_id, tokens_before) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let settings = get_agent_settings(&conn)?;
        let status = compute_agent_context_status(&conn, &settings)?;
        let all_msgs = query_agent_messages(&conn)?;
        let latest = query_latest_compaction(&conn)?;
        let (_, active_msgs) = split_messages_by_compaction(all_msgs, latest.as_ref());

        let Some(cut_idx) = select_compaction_cut_index(
            &active_msgs,
            cfg.keep_recent_tokens,
            status.threshold_tokens,
            force_manual,
        ) else {
            return Err("当前可压缩的活跃对话轮次不足（至少需要 2 轮对话），暂无需压缩".to_string());
        };

        let to_compact = active_msgs[..cut_idx].to_vec();
        let first_kept_id = active_msgs[cut_idx].id;
        (
            latest.as_ref().map(|c| c.id),
            latest.map(|c| c.summary),
            to_compact,
            first_kept_id,
            status.estimated_tokens,
        )
    };

    let compact_messages = build_compaction_prompt(
        previous_summary.as_deref(),
        &to_compact,
        custom_clean.as_deref(),
    );

    let mut compact_cfg = cfg.clone();
    compact_cfg.temperature = 0.1;
    let max_override = compaction_max_tokens_override(cfg);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;

    let resp = await_with_cancel(
        call_chat_completions(&client, &compact_cfg, &compact_messages, false, max_override),
        cancel_flag,
    )
    .await?;

    if cancel_flag.is_some_and(|flag| flag.load(Ordering::SeqCst)) {
        return Err("已手动停止生成".to_string());
    }

    let summary_text = resp
        .pointer("/choices/0/message")
        .and_then(extract_delta_content)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "模型未返回有效的压缩摘要内容".to_string())?;

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    persist_compaction_checked(
        &conn,
        prev_compaction_id,
        first_kept_message_id,
        &summary_text,
        tokens_before,
        custom_clean.as_deref(),
    )
}

pub fn active_history_messages(
    conn: &Connection,
) -> Result<(Option<AgentCompactionItem>, Vec<Value>), String> {
    let all = query_agent_messages(conn)?;
    let latest = query_latest_compaction(conn)?;
    let (_, active) = split_messages_by_compaction(all, latest.as_ref());
    let history = active
        .into_iter()
        .filter(|m| m.role == "user" || m.role == "assistant")
        .map(|m| json!({ "role": m.role, "content": m.content }))
        .collect();
    Ok((latest, history))
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

// ─── Pi Agent 风格精炼提示词、SSE 流式 Tool-Calling 循环与测试连接 ────────

pub fn build_agent_system_prompt(
    today: &str,
    usd_cny_rate: f64,
    memory_enabled: bool,
    frozen_memory_block: &str,
    custom_system_prompt: &str,
    compaction_summary: Option<&str>,
) -> String {
    let mut prompt = format!(
        "你是 GoogleManager 的本地数字资产代理（Pi-Agent 极简务实风格），始终使用中文回答。
当前环境：本地日期 {today} | 结算汇率 1 USD = ¥{usd_cny_rate:.4}（默认统一以人民币 CNY 汇报费用）。

工作准则：
1. **先查后答**：任何涉及资产数量、费用、续费、服务器负载、域名、提醒的问题，先调用只读工具获取实时数据再作答，绝不猜测或编造。
2. **桌面客户端原生排版**：
   - 结论先行：开头先用一句引用块 `> ...` 概括核心结论或人民币总计。
   - 多条目对比（服务器、域名、到期续费、费用明细）优先使用紧凑标准 Markdown 表格（列数 <= 5），单条要点用简洁 `- ` 列表，分区用 `## ` / `### ` 标题。
   - **严禁**使用 `*****`、`=====`、`-----`、`~~~~~` 等连续字符分隔线，也不要用过多星号修饰整段文字；日期、金额、IP、域名用反引号标注。
   - 保持高信噪比：不寒暄、不赘述、不重复隐私声明。
3. **统一人民币结算**：统计总支出时优先给出折算后的人民币月/年总额，美元项可在括号内注明原价。
4. **严格隐私边界**：你只能访问脱敏白名单元数据，无法读取密码、2FA 密钥、接码链接、卡号/CVV、OAuth 令牌、SSH 私钥或 Cloudflare Token。仅当用户明确索要这些敏感值时，用一句话说明本地隔离限制并告知对应管理页。
5. **变更走提案确认**：新增备忘或更新资产非敏感字段（费用/周期/到期日/备注/标签），必须先查清目标 ID，再调用 `propose_create_reminder` 或 `propose_update_asset` 生成待审提案，并提示用户在下方卡片点击「确认写入」后生效。"
    );

    if memory_enabled {
        prompt.push_str(
            "\n6. **Hermes 本地长期记忆**：若用户在对话中表达了长期偏好（称呼、汇报风格、常用节点约定等）或要求你记住某条非敏感工作区事实时，主动调用 `manage_memory` 工具保存、替换或删除记忆条目（分为 `user` 用户画像与 `memory` 工作区笔记两区）。绝对禁止往记忆中写入任何密码、API Key、2FA 密钥、卡号或私钥。"
        );
        let mem = frozen_memory_block.trim();
        if !mem.is_empty() {
            prompt.push_str("\n\n---\n\n");
            prompt.push_str(mem);
        }
    }

    let custom = custom_system_prompt.trim();
    if !custom.is_empty() {
        prompt.push_str("\n\n---\n\n## 用户附加指令\n");
        prompt.push_str(custom);
    }

    if let Some(summary) = compaction_summary.map(str::trim).filter(|s| !s.is_empty()) {
        prompt.push_str("\n\n---\n\n## 历史对话压缩摘要（Pi-Agent Compaction）\n");
        prompt.push_str(summary);
    }

    prompt
}

fn tool_display_label(tool_name: &str) -> &'static str {
    match tool_name {
        "get_workspace_summary" => "读取工作区总览",
        "search_assets" => "检索脱敏资产",
        "get_renewals_and_spend" => "统计续费与支出",
        "get_server_status" => "检查服务器状态",
        "propose_create_reminder" => "生成提醒提案",
        "propose_update_asset" => "生成变更提案",
        "manage_memory" => "读写本地记忆",
        _ => "调用工具",
    }
}

pub fn agent_tool_definitions_for(memory_enabled: bool) -> Value {
    let mut defs = vec![
        json!({
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
        }),
        json!({
            "type": "function",
            "function": {
                "name": "search_assets",
                "description": "按关键词搜索脱敏后的各类资产元数据（google/card/ai/server/domain/reminder），最多返回 30 条。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": { "type": "string", "description": "搜索关键词，留空可列出最近记录" },
                        "kind": {
                            "type": "string",
                            "enum": ["all", "google", "card", "ai", "server", "domain", "reminder"]
                        }
                    },
                    "required": ["query"],
                    "additionalProperties": false
                }
            }
        }),
        json!({
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
        }),
        json!({
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
        }),
        json!({
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
        }),
        json!({
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
        }),
    ];

    if memory_enabled {
        defs.push(json!({
            "type": "function",
            "function": {
                "name": "manage_memory",
                "description": "读写 Hermes 本地长期记忆（USER.md 用户画像或 MEMORY.md 工作区笔记），下轮对话自动冻结注入。禁止写入密码、API Key、2FA、卡号或私钥。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "action": { "type": "string", "enum": ["add", "replace", "remove"] },
                        "target": { "type": "string", "enum": ["user", "memory"] },
                        "content": { "type": "string", "maxLength": 300, "description": "add 或 replace 时的精简记忆内容" },
                        "match_text": { "type": "string", "description": "replace 或 remove 时用于匹配已有条目的关键词" },
                        "entry_id": { "type": "integer", "description": "可选：已有条目的精确 #ID" }
                    },
                    "required": ["action", "target"],
                    "additionalProperties": false
                }
            }
        }));
    }

    Value::Array(defs)
}

#[allow(dead_code)]
pub fn agent_tool_definitions() -> Value {
    agent_tool_definitions_for(true)
}

fn execute_manage_memory_tool(
    conn: &Connection,
    args: &Value,
    memory_enabled: bool,
) -> Result<Value, String> {
    if !memory_enabled {
        return Err("当前设置已关闭本地长期记忆功能，无法写入。".to_string());
    }
    let action = args
        .get("action")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .ok_or_else(|| "缺少 action (add / replace / remove)".to_string())?;
    let target = args
        .get("target")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "缺少 target (user / memory)".to_string())?;
    let normalized_target = normalize_memory_target(target)?;
    let entry_id = args.get("entry_id").and_then(|v| v.as_i64());
    let match_text = args.get("match_text").and_then(|v| v.as_str());

    let affected_entry = match action {
        "add" => {
            let content = args
                .get("content")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "add 操作必须提供 content".to_string())?;
            add_memory_entry(conn, normalized_target, content)?
        }
        "replace" => {
            let content = args
                .get("content")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "replace 操作必须提供 content".to_string())?;
            replace_memory_entry_by_match(conn, normalized_target, match_text, entry_id, content)?
        }
        "remove" => remove_memory_entry_by_match(conn, normalized_target, match_text, entry_id)?,
        other => return Err(format!("不支持的记忆操作：{}", other)),
    };

    let entries = query_memory_entries(conn, Some(normalized_target))?;
    let used_chars = memory_used_chars(&entries);
    let budget = memory_budget_for_target(normalized_target);

    Ok(json!({
        "saved": true,
        "action": action,
        "target": normalized_target,
        "entry": affected_entry,
        "used_chars": used_chars,
        "budget_chars": budget,
        "remaining_chars": budget.saturating_sub(used_chars),
        "note": "记忆已写入本地数据库并将同步到 USER.md / MEMORY.md，下轮会话生效。"
    }))
}

pub fn dispatch_agent_tool_with_options(
    conn: &Connection,
    tool_name: &str,
    args: &Value,
    proposals: &mut Vec<AgentProposal>,
    memory_enabled: bool,
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
        "manage_memory" => execute_manage_memory_tool(conn, args, memory_enabled),
        other => Err(format!("未知工具：{}", other)),
    };

    match result {
        Ok(val) => val,
        Err(err) => json!({ "error": err }),
    }
}

#[allow(dead_code)]
pub fn dispatch_agent_tool(
    conn: &Connection,
    tool_name: &str,
    args: &Value,
    proposals: &mut Vec<AgentProposal>,
) -> Value {
    dispatch_agent_tool_with_options(conn, tool_name, args, proposals, true)
}

#[allow(dead_code)]
pub fn recent_history_messages(conn: &Connection) -> Result<Vec<Value>, String> {
    let (_, active) = active_history_messages(conn)?;
    Ok(active)
}

fn build_chat_request_body(
    cfg: &LoadedAgentConfig,
    messages: &[Value],
    with_tools: bool,
    max_tokens_override: Option<u32>,
    stream: bool,
) -> Value {
    let effective_max = max_tokens_override.unwrap_or(cfg.max_tokens);
    let mut obj = Map::new();
    obj.insert("model".to_string(), json!(cfg.model));
    obj.insert("messages".to_string(), json!(messages));
    obj.insert("temperature".to_string(), json!(normalize_temperature(cfg.temperature)));
    if stream {
        obj.insert("stream".to_string(), json!(true));
    }
    if effective_max > 0 {
        obj.insert("max_tokens".to_string(), json!(effective_max));
    }
    if with_tools {
        obj.insert("tools".to_string(), agent_tool_definitions_for(cfg.memory_enabled));
        obj.insert("tool_choice".to_string(), json!("auto"));
    }
    Value::Object(obj)
}

async fn call_chat_completions(
    client: &reqwest::Client,
    cfg: &LoadedAgentConfig,
    messages: &[Value],
    with_tools: bool,
    max_tokens_override: Option<u32>,
) -> Result<Value, String> {
    let endpoint = format!("{}/chat/completions", cfg.base_url.trim_end_matches('/'));
    let body = build_chat_request_body(cfg, messages, with_tools, max_tokens_override, false);

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

#[derive(Debug, Default)]
struct StreamToolCallAcc {
    id: String,
    name: String,
    arguments: String,
}

#[derive(Debug, Default)]
pub struct StreamedTurnOutcome {
    pub content: String,
    #[allow(dead_code)]
    pub reasoning: String,
    pub tool_calls: Vec<Value>,
    pub cancelled: bool,
}

fn extract_delta_reasoning(delta: &Value) -> Option<&str> {
    delta
        .get("reasoning_content")
        .or_else(|| delta.get("reasoning"))
        .or_else(|| delta.get("thinking"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
}

fn extract_delta_content(delta: &Value) -> Option<String> {
    let val = delta.get("content")?;
    if let Some(s) = val.as_str() {
        return (!s.is_empty()).then(|| s.to_string());
    }
    if let Some(arr) = val.as_array() {
        let mut out = String::new();
        for part in arr {
            if let Some(t) = part.get("text").and_then(|v| v.as_str()) {
                out.push_str(t);
            }
        }
        return (!out.is_empty()).then_some(out);
    }
    None
}

fn apply_sse_json_chunk(
    chunk: &Value,
    content_acc: &mut String,
    reasoning_acc: &mut String,
    tool_acc: &mut BTreeMap<usize, StreamToolCallAcc>,
    emit_event: &mut impl FnMut(&str, &str),
) {
    let Some(choice) = chunk.pointer("/choices/0") else {
        return;
    };

    // 兼容部分服务端忽略 stream:true 直接返回非流式 choices[0].message
    if let Some(msg) = choice.get("message") {
        if let Some(r) = extract_delta_reasoning(msg) {
            reasoning_acc.push_str(r);
            emit_event("reasoning", r);
        }
        if let Some(c) = extract_delta_content(msg) {
            content_acc.push_str(&c);
            emit_event("delta", &c);
        }
        if let Some(tcs) = msg.get("tool_calls").and_then(|v| v.as_array()) {
            for (idx, tc) in tcs.iter().enumerate() {
                let entry = tool_acc.entry(idx).or_default();
                if let Some(id) = tc.get("id").and_then(|v| v.as_str()) {
                    entry.id = id.to_string();
                }
                if let Some(name) = tc.pointer("/function/name").and_then(|v| v.as_str()) {
                    entry.name = name.to_string();
                }
                if let Some(args) = tc.pointer("/function/arguments").and_then(|v| v.as_str()) {
                    entry.arguments = args.to_string();
                }
            }
        }
        return;
    }

    let Some(delta) = choice.get("delta") else {
        return;
    };

    if let Some(r) = extract_delta_reasoning(delta) {
        reasoning_acc.push_str(r);
        emit_event("reasoning", r);
    }
    if let Some(c) = extract_delta_content(delta) {
        content_acc.push_str(&c);
        emit_event("delta", &c);
    }
    if let Some(tcs) = delta.get("tool_calls").and_then(|v| v.as_array()) {
        for (fallback_idx, tc) in tcs.iter().enumerate() {
            let idx = tc
                .get("index")
                .and_then(|v| v.as_u64())
                .map(|v| v as usize)
                .unwrap_or(fallback_idx);
            let entry = tool_acc.entry(idx).or_default();
            if let Some(id) = tc.get("id").and_then(|v| v.as_str()) {
                if !id.is_empty() {
                    entry.id = id.to_string();
                }
            }
            if let Some(name) = tc.pointer("/function/name").and_then(|v| v.as_str()) {
                entry.name.push_str(name);
            }
            if let Some(args) = tc.pointer("/function/arguments").and_then(|v| v.as_str()) {
                entry.arguments.push_str(args);
            }
        }
    }
}

#[cfg(test)]
pub fn parse_sse_stream_text_for_test(raw_sse: &str) -> StreamedTurnOutcome {
    let mut content = String::new();
    let mut reasoning = String::new();
    let mut tool_acc: BTreeMap<usize, StreamToolCallAcc> = BTreeMap::new();
    let mut noop = |_: &str, _: &str| {};

    for line in raw_sse.lines() {
        let trimmed = line.trim();
        let Some(payload) = trimmed.strip_prefix("data:") else {
            continue;
        };
        let payload = payload.trim();
        if payload.is_empty() || payload == "[DONE]" {
            continue;
        }
        if let Ok(val) = serde_json::from_str::<Value>(payload) {
            apply_sse_json_chunk(&val, &mut content, &mut reasoning, &mut tool_acc, &mut noop);
        }
    }
    let tool_calls = tool_acc
        .into_iter()
        .filter(|(_, tc)| !tc.name.is_empty())
        .map(|(idx, tc)| {
            json!({
                "id": if tc.id.is_empty() { format!("call_{}", idx) } else { tc.id },
                "type": "function",
                "function": {
                    "name": tc.name,
                    "arguments": if tc.arguments.is_empty() { "{}".to_string() } else { tc.arguments },
                }
            })
        })
        .collect();
    StreamedTurnOutcome {
        content,
        reasoning,
        tool_calls,
        cancelled: false,
    }
}

async fn call_chat_completions_streaming(
    client: &reqwest::Client,
    cfg: &LoadedAgentConfig,
    messages: &[Value],
    with_tools: bool,
    cancel_flag: &AtomicBool,
    mut on_chunk: impl FnMut(&str, &str),
) -> Result<StreamedTurnOutcome, String> {
    let endpoint = format!("{}/chat/completions", cfg.base_url.trim_end_matches('/'));
    let body = build_chat_request_body(cfg, messages, with_tools, None, true);

    let mut req = client
        .post(&endpoint)
        .header("Accept", "text/event-stream")
        .json(&body);
    if !cfg.api_key.is_empty() {
        req = req.bearer_auth(&cfg.api_key);
    }

    let mut resp = req
        .send()
        .await
        .map_err(|e| format!("请求 AI 模型接口失败: {}", e))?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        let snippet: String = text.chars().take(240).collect();
        return Err(format!("AI 接口返回错误 ({}): {}", status.as_u16(), snippet));
    }

    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();

    let mut content_acc = String::new();
    let mut reasoning_acc = String::new();
    let mut tool_acc: BTreeMap<usize, StreamToolCallAcc> = BTreeMap::new();

    // 兼容服务端忽略 stream:true 返回 application/json 的场景
    if content_type.contains("application/json") {
        let text = resp
            .text()
            .await
            .map_err(|e| format!("读取模型响应失败: {}", e))?;
        let val = serde_json::from_str::<Value>(&text)
            .map_err(|e| format!("解析模型响应 JSON 失败: {}", e))?;
        apply_sse_json_chunk(
            &val,
            &mut content_acc,
            &mut reasoning_acc,
            &mut tool_acc,
            &mut on_chunk,
        );
    } else {
        let mut pending_bytes: Vec<u8> = Vec::new();
        let mut raw_fallback: Vec<u8> = Vec::new();
        let mut saw_sse_data = false;

        loop {
            if cancel_flag.load(Ordering::SeqCst) {
                return Ok(StreamedTurnOutcome {
                    content: content_acc,
                    reasoning: reasoning_acc,
                    tool_calls: Vec::new(),
                    cancelled: true,
                });
            }
            let next_chunk = tokio::time::timeout(Duration::from_secs(90), resp.chunk())
                .await
                .map_err(|_| "模型流式响应超时".to_string())?
                .map_err(|e| format!("读取流式响应失败: {}", e))?;
            let Some(bytes) = next_chunk else {
                break;
            };
            pending_bytes.extend_from_slice(&bytes);
            if !saw_sse_data && raw_fallback.len() < 256 * 1024 {
                raw_fallback.extend_from_slice(&bytes);
            }

            while let Some(pos) = pending_bytes.iter().position(|&b| b == b'\n') {
                let line_bytes: Vec<u8> = pending_bytes.drain(..=pos).collect();
                let line = String::from_utf8_lossy(&line_bytes);
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with(':') {
                    continue;
                }
                if let Some(payload) = trimmed.strip_prefix("data:") {
                    saw_sse_data = true;
                    let payload = payload.trim();
                    if payload == "[DONE]" {
                        break;
                    }
                    if let Ok(val) = serde_json::from_str::<Value>(payload) {
                        apply_sse_json_chunk(
                            &val,
                            &mut content_acc,
                            &mut reasoning_acc,
                            &mut tool_acc,
                            &mut on_chunk,
                        );
                    }
                }
            }
        }

        // 处理末尾未带换行的残留行，或无 Content-Type 但实际返回纯 JSON 的网关
        if !pending_bytes.is_empty() {
            let line = String::from_utf8_lossy(&pending_bytes);
            let trimmed = line.trim();
            if let Some(payload) = trimmed.strip_prefix("data:") {
                saw_sse_data = true;
                let payload = payload.trim();
                if !payload.is_empty() && payload != "[DONE]" {
                    if let Ok(val) = serde_json::from_str::<Value>(payload) {
                        apply_sse_json_chunk(
                            &val,
                            &mut content_acc,
                            &mut reasoning_acc,
                            &mut tool_acc,
                            &mut on_chunk,
                        );
                    }
                }
            }
        }

        if !saw_sse_data && !raw_fallback.is_empty() {
            if let Ok(val) = serde_json::from_slice::<Value>(&raw_fallback) {
                apply_sse_json_chunk(
                    &val,
                    &mut content_acc,
                    &mut reasoning_acc,
                    &mut tool_acc,
                    &mut on_chunk,
                );
            }
        }
    }

    let tool_calls = tool_acc
        .into_iter()
        .filter(|(_, tc)| !tc.name.is_empty())
        .map(|(idx, tc)| {
            json!({
                "id": if tc.id.is_empty() { format!("call_{}", idx) } else { tc.id },
                "type": "function",
                "function": {
                    "name": tc.name,
                    "arguments": if tc.arguments.is_empty() { "{}".to_string() } else { tc.arguments },
                }
            })
        })
        .collect();

    Ok(StreamedTurnOutcome {
        content: content_acc,
        reasoning: reasoning_acc,
        tool_calls,
        cancelled: cancel_flag.load(Ordering::SeqCst),
    })
}

pub async fn test_agent_connection(
    cfg: &LoadedAgentConfig,
) -> Result<AgentConnectionTestResult, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let start = Instant::now();
    let messages = vec![json!({ "role": "user", "content": "请回复 OK" })];
    let resp = call_chat_completions(&client, cfg, &messages, false, Some(64)).await?;
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

#[allow(clippy::too_many_arguments)]
pub async fn run_agent_chat_turn(
    app: Option<&AppHandle>,
    db: &crate::database::Database,
    cfg: LoadedAgentConfig,
    compaction_summary: Option<String>,
    history_before_user: Vec<Value>,
    user_text: &str,
    stream_id: &str,
    cancel_flag: &AtomicBool,
) -> Result<AgentMessageItem, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(AGENT_HTTP_TIMEOUT_SECS))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;

    let (today_str, fx_rate, frozen_memory_block) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let mem = if cfg.memory_enabled {
            build_frozen_memory_prompt_block(&conn)?
        } else {
            String::new()
        };
        (
            assets_db::today_local().format("%Y-%m-%d").to_string(),
            current_usd_cny_rate(&conn),
            mem,
        )
    };

    let mut messages: Vec<Value> = Vec::new();
    messages.push(json!({
        "role": "system",
        "content": build_agent_system_prompt(
            &today_str,
            fx_rate,
            cfg.memory_enabled,
            &frozen_memory_block,
            &cfg.custom_system_prompt,
            compaction_summary.as_deref(),
        ),
    }));
    messages.extend(history_before_user);
    messages.push(json!({ "role": "user", "content": user_text }));

    let mut proposals: Vec<AgentProposal> = Vec::new();
    let mut final_text = String::new();
    let mut was_cancelled = false;

    for step in 0..=MAX_TOOL_STEPS {
        if cancel_flag.load(Ordering::SeqCst) {
            was_cancelled = true;
            if final_text.trim().is_empty() {
                final_text = "已停止生成。".to_string();
            }
            break;
        }
        let allow_tools = step < MAX_TOOL_STEPS;
        let outcome = call_chat_completions_streaming(
            &client,
            &cfg,
            &messages,
            allow_tools,
            cancel_flag,
            |kind, chunk_text| {
                if let Some(handle) = app {
                    let _ = handle.emit(
                        "agent-stream",
                        json!({
                            "stream_id": stream_id,
                            "type": kind,
                            "text": chunk_text,
                        }),
                    );
                }
            },
        )
        .await?;

        if outcome.cancelled {
            was_cancelled = true;
            let trimmed = outcome.content.trim();
            final_text = if trimmed.is_empty() {
                "已停止生成。".to_string()
            } else {
                format!("{}\n\n*（已手动停止生成）*", trimmed)
            };
            break;
        }

        let content_str = outcome.content.trim().to_string();
        let tool_calls = outcome.tool_calls;

        if tool_calls.is_empty() || !allow_tools {
            final_text = if !content_str.is_empty() {
                content_str
            } else if !proposals.is_empty() {
                "已为您生成以下变更提案，请核对差异并点击「确认写入」。".to_string()
            } else {
                "模型未返回文本内容。".to_string()
            };
            break;
        }

        let mut assistant_msg = Map::new();
        assistant_msg.insert("role".to_string(), json!("assistant"));
        assistant_msg.insert(
            "content".to_string(),
            if content_str.is_empty() {
                Value::Null
            } else {
                json!(content_str)
            },
        );
        assistant_msg.insert("tool_calls".to_string(), Value::Array(tool_calls.clone()));
        messages.push(Value::Object(assistant_msg));

        // 通知前端工具执行开始
        if let Some(handle) = app {
            for tc in &tool_calls {
                let fn_name = tc
                    .pointer("/function/name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let _ = handle.emit(
                    "agent-stream",
                    json!({
                        "stream_id": stream_id,
                        "type": "tool_start",
                        "tool": fn_name,
                        "label": tool_display_label(fn_name),
                    }),
                );
            }
        }

        // 短暂加锁执行本地只读工具、提案与记忆写入，绝不在 .await 期间持有锁
        let mut memory_dirty = false;
        let tool_outputs: Vec<(String, String, String, bool)> = {
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
                        .unwrap_or("")
                        .to_string();
                    let raw_args = tc
                        .pointer("/function/arguments")
                        .and_then(|v| v.as_str())
                        .unwrap_or("{}");
                    let args = serde_json::from_str::<Value>(raw_args).unwrap_or_else(|_| json!({}));
                    let out = dispatch_agent_tool_with_options(
                        &conn,
                        &fn_name,
                        &args,
                        &mut proposals,
                        cfg.memory_enabled,
                    );
                    let ok = out.get("error").is_none();
                    if fn_name == "manage_memory" && ok {
                        memory_dirty = true;
                    }
                    (
                        call_id,
                        fn_name,
                        serde_json::to_string(&out).unwrap_or_else(|_| "{}".to_string()),
                        ok,
                    )
                })
                .collect()
        };

        if memory_dirty {
            let dir = agent_memory_dir();
            let sync_res = {
                let conn = db.0.lock().map_err(|e| e.to_string())?;
                let user_md = render_memory_markdown(
                    MEMORY_TARGET_USER,
                    &query_memory_entries(&conn, Some(MEMORY_TARGET_USER))?,
                );
                let mem_md = render_memory_markdown(
                    MEMORY_TARGET_MEMORY,
                    &query_memory_entries(&conn, Some(MEMORY_TARGET_MEMORY))?,
                );
                Ok::<(String, String), String>((user_md, mem_md))
            };
            if let Ok((user_md, mem_md)) = sync_res {
                if std::fs::create_dir_all(&dir).is_ok() {
                    let _ = std::fs::write(dir.join("USER.md"), user_md.as_bytes());
                    let _ = std::fs::write(dir.join("MEMORY.md"), mem_md.as_bytes());
                }
            }
            if let Some(handle) = app {
                let _ = handle.emit(
                    "agent-stream",
                    json!({
                        "stream_id": stream_id,
                        "type": "memory_updated",
                    }),
                );
            }
        }

        for (call_id, fn_name, out_json, ok) in tool_outputs {
            if let Some(handle) = app {
                let _ = handle.emit(
                    "agent-stream",
                    json!({
                        "stream_id": stream_id,
                        "type": "tool_done",
                        "tool": fn_name,
                        "label": tool_display_label(&fn_name),
                        "ok": ok,
                    }),
                );
            }
            messages.push(json!({
                "role": "tool",
                "tool_call_id": call_id,
                "content": out_json,
            }));
        }
    }

    if let Some(handle) = app {
        let _ = handle.emit(
            "agent-stream",
            json!({
                "stream_id": stream_id,
                "type": "done",
                "cancelled": was_cancelled,
            }),
        );
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

    #[test]
    fn test_max_tokens_bounds_and_sse_streaming_parser() {
        assert_eq!(normalize_max_tokens(0), 0);
        assert_eq!(normalize_max_tokens(128_000), 128_000);
        assert_eq!(normalize_max_tokens(2_000_000), 1_000_000);
        assert_eq!(normalize_max_tokens(10), 256);

        let cfg = LoadedAgentConfig {
            base_url: "https://api.example.com/v1".to_string(),
            api_key: String::new(),
            model: "gemini-4-hydrogen-xhigh".to_string(),
            max_tokens: 0,
            context_window: DEFAULT_CONTEXT_WINDOW,
            temperature: DEFAULT_TEMPERATURE,
            auto_compact: true,
            reserve_tokens: DEFAULT_RESERVE_TOKENS,
            keep_recent_tokens: DEFAULT_KEEP_RECENT_TOKENS,
            memory_enabled: true,
            custom_system_prompt: String::new(),
        };
        let auto_body = build_chat_request_body(&cfg, &[], false, None, true);
        assert!(auto_body.get("max_tokens").is_none());
        assert_eq!(auto_body.get("stream").and_then(|v| v.as_bool()), Some(true));
        assert_eq!(auto_body.get("temperature").and_then(|v| v.as_f64()), Some(0.2));

        let sse = concat!(
            "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"先检查续费\"}}]}\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"本月合计 \"}}]}\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"¥205.00\"}}]}\n",
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"c1\",\"function\":{\"name\":\"search_\",\"arguments\":\"{\\\"query\\\":\"}}]}}]}\n",
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"name\":\"assets\",\"arguments\":\"\\\"vps\\\"}\"}}]}}]}\n",
            "data: [DONE]\n"
        );
        let parsed = parse_sse_stream_text_for_test(sse);
        assert_eq!(parsed.reasoning, "先检查续费");
        assert_eq!(parsed.content, "本月合计 ¥205.00");
        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(parsed.tool_calls[0].pointer("/function/name").and_then(|v| v.as_str()), Some("search_assets"));
        assert_eq!(parsed.tool_calls[0].pointer("/function/arguments").and_then(|v| v.as_str()), Some("{\"query\":\"vps\"}"));
    }

    #[test]
    fn test_agent_settings_extended_roundtrip_and_bounds() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = open_temp_db(tmp.path());

        let defaults = get_agent_settings(&conn).unwrap();
        assert_eq!(defaults.context_window, DEFAULT_CONTEXT_WINDOW);
        assert!((defaults.temperature - 0.2).abs() < f64::EPSILON);
        assert!(defaults.auto_compact);
        assert_eq!(defaults.reserve_tokens, DEFAULT_RESERVE_TOKENS);
        assert_eq!(defaults.keep_recent_tokens, DEFAULT_KEEP_RECENT_TOKENS);
        assert!(defaults.memory_enabled);
        assert!(defaults.custom_system_prompt.is_empty());

        let saved = save_agent_settings(
            &conn,
            &AgentSettingsInput {
                base_url: "https://api.openai.com/v1/".to_string(),
                api_key: Some("sk-test-secret-1234567890".to_string()),
                clear_api_key: None,
                model: "gpt-4o".to_string(),
                max_tokens: Some(32768),
                context_window: Some(9_999_999), // 钳制上限 2_000_000
                temperature: Some(3.5),           // 钳制上限 2.0
                auto_compact: Some(false),
                reserve_tokens: Some(100),        // 钳制下限 1024
                keep_recent_tokens: Some(900_000), // 钳制上限 500_000
                memory_enabled: Some(false),
                custom_system_prompt: Some("  始终附带服务器所在区域  ".to_string()),
            },
        )
        .unwrap();

        assert_eq!(saved.context_window, 2_000_000);
        assert!((saved.temperature - 2.0).abs() < f64::EPSILON);
        assert!(!saved.auto_compact);
        assert_eq!(saved.reserve_tokens, 1_024);
        assert_eq!(saved.keep_recent_tokens, 500_000);
        assert!(!saved.memory_enabled);
        assert_eq!(saved.custom_system_prompt, "始终附带服务器所在区域");

        // 仅传基础字段时保留扩展字段不丢失
        let partial = save_agent_settings(
            &conn,
            &AgentSettingsInput {
                base_url: "https://api.openai.com/v1".to_string(),
                api_key: None,
                clear_api_key: None,
                model: "gpt-4.1".to_string(),
                max_tokens: Some(65536),
                context_window: None,
                temperature: None,
                auto_compact: None,
                reserve_tokens: None,
                keep_recent_tokens: None,
                memory_enabled: None,
                custom_system_prompt: None,
            },
        )
        .unwrap();
        assert_eq!(partial.model, "gpt-4.1");
        assert_eq!(partial.context_window, 2_000_000);
        assert!(!partial.auto_compact);
    }

    #[test]
    fn test_parse_models_response_variants() {
        let openai = json!({
            "data": [
                { "id": "gpt-4o-mini", "owned_by": "openai", "context_window": 128000, "max_output_tokens": 16384 },
                { "id": "claude-3.7-sonnet", "provider": "anthropic", "top_provider": { "context_length": 200000, "max_completion_tokens": 64000 } },
                { "id": "gpt-4o-mini", "owned_by": "dup" }
            ]
        });
        let parsed = parse_models_response(&openai);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].id, "claude-3.7-sonnet");
        assert_eq!(parsed[0].owned_by.as_deref(), Some("anthropic"));
        assert_eq!(parsed[0].context_window, Some(200_000));
        assert_eq!(parsed[0].max_output_tokens, Some(64_000));
        assert_eq!(parsed[1].id, "gpt-4o-mini");
        assert_eq!(parsed[1].context_window, Some(128_000));

        let ollama = json!({
            "models": [
                { "name": "qwen2.5:14b", "context_length": 32768.0, "max_output_tokens": "8192.0" },
                "llama3.1:8b"
            ]
        });
        let parsed_ollama = parse_models_response(&ollama);
        assert_eq!(parsed_ollama.len(), 2);
        assert_eq!(parsed_ollama[0].id, "llama3.1:8b");
        assert_eq!(parsed_ollama[1].context_window, Some(32_768));
        assert_eq!(parsed_ollama[1].max_output_tokens, Some(8_192));

        // 兼容 HTTP 200 返回 {"error": ...} 的网关错误提取
        let err_payload = json!({ "error": { "message": "Invalid API Key" } });
        assert_eq!(
            extract_api_error_message(&err_payload).as_deref(),
            Some("Invalid API Key")
        );
        assert!(extract_api_error_message(&openai).is_none());
    }

    #[test]
    fn test_pi_compaction_cut_point_and_token_estimation() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = open_temp_db(tmp.path());

        assert_eq!(estimate_text_tokens(""), 0);
        assert!(estimate_text_tokens("测试人民币总支出 12345678") >= 8);
        assert_eq!(effective_threshold_tokens(128_000, 16_384), 111_616);

        let msgs = vec![
            AgentMessageItem {
                id: 1,
                session_id: "default".to_string(),
                role: "user".to_string(),
                content: "第一轮问题：".to_string() + &"资产说明".repeat(350),
                proposals: vec![],
                created_at: String::new(),
            },
            AgentMessageItem {
                id: 2,
                session_id: "default".to_string(),
                role: "assistant".to_string(),
                content: "第一轮回答：".to_string() + &"明细内容".repeat(350),
                proposals: vec![],
                created_at: String::new(),
            },
            AgentMessageItem {
                id: 3,
                session_id: "default".to_string(),
                role: "user".to_string(),
                content: "第二轮问题：查看香港节点".to_string(),
                proposals: vec![],
                created_at: String::new(),
            },
            AgentMessageItem {
                id: 4,
                session_id: "default".to_string(),
                role: "assistant".to_string(),
                content: "第二轮回答：香港节点正常。".to_string(),
                proposals: vec![],
                created_at: String::new(),
            },
        ];

        // keep_budget = 1000 时应保留第 2 轮(id 3, 4)，切分点精确落到 index=2（role == "user"）
        let cut = select_compaction_cut_index(&msgs, 1_000, 8_192, false).unwrap();
        assert_eq!(cut, 2);
        assert_eq!(msgs[cut].role, "user");

        // 自动压缩下全在保留区（cut_idx == 0 回退）也必须对齐到 user 边界，绝不能只留孤立 assistant
        let auto_fallback_cut = select_compaction_cut_index(&msgs, 20_000, 100_000, false).unwrap();
        assert_eq!(auto_fallback_cut, 2);
        assert_eq!(msgs[auto_fallback_cut].role, "user");

        // 仅 1 轮对话 [user, assistant] 不存在 index >= 1 的 user 边界，应返回 None 避免孤立 assistant 开头
        let single_turn = &msgs[2..4];
        assert_eq!(select_compaction_cut_index(single_turn, 20_000, 100_000, true), None);
        assert_eq!(select_compaction_cut_index(single_turn, 20_000, 100_000, false), None);

        // max_tokens == 0 时压缩请求不强行下发 max_tokens；显式 max_tokens > 0 时按 summary_cap 钳位
        let base_cfg = LoadedAgentConfig {
            base_url: "https://api.example.com/v1".to_string(),
            api_key: String::new(),
            model: "gemini-thinking".to_string(),
            max_tokens: 0,
            context_window: DEFAULT_CONTEXT_WINDOW,
            temperature: DEFAULT_TEMPERATURE,
            auto_compact: true,
            reserve_tokens: DEFAULT_RESERVE_TOKENS,
            keep_recent_tokens: DEFAULT_KEEP_RECENT_TOKENS,
            memory_enabled: true,
            custom_system_prompt: String::new(),
        };
        assert_eq!(compaction_max_tokens_override(&base_cfg), None);
        let mut limited_cfg = base_cfg.clone();
        limited_cfg.max_tokens = 16_384;
        assert_eq!(compaction_max_tokens_override(&limited_cfg), Some(4_096));

        // build_compaction_prompt 总字符上限守卫：海量待压缩消息自动截断最早条目
        let huge_msgs: Vec<AgentMessageItem> = (1..=40)
            .map(|idx| AgentMessageItem {
                id: idx,
                session_id: "default".to_string(),
                role: if idx % 2 == 1 { "user" } else { "assistant" }.to_string(),
                content: format!("第 {} 条长日志：", idx) + &"数据".repeat(1_200),
                proposals: vec![],
                created_at: String::new(),
            })
            .collect();
        let prompt = build_compaction_prompt(None, &huge_msgs, None);
        let user_content = prompt[1].get("content").and_then(|v| v.as_str()).unwrap();
        assert!(user_content.chars().count() <= COMPACTION_TRANSCRIPT_MAX_CHARS + 500);
        assert!(user_content.contains("早期"));
        assert!(user_content.contains("第 40 条长日志"));

        // 事务校验：正常落库、并发冲突拒绝、清空后拒绝幽灵摘要复活
        let u1 = insert_agent_message(&conn, "user", "第一轮问题", &[]).unwrap();
        let _a1 = insert_agent_message(&conn, "assistant", "第一轮回答", &[]).unwrap();
        let u2 = insert_agent_message(&conn, "user", "第二轮问题", &[]).unwrap();
        let _a2 = insert_agent_message(&conn, "assistant", "第二轮回答", &[]).unwrap();

        let saved_comp = persist_compaction_checked(
            &conn,
            None,
            u2.id,
            "## 目标与关注点\n摘要 V1",
            1200,
            None,
        )
        .unwrap();
        assert_eq!(saved_comp.compaction.first_kept_message_id, u2.id);
        assert_eq!(saved_comp.compaction.compacted_message_count, 2);
        assert!(saved_comp.compaction.tokens_after > 0);

        // 模拟并发旧压缩（仍携带 prev_compaction_id = None）晚到：必须被拒绝，不能倒退边界
        let stale_err = persist_compaction_checked(
            &conn,
            None,
            u1.id,
            "## 目标与关注点\n旧摘要",
            1200,
            None,
        );
        assert!(stale_err.is_err());
        assert_eq!(
            query_latest_compaction(&conn).unwrap().unwrap().id,
            saved_comp.compaction.id
        );

        // 验证 clear_agent_messages 同步清空 agent_compactions，且在途压缩落库必须被拒
        clear_agent_messages(&conn).unwrap();
        assert!(query_latest_compaction(&conn).unwrap().is_none());
        let ghost_err = persist_compaction_checked(
            &conn,
            Some(saved_comp.compaction.id),
            u2.id,
            "## 目标与关注点\n幽灵摘要",
            1200,
            None,
        );
        assert!(ghost_err.is_err());
        assert!(query_latest_compaction(&conn).unwrap().is_none());
    }

    #[test]
    fn test_hermes_local_memory_crud_budget_guard_and_markdown_sync() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = open_temp_db(tmp.path());
        let mem_dir = tmp.path().join("agent_memory");

        // 敏感凭据守卫：全部拒绝（含大小写绕过、OAuth/xAI/AWS/JWT 与 Luhn 银行卡）
        for bad in [
            "OpenAI Key 是 sk-abcdefghijklmnopqrstuvwxyz123456",
            "大写绕过测试 SK-ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
            "OAuth Secret: GOCSPX-abc1234567890xyz",
            "Google OAuth Token ya29.a0AfH6SMBx1234567890abcdef",
            "Google Refresh 1//0gAbCdEfGhIjKlMnOpQrStUvWx",
            "xAI Key: xai-abcdefghijklmnopqrstuvwxyz1234",
            "AWS Key AKIAIOSFODNN7EXAMPLE",
            "JWT eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
            "2FA otpauth://totp/Google:test@gmail.com?secret=JBSWY3DPEHPK3PXP",
            "-----BEGIN OPENSSH PRIVATE KEY----- b3BlbnNzaC1rZXktdjE=",
            "常用卡号 4111-2222-3333-4455 备用",
            "无分隔卡号 4111222233334455 备用",
            "安全码 cvv: 899",
        ] {
            assert!(
                add_memory_entry(&conn, "memory", bad).is_err(),
                "敏感记忆未被拦截: {}",
                bad
            );
        }

        // 正常长业务编号（20位订单号、19位非Luhn Snowflake ID、含 cvc 子串主机名）不得误伤
        for safe in [
            "阿里云续费订单号 20261124000123456789 已核销",
            "告警通知频道 Snowflake ID 1234567890123456780",
            "新加坡反代主机名 mycvc2026.internal 负责静态缓存",
        ] {
            assert!(
                validate_memory_content_safety(safe).is_ok(),
                "正常业务内容被误拦: {}",
                safe
            );
        }

        // 正常偏好与工作区笔记写入 + 幂等去重
        let u1 = add_memory_entry(&conn, "user", "默认统一以人民币（CNY）汇报固定支出总额。").unwrap();
        let u1_dup = add_memory_entry(&conn, "user", "默认统一以人民币（CNY）汇报固定支出总额。").unwrap();
        assert_eq!(u1.id, u1_dup.id);
        let m1 = add_memory_entry(&conn, "memory", "讯猫节点位于香港，用于主博客反代与监控探针。").unwrap();

        // 通过 manage_memory 工具进行 replace（子串匹配）和 add
        let mut proposals = Vec::new();
        let replace_res = dispatch_agent_tool_with_options(
            &conn,
            "manage_memory",
            &json!({
                "action": "replace",
                "target": "memory",
                "match_text": "讯猫节点",
                "content": "讯猫节点（香港）承担主博客反代与长期探针任务。"
            }),
            &mut proposals,
            true,
        );
        assert_eq!(replace_res.get("saved").and_then(|v| v.as_bool()), Some(true));

        let updated_m1 = require_memory_entry_by_id(&conn, m1.id).unwrap();
        assert!(updated_m1.content.contains("长期探针任务"));

        // 预算上限测试（USER.md 1500 字符上限）
        for i in 0..8 {
            let chunk = format!("用户偏好条目 {}：{}", i, "测试".repeat(95));
            let res = add_memory_entry(&conn, "user", &chunk);
            if i >= 7 {
                assert!(res.is_err(), "超出 USER.md 1500 字符预算应拒绝写入");
            }
        }

        // 同步生成 USER.md 和 MEMORY.md 文件到临时目录并验证冻结快照
        sync_memory_files_to_dir(&conn, &mem_dir).unwrap();
        let user_md = std::fs::read_to_string(mem_dir.join("USER.md")).unwrap();
        let memory_md = std::fs::read_to_string(mem_dir.join("MEMORY.md")).unwrap();
        assert!(user_md.contains("人民币（CNY）"));
        assert!(memory_md.contains("讯猫节点（香港）"));

        let frozen = build_frozen_memory_prompt_block(&conn).unwrap();
        let sys = build_agent_system_prompt("2026-11-25", 7.25, true, &frozen, "", None);
        assert!(sys.contains("USER.md"));
        assert!(sys.contains("MEMORY.md"));
        assert!(sys.contains("讯猫节点（香港）"));

        // 工具 remove 删除确认
        let rm_res = dispatch_agent_tool_with_options(
            &conn,
            "manage_memory",
            &json!({
                "action": "remove",
                "target": "memory",
                "entry_id": m1.id
            }),
            &mut proposals,
            true,
        );
        assert_eq!(rm_res.get("saved").and_then(|v| v.as_bool()), Some(true));
        assert!(query_memory_entries(&conn, Some("memory")).unwrap().is_empty());
    }

    #[test]
    fn test_await_with_cancel_aborts_pending_future() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap();
        rt.block_on(async {
            let flag = Arc::new(AtomicBool::new(false));
            let flag_clone = flag.clone();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(60)).await;
                flag_clone.store(true, Ordering::SeqCst);
            });
            let pending = async {
                tokio::time::sleep(Duration::from_secs(30)).await;
                Ok::<(), String>(())
            };
            let started = Instant::now();
            let res = await_with_cancel(pending, Some(&flag)).await;
            assert!(res.is_err());
            assert!(started.elapsed() < Duration::from_secs(2));
        });
    }
}
