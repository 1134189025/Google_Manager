use chrono::{DateTime, NaiveDate};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

const WHOIS_TIMEOUT: Duration = Duration::from_secs(8);
const DOH_TIMEOUT: Duration = Duration::from_secs(6);

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DomainProbeResult {
    pub domain: String,
    pub registrar: Option<String>,
    pub expires_at: Option<String>,
    pub created_at: Option<String>,
    pub nameservers: Vec<String>,
    pub statuses: Vec<String>,
    pub auto_renew: bool,
}

pub fn normalize_domain_name(input: &str) -> Result<String, String> {
    let cleaned = input
        .trim()
        .to_ascii_lowercase()
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap_or("")
        .trim_end_matches('.')
        .to_string();

    if cleaned.is_empty()
        || cleaned.len() > 253
        || !cleaned.contains('.')
        || cleaned.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err("域名格式不正确".to_string());
    }
    Ok(cleaned)
}

async fn whois_query(server: &str, query: &str) -> Result<String, String> {
    let addr = format!("{}:43", server);
    let mut stream = tokio::time::timeout(WHOIS_TIMEOUT, TcpStream::connect(&addr))
        .await
        .map_err(|_| format!("WHOIS 连接超时：{}", server))?
        .map_err(|e| format!("WHOIS 连接失败（{}）：{}", server, e))?;

    let payload = format!("{}\r\n", query);
    tokio::time::timeout(WHOIS_TIMEOUT, stream.write_all(payload.as_bytes()))
        .await
        .map_err(|_| format!("WHOIS 发送超时：{}", server))?
        .map_err(|e| format!("WHOIS 发送失败：{}", e))?;

    let mut buf = Vec::with_capacity(8192);
    let _ = tokio::time::timeout(WHOIS_TIMEOUT, async {
        let mut chunk = [0u8; 4096];
        loop {
            match stream.read(&mut chunk).await {
                Ok(0) => break,
                Ok(n) => {
                    if buf.len() + n > 512 * 1024 {
                        break;
                    }
                    buf.extend_from_slice(&chunk[..n]);
                }
                Err(_) => break,
            }
        }
    })
    .await;

    Ok(String::from_utf8_lossy(&buf).into_owned())
}

async fn query_doh_nameservers(domain: &str) -> Vec<String> {
    let client = match reqwest::Client::builder().timeout(DOH_TIMEOUT).build() {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let Ok(resp) = client
        .get("https://cloudflare-dns.com/dns-query")
        .query(&[("name", domain), ("type", "NS")])
        .header("Accept", "application/dns-json")
        .send()
        .await
    else {
        return Vec::new();
    };
    if !resp.status().is_success() {
        return Vec::new();
    }
    let Ok(json) = resp.json::<serde_json::Value>().await else {
        return Vec::new();
    };
    let mut out = BTreeSet::new();
    if let Some(answers) = json.get("Answer").and_then(|v| v.as_array()) {
        for ans in answers {
            if let Some(data) = ans.get("data").and_then(|v| v.as_str()) {
                let ns = data.trim().trim_end_matches('.').to_ascii_lowercase();
                if !ns.is_empty() && ns.contains('.') {
                    out.insert(ns);
                }
            }
        }
    }
    out.into_iter().collect()
}

pub fn parse_whois_text(domain: &str, text: &str) -> DomainProbeResult {
    let mut registrar: Option<String> = None;
    let mut expires_at: Option<String> = None;
    let mut created_at: Option<String> = None;
    let mut nameservers = BTreeSet::new();
    let mut statuses = BTreeSet::new();

    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('%') || line.starts_with('#') {
            continue;
        }
        let Some((k_raw, v_raw)) = line.split_once(':') else {
            continue;
        };
        let key = k_raw.trim().to_ascii_lowercase();
        let val = v_raw.trim();
        if val.is_empty() {
            continue;
        }

        if registrar.is_none()
            && matches!(
                key.as_str(),
                "registrar" | "sponsoring registrar" | "registrar name"
            )
        {
            registrar = Some(val.chars().take(120).collect());
        }

        if expires_at.is_none()
            && matches!(
                key.as_str(),
                "registry expiry date"
                    | "registrar registration expiration date"
                    | "expiration date"
                    | "expiry date"
                    | "expiration time"
                    | "paid-till"
                    | "renewal date"
            )
        {
            expires_at = parse_whois_date(val);
        }

        if created_at.is_none()
            && matches!(
                key.as_str(),
                "creation date" | "registered on" | "registration time" | "created"
            )
        {
            created_at = parse_whois_date(val);
        }

        if matches!(key.as_str(), "name server" | "nserver") {
            let ns = val
                .split_whitespace()
                .next()
                .unwrap_or("")
                .trim_end_matches('.')
                .to_ascii_lowercase();
            if !ns.is_empty() && ns.contains('.') {
                nameservers.insert(ns);
            }
        }

        if matches!(key.as_str(), "domain status" | "status") {
            if let Some(status) = val.split_whitespace().next() {
                if statuses.len() < 8 {
                    statuses.insert(status.chars().take(64).collect());
                }
            }
        }
    }

    let status_vec: Vec<String> = statuses.into_iter().collect();
    let auto_renew = status_vec
        .iter()
        .any(|s| s.to_ascii_lowercase().contains("autorenew"));

    DomainProbeResult {
        domain: domain.to_string(),
        registrar,
        expires_at,
        created_at,
        nameservers: nameservers.into_iter().collect(),
        statuses: status_vec,
        auto_renew,
    }
}

