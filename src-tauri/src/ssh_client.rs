use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::client::{self, Handle};
use russh::keys::{decode_secret_key, HashAlg, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use russh::{ChannelMsg, Disconnect};
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;
use tokio::sync::{mpsc, Mutex as AsyncMutex};

use crate::assets_db::{ServerItem, ServerProbeUpdate};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const EXEC_TIMEOUT: Duration = Duration::from_secs(20);
const SFTP_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_EXEC_BYTES: usize = 512 * 1024;
const MAX_PORTS: usize = 200;
const MAX_CONTAINERS: usize = 100;
const MAX_CONTAINER_PORTS: usize = 40;
const MAX_SFTP_ENTRIES: usize = 10_000;

pub const PROBE_SCRIPT: &str = r#"
set +e
os=$( . /etc/os-release 2>/dev/null; printf '%s' "${PRETTY_NAME:-$(uname -s) $(uname -r)}" )
printf 'os=%s\n' "$os"
printf 'host=%s\n' "$(hostname 2>/dev/null)"
printf 'kernel=%s\n' "$(uname -r 2>/dev/null)"

if [ -r /proc/uptime ]; then
  printf 'uptime=%s\n' "$(cut -d' ' -f1 /proc/uptime | cut -d. -f1)"
fi

if [ -r /proc/stat ]; then
  read _cpu a b c d e f g _rest < /proc/stat
  t1=$((a+b+c+d+e+f+g)); i1=$d
  sleep 0.4
  read _cpu a b c d e f g _rest < /proc/stat
  t2=$((a+b+c+d+e+f+g)); i2=$d
  dt=$((t2-t1)); di=$((i2-i1))
  [ "$dt" -gt 0 ] && printf 'cpu=%s\n' "$(( (100*(dt-di)) / dt ))"
fi

if [ -r /proc/meminfo ]; then
  total=$(awk '/^MemTotal:/{print $2}' /proc/meminfo)
  avail=$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)
  [ -z "$avail" ] && avail=$(awk '/^MemFree:/{print $2}' /proc/meminfo)
  [ -n "$total" ] && [ "$total" -gt 0 ] && printf 'memory=%s\nmemTotalKb=%s\n' "$(( (100*(total-avail))/total ))" "$total"
fi

df -Pk / 2>/dev/null | awk 'NR==2 {gsub("%","",$5); printf "disk=%s\ndiskTotalKb=%s\n", $5, $2}'
printf 'loadavg=%s\n' "$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null)"
"#;

pub const SERVICES_SCRIPT: &str = r#"
set +e
echo '##ss'
if command -v ss >/dev/null 2>&1; then
  ss -H -tulnp 2>/dev/null || ss -H -tuln 2>/dev/null
elif command -v netstat >/dev/null 2>&1; then
  netstat -tulnp 2>/dev/null | tail -n +3 || netstat -tuln 2>/dev/null | tail -n +3
fi
echo '##docker'
if command -v docker >/dev/null 2>&1; then
  out=$(docker ps -a --no-trunc --format '{{json .}}' 2>&1)
  if [ $? -ne 0 ]; then
    echo '##dockererror'
    printf '%s\n' "$out" | head -c 300
  else
    printf '%s\n' "$out"
    ids=$(docker ps -aq --no-trunc 2>/dev/null)
    echo '##inspect'
    [ -n "$ids" ] && docker inspect --format '{{.Id}}|{{.RestartCount}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.State.ExitCode}}|{{.State.OOMKilled}}|{{.State.StartedAt}}' $ids 2>/dev/null
    echo '##stats'
    docker stats --no-stream --no-trunc --format '{{json .}}' 2>/dev/null
  fi
else
  echo '##nodocker'
