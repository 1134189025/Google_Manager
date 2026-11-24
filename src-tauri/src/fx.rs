//! 实时汇率获取与本地缓存模块（仅用于 USD -> CNY 费用统一人民币结算）。
//!
//! 严格遵循出站请求原则：无常驻服务，不持有数据库锁等待网络。
//! 优先查询 open.er-api.com，失败回退 api.frankfurter.app，离线回退本地缓存或默认参考汇率。

use crate::database;
use chrono::{DateTime, Duration, Utc};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::time::Duration as StdDuration;

pub const DEFAULT_USD_CNY_RATE: f64 = 7.25;
const MIN_VALID_RATE: f64 = 4.0;
const MAX_VALID_RATE: f64 = 15.0;
const CACHE_TTL_HOURS: i64 = 6;

const SETTING_FX_RATE: &str = "fx.usd_cny_rate";
const SETTING_FX_UPDATED_AT: &str = "fx.usd_cny_updated_at";
const SETTING_FX_SOURCE: &str = "fx.usd_cny_source";

const PRIMARY_FX_URL: &str = "https://open.er-api.com/v6/latest/USD";
const FALLBACK_FX_URL: &str = "https://api.frankfurter.app/latest?from=USD&to=CNY";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExchangeRateInfo {
    pub rate: f64,
    pub updated_at: String,
    pub source: String,
    pub is_fallback: bool,
}

fn sanitize_rate(rate: f64) -> Option<f64> {
    if !rate.is_finite() || !(MIN_VALID_RATE..=MAX_VALID_RATE).contains(&rate) {
        return None;
    }
    Some((rate * 10_000.0).round() / 10_000.0)
}

pub fn parse_cny_rate_from_json(body: &str) -> Result<f64, String> {
    let value: serde_json::Value =
        serde_json::from_str(body).map_err(|e| format!("解析汇率 JSON 失败: {}", e))?;
    let raw = value
        .get("rates")
        .and_then(|r| r.get("CNY"))
        .and_then(|v| v.as_f64())
        .ok_or_else(|| "汇率响应缺少 rates.CNY 字段".to_string())?;
    sanitize_rate(raw).ok_or_else(|| format!("汇率数值超出合理范围: {}", raw))
}

pub fn read_cached_rate(conn: &Connection) -> Option<ExchangeRateInfo> {
    let raw_rate = database::get_setting(conn, SETTING_FX_RATE).ok()??;
    let parsed_rate = raw_rate.trim().parse::<f64>().ok().and_then(sanitize_rate)?;
    let updated_at = database::get_setting(conn, SETTING_FX_UPDATED_AT)
        .ok()
        .flatten()
        .unwrap_or_default();
    let source = database::get_setting(conn, SETTING_FX_SOURCE)
        .ok()
        .flatten()
        .unwrap_or_else(|| "本地缓存".to_string());
    Some(ExchangeRateInfo {
        rate: parsed_rate,
        updated_at,
        source,
        is_fallback: false,
    })
}

pub fn save_cached_rate(conn: &Connection, info: &ExchangeRateInfo) -> Result<(), String> {
    database::set_setting(conn, SETTING_FX_RATE, Some(&format!("{:.4}", info.rate)))?;
    database::set_setting(conn, SETTING_FX_UPDATED_AT, Some(&info.updated_at))?;
    database::set_setting(conn, SETTING_FX_SOURCE, Some(&info.source))?;
    Ok(())
}

pub fn is_cache_fresh(info: &ExchangeRateInfo, now: DateTime<Utc>) -> bool {
    let Ok(ts) = DateTime::parse_from_rfc3339(&info.updated_at) else {
        return false;
    };
    let age = now.signed_duration_since(ts.with_timezone(&Utc));
    age >= Duration::zero() && age < Duration::hours(CACHE_TTL_HOURS)
}

async fn fetch_from_url(client: &reqwest::Client, url: &str) -> Result<f64, String> {
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("请求汇率失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("汇率接口返回 HTTP {}", resp.status()));
    }
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取汇率响应失败: {}", e))?;
    parse_cny_rate_from_json(&text)
}

/// 发起出站 HTTPS 请求获取实时 USD -> CNY 汇率（主备双源自动切换）
pub async fn fetch_live_usd_cny_rate() -> Result<(f64, String), String> {
    let client = reqwest::Client::builder()
        .timeout(StdDuration::from_secs(6))
        .user_agent("GoogleManager/0.5")
        .build()
        .map_err(|e| format!("初始化 HTTP 客户端失败: {}", e))?;

    if let Ok(rate) = fetch_from_url(&client, PRIMARY_FX_URL).await {
        return Ok((rate, "open.er-api.com".to_string()));
    }

    match fetch_from_url(&client, FALLBACK_FX_URL).await {
        Ok(rate) => Ok((rate, "frankfurter.app".to_string())),
        Err(e) => Err(e),
    }
}

pub fn fallback_rate_info(cached: Option<ExchangeRateInfo>) -> ExchangeRateInfo {
    if let Some(prev) = cached {
        let source = if prev.source.contains("缓存") {
            prev.source
        } else {
            format!("{}（缓存）", prev.source)
        };
        return ExchangeRateInfo {
            rate: prev.rate,
            updated_at: prev.updated_at,
            source,
            is_fallback: true,
        };
    }
    ExchangeRateInfo {
        rate: DEFAULT_USD_CNY_RATE,
        updated_at: Utc::now().to_rfc3339(),
        source: "默认参考汇率".to_string(),
        is_fallback: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::init_database_at_for_test;

    #[test]
    fn test_parse_open_er_api_and_frankfurter_json() {
        let er_body = r#"{"result":"success","base_code":"USD","rates":{"CNY":7.23456,"EUR":0.92}}"#;
        assert_eq!(parse_cny_rate_from_json(er_body).unwrap(), 7.2346);

        let frankfurter_body = r#"{"amount":1.0,"base":"USD","date":"2026-11-24","rates":{"CNY":7.198}}"#;
        assert_eq!(parse_cny_rate_from_json(frankfurter_body).unwrap(), 7.198);
    }

    #[test]
    fn test_parse_rejects_out_of_range_rates() {
        assert!(parse_cny_rate_from_json(r#"{"rates":{"CNY":0.5}}"#).is_err());
        assert!(parse_cny_rate_from_json(r#"{"rates":{"CNY":99.0}}"#).is_err());
        assert!(parse_cny_rate_from_json(r#"{"rates":{"EUR":0.9}}"#).is_err());
    }

    #[test]
    fn test_cache_roundtrip_and_freshness() {
        let tmp = tempfile::tempdir().unwrap();
        let conn =
            init_database_at_for_test(&tmp.path().join("data.db"), &tmp.path().join("backups"))
                .unwrap();

        assert!(read_cached_rate(&conn).is_none());

        let now = Utc::now();
        let info = ExchangeRateInfo {
            rate: 7.2412,
            updated_at: now.to_rfc3339(),
            source: "open.er-api.com".to_string(),
            is_fallback: false,
        };
        save_cached_rate(&conn, &info).unwrap();

        let loaded = read_cached_rate(&conn).unwrap();
        assert_eq!(loaded.rate, 7.2412);
        assert_eq!(loaded.source, "open.er-api.com");
        assert!(is_cache_fresh(&loaded, now + Duration::hours(2)));
        assert!(!is_cache_fresh(&loaded, now + Duration::hours(7)));

        let fb = fallback_rate_info(Some(loaded));
        assert!(fb.is_fallback);
        assert!(fb.source.contains("缓存"));
    }
}
