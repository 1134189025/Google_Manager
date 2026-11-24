use base64::engine::general_purpose::{URL_SAFE_NO_PAD};
use base64::Engine;
use chrono::{DateTime, Utc};
use rand::RngCore;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use url::Url;

use crate::database;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const OAUTH_SESSION_TIMEOUT: Duration = Duration::from_secs(300);

pub const SETTING_GEMINI_CLIENT_ID: &str = "oauth.gemini.client_id";
pub const SETTING_GEMINI_CLIENT_SECRET: &str = "oauth.gemini.client_secret";

#[derive(Debug, Clone)]
pub struct GeminiOAuthOverride {
    pub client_id: String,
    pub client_secret: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GeminiOAuthConfigView {
    pub configured: bool,
    pub source: String,
    pub client_id_hint: Option<String>,
    pub has_client_secret: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GeminiOAuthConfigInput {
    #[serde(default)]
    pub client_id: Option<String>,
    #[serde(default)]
    pub client_secret: Option<String>,
    #[serde(default)]
    pub raw_json: Option<String>,
    #[serde(default)]
    pub clear: Option<bool>,
}

fn mask_client_id(id: &str) -> String {
    let chars: Vec<char> = id.trim().chars().collect();
    if chars.len() <= 12 {
        return id.trim().to_string();
    }
    let head: String = chars.iter().take(6).collect();
    let tail: String = chars[chars.len() - 6..].iter().collect();
    format!("{}…{}", head, tail)
}

/// 解析 Google Cloud Console 下载的 OAuth 客户端 JSON 或扁平 JSON
pub fn parse_gemini_oauth_json(raw: &str) -> Result<(String, Option<String>), String> {
    let val: serde_json::Value =
        serde_json::from_str(raw.trim()).map_err(|_| "OAuth 配置不是有效的 JSON 格式".to_string())?;
    let section = val
        .get("installed")
        .or_else(|| val.get("web"))
        .unwrap_or(&val);
    let client_id = section
        .get("client_id")
        .or_else(|| section.get("clientId"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "JSON 中缺少 client_id 字段".to_string())?
        .to_string();
    let client_secret = section
        .get("client_secret")
        .or_else(|| section.get("clientSecret"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    Ok((client_id, client_secret))
}

fn extract_js_string_const(source: &str, name: &str) -> Option<String> {
    let idx = source.find(name)?;
    let rest = &source[idx + name.len()..];
    let eq_idx = rest.find('=')?;
    let after_eq = rest[eq_idx + 1..].trim_start();
    let quote = after_eq.chars().next()?;
    if quote != '\'' && quote != '"' {
        return None;
    }
    let inner = &after_eq[1..];
    let end = inner.find(quote)?;
    let val = inner[..end].trim();
    (!val.is_empty()).then(|| val.to_string())
}

fn candidate_gemini_cli_oauth_files() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let rel = Path::new("@google")
        .join("gemini-cli-core")
        .join("dist")
        .join("src")
        .join("code_assist")
        .join("oauth2.js");

    if let Ok(appdata) = std::env::var("APPDATA") {
        paths.push(PathBuf::from(&appdata).join("npm").join("node_modules").join(&rel));
        paths.push(
            PathBuf::from(&appdata)
                .join("npm")
                .join("node_modules")
                .join("@google")
                .join("gemini-cli")
                .join("node_modules")
                .join(&rel),
        );
    }
    if let Ok(local_app) = std::env::var("LOCALAPPDATA") {
        paths.push(
            PathBuf::from(&local_app)
                .join("pnpm")
                .join("global")
                .join("5")
                .join("node_modules")
                .join(&rel),
        );
    }
    if let Some(home) = dirs::home_dir() {
        paths.push(home.join(".npm-global").join("lib").join("node_modules").join(&rel));
        paths.push(home.join(".pnpm-global").join("node_modules").join(&rel));
    }
    paths.push(PathBuf::from("/opt/homebrew/lib/node_modules").join(&rel));
    paths.push(PathBuf::from("/usr/local/lib/node_modules").join(&rel));
    paths
}

fn discover_local_gemini_cli_oauth() -> Option<GeminiOAuthOverride> {
    for path in candidate_gemini_cli_oauth_files() {
        let Ok(content) = std::fs::read_to_string(&path) else {
            continue;
        };
        if let Some(client_id) = extract_js_string_const(&content, "OAUTH_CLIENT_ID") {
            let client_secret = extract_js_string_const(&content, "OAUTH_CLIENT_SECRET");
            return Some(GeminiOAuthOverride {
                client_id,
                client_secret,
            });
        }
    }
    None
}

pub fn load_gemini_oauth_override(conn: &Connection) -> Option<GeminiOAuthOverride> {
    let client_id = database::get_setting(conn, SETTING_GEMINI_CLIENT_ID)
        .ok()
        .flatten()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())?;
    let client_secret = database::get_setting(conn, SETTING_GEMINI_CLIENT_SECRET)
        .ok()
        .flatten()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    Some(GeminiOAuthOverride {
        client_id,
        client_secret,
    })
}

fn resolve_gemini_credentials(
    db_override: Option<&GeminiOAuthOverride>,
) -> Option<(String, Option<String>, &'static str)> {
    if let Some(ov) = db_override {
        let id = ov.client_id.trim();
        if !id.is_empty() {
            return Some((
                id.to_string(),
                ov.client_secret
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string),
                "本地设置",
            ));
        }
    }
    if let Some(env_id) = resolve_oauth_env("GOOGLE_MANAGER_GEMINI_CLIENT_ID", None) {
        let env_secret = resolve_oauth_env("GOOGLE_MANAGER_GEMINI_CLIENT_SECRET", None);
        return Some((env_id, env_secret, "环境变量"));
    }
    if let Some(built_id) = option_env!("GOOGLE_MANAGER_GEMINI_CLIENT_ID")
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let built_secret = option_env!("GOOGLE_MANAGER_GEMINI_CLIENT_SECRET")
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        return Some((built_id.to_string(), built_secret, "内置构建配置"));
    }
    if let Some(cli) = discover_local_gemini_cli_oauth() {
        return Some((cli.client_id, cli.client_secret, "本机 Gemini CLI"));
    }
    None
}

pub fn get_gemini_oauth_config(conn: &Connection) -> GeminiOAuthConfigView {
    let db_override = load_gemini_oauth_override(conn);
    if let Some((cid, csec, source)) = resolve_gemini_credentials(db_override.as_ref()) {
        GeminiOAuthConfigView {
            configured: true,
            source: source.to_string(),
            client_id_hint: Some(mask_client_id(&cid)),
            has_client_secret: csec.is_some(),
        }
    } else {
        GeminiOAuthConfigView {
            configured: false,
            source: "未配置".to_string(),
            client_id_hint: None,
            has_client_secret: false,
        }
    }
}

pub fn save_gemini_oauth_config(
    conn: &Connection,
    input: &GeminiOAuthConfigInput,
) -> Result<GeminiOAuthConfigView, String> {
    if input.clear == Some(true) {
        database::set_setting(conn, SETTING_GEMINI_CLIENT_ID, None)?;
        database::set_setting(conn, SETTING_GEMINI_CLIENT_SECRET, None)?;
        return Ok(get_gemini_oauth_config(conn));
    }

    let (client_id, client_secret) = if let Some(ref raw) = input.raw_json {
        if !raw.trim().is_empty() {
            parse_gemini_oauth_json(raw)?
        } else {
            let id = input
                .client_id
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "请填写 Gemini OAuth Client ID 或粘贴 Google OAuth JSON".to_string())?
                .to_string();
            let sec = input
                .client_secret
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string);
            (id, sec)
        }
    } else {
        let id = input
            .client_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| "请填写 Gemini OAuth Client ID 或粘贴 Google OAuth JSON".to_string())?
            .to_string();
        let sec = input
            .client_secret
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        (id, sec)
    };

    database::set_setting(conn, SETTING_GEMINI_CLIENT_ID, Some(&client_id))?;
    if let Some(ref sec) = client_secret {
        database::set_setting(conn, SETTING_GEMINI_CLIENT_SECRET, Some(sec))?;
    } else if input.client_secret.is_some() {
        database::set_setting(conn, SETTING_GEMINI_CLIENT_SECRET, None)?;
    }

    Ok(get_gemini_oauth_config(conn))
}