fi
echo '##end'
"#;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ParsedProbeMetrics {
    pub os: Option<String>,
    pub hostname: Option<String>,
    pub kernel: Option<String>,
    pub cpu: Option<f64>,
    pub memory: Option<f64>,
    pub disk: Option<f64>,
    pub uptime_seconds: Option<u64>,
    pub uptime: Option<String>,
    pub mem_total_kb: Option<i64>,
    pub disk_total_kb: Option<i64>,
    pub loadavg: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ListeningPort {
    pub proto: String,
    pub port: u16,
    pub exposure: String,
    pub address: String,
    pub process: Option<String>,
    pub pid: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ContainerPort {
    pub container_port: u16,
    pub proto: String,
    pub host_port: Option<u16>,
    pub host_ip: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ContainerInfo {
    pub id: String,
    pub name: String,
    pub image: String,
    pub state: String,
    pub status: String,
    pub restart_count: Option<i64>,
    pub health: Option<String>,
    pub exit_code: Option<i64>,
    pub oom_killed: Option<bool>,
    pub started_at: Option<String>,
    pub cpu: Option<f64>,
    pub memory_pct: Option<f64>,
    pub memory_usage: Option<String>,
    pub ports: Vec<ContainerPort>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ServerServicesSnapshot {
    pub ports: Vec<ListeningPort>,
    pub docker_available: bool,
    pub docker_reason: Option<String>,
    pub containers: Vec<ContainerInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshSessionInfo {
    pub session_id: String,
    pub server_id: i64,
    pub server_name: String,
    pub host: String,
    pub port: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshOutputEvent {
    pub session_id: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshClosedEvent {
    pub session_id: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SftpEntry {
    pub name: String,
    pub size: u64,
    pub modified: Option<u64>,
    pub is_dir: bool,
    pub is_symlink: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SftpDirListing {
    pub path: String,
    pub entries: Vec<SftpEntry>,
    pub truncated: bool,
}

#[derive(Default)]
struct HostKeyState {
    expected: Option<String>,
    newly_pinned: Option<String>,
    mismatch_error: Option<String>,
}

struct TofuClientHandler {
    host_key_state: Arc<Mutex<HostKeyState>>,
}

impl client::Handler for TofuClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let actual = format_public_key_fingerprint(server_public_key);
        let mut guard = self
            .host_key_state
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        match guard.expected.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            None => {
                guard.newly_pinned = Some(actual);
                Ok(true)
            }
            Some(expected) if expected == actual => Ok(true),
            Some(expected) => {
                guard.mismatch_error = Some(format!("HOST_KEY_CHANGED:{}:{}", expected, actual));
                Ok(false)
            }
        }
    }
}

pub fn format_public_key_fingerprint(key: &PublicKeyOrCertificate) -> String {
    key.public_key().fingerprint(HashAlg::Sha256).to_string()
}

#[allow(dead_code)]
pub fn format_ssh_pubkey_str_fingerprint(pubkey_line: &str) -> Result<String, String> {
    let key = russh::keys::PublicKey::from_openssh(pubkey_line.trim())
        .map_err(|e| format!("解析公钥失败: {}", e))?;
    Ok(key.fingerprint(HashAlg::Sha256).to_string())
}

fn friendly_ssh_error(err: &str) -> String {
    let lower = err.to_lowercase();
    if err.starts_with("HOST_KEY_CHANGED:") {
        return err.to_string();
    }
    if lower.contains("authentication") || lower.contains("auth") {
        return "认证失败：用户名、密码或私钥不正确".to_string();
    }
    if lower.contains("connection refused") || lower.contains("10061") {
        return "连接被拒绝：目标端口没有 SSH 服务".to_string();
    }
    if lower.contains("timed out") || lower.contains("timeout") {
        return "连接超时：主机不可达或被防火墙拦截".to_string();
    }
    if lower.contains("dns") || lower.contains("no such host") || lower.contains("failed to lookup") {
        return "无法解析主机名".to_string();
    }
    if lower.contains("reset") || lower.contains("eof") || lower.contains("disconnected") {
        return "连接被对端关闭或重置".to_string();
    }
    err.to_string()
}

async fn connect_and_authenticate(
    server: &ServerItem,
) -> Result<(Handle<TofuClientHandler>, Option<String>), String> {
    let host_key_state = Arc::new(Mutex::new(HostKeyState {
        expected: server.host_fingerprint.clone(),
        newly_pinned: None,
        mismatch_error: None,
    }));

    let config = client::Config {
        keepalive_interval: Some(Duration::from_secs(20)),
        keepalive_max: 3,
        inactivity_timeout: Some(Duration::from_secs(60 * 60)),
        nodelay: true,
        ..Default::default()
    };

    let handler = TofuClientHandler {
        host_key_state: Arc::clone(&host_key_state),
    };
    let port: u16 = server
        .port
        .try_into()
        .map_err(|_| "无效的 SSH 端口".to_string())?;
    let addr = (server.host.as_str(), port);

    let connect_res = tokio::time::timeout(
        CONNECT_TIMEOUT,
        client::connect(Arc::new(config), addr, handler),
    )
    .await;

    let mut session = match connect_res {
        Ok(Ok(handle)) => handle,
        Ok(Err(err)) => {
            if let Some(mismatch) = host_key_state
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .mismatch_error
                .take()
            {
                return Err(mismatch);
            }
            return Err(friendly_ssh_error(&err.to_string()));
        }
        Err(_) => {
            return Err("连接超时：主机不可达或被防火墙拦截".to_string());
        }
    };

    let cred = server
        .credential
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "服务器尚未填写登录密码或私钥".to_string())?;

    let authed = if server.auth_kind == "key" {
        let passphrase = server.passphrase.as_deref().filter(|s| !s.is_empty());
        let key = decode_secret_key(cred, passphrase)
            .map_err(|_| "私钥格式无法解析或口令不正确".to_string())?;
        let rsa_hash = if key.algorithm().is_rsa() {
            session
                .best_supported_rsa_hash()
                .await
                .ok()
                .flatten()
                .flatten()
        } else {
            None
        };
        let key_with_alg = PrivateKeyWithHashAlg::new(Arc::new(key), rsa_hash);
        session
            .authenticate_publickey(&server.username, key_with_alg)
            .await
            .map_err(|e| friendly_ssh_error(&e.to_string()))?
            .success()
    } else {
        session
            .authenticate_password(&server.username, cred)
            .await
            .map_err(|e| friendly_ssh_error(&e.to_string()))?
            .success()
    };

    if !authed {
        let _ = session
            .disconnect(Disconnect::ByApplication, "", "en")
            .await;
        return Err("认证失败：用户名、密码或私钥不正确".to_string());
    }

    let pinned = host_key_state
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .newly_pinned
        .take();
    Ok((session, pinned))
}

async fn exec_remote_script(
    session: &Handle<TofuClientHandler>,
    script: &str,
) -> Result<String, String> {
    let mut channel = session
        .channel_open_session()
        .await
        .map_err(|e| format!("打开 SSH 通道失败: {}", e))?;
    channel
        .exec(true, script)
        .await
        .map_err(|e| format!("执行远程脚本失败: {}", e))?;

    let mut out = Vec::with_capacity(4096);
    let read_fut = async {
        while let Some(msg) = channel.wait().await {
            match msg {
                ChannelMsg::Data { ref data } => {
                    if out.len() < MAX_EXEC_BYTES {
                        let remain = MAX_EXEC_BYTES - out.len();
                        let take = remain.min(data.len());
                        out.extend_from_slice(&data[..take]);
                    }
                }
                ChannelMsg::Eof | ChannelMsg::Close => break,
                _ => {}
            }
        }
    };

    if tokio::time::timeout(EXEC_TIMEOUT, read_fut).await.is_err() {
        let _ = channel.close().await;
        return Err("远程命令执行超时".to_string());
    }
    Ok(String::from_utf8_lossy(&out).into_owned())
}

// ─── 输出清理与解析器 ─────────────────────────────────────────────

fn clean_str(value: &str, max: usize) -> String {
    value
        .chars()
        .filter(|&c| {
            let code = c as u32;
            code >= 32 && code != 127
        })
        .take(max)
        .collect()
}

pub fn format_uptime_seconds(secs: u64) -> String {
    let days = secs / 86_400;
    let hours = (secs % 86_400) / 3_600;
    let mins = (secs % 3_600) / 60;
    if days > 0 {
        format!("{} 天 {} 小时", days, hours)
    } else if hours > 0 {
        format!("{} 小时 {} 分", hours, mins)
    } else {
        format!("{} 分钟", mins.max(1))
    }
}

pub fn parse_probe_output(raw: &str) -> ParsedProbeMetrics {
    let mut kv: HashMap<&str, &str> = HashMap::new();
    for line in raw.lines() {
        if let Some((k, v)) = line.split_once('=') {
            kv.insert(k.trim(), v.trim());
        }
    }
    let parse_pct = |k: &str| -> Option<f64> {
        kv.get(k)
            .and_then(|v| v.parse::<f64>().ok())
            .filter(|v| v.is_finite())
            .map(|v| v.round().clamp(0.0, 100.0))
    };
    let parse_i64 = |k: &str| -> Option<i64> { kv.get(k).and_then(|v| v.parse::<i64>().ok()) };
    let parse_nonempty = |k: &str, max: usize| -> Option<String> {
        kv.get(k)
            .map(|v| clean_str(v.trim(), max))
            .filter(|s| !s.is_empty())
    };
    let uptime_seconds = kv.get("uptime").and_then(|v| v.parse::<u64>().ok());
    let uptime = uptime_seconds.map(format_uptime_seconds);
    ParsedProbeMetrics {
        os: parse_nonempty("os", 120),
        hostname: parse_nonempty("host", 120),
        kernel: parse_nonempty("kernel", 80),
        cpu: parse_pct("cpu"),
        memory: parse_pct("memory"),
        disk: parse_pct("disk"),
        uptime_seconds,
        uptime,
        mem_total_kb: parse_i64("memTotalKb"),
        disk_total_kb: parse_i64("diskTotalKb"),
        loadavg: parse_nonempty("loadavg", 64),
    }
}

pub fn address_exposure(address: &str) -> &'static str {
    let trimmed = address
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .split('%')
        .next()
        .unwrap_or("");
    if trimmed == "*" || trimmed == "0.0.0.0" || trimmed == "::" || trimmed.is_empty() {
        "public"
    } else if trimmed == "::1" || trimmed.starts_with("127.") {
        "local"
    } else {
        "private"
    }
}

fn exposure_rank(exposure: &str) -> u8 {
    match exposure {
        "public" => 2,
        "private" => 1,
        _ => 0,
    }
}

fn split_address_port(text: &str) -> Option<(String, u16)> {
    let idx = text.rfind(':')?;
    let port = text[idx + 1..].parse::<u16>().ok()?;
    if port == 0 {
        return None;
    }
    Some((text[..idx].to_string(), port))
}

fn extract_process_info(line: &str) -> (Option<String>, Option<u32>) {
    // ss 格式: users:(("nginx",pid=1234,fd=6))
    if let Some(pos) = line.find("((\"") {
        let rest = &line[pos + 3..];
        if let Some(end_name) = rest.find('"') {
            let name = clean_str(&rest[..end_name], 64);
            let after = &rest[end_name..];
            let pid = after
                .find("pid=")
                .and_then(|p| {
                    let digits: String = after[p + 4..]
                        .chars()
                        .take_while(|c| c.is_ascii_digit())
                        .collect();
                    digits.parse::<u32>().ok()
                });
            return (if name.is_empty() { None } else { Some(name) }, pid);
        }
    }
    // netstat 格式: ... 1234/nginx
    if let Some(last) = line.split_whitespace().last() {
        if let Some((pid_str, prog)) = last.split_once('/') {
            if let Ok(pid) = pid_str.parse::<u32>() {
                let name = clean_str(prog, 64);
                return (if name.is_empty() { None } else { Some(name) }, Some(pid));
            }
        }
    }
    (None, None)
}

pub fn parse_listening_ports(lines: &[&str]) -> Vec<ListeningPort> {
    let mut by_key: HashMap<(String, u16), ListeningPort> = HashMap::new();
    for raw in lines {
        let parts: Vec<&str> = raw.split_whitespace().collect();
        if parts.len() < 5 {
            continue;
        }
        let proto = if parts[0].starts_with("tcp") {
            "tcp"
        } else if parts[0].starts_with("udp") {
            "udp"
        } else {
            continue;
        };
        let is_netstat = parts
            .get(1)
            .map(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit()))
            .unwrap_or(false);
        let local_idx = if is_netstat { 3 } else { 4 };
        let Some((addr, port)) = parts.get(local_idx).and_then(|s| split_address_port(s)) else {
            continue;
        };
        let state = if is_netstat {
            parts.get(5).copied().unwrap_or("")
        } else {
            parts.get(1).copied().unwrap_or("")
        };
        if proto == "tcp" && !state.eq_ignore_ascii_case("LISTEN") {
            continue;
        }
        let exposure = address_exposure(&addr).to_string();
        let address = clean_str(&addr, 64);
        let (process, pid) = extract_process_info(raw);
        let key = (proto.to_string(), port);
        match by_key.get_mut(&key) {
            None => {
                by_key.insert(
                    key,
                    ListeningPort {
                        proto: proto.to_string(),
                        port,
                        exposure,
                        address,
                        process,
                        pid,
                    },
                );
            }
            Some(existing) => {
                if exposure_rank(&exposure) > exposure_rank(&existing.exposure) {
                    existing.exposure = exposure;
                    existing.address = address;
                }
                if existing.process.is_none() && process.is_some() {
                    existing.process = process;
                    existing.pid = pid;
                }
            }
        }
    }
    let mut out: Vec<ListeningPort> = by_key.into_values().collect();
    out.sort_by(|a, b| a.port.cmp(&b.port).then_with(|| a.proto.cmp(&b.proto)));
    out.truncate(MAX_PORTS);
    out
}

pub fn parse_container_ports(raw: &str) -> Vec<ContainerPort> {
    let mut seen: HashSet<(String, Option<u16>, u16)> = HashSet::new();
    let mut out = Vec::new();
    for piece in raw.split(',') {
        let trimmed = piece.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Some((port_part, proto_raw)) = trimmed.rsplit_once('/') else {
            continue;
        };
        let proto = proto_raw.trim().to_ascii_lowercase();
        if proto != "tcp" && proto != "udp" {
            continue;
        }
        let (host_ip, host_port, container_part) = if let Some((left, right)) = port_part.split_once("->") {
            let parsed = split_address_port(left.trim());
            let (hip, hp) = match parsed {
                Some((ip, p)) => (
                    Some(clean_str(ip.trim_matches(|c| c == '[' || c == ']'), 64)),
                    Some(p),
                ),
                None => (None, None),
            };
            (hip, hp, right.trim())
        } else {
            (None, None, port_part.trim())
        };
        let container_port_str = container_part.split('-').next().unwrap_or("");
        let Ok(container_port) = container_port_str.parse::<u16>() else {
            continue;
        };
        if container_port == 0 {
            continue;
        }
        let key = (proto.clone(), host_port, container_port);
        if !seen.insert(key) {
            continue;
        }
        out.push(ContainerPort {
            container_port,
            proto,
            host_port,
            host_ip,
        });
        if out.len() >= MAX_CONTAINER_PORTS {
            break;
        }
    }
    out
}

fn parse_percent_value(raw: Option<&serde_json::Value>) -> Option<f64> {
    let s = raw?.as_str()?;
    let val = s.trim().trim_end_matches('%').parse::<f64>().ok()?;
    if val.is_finite() {
        Some((val * 10.0).round() / 10.0)
    } else {
        None
    }
}

fn is_hex_id(id: &str) -> bool {
    (12..=64).contains(&id.len()) && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

struct ContainerInspectDetail {
    restart_count: Option<i64>,
    health: Option<String>,
    exit_code: Option<i64>,
    oom_killed: Option<bool>,
    started_at: Option<String>,
}

struct ContainerStatsUsage {
    cpu: Option<f64>,
    memory_pct: Option<f64>,
    memory_usage: Option<String>,
}

pub fn parse_containers(ps: &[&str], inspect: &[&str], stats: &[&str]) -> Vec<ContainerInfo> {
    let mut details: HashMap<String, ContainerInspectDetail> = HashMap::new();
    for line in inspect {
        let cols: Vec<&str> = line.trim().split('|').collect();
        if cols.is_empty() || !is_hex_id(cols[0]) {
            continue;
        }
        let health = cols
            .get(2)
            .copied()
            .filter(|h| matches!(*h, "healthy" | "unhealthy" | "starting"))
            .map(str::to_string);
        let started_at = cols
            .get(5)
            .copied()
            .filter(|s| s.len() >= 10 && s.as_bytes()[4] == b'-')
            .map(|s| clean_str(s, 40));
        details.insert(
            cols[0].to_string(),
            ContainerInspectDetail {
                restart_count: cols.get(1).and_then(|s| s.parse::<i64>().ok()),
                health,
                exit_code: cols.get(3).and_then(|s| s.parse::<i64>().ok()),
                oom_killed: if cols.get(4) == Some(&"true") {
                    Some(true)
                } else {
                    None
                },
                started_at,
            },
        );
    }

    let mut usage_map: HashMap<String, ContainerStatsUsage> = HashMap::new();
    for line in stats {
        let Ok(serde_json::Value::Object(obj)) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let mem_usage = obj
            .get("MemUsage")
            .and_then(|v| v.as_str())
            .and_then(|s| s.split('/').next())
            .map(|s| clean_str(s.trim(), 24))
            .filter(|s| !s.is_empty());
        let cpu = parse_percent_value(obj.get("CPUPerc"));
        let memory_pct = parse_percent_value(obj.get("MemPerc"));
        for k in ["ID", "Container", "Name"] {
            if let Some(val) = obj.get(k).and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
                usage_map.insert(
                    val.to_string(),
                    ContainerStatsUsage {
                        cpu,
                        memory_pct,
                        memory_usage: mem_usage.clone(),
                    },
                );
            }
        }
    }

    let mut containers = Vec::new();
    for line in ps {
        let Ok(serde_json::Value::Object(obj)) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let id = obj.get("ID").and_then(|v| v.as_str()).unwrap_or("");
        if !is_hex_id(id) {
            continue;
        }
        let short_id = id[..12].to_string();
        let raw_name = obj
            .get("Names")
            .and_then(|v| v.as_str())
            .and_then(|s| s.split(',').next())
            .unwrap_or("");
        let cleaned_name = clean_str(raw_name.trim(), 80);
        let name = if cleaned_name.is_empty() {
            short_id.clone()
        } else {
            cleaned_name
        };

        let detail = details
            .get(id)
            .or_else(|| details.iter().find(|(k, _)| k.starts_with(id)).map(|(_, v)| v));
        let live = usage_map
            .get(id)
            .or_else(|| usage_map.get(&short_id))
            .or_else(|| usage_map.get(&name));

        let image = obj
            .get("Image")
            .and_then(|v| v.as_str())
            .map(|s| clean_str(s, 120))
            .unwrap_or_default();
        let state = obj
            .get("State")
            .and_then(|v| v.as_str())
            .map(|s| clean_str(&s.to_ascii_lowercase(), 24))
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "unknown".to_string());
        let status = obj
            .get("Status")
            .and_then(|v| v.as_str())
            .map(|s| clean_str(s, 80))
            .unwrap_or_default();
        let ports_str = obj.get("Ports").and_then(|v| v.as_str()).unwrap_or("");

        containers.push(ContainerInfo {
            id: short_id,
            name,
            image,
            state,
            status,
            restart_count: detail.and_then(|d| d.restart_count),
            health: detail.and_then(|d| d.health.clone()),
            exit_code: detail.and_then(|d| d.exit_code),
            oom_killed: detail.and_then(|d| d.oom_killed),
            started_at: detail.and_then(|d| d.started_at.clone()),
            cpu: live.and_then(|u| u.cpu),
            memory_pct: live.and_then(|u| u.memory_pct),
            memory_usage: live.and_then(|u| u.memory_usage.clone()),
            ports: parse_container_ports(ports_str),
        });
        if containers.len() >= MAX_CONTAINERS {
            break;
        }
    }

    containers.sort_by(|a, b| a.name.cmp(&b.name));
    containers
}

pub fn parse_services_output(raw: &str) -> ServerServicesSnapshot {
    let mut sections: HashMap<String, Vec<&str>> = HashMap::new();
    let mut current: Option<String> = None;
    for line in raw.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("##") {
            if !rest.is_empty() && rest.chars().all(|c| c.is_ascii_lowercase()) {
                current = Some(rest.to_string());
                sections.entry(rest.to_string()).or_default();
                continue;
            }
        }
        if let Some(ref cur) = current {
            sections.entry(cur.clone()).or_default().push(line);
        }
    }

    let ss_lines = sections.get("ss").map(|v| v.as_slice()).unwrap_or(&[]);
    let ports = parse_listening_ports(ss_lines);

    if sections.contains_key("nodocker") {
        return ServerServicesSnapshot {
            ports,
            docker_available: false,
            docker_reason: Some("该主机未安装 Docker".to_string()),
            containers: Vec::new(),
        };
    }

    if let Some(err_lines) = sections.get("dockererror") {
        let msg = clean_str(&err_lines.join(" "), 200);
        let lower = msg.to_ascii_lowercase();
        let reason = if lower.contains("permission denied") {
            "当前登录用户没有权限访问 Docker（需加入 docker 组）".to_string()
        } else if lower.contains("cannot connect") || lower.contains("daemon running") {
            "Docker 服务未运行".to_string()
        } else if msg.is_empty() {
            "读取 Docker 状态失败".to_string()
        } else {
            msg
        };
        return ServerServicesSnapshot {
            ports,
            docker_available: false,
            docker_reason: Some(reason),
            containers: Vec::new(),
        };
    }

    let docker_ps: Vec<&str> = sections
        .get("docker")
        .map(|lines| {
            lines
                .iter()
                .copied()
                .filter(|l| l.trim_start().starts_with('{'))
                .collect()
        })
        .unwrap_or_default();
    let inspect_lines = sections.get("inspect").map(|v| v.as_slice()).unwrap_or(&[]);
    let stats_lines = sections.get("stats").map(|v| v.as_slice()).unwrap_or(&[]);

    if sections.contains_key("docker") {
        ServerServicesSnapshot {
            ports,
            docker_available: true,
            docker_reason: None,
            containers: parse_containers(&docker_ps, inspect_lines, stats_lines),
        }
    } else {
        ServerServicesSnapshot {
            ports,
            docker_available: false,
            docker_reason: Some("未返回 Docker 状态".to_string()),
            containers: Vec::new(),
        }
    }
}