pub fn parse_whois_date(raw: &str) -> Option<String> {
    let token = raw.trim().split_whitespace().next().unwrap_or("").trim();
    if token.is_empty() {
        return None;
    }
    if let Ok(dt) = DateTime::parse_from_rfc3339(token) {
        return Some(dt.date_naive().format("%Y-%m-%d").to_string());
    }
    if let Ok(d) = NaiveDate::parse_from_str(token, "%Y-%m-%d") {
        return Some(d.format("%Y-%m-%d").to_string());
    }
    if token.len() >= 10 {
        if let Ok(d) = NaiveDate::parse_from_str(&token[..10], "%Y-%m-%d") {
            return Some(d.format("%Y-%m-%d").to_string());
        }
        if let Ok(d) = NaiveDate::parse_from_str(&token[..10], "%Y.%m.%d") {
            return Some(d.format("%Y-%m-%d").to_string());
        }
        if let Ok(d) = NaiveDate::parse_from_str(&token[..10], "%Y/%m/%d") {
            return Some(d.format("%Y-%m-%d").to_string());
        }
    }
    None
}

fn find_whois_referral(text: &str, key_prefix: &str) -> Option<String> {
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.len() > key_prefix.len()
            && trimmed[..key_prefix.len()].eq_ignore_ascii_case(key_prefix)
        {
            let rest = trimmed[key_prefix.len()..].trim();
            if let Some(host) = rest.split_whitespace().next() {
                if host.contains('.') && !host.contains('/') {
                    return Some(host.to_ascii_lowercase());
                }
            }
        }
    }
    None
}

pub async fn probe_domain(input: &str) -> Result<DomainProbeResult, String> {
    let domain = normalize_domain_name(input)?;
    let tld = domain
        .rsplit('.')
        .next()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "域名缺少顶级后缀".to_string())?;

    let mut combined_whois = String::new();
    if let Ok(iana_text) = whois_query("whois.iana.org", tld).await {
        if let Some(registry_server) = find_whois_referral(&iana_text, "whois:") {
            if let Ok(reg_text) = whois_query(&registry_server, &domain).await {
                combined_whois.push_str(&reg_text);
                if let Some(referral) = find_whois_referral(&reg_text, "Registrar WHOIS Server:") {
                    if referral != registry_server {
                        if let Ok(deeper) = whois_query(&referral, &domain).await {
                            if deeper.len() > reg_text.len() / 2 {
                                combined_whois.push('\n');
                                combined_whois.push_str(&deeper);
                            }
                        }
                    }
                }
            }
        }
    }

    let mut result = parse_whois_text(&domain, &combined_whois);
    let live_ns = query_doh_nameservers(&domain).await;
    if !live_ns.is_empty() {
        result.nameservers = live_ns;
    }

    if result.registrar.is_none() && result.expires_at.is_none() && result.nameservers.is_empty() {
        return Err(format!("未能探测到 {} 的 WHOIS 或 NS 记录", domain));
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_whois_text_and_dates() {
        let sample = "
Domain Name: EXAMPLE.COM
Registrar: Cloudflare, Inc.
Registrar WHOIS Server: whois.cloudflare.com
Creation Date: 2020-05-01T00:00:00Z
Registry Expiry Date: 2027-05-01T00:00:00Z
Name Server: ALICE.NS.CLOUDFLARE.COM
Name Server: bob.ns.cloudflare.com
Domain Status: clientTransferProhibited https://icann.org/epp#clientTransferProhibited
Domain Status: autoRenewPeriod
";
        let parsed = parse_whois_text("example.com", sample);
        assert_eq!(parsed.registrar.as_deref(), Some("Cloudflare, Inc."));
        assert_eq!(parsed.created_at.as_deref(), Some("2020-05-01"));
        assert_eq!(parsed.expires_at.as_deref(), Some("2027-05-01"));
        assert_eq!(
            parsed.nameservers,
            vec![
                "alice.ns.cloudflare.com".to_string(),
                "bob.ns.cloudflare.com".to_string()
            ]
        );
        assert!(parsed.auto_renew);
    }

    #[test]
    fn test_normalize_domain_name() {
        assert_eq!(
            normalize_domain_name("  HTTPS://Sub.Example.COM/path ").unwrap(),
            "sub.example.com"
        );
        assert!(normalize_domain_name("invalid").is_err());
    }
}
