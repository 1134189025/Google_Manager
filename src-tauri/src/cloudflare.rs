use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::net::{Ipv4Addr, Ipv6Addr};
use std::time::Duration;

const CF_API_BASE: &str = "https://api.cloudflare.com/client/v4";
const CF_TIMEOUT: Duration = Duration::from_secs(15);
const WRITABLE_TYPES: &[&str] = &["A", "AAAA", "CNAME", "TXT", "MX", "NS"];
const PROXY_TYPES: &[&str] = &["A", "AAAA", "CNAME"];

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CloudflareZone {
    pub zone_id: String,
    pub account_id: Option<String>,
    pub name: String,
    pub status: String,
    pub name_servers: Vec<String>,
    pub registrar: Option<String>,
    pub expires_at: Option<String>,
    pub auto_renew: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CloudflareDnsRecord {
    pub id: String,
    #[serde(rename = "type")]
    pub record_type: String,
    pub name: String,
    pub content: String,
    pub ttl: i64,
    pub proxied: Option<bool>,
    pub priority: Option<i64>,
    pub comment: Option<String>,
    pub modified_on: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DnsRecordInput {
    #[serde(rename = "type")]
    pub record_type: String,
    pub name: String,
    pub content: String,
    pub ttl: i64,
    #[serde(default)]
    pub proxied: Option<bool>,
    #[serde(default)]
    pub priority: Option<i64>,
    #[serde(default)]
    pub comment: Option<String>,
}

pub fn validate_cf_token(token: &str) -> Result<String, String> {
    let trimmed = token.trim();
    if trimmed.is_empty()
        || trimmed.len() > 4096
        || trimmed.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err("Cloudflare API Token 格式不正确".to_string());
    }
    Ok(trimmed.to_string())
}

pub fn validate_cf_id(id: &str, label: &str) -> Result<String, String> {
    let trimmed = id.trim();
    if trimmed.len() != 32 || !trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!("{}标识格式不正确", label));
    }
    Ok(trimmed.to_ascii_lowercase())
}

pub fn validate_dns_hostname(
    value: &str,
    wildcard: bool,
    underscore: bool,
) -> Result<String, String> {
    let trimmed = value.trim().to_ascii_lowercase();
    if trimmed.is_empty()
        || trimmed.len() > 1024
        || trimmed
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || matches!(c, '/' | ':' | '@' | '?' | '#' | '\\'))
    {
        return Err("DNS 域名格式不正确，请填写完整域名".to_string());
    }
    let trimmed = trimmed.trim_end_matches('.');
    let (has_star, host) = if wildcard && trimmed.starts_with("*.") {
        (true, &trimmed[2..])
    } else {
        (false, trimmed)
    };
    if host.is_empty()
        || host.len() + if has_star { 2 } else { 0 } > 253
        || !host.contains('.')
        || host.parse::<Ipv4Addr>().is_ok()
        || host.parse::<Ipv6Addr>().is_ok()
    {
        return Err("DNS 域名格式不正确，请填写完整域名".to_string());
    }
    for part in host.split('.') {
        if part.is_empty() || part.len() > 63 {
            return Err("DNS 域名格式不正确，请填写完整域名".to_string());
        }
        let valid_chars = part.chars().all(|c| {
            c.is_ascii_alphanumeric() || c == '-' || (underscore && c == '_')
        });
        let valid_edges = !part.starts_with('-') && !part.ends_with('-');
        if !valid_chars || !valid_edges {
            return Err("DNS 域名格式不正确，请填写完整域名".to_string());
        }
    }
    Ok(if has_star {
        format!("*.{}", host)
    } else {
        host.to_string()
    })
}