pub async fn probe_server_remote(
    server: &ServerItem,
) -> Result<(ServerProbeUpdate, Option<String>), String> {
    let (session, newly_pinned) = connect_and_authenticate(server).await?;
    let probe_res = exec_remote_script(&session, PROBE_SCRIPT).await;
    let metrics = match probe_res {
        Ok(raw) => parse_probe_output(&raw),
        Err(err) => {
            let _ = session
                .disconnect(Disconnect::ByApplication, "", "en")
                .await;
            return Err(err);
        }
    };

    let services_json = match exec_remote_script(&session, SERVICES_SCRIPT).await {
        Ok(raw) => serde_json::to_string(&parse_services_output(&raw)).ok(),
        Err(_) => None,
    };

    let _ = session
        .disconnect(Disconnect::ByApplication, "", "en")
        .await;

    Ok((
        ServerProbeUpdate {
            status: "online".to_string(),
            os: metrics.os,
            kernel: metrics.kernel,
            cpu: metrics.cpu,
            memory: metrics.memory,
            disk: metrics.disk,
            mem_total_kb: metrics.mem_total_kb,
            disk_total_kb: metrics.disk_total_kb,
            loadavg: metrics.loadavg,
            uptime: metrics.uptime,
            services_json,
            probe_error: None,
        },
        newly_pinned,
    ))
}