#[derive(Clone)]
pub struct AiOAuthProvider {
    pub mode: &'static str, // "loopback" | "code"
    pub client_id: String,
    pub client_secret: Option<String>,
    pub authorize_url: &'static str,
    pub token_url: &'static str,
    pub redirect_uri: &'static str,
    pub scope: &'static str,
    pub userinfo_url: Option<&'static str>,
    pub usage_url: &'static str,
    pub monthly_usage_url: Option<&'static str>,
    pub profile_url: Option<&'static str>,
}

fn resolve_oauth_env(name: &str, compile_time: Option<&'static str>) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            compile_time
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        })
}

#[allow(dead_code)]
pub fn get_provider(id: &str) -> Result<AiOAuthProvider, String> {
    get_provider_with_override(id, None)
}

pub fn get_provider_with_override(
    id: &str,
    gemini_override: Option<&GeminiOAuthOverride>,
) -> Result<AiOAuthProvider, String> {
    match id {
        "openai" => Ok(AiOAuthProvider {
            mode: "loopback",
            client_id: "app_EMoamEEZ73f0CkXaXp7hrann".to_string(),
            client_secret: None,
            authorize_url: "https://auth.openai.com/oauth/authorize",
            token_url: "https://auth.openai.com/oauth/token",
            redirect_uri: "http://localhost:1455/auth/callback",
            scope: "openid profile email offline_access",
            userinfo_url: None,
            usage_url: "https://chatgpt.com/backend-api/wham/usage",
            monthly_usage_url: None,
            profile_url: None,
        }),
        "claude" => Ok(AiOAuthProvider {
            mode: "code",
            client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e".to_string(),
            client_secret: None,
            authorize_url: "https://claude.com/cai/oauth/authorize",
            token_url: "https://platform.claude.com/v1/oauth/token",
            redirect_uri: "https://platform.claude.com/oauth/code/callback",
            scope: "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload",
            userinfo_url: None,
            usage_url: "https://api.anthropic.com/api/oauth/usage",
            monthly_usage_url: None,
            profile_url: None,
        }),
        "grok" => Ok(AiOAuthProvider {
            mode: "loopback",
            client_id: "b1a00492-073a-47ea-816f-4c329264a828".to_string(),
            client_secret: None,
            authorize_url: "https://auth.x.ai/oauth2/authorize",
            token_url: "https://auth.x.ai/oauth2/token",
            redirect_uri: "http://127.0.0.1:56121/callback",
            scope: "openid profile email offline_access grok-cli:access api:access",
            userinfo_url: Some("https://auth.x.ai/oauth2/userinfo"),
            usage_url: "https://cli-chat-proxy.grok.com/v1/billing?format=credits",
            monthly_usage_url: Some("https://cli-chat-proxy.grok.com/v1/billing"),
            profile_url: None,
        }),
        "gemini" => {
            let (client_id, client_secret, _source) = resolve_gemini_credentials(gemini_override)
                .ok_or_else(|| {
                    "GEMINI_OAUTH_NOT_CONFIGURED:Gemini OAuth 尚未配置凭据。请点击「Gemini OAuth 配置」粘贴 Client ID / JSON，或在发布仓库 Secrets 中设置 GOOGLE_MANAGER_GEMINI_CLIENT_ID。".to_string()
                })?;
            Ok(AiOAuthProvider {
                mode: "loopback",
                client_id,
                client_secret,
                authorize_url: "https://accounts.google.com/o/oauth2/v2/auth",
                token_url: "https://oauth2.googleapis.com/token",
                redirect_uri: "http://localhost:0/oauth2callback",
                scope: "openid https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
                userinfo_url: Some("https://openidconnect.googleapis.com/v1/userinfo"),
                usage_url: "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota",
                monthly_usage_url: None,
                profile_url: Some("https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist"),
            })
        }
        _ => Err("不支持的 AI 授权服务商".to_string()),
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QuotaWindow {
    pub label: String,
    pub used_percent: Option<f64>,
    pub remaining: Option<f64>,
    pub used: Option<f64>,
    pub limit: Option<f64>,
    pub unit: Option<String>,
    pub model: Option<String>,
    pub resets_at: Option<String>,
    pub window_seconds: Option<i64>,
    #[serde(default)]
    pub stale: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NormalizedUsage {
    pub source: String,
    pub scope: String,
    pub scope_note: String,
    pub plan: Option<String>,
    pub status: String, // "available" | "unavailable" | "stale"
    pub unavailable_reason: Option<String>,
    pub checked_at: String,
    pub windows: Vec<QuotaWindow>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StoredOAuthTokens {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub id_token: Option<String>,
    pub token_expires_at: String,
    pub account_id: String,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub plan: Option<String>,
}

fn scope_meta(provider: &str) -> (&'static str, &'static str, &'static str) {
    match provider {
        "openai" => (
            "openai-wham",
            "codex",
            "此处为 Codex 额度，不包含 ChatGPT 网页聊天、图片或深度研究的分类额度。",
        ),
        "claude" => (
            "anthropic-oauth",
            "claude",
            "此处为 Claude OAuth 返回的共享窗口及模型额度；服务商未提供完整的网页功能用量明细。",
        ),
        "grok" => (
            "xai-cli-billing",
            "grok-cli",
            "此处为 Grok CLI 周额度、产品额度与月度账单，不等同于 Grok 网页所有功能权益。",
        ),
        "gemini" => (
            "google-code-assist",
            "code-assist",
            "此处为 Gemini CLI / Code Assist 模型额度，不包含 Gemini 网页或 Google One 全部权益。",
        ),
        _ => ("unknown", "unknown", ""),
    }
}

fn iso_from_value(val: Option<&serde_json::Value>) -> Option<String> {
    let v = val?;
    if let Some(sec) = v.as_f64() {
        let dt = DateTime::<Utc>::from_timestamp(sec as i64, 0)?;
        return Some(dt.to_rfc3339());
    }
    if let Some(s) = v.as_str() {
        let trimmed = s.trim();
        if trimmed.is_empty() {
            return None;
        }
        if let Ok(dt) = DateTime::parse_from_rfc3339(trimmed) {
            return Some(dt.with_timezone(&Utc).to_rfc3339());
        }
    }
    None
}

fn num_from_value(val: Option<&serde_json::Value>) -> Option<f64> {
    let v = val?;
    let raw = if let Some(inner) = v.get("val") { inner } else { v };
    if let Some(n) = raw.as_f64() {
        return (n.is_finite() && n >= 0.0).then_some(n);
    }
    if let Some(s) = raw.as_str() {
        if let Ok(n) = s.trim().parse::<f64>() {
            return (n.is_finite() && n >= 0.0).then_some(n);
        }
    }
    None
}

pub fn normalize_usage(
    provider: &str,
    value: &serde_json::Value,
    checked_at: &str,
) -> NormalizedUsage {
    let (source, scope, scope_note) = scope_meta(provider);
    let mut windows = Vec::new();
    let plan = value
        .get("plan_type")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    match provider {
        "openai" => {
            let add_rate_limit = |windows: &mut Vec<QuotaWindow>,
                                  prefix: &str,
                                  limit_obj: Option<&serde_json::Value>,
                                  model: Option<String>| {
                let Some(map) = limit_obj.and_then(|v| v.as_object()) else {
                    return;
                };
                for (label, entry) in map {
                    let Some(used_pct) = entry.get("used_percent").and_then(|v| v.as_f64()) else {
                        continue;
                    };
                    let resets_at = iso_from_value(entry.get("reset_at")).or_else(|| {
                        let after = num_from_value(entry.get("reset_after_seconds"))?;
                        let base = DateTime::parse_from_rfc3339(checked_at).ok()?.timestamp();
                        DateTime::<Utc>::from_timestamp(base + after as i64, 0).map(|d| d.to_rfc3339())
                    });
                    windows.push(QuotaWindow {
                        label: if prefix.is_empty() {
                            label.clone()
                        } else {
                            format!("{}/{}", prefix, label)
                        },
                        used_percent: Some(used_pct),
                        remaining: None,
                        used: None,
                        limit: None,
                        unit: None,
                        model: model.clone(),
                        resets_at,
                        window_seconds: entry.get("limit_window_seconds").and_then(|v| v.as_i64()),
                        stale: false,
                    });
                }
            };

            add_rate_limit(&mut windows, "", value.get("rate_limit"), None);
            add_rate_limit(&mut windows, "code_review", value.get("code_review_rate_limit"), None);
            if let Some(arr) = value.get("additional_rate_limits").and_then(|v| v.as_array()) {
                for entry in arr {
                    let prefix = entry
                        .get("limit_name")
                        .or_else(|| entry.get("metered_feature"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("additional");
                    let model = entry
                        .get("normal_model_slug")
                        .or_else(|| entry.get("metered_feature"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    add_rate_limit(&mut windows, prefix, entry.get("rate_limit"), model);
                }
            }
            if let Some(bal) = num_from_value(value.get("credits").and_then(|c| c.get("balance"))) {
                let unlimited = value
                    .get("credits")
                    .and_then(|c| c.get("unlimited"))
                    .and_then(|u| u.as_bool())
                    == Some(true);
                if !unlimited {
                    windows.push(QuotaWindow {
                        label: "credits".to_string(),
                        used_percent: None,
                        remaining: Some(bal),
                        used: None,
                        limit: None,
                        unit: Some("credits".to_string()),
                        model: None,
                        resets_at: None,
                        window_seconds: None,
                        stale: false,
                    });
                }
            }
        }
        "grok" => {
            if let Some(cfg) = value.get("config") {
                let period_end = iso_from_value(cfg.get("currentPeriod").and_then(|p| p.get("end")));
                if let Some(pct) = cfg.get("creditUsagePercent").and_then(|v| v.as_f64()) {
                    windows.push(QuotaWindow {
                        label: "weekly".to_string(),
                        used_percent: Some(pct),
                        remaining: None,
                        used: None,
                        limit: None,
                        unit: None,
                        model: None,
                        resets_at: period_end.clone(),
                        window_seconds: None,
                        stale: false,
                    });
                }
                if let Some(arr) = cfg.get("productUsage").and_then(|v| v.as_array()) {
                    for entry in arr {
                        if let Some(pct) = entry.get("usagePercent").and_then(|v| v.as_f64()) {
                            let prod = entry
                                .get("product")
                                .and_then(|v| v.as_str())
                                .unwrap_or("product");
                            windows.push(QuotaWindow {
                                label: format!("product/{}", prod),
                                used_percent: Some(pct),
                                remaining: None,
                                used: None,
                                limit: None,
                                unit: None,
                                model: None,
                                resets_at: period_end.clone(),
                                window_seconds: None,
                                stale: false,
                            });
                        }
                    }
                }
                let billing_end = iso_from_value(cfg.get("billingPeriodEnd"));
                for (label, used_key, limit_key, div) in [
                    ("monthly", "used", "monthlyLimit", 100.0),
                    ("on_demand", "onDemandUsed", "onDemandCap", 1.0),
                ] {
                    let used = num_from_value(cfg.get(used_key));
                    let limit = num_from_value(cfg.get(limit_key));
                    if used.is_some() || limit.is_some() {
                        let pct = match (used, limit) {
                            (Some(u), Some(l)) if l > 0.0 => Some((u / l) * 100.0),
                            _ => None,
                        };
                        windows.push(QuotaWindow {
                            label: label.to_string(),
                            used_percent: pct,
                            remaining: None,
                            used: used.map(|u| u / div),
                            limit: limit.map(|l| l / div),
                            unit: Some("USD".to_string()),
                            model: None,
                            resets_at: billing_end.clone(),
                            window_seconds: None,
                            stale: false,
                        });
                    }
                }
                if let Some(prepaid) = num_from_value(cfg.get("prepaidBalance")) {
                    windows.push(QuotaWindow {
                        label: "prepaid".to_string(),
                        used_percent: None,
                        remaining: Some(prepaid),
                        used: None,
                        limit: None,
                        unit: Some("USD".to_string()),
                        model: None,
                        resets_at: None,
                        window_seconds: None,
                        stale: false,
                    });
                }
            }
        }
        "gemini" => {
            if let Some(buckets) = value.get("buckets").and_then(|v| v.as_array()) {
                for entry in buckets {
                    let frac = entry
                        .get("remainingFraction")
                        .and_then(|v| v.as_f64())
                        .filter(|f| (0.0..=1.0).contains(f));
                    let remaining = num_from_value(entry.get("remainingAmount"));
                    if frac.is_none() && remaining.is_none() {
                        continue;
                    }
                    let model_id = entry
                        .get("modelId")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .trim();
                    let token_type = entry
                        .get("tokenType")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .trim();
                    let label = format!("{} {}", model_id, token_type).trim().to_string();
                    windows.push(QuotaWindow {
                        label: if label.is_empty() {
                            "gemini".to_string()
                        } else {
                            label
                        },
                        used_percent: frac.map(|f| ((1.0 - f) * 10000.0).round() / 100.0),
                        remaining,
                        used: None,
                        limit: None,
                        unit: (!token_type.is_empty()).then(|| token_type.to_string()),
                        model: (!model_id.is_empty()).then(|| model_id.to_string()),
                        resets_at: iso_from_value(entry.get("resetTime")),
                        window_seconds: None,
                        stale: false,
                    });
                }
            }
            if let Some(credits) = value.get("availableCredits").and_then(|v| v.as_array()) {
                for entry in credits {
                    if let Some(rem) = num_from_value(entry.get("creditAmount")) {
                        let ctype = entry
                            .get("creditType")
                            .and_then(|v| v.as_str())
                            .unwrap_or("default");
                        windows.push(QuotaWindow {
                            label: format!("credits/{}", ctype),
                            used_percent: None,
                            remaining: Some(rem),
                            used: None,
                            limit: None,
                            unit: Some("credits".to_string()),
                            model: None,
                            resets_at: None,
                            window_seconds: None,
                            stale: false,
                        });
                    }
                }
            }
        }
        "claude" => {
            if let Some(map) = value.as_object() {
                for (label, entry) in map {
                    let Some(util) = entry.get("utilization").and_then(|v| v.as_f64()) else {
                        continue;
                    };
                    let window_seconds = if label.starts_with("five_hour") {
                        Some(18000)
                    } else if label.starts_with("seven_day") {
                        Some(604800)
                    } else {
                        None
                    };
                    windows.push(QuotaWindow {
                        label: label.clone(),
                        used_percent: Some(util),
                        remaining: None,
                        used: None,
                        limit: None,
                        unit: None,
                        model: None,
                        resets_at: iso_from_value(entry.get("resets_at")),
                        window_seconds,
                        stale: false,
                    });
                }
            }
        }
        _ => {}
    }

    windows.truncate(64);
    let has_windows = !windows.is_empty();
    NormalizedUsage {
        source: source.to_string(),
        scope: scope.to_string(),
        scope_note: scope_note.to_string(),
        plan,
        status: if has_windows {
            "available".to_string()
        } else {
            "unavailable".to_string()
        },
        unavailable_reason: (!has_windows)
            .then(|| "额度接口未返回当前账号可读取的用量数据。".to_string()),
        checked_at: checked_at.to_string(),
        windows,
    }
}

// ─── Antigravity CLI 额度解析与执行 ────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AntigravityQuotaResult {
    pub checked_at: String,
    pub windows: Vec<QuotaWindow>,
}

pub fn parse_antigravity_quota(stdout: &str) -> Vec<QuotaWindow> {
    let mut windows: Vec<QuotaWindow> = Vec::new();
    let mut seen: HashMap<String, usize> = HashMap::new();

    for line in stdout.lines() {
        let parts: Vec<&str> = line.trim().split('\t').map(str::trim).collect();
        if parts.len() < 3 {
            continue;
        }
        let pool = parts[0];
        let period = parts[1];
        let quota_raw = parts[2];
        let reset_raw = parts.get(3).copied().unwrap_or("");

        let seconds = if period.eq_ignore_ascii_case("Five Hour Limit Remaining") {
            Some(18000)
        } else if period.eq_ignore_ascii_case("Weekly Limit Remaining") {
            Some(604800)
        } else {
            None
        };
        let Some(window_seconds) = seconds else {
            continue;
        };

        let Some(pct_str) = quota_raw.strip_suffix('%') else {
            continue;
        };
        let Ok(rem_pct) = pct_str.trim().parse::<f64>() else {
            continue;
        };
        if pool.is_empty() || !rem_pct.is_finite() || !(0.0..=100.0).contains(&rem_pct) {
            continue;
        }

        let model: String = pool.chars().take(100).collect();
        let label = format!(
            "{}/{}",
            model,
            if window_seconds == 18000 {
                "five_hour"
            } else {
                "seven_day"
            }
        );
        let resets_at = DateTime::parse_from_rfc3339(reset_raw)
            .ok()
            .map(|d| d.with_timezone(&Utc).to_rfc3339())
            .or_else(|| {
                DateTime::parse_from_str(reset_raw, "%Y-%m-%d %H:%M:%S %z")
                    .ok()
                    .map(|d| d.with_timezone(&Utc).to_rfc3339())
            });

        let window = QuotaWindow {
            label: label.clone(),
            used_percent: Some(((100.0 - rem_pct) * 100.0).round() / 100.0),
            remaining: None,
            used: None,
            limit: None,
            unit: None,
            model: Some(model),
            resets_at,
            window_seconds: Some(window_seconds),
            stale: false,
        };

        if let Some(&idx) = seen.get(&label) {
            windows[idx] = window;
        } else if windows.len() < 64 {
            seen.insert(label, windows.len());
            windows.push(window);
        }
    }
    windows
}

struct TempDirGuard(std::path::PathBuf);
impl Drop for TempDirGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

pub async fn read_antigravity_quota() -> Result<AntigravityQuotaResult, String> {
    let bin = if cfg!(target_os = "windows") {
        "agy.exe"
    } else {
        "agy"
    };
    let tmp_path = std::env::temp_dir().join(format!("gm-agy-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&tmp_path).map_err(|e| format!("创建临时目录失败: {}", e))?;
    let _guard = TempDirGuard(tmp_path.clone());

    let mut cmd = tokio::process::Command::new(bin);
    cmd.args(["-p", "/usage", "--print-timeout", "20s"])
        .current_dir(&tmp_path);

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = tokio::time::timeout(Duration::from_secs(25), cmd.output())
        .await
        .map_err(|_| "读取 Antigravity CLI 额度超时".to_string())?
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "找不到 Antigravity CLI (agy)。安装后请重新启动应用。".to_string()
            } else {
                "读取 Antigravity CLI 额度失败，请检查本机 CLI 登录状态。".to_string()
            }
        })?;

    if !output.status.success() {
        return Err("读取 Antigravity CLI 额度失败，请确认本机 CLI 已登录。".to_string());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let windows = parse_antigravity_quota(&stdout);
    if windows.is_empty() {
        return Err("Antigravity CLI 未返回可识别的额度，请确认 CLI 已登录且支持额度查询。".to_string());
    }
    Ok(AntigravityQuotaResult {
        checked_at: Utc::now().to_rfc3339(),
        windows,
    })
}

// ─── OAuth 会话管理与令牌交换 ────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
pub struct OAuthStartInfo {
    pub session_id: String,
    pub mode: String,
    pub authorize_url: String,
    pub redirect_uri: String,
    pub manual_callback: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct OAuthStatusInfo {
    pub status: String, // "pending" | "exchanging" | "connected" | "error" | "cancelled" | "expired"
    pub error: String,
    pub subscription_id: i64,
}

struct OAuthSession {
    provider: String,
    resolved_provider: AiOAuthProvider,
    subscription_id: i64,
    state: String,
    verifier: String,
    redirect_uri: String,
    status: String,
    error: String,
    created_at: std::time::Instant,
    tokens_result: Option<StoredOAuthTokens>,
}

pub struct AiOAuthManager {
    sessions: Arc<Mutex<HashMap<String, OAuthSession>>>,
}

impl AiOAuthManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn get_status(&self, session_id: &str) -> OAuthStatusInfo {
        let mut guard = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let Some(sess) = guard.get_mut(session_id) else {
            return OAuthStatusInfo {
                status: "expired".to_string(),
                error: "授权会话不存在或已过期".to_string(),
                subscription_id: 0,
            };
        };
        if sess.status == "pending" && sess.created_at.elapsed() > OAUTH_SESSION_TIMEOUT {
            sess.status = "expired".to_string();
        }
        OAuthStatusInfo {
            status: sess.status.clone(),
            error: sess.error.clone(),
            subscription_id: sess.subscription_id,
        }
    }

    pub fn take_tokens(&self, session_id: &str) -> Option<(i64, String, StoredOAuthTokens)> {
        let mut guard = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let sess = guard.get_mut(session_id)?;
        let tokens = sess.tokens_result.take()?;
        Some((sess.subscription_id, sess.provider.clone(), tokens))
    }

    pub fn cancel(&self, session_id: &str) {
        let mut guard = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(sess) = guard.get_mut(session_id) {
            sess.status = "cancelled".to_string();
        }
    }
}

fn random_base64url(len: usize) -> String {
    let mut bytes = vec![0u8; len];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn parse_oauth_callback_input(
    input: &str,
    expected_redirect: &str,
    expected_state: &str,
) -> Result<(String, String), String> {
    let raw = input.trim();
    if raw.is_empty() || raw.len() > 16384 {
        return Err("请粘贴完整回调链接或 code#state".to_string());
    }
    let (code, state) = if raw.to_ascii_lowercase().starts_with("http://")
        || raw.to_ascii_lowercase().starts_with("https://")
    {
        let cb = Url::parse(raw).map_err(|_| "回调链接格式不正确".to_string())?;
        let exp = Url::parse(expected_redirect).map_err(|_| "预期回调链接无效".to_string())?;
        if cb.scheme() != exp.scheme()
            || cb.host_str() != exp.host_str()
            || cb.port_or_known_default() != exp.port_or_known_default()
            || cb.path() != exp.path()
        {
            return Err("回调地址与本次授权不匹配，请粘贴本次登录生成的完整链接".to_string());
        }
        let mut states = Vec::new();
        let mut codes = Vec::new();
        let mut has_error = false;
        for (k, v) in cb.query_pairs() {
            if k == "state" {
                states.push(v.into_owned());
            } else if k == "code" {
                codes.push(v.into_owned());
            } else if k == "error" {
                has_error = true;
            }
        }
        if has_error {
            return Err("授权已被拒绝".to_string());
        }
        if states.len() != 1 || states[0] != expected_state || codes.len() != 1 {
            return Err("授权码或 state 不匹配，请粘贴本次登录的完整回调".to_string());
        }
        (codes[0].clone(), states[0].clone())
    } else {
        let Some((c, s)) = raw.split_once('#') else {
            return Err("请粘贴完整回调链接或 code#state".to_string());
        };
        (c.to_string(), s.to_string())
    };

    if code.is_empty()
        || state != expected_state
        || code.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err("授权码或 state 不匹配，请粘贴本次登录的完整回调".to_string());
    }
    Ok((code, state))
}

fn decode_jwt_payload(token: &str) -> serde_json::Value {
    let Some(part) = token.split('.').nth(1) else {
        return serde_json::Value::Object(Default::default());
    };
    let Ok(bytes) = URL_SAFE_NO_PAD.decode(part) else {
        return serde_json::Value::Object(Default::default());
    };
    serde_json::from_slice(&bytes).unwrap_or_else(|_| serde_json::Value::Object(Default::default()))
}

fn extract_identity(provider: &str, tokens: &serde_json::Value) -> (String, Option<String>, Option<String>) {
    if provider == "claude" {
        let aid = tokens
            .get("account")
            .and_then(|a| a.get("uuid"))
            .or_else(|| tokens.get("organization").and_then(|o| o.get("uuid")))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let email = tokens
            .get("account")
            .and_then(|a| a.get("email_address"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        return (aid, email, None);
    }

    let access_claims = tokens
        .get("access_token")
        .and_then(|v| v.as_str())
        .map(decode_jwt_payload)
        .unwrap_or_default();
    let id_claims = tokens
        .get("id_token")
        .and_then(|v| v.as_str())
        .map(decode_jwt_payload)
        .unwrap_or_default();

    let auth_id = id_claims
        .get("https://api.openai.com/auth")
        .or_else(|| access_claims.get("https://api.openai.com/auth"));
    let account_id = if provider == "openai" {
        auth_id
            .and_then(|a| a.get("chatgpt_account_id"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    } else {
        id_claims
            .get("sub")
            .or_else(|| access_claims.get("sub"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    };
    let email = id_claims
        .get("email")
        .or_else(|| access_claims.get("email"))
        .or_else(|| {
            access_claims
                .get("https://api.openai.com/profile")
                .and_then(|p| p.get("email"))
        })
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let plan = auth_id
        .and_then(|a| a.get("chatgpt_plan_type"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    (account_id, email, plan)
}

async fn exchange_token(
    client: &reqwest::Client,
    p: &AiOAuthProvider,
    params: Vec<(&str, String)>,
) -> Result<serde_json::Value, String> {
    let mut body_pairs = params;
    if let Some(ref secret) = p.client_secret {
        body_pairs.push(("client_secret", secret.clone()));
    }
    let req = if p.mode == "loopback" {
        client
            .post(p.token_url)
            .form(&body_pairs)
            .header("Accept", "application/json")
    } else {
        let map: serde_json::Map<String, serde_json::Value> = body_pairs
            .into_iter()
            .map(|(k, v)| (k.to_string(), serde_json::Value::String(v)))
            .collect();
        client
            .post(p.token_url)
            .json(&serde_json::Value::Object(map))
            .header("Accept", "application/json")
    };

    let resp = req
        .send()
        .await
        .map_err(|_| "无法连接授权服务，请检查网络或重试".to_string())?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("授权令牌交换失败 (HTTP {})", status.as_u16()));
    }
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|_| "授权服务未返回有效 JSON".to_string())?;
    if json
        .get("access_token")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .is_none()
    {
        return Err("授权服务返回的令牌不完整".to_string());
    }
    Ok(json)
}

async fn complete_code_exchange(
    provider_id: &str,
    p: &AiOAuthProvider,
    redirect_uri: &str,
    verifier: &str,
    code: &str,
    state: &str,
) -> Result<StoredOAuthTokens, String> {
    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;

    let mut params = vec![
        ("grant_type", "authorization_code".to_string()),
        ("client_id", p.client_id.to_string()),
        ("redirect_uri", redirect_uri.to_string()),
        ("code_verifier", verifier.to_string()),
        ("code", code.to_string()),
    ];
    if provider_id == "claude" {
        params.push(("state", state.to_string()));
    }

    let tokens = exchange_token(&client, p, params).await?;
    let access_token = tokens["access_token"].as_str().unwrap_or("").to_string();
    let refresh_token = tokens
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let id_token = tokens
        .get("id_token")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let expires_in = tokens
        .get("expires_in")
        .and_then(|v| v.as_i64())
        .unwrap_or(3600)
        .max(60);

    let (mut account_id, mut email, plan) = extract_identity(provider_id, &tokens);
    if let Some(uinfo_url) = p.userinfo_url {
        if let Ok(resp) = client
            .get(uinfo_url)
            .bearer_auth(&access_token)
            .header("Accept", "application/json")
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(info) = resp.json::<serde_json::Value>().await {
                    if let Some(sub) = info.get("sub").and_then(|v| v.as_str()) {
                        account_id = sub.to_string();
                    }
                    if let Some(em) = info.get("email").and_then(|v| v.as_str()) {
                        email = Some(em.to_string());
                    }
                }
            }
        }
    }

    if account_id.is_empty() {
        return Err("授权服务没有返回账号标识".to_string());
    }

    Ok(StoredOAuthTokens {
        access_token,
        refresh_token,
        id_token,
        token_expires_at: (Utc::now() + chrono::Duration::seconds(expires_in)).to_rfc3339(),
        account_id,
        email,
        plan,
    })
}

pub async fn start_oauth_session(
    manager: &AiOAuthManager,
    provider_id: &str,
    subscription_id: i64,
    gemini_override: Option<&GeminiOAuthOverride>,
) -> Result<OAuthStartInfo, String> {
    let p = get_provider_with_override(provider_id, gemini_override)?;
    let session_id = uuid::Uuid::new_v4().to_string();
    let state = random_base64url(24);
    let verifier = random_base64url(32);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));

    let mut redirect_uri = p.redirect_uri.to_string();
    let mut manual_callback = p.mode == "code";
    let mut listener_opt: Option<TcpListener> = None;

    if p.mode == "loopback" {
        let parsed = Url::parse(p.redirect_uri).map_err(|e| e.to_string())?;
        let port = parsed.port().unwrap_or(0);
        match TcpListener::bind(("127.0.0.1", port)).await {
            Ok(listener) => {
                let bound_port = listener.local_addr().map_err(|e| e.to_string())?.port();
                let mut updated = parsed;
                let _ = updated.set_port(Some(bound_port));
                redirect_uri = updated.to_string();
                listener_opt = Some(listener);
            }
            Err(_) if port != 0 => {
                // 固定端口被占用时退回手动粘贴回调 URL 模式
                manual_callback = true;
            }
            Err(e) => {
                return Err(format!("无法启动本机授权回调监听: {}", e));
            }
        }
    }

    let mut auth_url = Url::parse(p.authorize_url).map_err(|e| e.to_string())?;
    {
        let mut qp = auth_url.query_pairs_mut();
        qp.append_pair("client_id", &p.client_id);
        qp.append_pair("response_type", "code");
        qp.append_pair("redirect_uri", &redirect_uri);
        qp.append_pair("scope", p.scope);
        qp.append_pair("state", &state);
        qp.append_pair("code_challenge_method", "S256");
        qp.append_pair("code_challenge", &challenge);
        if provider_id == "openai" {
            qp.append_pair("codex_cli_simplified_flow", "true");
            qp.append_pair("id_token_add_organizations", "true");
        } else if provider_id == "claude" {
            qp.append_pair("code", "true");
        } else if provider_id == "gemini" {
            qp.append_pair("access_type", "offline");
            qp.append_pair("prompt", "consent");
        }
    }

    {
        let mut guard = manager.sessions.lock().unwrap_or_else(|e| e.into_inner());
        guard.insert(
            session_id.clone(),
            OAuthSession {
                provider: provider_id.to_string(),
                resolved_provider: p.clone(),
                subscription_id,
                state: state.clone(),
                verifier: verifier.clone(),
                redirect_uri: redirect_uri.clone(),
                status: "pending".to_string(),
                error: String::new(),
                created_at: std::time::Instant::now(),
                tokens_result: None,
            },
        );
    }

    if let Some(listener) = listener_opt {
        let sessions_arc = manager.sessions.clone();
        let sid = session_id.clone();
        let redir_for_task = redirect_uri.clone();
        let state_for_task = state.clone();
        let verifier_for_task = verifier.clone();
        let prov_for_task = provider_id.to_string();
        let resolved_for_task = p.clone();

        tauri::async_runtime::spawn(async move {
            let accept_res = tokio::time::timeout(OAUTH_SESSION_TIMEOUT, listener.accept()).await;
            let Ok(Ok((mut socket, _))) = accept_res else {
                return;
            };
            let mut buf = [0u8; 8192];
            let Ok(n) = socket.read(&mut buf).await else {
                return;
            };
            let req_text = String::from_utf8_lossy(&buf[..n]);
            let first_line = req_text.lines().next().unwrap_or("");
            let req_path = first_line.split_whitespace().nth(1).unwrap_or("/");
            let full_url = if let Ok(base) = Url::parse(&redir_for_task) {
                format!("{}://{}{}", base.scheme(), base.authority(), req_path)
            } else {
                req_path.to_string()
            };

            match parse_oauth_callback_input(&full_url, &redir_for_task, &state_for_task) {
                Ok((code, st)) => {
                    let body = "已收到授权结果，请返回 GoogleManager 查看连接状态。";
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    let _ = socket.write_all(resp.as_bytes()).await;

                    {
                        let mut guard = sessions_arc.lock().unwrap_or_else(|e| e.into_inner());
                        if let Some(s) = guard.get_mut(&sid) {
                            if s.status != "pending" {
                                return;
                            }
                            s.status = "exchanging".to_string();
                        }
                    }

                    match complete_code_exchange(
                        &prov_for_task,
                        &resolved_for_task,
                        &redir_for_task,
                        &verifier_for_task,
                        &code,
                        &st,
                    )
                    .await
                    {
                        Ok(tokens) => {
                            let mut guard = sessions_arc.lock().unwrap_or_else(|e| e.into_inner());
                            if let Some(s) = guard.get_mut(&sid) {
                                s.tokens_result = Some(tokens);
                                s.status = "connected".to_string();
                            }
                        }
                        Err(err) => {
                            let mut guard = sessions_arc.lock().unwrap_or_else(|e| e.into_inner());
                            if let Some(s) = guard.get_mut(&sid) {
                                s.error = err;
                                s.status = "error".to_string();
                            }
                        }
                    }
                }
                Err(err) => {
                    let resp = format!(
                        "HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        err.len(),
                        err
                    );
                    let _ = socket.write_all(resp.as_bytes()).await;
                    let mut guard = sessions_arc.lock().unwrap_or_else(|e| e.into_inner());
                    if let Some(s) = guard.get_mut(&sid) {
                        s.error = err;
                        s.status = "error".to_string();
                    }
                }
            }
        });
    }

    Ok(OAuthStartInfo {
        session_id,
        mode: p.mode.to_string(),
        authorize_url: auth_url.to_string(),
        redirect_uri,
        manual_callback,
    })
}

pub async fn complete_oauth_manual(
    manager: &AiOAuthManager,
    session_id: &str,
    callback_input: &str,
) -> Result<(i64, String, StoredOAuthTokens), String> {
    let (provider_id, resolved_provider, subscription_id, redirect_uri, verifier, state) = {
        let mut guard = manager.sessions.lock().unwrap_or_else(|e| e.into_inner());
        let sess = guard
            .get_mut(session_id)
            .ok_or_else(|| "授权会话不存在或已过期".to_string())?;
        if sess.status != "pending" {
            return Err("授权已结束，请重新发起".to_string());
        }
        sess.status = "exchanging".to_string();
        (
            sess.provider.clone(),
            sess.resolved_provider.clone(),
            sess.subscription_id,
            sess.redirect_uri.clone(),
            sess.verifier.clone(),
            sess.state.clone(),
        )
    };

    let (code, st) = match parse_oauth_callback_input(callback_input, &redirect_uri, &state) {
        Ok(pair) => pair,
        Err(err) => {
            let mut guard = manager.sessions.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(s) = guard.get_mut(session_id) {
                s.status = "pending".to_string();
            }
            return Err(err);
        }
    };

    match complete_code_exchange(&provider_id, &resolved_provider, &redirect_uri, &verifier, &code, &st).await {
        Ok(tokens) => {
            let mut guard = manager.sessions.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(s) = guard.get_mut(session_id) {
                s.status = "connected".to_string();
            }
            Ok((subscription_id, provider_id, tokens))
        }
        Err(err) => {
            let mut guard = manager.sessions.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(s) = guard.get_mut(session_id) {
                s.error = err.clone();
                s.status = "error".to_string();
            }
            Err(err)
        }
    }
}

async fn send_usage_request(
    client: &reqwest::Client,
    provider_id: &str,
    tokens: &StoredOAuthTokens,
    url: &str,
    method: reqwest::Method,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value, (u16, String)> {
    let mut req = client
        .request(method, url)
        .bearer_auth(&tokens.access_token)
        .header("Accept", "application/json");
    match provider_id {
        "claude" => {
            req = req.header("anthropic-beta", "oauth-2025-04-20");
        }
        "openai" => {
            req = req
                .header("ChatGPT-Account-Id", &tokens.account_id)
                .header("OpenAI-Beta", "codex-1");
        }
        "grok" => {
            req = req
                .header("x-xai-token-auth", "xai-grok-cli")
                .header("x-grok-client-version", "0.2.120");
        }
        _ => {}
    }
    if let Some(b) = body {
        req = req.json(&b);
    }

    let resp = req
        .send()
        .await
        .map_err(|_| (0, "无法连接服务商额度接口，请检查网络".to_string()))?;
    let status = resp.status().as_u16();
    if status < 200 || status >= 300 {
        let msg = match status {
            401 => "登录凭据已失效（HTTP 401），请重新授权".to_string(),
            403 => "服务商拒绝了本次请求（HTTP 403）".to_string(),
            429 => "请求过于频繁（HTTP 429），请稍后重试".to_string(),
            _ => format!("额度请求失败（HTTP {}）", status),
        };
        return Err((status, msg));
    }
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|_| (status, "额度响应不是有效 JSON".to_string()))?;
    Ok(json)
}

async fn refresh_oauth_tokens(
    client: &reqwest::Client,
    provider_id: &str,
    p: &AiOAuthProvider,
    current: &StoredOAuthTokens,
) -> Result<StoredOAuthTokens, String> {
    let refresh_token = current
        .refresh_token
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "登录已过期，请重新授权".to_string())?;
    let new_tokens = exchange_token(
        client,
        p,
        vec![
            ("grant_type", "refresh_token".to_string()),
            ("client_id", p.client_id.to_string()),
            ("refresh_token", refresh_token.to_string()),
        ],
    )
    .await?;

    let (aid, email, plan) = extract_identity(provider_id, &new_tokens);
    if !aid.is_empty() && aid != current.account_id {
        return Err("服务商返回了其他账号的令牌，请重新授权当前账号".to_string());
    }
    let expires_in = new_tokens
        .get("expires_in")
        .and_then(|v| v.as_i64())
        .unwrap_or(3600)
        .max(60);

    Ok(StoredOAuthTokens {
        access_token: new_tokens["access_token"].as_str().unwrap_or("").to_string(),
        refresh_token: new_tokens
            .get("refresh_token")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| current.refresh_token.clone()),
        id_token: new_tokens
            .get("id_token")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| current.id_token.clone()),
        token_expires_at: (Utc::now() + chrono::Duration::seconds(expires_in)).to_rfc3339(),
        account_id: current.account_id.clone(),
        email: email.or_else(|| current.email.clone()),
        plan: plan.or_else(|| current.plan.clone()),
    })
}

/// 刷新并返回新令牌（如有轮换）与归一化额度；调用方负责在请求前/后短锁持久化
pub async fn fetch_provider_usage(
    provider_id: &str,
    tokens: StoredOAuthTokens,
    gemini_override: Option<&GeminiOAuthOverride>,
) -> (StoredOAuthTokens, Result<NormalizedUsage, String>) {
    let p = match get_provider_with_override(provider_id, gemini_override) {
        Ok(p) => p,
        Err(e) => return (tokens, Err(e)),
    };
    let client = match reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
    {
        Ok(c) => c,
        Err(e) => return (tokens, Err(e.to_string())),
    };

    let mut current = tokens;
    let needs_refresh = DateTime::parse_from_rfc3339(&current.token_expires_at)
        .map(|dt| dt.with_timezone(&Utc) < Utc::now() + chrono::Duration::seconds(60))
        .unwrap_or(true);

    if needs_refresh && current.refresh_token.is_some() {
        match refresh_oauth_tokens(&client, provider_id, &p, &current).await {
            Ok(updated) => current = updated,
            Err(e) => return (current, Err(e)),
        }
    }

    let checked_at = Utc::now().to_rfc3339();
    let res = if provider_id == "gemini" {
        let profile_url = p.profile_url.unwrap_or("");
        let profile_body = serde_json::json!({
            "metadata": {
                "ideType": "IDE_UNSPECIFIED",
                "platform": "PLATFORM_UNSPECIFIED",
                "pluginType": "GEMINI"
            }
        });
        let prof_res = match send_usage_request(
            &client,
            provider_id,
            &current,
            profile_url,
            reqwest::Method::POST,
            Some(profile_body.clone()),
        )
        .await
        {
            Ok(v) => Ok(v),
            Err((401, _)) if current.refresh_token.is_some() => {
                match refresh_oauth_tokens(&client, provider_id, &p, &current).await {
                    Ok(updated) => {
                        current = updated;
                        send_usage_request(
                            &client,
                            provider_id,
                            &current,
                            profile_url,
                            reqwest::Method::POST,
                            Some(profile_body),
                        )
                        .await
                        .map_err(|(_, m)| m)
                    }
                    Err(e) => Err(e),
                }
            }
            Err((_, m)) => Err(m),
        };
        match prof_res {
            Err(e) => Err(e),
            Ok(profile) => {
                let tier = profile.get("paidTier").or_else(|| profile.get("currentTier"));
                if let Some(pname) = tier
                    .and_then(|t| t.get("name").or_else(|| t.get("id")))
                    .and_then(|v| v.as_str())
                {
                    if !pname.is_empty() {
                        current.plan = Some(pname.to_string());
                    }
                }
                let proj = profile
                    .get("cloudaicompanionProject")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty());
                match proj {
                    None => {
                        let unsupported = profile
                            .get("ineligibleTiers")
                            .and_then(|v| v.as_array())
                            .map(|arr| {
                                arr.iter().any(|t| {
                                    t.get("reasonCode").and_then(|r| r.as_str())
                                        == Some("UNSUPPORTED_CLIENT")
                                })
                            })
                            .unwrap_or(false);
                        if unsupported {
                            Err("Google 不再通过此授权提供个人账号的 Gemini Code Assist 额度，可使用 Antigravity CLI 查看额度。".to_string())
                        } else {
                            Err("Google 未返回 Gemini Code Assist 项目，请确认当前账号有可用席位。".to_string())
                        }
                    }
                    Some(project_id) => {
                        let usage_res = send_usage_request(
                            &client,
                            provider_id,
                            &current,
                            p.usage_url,
                            reqwest::Method::POST,
                            Some(serde_json::json!({ "project": project_id })),
                        )
                        .await;
                        match usage_res {
                            Ok(mut val) => {
                                if let Some(ac) = tier.and_then(|t| t.get("availableCredits")) {
                                    if let Some(obj) = val.as_object_mut() {
                                        obj.insert("availableCredits".to_string(), ac.clone());
                                    }
                                }
                                Ok(normalize_usage(provider_id, &val, &checked_at))
                            }
                            Err((_, m)) => Err(m),
                        }
                    }
                }
            }
        }
    } else if provider_id == "grok" && p.monthly_usage_url.is_some() {
        let mut all_windows: Vec<QuotaWindow> = Vec::new();
        let mut errors: Vec<String> = Vec::new();
        for url in [p.usage_url, p.monthly_usage_url.unwrap()] {
            let r = match send_usage_request(
                &client,
                provider_id,
                &current,
                url,
                reqwest::Method::GET,
                None,
            )
            .await
            {
                Ok(v) => Ok(v),
                Err((401, _)) if current.refresh_token.is_some() => {
                    match refresh_oauth_tokens(&client, provider_id, &p, &current).await {
                        Ok(updated) => {
                            current = updated;
                            send_usage_request(
                                &client,
                                provider_id,
                                &current,
                                url,
                                reqwest::Method::GET,
                                None,
                            )
                            .await
                            .map_err(|(_, m)| m)
                        }
                        Err(e) => Err(e),
                    }
                }
                Err((_, m)) => Err(m),
            };
            match r {
                Ok(val) => {
                    let norm = normalize_usage("grok", &val, &checked_at);
                    all_windows.extend(norm.windows);
                }
                Err(e) => errors.push(e),
            }
        }
        if all_windows.is_empty() && !errors.is_empty() {
            Err(errors.remove(0))
        } else {
            let mut norm = normalize_usage("grok", &serde_json::json!({}), &checked_at);
            norm.windows = all_windows.into_iter().take(64).collect();
            norm.status = if norm.windows.is_empty() {
                "unavailable".to_string()
            } else {
                "available".to_string()
            };
            norm.unavailable_reason = None;
            Ok(norm)
        }
    } else {
        let r = match send_usage_request(
            &client,
            provider_id,
            &current,
            p.usage_url,
            reqwest::Method::GET,
            None,
        )
        .await
        {
            Ok(v) => Ok(v),
            Err((401, _)) if current.refresh_token.is_some() => {
                match refresh_oauth_tokens(&client, provider_id, &p, &current).await {
                    Ok(updated) => {
                        current = updated;
                        send_usage_request(
                            &client,
                            provider_id,
                            &current,
                            p.usage_url,
                            reqwest::Method::GET,
                            None,
                        )
                        .await
                        .map_err(|(_, m)| m)
                    }
                    Err(e) => Err(e),
                }
            }
            Err((_, m)) => Err(m),
        };
        r.map(|val| {
            let norm = normalize_usage(provider_id, &val, &checked_at);
            if let Some(ref p) = norm.plan {
                current.plan = Some(p.clone());
            }
            norm
        })
    };

    (current, res)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_usage_all_4_providers() {
        let checked = "2026-11-24T10:00:00Z";

        let openai = normalize_usage(
            "openai",
            &serde_json::json!({
                "plan_type": "plus",
                "rate_limit": {
                    "primary_window": { "used_percent": 25.0, "reset_after_seconds": 3600, "limit_window_seconds": 18000 }
                },
                "credits": { "balance": "12.5", "unlimited": false }
            }),
            checked,
        );
        assert_eq!(openai.status, "available");
        assert_eq!(openai.plan.as_deref(), Some("plus"));
        assert_eq!(openai.windows.len(), 2);
        assert_eq!(openai.windows[0].used_percent, Some(25.0));

        let claude = normalize_usage(
            "claude",
            &serde_json::json!({
                "five_hour": { "utilization": 42.5, "resets_at": "2026-11-24T15:00:00Z" },
                "seven_day": { "utilization": 10.0, "resets_at": "2026-12-01T00:00:00Z" }
            }),
            checked,
        );
        assert_eq!(claude.windows.len(), 2);
        assert_eq!(claude.windows[0].window_seconds, Some(18000));

        let grok = normalize_usage(
            "grok",
            &serde_json::json!({
                "config": {
                    "creditUsagePercent": 30.0,
                    "used": 500,
                    "monthlyLimit": 2000,
                    "prepaidBalance": 8.0
                }
            }),
            checked,
        );
        assert_eq!(grok.windows.len(), 3);
        assert_eq!(grok.windows[1].used, Some(5.0));
        assert_eq!(grok.windows[1].limit, Some(20.0));

        let gemini = normalize_usage(
            "gemini",
            &serde_json::json!({
                "buckets": [
                    { "modelId": "gemini-2.5-pro", "tokenType": "REQUESTS", "remainingFraction": 0.85, "resetTime": "2026-11-25T00:00:00Z" }
                ]
            }),
            checked,
        );
        assert_eq!(gemini.windows.len(), 1);
        assert_eq!(gemini.windows[0].used_percent, Some(15.0));
    }

    #[test]
    fn test_parse_antigravity_quota() {
        let out = "Claude\tFive Hour Limit Remaining\t80%\t2026-11-24T15:00:00Z\nGemini Pro\tWeekly Limit Remaining\t95.5%\t2026-11-30T00:00:00Z\nBad\tOther\t50%\t";
        let windows = parse_antigravity_quota(out);
        assert_eq!(windows.len(), 2);
        assert_eq!(windows[0].used_percent, Some(20.0));
        assert_eq!(windows[1].used_percent, Some(4.5));
    }

    #[test]
    fn test_parse_oauth_callback_input() {
        let (c, s) = parse_oauth_callback_input(
            "http://localhost:1455/auth/callback?code=abc123&state=st1",
            "http://localhost:1455/auth/callback",
            "st1",
        )
        .unwrap();
        assert_eq!(c, "abc123");
        assert_eq!(s, "st1");

        let (c2, s2) = parse_oauth_callback_input("xyz#st2", "https://claude/cb", "st2").unwrap();
        assert_eq!(c2, "xyz");
        assert_eq!(s2, "st2");

        assert!(parse_oauth_callback_input(
            "http://evil.com/auth/callback?code=a&state=st1",
            "http://localhost:1455/auth/callback",
            "st1"
        )
        .is_err());

        // 支持解析 Google Cloud Desktop OAuth JSON 与本地配置覆盖
        let (gid, gsec) = parse_gemini_oauth_json(
            r#"{"installed":{"client_id":"demo-client-id.apps.googleusercontent.com","client_secret":"demo-secret"}}"#,
        )
        .unwrap();
        assert_eq!(gid, "demo-client-id.apps.googleusercontent.com");
        assert_eq!(gsec.as_deref(), Some("demo-secret"));

        let ov = GeminiOAuthOverride {
            client_id: gid,
            client_secret: gsec,
        };
        let gp = get_provider_with_override("gemini", Some(&ov)).unwrap();
        assert_eq!(gp.client_id, "demo-client-id.apps.googleusercontent.com");
        assert_eq!(gp.client_secret.as_deref(), Some("demo-secret"));

        let tmp = tempfile::tempdir().unwrap();
        let conn = crate::database::init_database_at_for_test(
            &tmp.path().join("data.db"),
            &tmp.path().join("backups"),
        )
        .unwrap();
        let saved = save_gemini_oauth_config(
            &conn,
            &GeminiOAuthConfigInput {
                client_id: Some("1234567890-abcdef.apps.googleusercontent.com".to_string()),
                client_secret: Some("test-local-sec".to_string()),
                raw_json: None,
                clear: None,
            },
        )
        .unwrap();
        assert!(saved.configured);
        assert_eq!(saved.source, "本地设置");
        assert!(saved.has_client_secret);

        let cleared = save_gemini_oauth_config(
            &conn,
            &GeminiOAuthConfigInput {
                client_id: None,
                client_secret: None,
                raw_json: None,
                clear: Some(true),
            },
        )
        .unwrap();
        assert!(load_gemini_oauth_override(&conn).is_none());
        let _ = cleared;
    }
}