pub fn validate_dns_record_input(input: &DnsRecordInput) -> Result<serde_json::Value, String> {
    let rtype = input.record_type.trim().to_ascii_uppercase();
    if !WRITABLE_TYPES.contains(&rtype.as_str()) {
        return Err("暂不支持编辑此 DNS 类型，请在 Cloudflare 控制台编辑".to_string());
    }
    let name = validate_dns_hostname(&input.name, true, true)?;
    if input.content.is_empty()
        || input.content.len() > 2048
        || input
            .content
            .chars()
            .any(|c| (c as u32) < 32 && c != '\t' && c != '\n' || (c as u32) == 127)
    {
        return Err("DNS 记录内容格式不正确或过长".to_string());
    }

    let content = if rtype == "TXT" {
        input.content.clone()
    } else {
        input.content.trim().to_string()
    };

    match rtype.as_str() {
        "A" => {
            content
                .parse::<Ipv4Addr>()
                .map_err(|_| "A 记录需要有效的 IPv4 地址".to_string())?;
        }
        "AAAA" => {
            if content.contains('%') || content.parse::<Ipv6Addr>().is_err() {
                return Err("AAAA 记录需要有效的 IPv6 地址".to_string());
            }
        }
        "CNAME" | "MX" | "NS" => {
            let _ = validate_dns_hostname(&content, false, rtype == "CNAME")?;
        }
        _ => {}
    }

    if input.ttl != 1 && !(60..=86400).contains(&input.ttl) {
        return Err("TTL 请选择自动（1）或 60–86400 秒".to_string());
    }
    let proxied = input.proxied.unwrap_or(false);
    if proxied && !PROXY_TYPES.contains(&rtype.as_str()) {
        return Err("只有 A、AAAA、CNAME 记录支持 Cloudflare 代理".to_string());
    }
    if proxied && input.ttl != 1 {
        return Err("开启 Cloudflare 代理的记录需要使用自动 TTL (1)".to_string());
    }

    let mut body = serde_json::Map::new();
    body.insert("type".to_string(), serde_json::Value::String(rtype.clone()));
    body.insert("name".to_string(), serde_json::Value::String(name));
    body.insert(
        "content".to_string(),
        serde_json::Value::String(if matches!(rtype.as_str(), "CNAME" | "MX" | "NS") {
            content.trim().trim_end_matches('.').to_ascii_lowercase()
        } else {
            content
        }),
    );
    body.insert("ttl".to_string(), serde_json::Value::Number(input.ttl.into()));
    if PROXY_TYPES.contains(&rtype.as_str()) {
        if let Some(p) = input.proxied {
            body.insert("proxied".to_string(), serde_json::Value::Bool(p));
        }
    }
    if rtype == "MX" {
        let prio = input
            .priority
            .ok_or_else(|| "MX 记录必须填写 0–65535 的优先级".to_string())?;
        if !(0..=65535).contains(&prio) {
            return Err("MX 优先级须为 0–65535 的整数".to_string());
        }
        body.insert("priority".to_string(), serde_json::Value::Number(prio.into()));
    }
    if let Some(comment) = input.comment.as_deref() {
        if comment.chars().count() > 500 || comment.chars().any(|c| c.is_control()) {
            return Err("DNS 备注过长或包含非法字符".to_string());
        }
        if !comment.trim().is_empty() {
            body.insert(
                "comment".to_string(),
                serde_json::Value::String(comment.trim().to_string()),
            );
        }
    }

    Ok(serde_json::Value::Object(body))
}

fn build_cf_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(CF_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("初始化 Cloudflare HTTP 客户端失败: {}", e))
}

async fn cf_request(
    client: &reqwest::Client,
    token: &str,
    method: reqwest::Method,
    path: &str,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let url = format!("{}{}", CF_API_BASE, path);
    let mut req = client
        .request(method, &url)
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/json");
    if let Some(b) = body {
        req = req.json(&b);
    }
    let resp = req
        .send()
        .await
        .map_err(|_| "无法连接 Cloudflare，请检查网络后重试".to_string())?;

    let status = resp.status();
    if status.is_redirection() {
        return Err("Cloudflare 返回了重定向，已阻止请求".to_string());
    }
    if status.as_u16() == 401 {
        return Err("Cloudflare 认证失败，请检查 API Token".to_string());
    }
    if status.as_u16() == 403 {
        return Err("Cloudflare 权限不足，请检查 API Token 权限范围".to_string());
    }
    if status.as_u16() == 404 {
        return Err("Cloudflare 资源不存在或 Token 无权访问".to_string());
    }
    if !status.is_success() {
        return Err(format!("Cloudflare 请求失败 (HTTP {})", status.as_u16()));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|_| "Cloudflare 返回数据解析失败".to_string())?;
    if json.get("success").and_then(|v| v.as_bool()) != Some(true) {
        let msg = json
            .get("errors")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("Cloudflare 拒绝了本次请求");
        return Err(msg.to_string());
    }
    Ok(json)
}