// ─── 交互式多标签 PTY 会话管理 ────────────────────────────────────

enum PtyControl {
    Write(Vec<u8>),
    Resize { cols: u32, rows: u32 },
    Close,
}

struct ActiveSshSession {
    info: SshSessionInfo,
    tx: mpsc::UnboundedSender<PtyControl>,
}

pub struct SshSessionManager {
    sessions: Arc<AsyncMutex<HashMap<String, ActiveSshSession>>>,
}

impl Default for SshSessionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SshSessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(AsyncMutex::new(HashMap::new())),
        }
    }

    pub async fn open_session(
        &self,
        app: AppHandle,
        server: &ServerItem,
        cols: u32,
        rows: u32,
    ) -> Result<(SshSessionInfo, Option<String>), String> {
        let (handle, newly_pinned) = connect_and_authenticate(server).await?;
        let mut channel = handle
            .channel_open_session()
            .await
            .map_err(|e| format!("打开终端通道失败: {}", e))?;

        let cols = cols.clamp(20, 500);
        let rows = rows.clamp(5, 200);
        channel
            .request_pty(false, "xterm-256color", cols, rows, 0, 0, &[])
            .await
            .map_err(|e| format!("请求 PTY 失败: {}", e))?;
        channel
            .request_shell(false)
            .await
            .map_err(|e| format!("启动远程 Shell 失败: {}", e))?;

        let session_id = uuid::Uuid::new_v4().to_string();
        let info = SshSessionInfo {
            session_id: session_id.clone(),
            server_id: server.id,
            server_name: server.name.clone(),
            host: server.host.clone(),
            port: server.port,
        };

        let (tx, mut rx) = mpsc::unbounded_channel::<PtyControl>();
        self.sessions.lock().await.insert(
            session_id.clone(),
            ActiveSshSession {
                info: info.clone(),
                tx,
            },
        );

        let sessions_ref = Arc::clone(&self.sessions);
        let sid = session_id.clone();
        tauri::async_runtime::spawn(async move {
            let mut pending_utf8: Vec<u8> = Vec::with_capacity(4);
            let reason = loop {
                tokio::select! {
                    maybe_ctrl = rx.recv() => {
                        match maybe_ctrl {
                            Some(PtyControl::Write(bytes)) => {
                                if channel.data(&bytes[..]).await.is_err() {
                                    break "写入终端失败，连接已关闭".to_string();
                                }
                            }
                            Some(PtyControl::Resize { cols, rows }) => {
                                let _ = channel.window_change(cols.clamp(20, 500), rows.clamp(5, 200), 0, 0).await;
                            }
                            Some(PtyControl::Close) | None => {
                                let _ = channel.eof().await;
                                let _ = channel.close().await;
                                break "终端已断开".to_string();
                            }
                        }
                    }
                    maybe_msg = channel.wait() => {
                        match maybe_msg {
                            Some(ChannelMsg::Data { ref data }) | Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                                if let Some(text) = decode_utf8_chunk(&mut pending_utf8, data) {
                                    let _ = app.emit("ssh-output", SshOutputEvent {
                                        session_id: sid.clone(),
                                        data: text,
                                    });
                                }
                            }
                            Some(ChannelMsg::ExitStatus { exit_status }) => {
                                break format!("远端 Shell 已退出 (code={})", exit_status);
                            }
                            Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                                break "远程连接已结束".to_string();
                            }
                            _ => {}
                        }
                    }
                }
            };

            if !pending_utf8.is_empty() {
                let tail = String::from_utf8_lossy(&pending_utf8).into_owned();
                let _ = app.emit(
                    "ssh-output",
                    SshOutputEvent {
                        session_id: sid.clone(),
                        data: tail,
                    },
                );
            }

            sessions_ref.lock().await.remove(&sid);
            let _ = handle
                .disconnect(Disconnect::ByApplication, "", "en")
                .await;
            let _ = app.emit(
                "ssh-closed",
                SshClosedEvent {
                    session_id: sid,
                    reason,
                },
            );
        });

        Ok((info, newly_pinned))
    }

    pub async fn write_session(&self, session_id: &str, data: &str) -> Result<(), String> {
        let tx = {
            let guard = self.sessions.lock().await;
            guard
                .get(session_id)
                .map(|s| s.tx.clone())
                .ok_or_else(|| "SSH 会话不存在或已断开".to_string())?
        };
        tx.send(PtyControl::Write(data.as_bytes().to_vec()))
            .map_err(|_| "SSH 会话已关闭".to_string())
    }

    pub async fn resize_session(&self, session_id: &str, cols: u32, rows: u32) -> Result<(), String> {
        let tx = {
            let guard = self.sessions.lock().await;
            guard
                .get(session_id)
                .map(|s| s.tx.clone())
                .ok_or_else(|| "SSH 会话不存在或已断开".to_string())?
        };
        tx.send(PtyControl::Resize { cols, rows })
            .map_err(|_| "SSH 会话已关闭".to_string())
    }

    pub async fn close_session(&self, session_id: &str) -> Result<(), String> {
        let tx_opt = self
            .sessions
            .lock()
            .await
            .remove(session_id)
            .map(|s| s.tx);
        if let Some(tx) = tx_opt {
            let _ = tx.send(PtyControl::Close);
        }
        Ok(())
    }

    pub async fn list_sessions(&self) -> Vec<SshSessionInfo> {
        self.sessions
            .lock()
            .await
            .values()
            .map(|s| s.info.clone())
            .collect()
    }
}

fn decode_utf8_chunk(pending: &mut Vec<u8>, chunk: &[u8]) -> Option<String> {
    if chunk.is_empty() && pending.is_empty() {
        return None;
    }
    pending.extend_from_slice(chunk);
    let mut out = String::new();
    loop {
        match std::str::from_utf8(pending) {
            Ok(valid) => {
                out.push_str(valid);
                pending.clear();
                break;
            }
            Err(err) => {
                let valid_up_to = err.valid_up_to();
                if valid_up_to > 0 {
                    out.push_str(&String::from_utf8_lossy(&pending[..valid_up_to]));
                    pending.drain(..valid_up_to);
                    continue;
                }
                match err.error_len() {
                    Some(invalid_len) => {
                        out.push('\u{FFFD}');
                        pending.drain(..invalid_len);
                    }
                    None => {
                        // 末尾有不完整的 UTF-8 多字节序列，留到下一帧继续拼接
                        break;
                    }
                }
            }
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

// ─── SFTP 文件操作 ─────────────────────────────────────────────────

pub fn validate_remote_path(path: &str) -> Result<String, String> {
    if path.is_empty() || path.len() > 4096 {
        return Err("无效的远端路径".to_string());
    }
    if path.chars().any(|c| (c as u32) < 32 || (c as u32) == 127) {
        return Err("远端路径不能包含控制字符".to_string());
    }
    Ok(path.to_string())
}

async fn open_sftp(
    server: &ServerItem,
) -> Result<(Handle<TofuClientHandler>, SftpSession, Option<String>), String> {
    let (handle, pinned) = connect_and_authenticate(server).await?;
    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("打开 SFTP 通道失败: {}", e))?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| format!("请求 SFTP 子系统失败: {}", e))?;
    let sftp = SftpSession::new(channel.into_stream())
        .await
        .map_err(|e| format!("初始化 SFTP 会话失败: {}", e))?;
    Ok((handle, sftp, pinned))
}

pub async fn sftp_list_dir(
    server: &ServerItem,
    path: Option<String>,
) -> Result<(SftpDirListing, Option<String>), String> {
    let target = path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(".");
    let target = validate_remote_path(target)?;

    let (handle, sftp, pinned) = open_sftp(server).await?;
    let work = tokio::time::timeout(SFTP_TIMEOUT, async {
        let canonical = sftp
            .canonicalize(&target)
            .await
            .map_err(|e| format!("解析远端目录失败: {}", e))?;
        let dir = sftp
            .read_dir(&canonical)
            .await
            .map_err(|e| format!("读取远端目录失败: {}", e))?;
        let mut entries: Vec<SftpEntry> = Vec::new();
        for entry in dir {
            let name = entry.file_name();
            if name == "." || name == ".." {
                continue;
            }
            let meta = entry.metadata();
            entries.push(SftpEntry {
                name,
                size: meta.len(),
                modified: meta.mtime.map(|m| m as u64),
                is_dir: meta.is_dir(),
                is_symlink: meta.is_symlink(),
            });
        }
        entries.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then_with(|| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()))
        });
        let truncated = entries.len() > MAX_SFTP_ENTRIES;
        entries.truncate(MAX_SFTP_ENTRIES);
        Ok::<SftpDirListing, String>(SftpDirListing {
            path: canonical,
            entries,
            truncated,
        })
    })
    .await;

    let _ = sftp.close().await;
    let _ = handle
        .disconnect(Disconnect::ByApplication, "", "en")
        .await;

    match work {
        Ok(res) => res.map(|listing| (listing, pinned)),
        Err(_) => Err("SFTP 读取目录超时".to_string()),
    }
}