async fn cf_list_all(
    client: &reqwest::Client,
    token: &str,
    path: &str,
) -> Result<Vec<serde_json::Value>, String> {
    let mut rows = Vec::new();
    let mut seen = HashSet::new();
    for page in 1..=50 {
        let sep = if path.contains('?') { '&' } else { '?' };
        let data = cf_request(
            client,
            token,
            reqwest::Method::GET,
            &format!("{}{}page={}&per_page=50", path, sep, page),
            None,
        )
        .await?;
        let arr = data
            .get("result")
            .and_then(|v| v.as_array())
            .ok_or_else(|| "Cloudflare 列表格式不正确".to_string())?;
        for item in arr {
            if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                if seen.insert(id.to_string()) {
                    rows.push(item.clone());
                }
            }
        }
        let total_pages = data
            .get("result_info")
            .and_then(|v| v.get("total_pages"))
            .and_then(|v| v.as_i64());
        if let Some(tp) = total_pages {
            if page >= tp {
                break;
            }
        } else if arr.len() < 50 {
            break;
        }
    }
    Ok(rows)
}

pub async fn list_cloudflare_zones(token: &str) -> Result<(Vec<CloudflareZone>, Option<String>), String> {
    let token = validate_cf_token(token)?;
    let client = build_cf_client()?;

    let zone_rows = cf_list_all(&client, &token, "/zones").await?;
    let mut zones = Vec::new();
    let mut account_ids = HashSet::new();

    for row in &zone_rows {
        let Some(zone_id) = row.get("id").and_then(|v| v.as_str()) else {
            continue;
        };
        let Some(name) = row.get("name").and_then(|v| v.as_str()) else {
            continue;
        };
        let account_id = row
            .get("account")
            .and_then(|a| a.get("id"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        if let Some(ref aid) = account_id {
            account_ids.insert(aid.clone());
        }
        let name_servers = row
            .get("name_servers")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_ascii_lowercase()))
                    .collect()
            })
            .unwrap_or_default();
        zones.push(CloudflareZone {
            zone_id: zone_id.to_string(),
            account_id,
            name: name.to_ascii_lowercase(),
            status: row
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string(),
            name_servers,
            registrar: None,
            expires_at: None,
            auto_renew: None,
        });
    }

    // 附加读取 Cloudflare Registrar 到期信息（无权限时静默跳过）
    let mut reg_map: HashMap<String, (Option<String>, Option<bool>)> = HashMap::new();
    for aid in &account_ids {
        if let Ok(reg_data) = cf_request(
            &client,
            &token,
            reqwest::Method::GET,
            &format!("/accounts/{}/registrar/domains?per_page=50", aid),
            None,
        )
        .await
        {
            if let Some(items) = reg_data.get("result").and_then(|v| v.as_array()) {
                for item in items {
                    if let Some(d) = item.get("domain_name").and_then(|v| v.as_str()) {
                        let exp = item
                            .get("expires_at")
                            .and_then(|v| v.as_str())
                            .and_then(crate::domain_probe::parse_whois_date);
                        let auto = item.get("auto_renew").and_then(|v| v.as_bool());
                        reg_map.insert(d.to_ascii_lowercase(), (exp, auto));
                    }
                }
            }
        }
    }

    for z in &mut zones {
        if let Some((exp, auto)) = reg_map.get(&z.name) {
            z.registrar = Some("Cloudflare".to_string());
            z.expires_at = exp.clone();
            z.auto_renew = *auto;
        }
    }

    let summary = Some(format!("{} 个域名 · {} 个账户", zones.len(), account_ids.len()));
    Ok((zones, summary))
}