pub async fn sftp_download_file(
    server: &ServerItem,
    remote_path: &str,
    local_path: &str,
) -> Result<(u64, Option<String>), String> {
    let remote = validate_remote_path(remote_path)?;
    let dest = Path::new(local_path);
    if local_path.trim().is_empty() {
        return Err("本地保存路径不能为空".to_string());
    }
    let tmp_path = dest.with_file_name(format!(
        "{}.gm-tmp-{}",
        dest.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("download"),
        uuid::Uuid::new_v4()
    ));

    let (handle, sftp, pinned) = open_sftp(server).await?;
    let work = tokio::time::timeout(SFTP_TIMEOUT, async {
        let meta = sftp
            .metadata(&remote)
            .await
            .map_err(|e| format!("获取远端文件信息失败: {}", e))?;
        if meta.is_dir() {
            return Err("暂不支持直接下载文件夹，请选择普通文件".to_string());
        }
        let mut remote_file = sftp
            .open(&remote)
            .await
            .map_err(|e| format!("打开远端文件失败: {}", e))?;
        let mut local_file = tokio::fs::File::create(&tmp_path)
            .await
            .map_err(|e| format!("创建本地文件失败: {}", e))?;
        let bytes = tokio::io::copy(&mut remote_file, &mut local_file)
            .await
            .map_err(|e| format!("下载文件失败: {}", e))?;
        local_file
            .flush()
            .await
            .map_err(|e| format!("写入本地文件失败: {}", e))?;
        drop(local_file);
        tokio::fs::rename(&tmp_path, dest)
            .await
            .map_err(|e| format!("保存下载文件失败: {}", e))?;
        Ok::<u64, String>(bytes)
    })
    .await;

    let _ = sftp.close().await;
    let _ = handle
        .disconnect(Disconnect::ByApplication, "", "en")
        .await;

    match work {
        Ok(Ok(bytes)) => Ok((bytes, pinned)),
        Ok(Err(err)) => {
            let _ = std::fs::remove_file(&tmp_path);
            Err(err)
        }
        Err(_) => {
            let _ = std::fs::remove_file(&tmp_path);
            Err("SFTP 下载超时".to_string())
        }
    }
}

pub async fn sftp_upload_file(
    server: &ServerItem,
    local_path: &str,
    remote_path: &str,
) -> Result<(u64, Option<String>), String> {
    let remote = validate_remote_path(remote_path)?;
    if local_path.trim().is_empty() {
        return Err("本地文件路径不能为空".to_string());
    }

    let (handle, sftp, pinned) = open_sftp(server).await?;
    let work = tokio::time::timeout(SFTP_TIMEOUT, async {
        let mut local_file = tokio::fs::File::open(local_path)
            .await
            .map_err(|e| format!("打开本地文件失败: {}", e))?;
        let mut remote_file = sftp
            .open_with_flags(
                &remote,
                OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
            )
            .await
            .map_err(|e| format!("创建远端文件失败: {}", e))?;
        let bytes = tokio::io::copy(&mut local_file, &mut remote_file)
            .await
            .map_err(|e| format!("上传文件失败: {}", e))?;
        remote_file
            .shutdown()
            .await
            .map_err(|e| format!("完成远端文件写入失败: {}", e))?;
        Ok::<u64, String>(bytes)
    })
    .await;

    let _ = sftp.close().await;
    let _ = handle
        .disconnect(Disconnect::ByApplication, "", "en")
        .await;

    match work {
        Ok(res) => res.map(|bytes| (bytes, pinned)),
        Err(_) => Err("SFTP 上传超时".to_string()),
    }
}

pub async fn sftp_mkdir(server: &ServerItem, remote_path: &str) -> Result<Option<String>, String> {
    let remote = validate_remote_path(remote_path)?;
    let (handle, sftp, pinned) = open_sftp(server).await?;
    let res = tokio::time::timeout(SFTP_TIMEOUT, sftp.create_dir(&remote)).await;
    let _ = sftp.close().await;
    let _ = handle
        .disconnect(Disconnect::ByApplication, "", "en")
        .await;
    match res {
        Ok(Ok(())) => Ok(pinned),
        Ok(Err(e)) => Err(format!("创建远端目录失败: {}", e)),
        Err(_) => Err("SFTP 操作超时".to_string()),
    }
}