fn parse_dns_record(row: &serde_json::Value) -> Option<CloudflareDnsRecord> {
    Some(CloudflareDnsRecord {
        id: row.get("id")?.as_str()?.to_string(),
        record_type: row.get("type")?.as_str()?.to_string(),
        name: row.get("name")?.as_str()?.to_string(),
        content: row.get("content")?.as_str()?.to_string(),
        ttl: row.get("ttl")?.as_i64()?,
        proxied: row.get("proxied").and_then(|v| v.as_bool()),
        priority: row.get("priority").and_then(|v| v.as_i64()),
        comment: row
            .get("comment")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        modified_on: row
            .get("modified_on")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    })
}

pub async fn list_dns_records(
    token: &str,
    zone_id: &str,
) -> Result<Vec<CloudflareDnsRecord>, String> {
    let token = validate_cf_token(token)?;
    let zone_id = validate_cf_id(zone_id, "域名")?;
    let client = build_cf_client()?;
    let rows = cf_list_all(&client, &token, &format!("/zones/{}/dns_records", zone_id)).await?;
    Ok(rows.iter().filter_map(parse_dns_record).collect())
}

pub async fn apply_dns_record(
    token: &str,
    zone_id: &str,
    action: &str,
    record_id: Option<&str>,
    record: Option<&DnsRecordInput>,
) -> Result<Option<CloudflareDnsRecord>, String> {
    let token = validate_cf_token(token)?;
    let zone_id = validate_cf_id(zone_id, "域名")?;
    let client = build_cf_client()?;
    let base = format!("/zones/{}/dns_records", zone_id);

    match action {
        "create" => {
            let input = record.ok_or_else(|| "缺少 DNS 记录内容".to_string())?;
            let body = validate_dns_record_input(input)?;
            let data = cf_request(&client, &token, reqwest::Method::POST, &base, Some(body)).await?;
            Ok(data.get("result").and_then(parse_dns_record))
        }
        "update" => {
            let rid = validate_cf_id(record_id.unwrap_or(""), "DNS 记录")?;
            let input = record.ok_or_else(|| "缺少 DNS 记录内容".to_string())?;
            let body = validate_dns_record_input(input)?;
            let data = cf_request(
                &client,
                &token,
                reqwest::Method::PATCH,
                &format!("{}/{}", base, rid),
                Some(body),
            )
            .await?;
            Ok(data.get("result").and_then(parse_dns_record))
        }
        "delete" => {
            let rid = validate_cf_id(record_id.unwrap_or(""), "DNS 记录")?;
            let _ = cf_request(
                &client,
                &token,
                reqwest::Method::DELETE,
                &format!("{}/{}", base, rid),
                None,
            )
            .await?;
            Ok(None)
        }
        _ => Err("不支持的 DNS 操作".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_dns_record_input_rules() {
        let valid_a = validate_dns_record_input(&DnsRecordInput {
            record_type: "A".to_string(),
            name: "www.example.com".to_string(),
            content: "1.2.3.4".to_string(),
            ttl: 1,
            proxied: Some(true),
            priority: None,
            comment: Some("web".to_string()),
        })
        .unwrap();
        assert_eq!(valid_a["type"], "A");
        assert_eq!(valid_a["proxied"], true);

        // 开启代理时 TTL 非 1 应拒绝
        assert!(validate_dns_record_input(&DnsRecordInput {
            record_type: "A".to_string(),
            name: "www.example.com".to_string(),
            content: "1.2.3.4".to_string(),
            ttl: 300,
            proxied: Some(true),
            priority: None,
            comment: None,
        })
        .is_err());

        // MX 必须有优先级
        assert!(validate_dns_record_input(&DnsRecordInput {
            record_type: "MX".to_string(),
            name: "example.com".to_string(),
            content: "mail.example.com".to_string(),
            ttl: 300,
            proxied: None,
            priority: None,
            comment: None,
        })
        .is_err());

        // 无效 IPv4
        assert!(validate_dns_record_input(&DnsRecordInput {
            record_type: "A".to_string(),
            name: "example.com".to_string(),
            content: "not-an-ip".to_string(),
            ttl: 1,
            proxied: None,
            priority: None,
            comment: None,
        })
        .is_err());
    }
}