pub async fn sftp_remove(
    server: &ServerItem,
    remote_path: &str,
    is_dir: bool,
) -> Result<Option<String>, String> {
    let remote = validate_remote_path(remote_path)?;
    if remote.trim() == "/" {
        return Err("禁止删除根目录 /".to_string());
    }
    let (handle, sftp, pinned) = open_sftp(server).await?;
    let res = tokio::time::timeout(SFTP_TIMEOUT, async {
        if is_dir {
            sftp.remove_dir(&remote)
                .await
                .map_err(|e| format!("删除目录失败（非空目录需先清理内容）: {}", e))
        } else {
            sftp.remove_file(&remote)
                .await
                .map_err(|e| format!("删除文件失败: {}", e))
        }
    })
    .await;
    let _ = sftp.close().await;
    let _ = handle
        .disconnect(Disconnect::ByApplication, "", "en")
        .await;
    match res {
        Ok(Ok(())) => Ok(pinned),
        Ok(Err(e)) => Err(e),
        Err(_) => Err("SFTP 删除超时".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_probe_output() {
        let raw = "\
os=Ubuntu 24.04.1 LTS
host=edge-tokyo
kernel=6.8.0-45-generic
uptime=90061
cpu=18
memory=64
memTotalKb=4096000
disk=42
diskTotalKb=52428800
loadavg=0.25 0.19 0.12
";
        let parsed = parse_probe_output(raw);
        assert_eq!(parsed.os.as_deref(), Some("Ubuntu 24.04.1 LTS"));
        assert_eq!(parsed.hostname.as_deref(), Some("edge-tokyo"));
        assert_eq!(parsed.kernel.as_deref(), Some("6.8.0-45-generic"));
        assert_eq!(parsed.cpu, Some(18.0));
        assert_eq!(parsed.memory, Some(64.0));
        assert_eq!(parsed.disk, Some(42.0));
        assert_eq!(parsed.uptime_seconds, Some(90061));
        assert_eq!(parsed.uptime.as_deref(), Some("1 天 1 小时"));
        assert_eq!(parsed.mem_total_kb, Some(4096000));
        assert_eq!(parsed.disk_total_kb, Some(52428800));
        assert_eq!(parsed.loadavg.as_deref(), Some("0.25 0.19 0.12"));
    }

    #[test]
    fn test_parse_listening_ports_dedup_and_exposure() {
        let lines = [
            "tcp LISTEN 0 511 127.0.0.1:80 0.0.0.0:* users:((\"nginx\",pid=101,fd=7))",
            "tcp LISTEN 0 511 [::]:80 [::]:* users:((\"nginx\",pid=101,fd=8))",
            "tcp LISTEN 0 128 127.0.0.1:5432 0.0.0.0:* users:((\"postgres\",pid=222,fd=4))",
            "udp UNCONN 0 0 10.0.0.5:51820 0.0.0.0:*",
        ];
        let ports = parse_listening_ports(&lines);
        assert_eq!(ports.len(), 3);
        assert_eq!(ports[0].port, 80);
        assert_eq!(ports[0].exposure, "public");
        assert_eq!(ports[0].process.as_deref(), Some("nginx"));
        assert_eq!(ports[0].pid, Some(101));

        assert_eq!(ports[1].port, 5432);
        assert_eq!(ports[1].exposure, "local");

        assert_eq!(ports[2].port, 51820);
        assert_eq!(ports[2].proto, "udp");
        assert_eq!(ports[2].exposure, "private");
    }

    #[test]
    fn test_parse_container_ports_and_containers() {
        let cp = parse_container_ports("0.0.0.0:8080->80/tcp, [::]:8080->80/tcp, 443/tcp");
        assert_eq!(cp.len(), 2);
        assert_eq!(cp[0].host_port, Some(8080));
        assert_eq!(cp[0].container_port, 80);
        assert_eq!(cp[1].host_port, None);
        assert_eq!(cp[1].container_port, 443);

        let full_id = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let ps_line = format!(
            r#"{{"ID":"{}","Names":"web-proxy","Image":"caddy:2","State":"running","Status":"Up 3 days","Ports":"0.0.0.0:80->80/tcp"}}"#,
            full_id
        );
        let inspect_line = format!("{}|2|healthy|0|false|2026-11-20T01:02:03Z", full_id);
        let stats_line = format!(
            r#"{{"ID":"{}","CPUPerc":"1.5%","MemPerc":"12.3%","MemUsage":"120MiB / 1GiB"}}"#,
            &full_id[..12]
        );
        let list = parse_containers(&[&ps_line], &[&inspect_line], &[&stats_line]);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "web-proxy");
        assert_eq!(list[0].health.as_deref(), Some("healthy"));
        assert_eq!(list[0].restart_count, Some(2));
        assert_eq!(list[0].cpu, Some(1.5));
        assert_eq!(list[0].memory_usage.as_deref(), Some("120MiB"));
        assert_eq!(list[0].ports.len(), 1);
    }

    #[test]
    fn test_parse_services_output_nodocker_and_valid() {
        let raw = "##ss\ntcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:*\n##docker\n##nodocker\n##end\n";
        let snap = parse_services_output(raw);
        assert!(!snap.docker_available);
        assert!(snap.docker_reason.unwrap().contains("未安装 Docker"));
        assert_eq!(snap.ports.len(), 1);
        assert_eq!(snap.ports[0].port, 22);
    }

    #[test]
    fn test_validate_remote_path_and_utf8_chunk() {
        assert!(validate_remote_path("/root/app.log").is_ok());
        assert!(validate_remote_path("").is_err());
        assert!(validate_remote_path("/tmp/bad\npath").is_err());
        assert!(validate_remote_path(&"a".repeat(4097)).is_err());

        // “你” = E4 BD A0，分两帧到达不应乱码
        let mut buf = Vec::new();
        assert_eq!(decode_utf8_chunk(&mut buf, &[0xE4, 0xBD]), None);
        assert_eq!(decode_utf8_chunk(&mut buf, &[0xA0]), Some("你".to_string()));
        assert!(buf.is_empty());
    }

    #[test]
    fn test_format_ssh_pubkey_str_fingerprint() {
        let fp = format_ssh_pubkey_str_fingerprint(
            "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILagOJFgwaMNhBWQINinKOXmqS4Gh5NgxgriXwdOoINJ",
        )
        .unwrap();
        assert_eq!(fp, "SHA256:ldyiXa1JQakitNU5tErauu8DvWQ1dZ7aXu+rm7KQuog");
    }
}
