//! 手机接码地址（sms_url）短信验证码获取服务
//!
//! 真实接口契约（已实测确认）：
//!   GET https://sms6688.com/api/sms/recordText?token=<令牌>&tpl=1
//!   HTTP 200，Content-Type: text/plain; charset=UTF-8
//!   有短信：`YES|G-821371 is your Google verification code.`（格式：状态|短信内容）
//!   链接失效：`NO|已失效，请获取最新链接`
//! 因此解析一律以 `YES|` / `NO|` 前缀为第一判据，正文按纯文本处理，不解析 HTML。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tokio::sync::Semaphore;

/// 出站请求并发上限
const MAX_CONCURRENCY: usize = 3;
/// 同一 URL 的去重窗口：窗口内重复请求直接复用上次结果
const DEDUP_WINDOW: Duration = Duration::from_secs(2);
/// 同一 URL 的最小请求间隔：过于频繁时不再发起真实请求
const MIN_REQUEST_INTERVAL: Duration = Duration::from_secs(3);
/// 连接超时
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// 整体请求超时
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
/// 响应体读取上限：超出即截断
const MAX_BODY_BYTES: usize = 64 * 1024;
/// message 字段最大字符数
const MAX_MESSAGE_CHARS: usize = 200;
/// Retry-After 缺失时的默认等待秒数
const DEFAULT_RETRY_AFTER_SECONDS: u64 = 60;
/// 关键词上下文窗口（字符数）
const KEYWORD_WINDOW_CHARS: usize = 12;
/// 结果缓存条目上限
const CACHE_ENTRY_LIMIT: usize = 128;
/// 结果缓存有效期
const CACHE_TTL: Duration = Duration::from_secs(300);

/// status 取值：命中验证码
pub const STATUS_SUCCESS: &str = "success";
/// status 取值：暂无短信
pub const STATUS_EMPTY: &str = "empty";
/// status 取值：链接失效
pub const STATUS_INVALID_LINK: &str = "invalid_link";
/// status 取值：响应无法解析
pub const STATUS_UNPARSABLE: &str = "unparsable";
/// status 取值：未配置接码地址
pub const STATUS_NO_CONFIG: &str = "no_config";
/// status 取值：请求/服务错误
pub const STATUS_ERROR: &str = "error";

/// 验证码关键词（用于限定数字候选的上下文）
const CODE_KEYWORDS: &[&str] = &[
    "验证码",
    "校验码",
    "动态码",
    "安全码",
    "verification code",
    "code is",
    "otp",
];

/// 取码结果（字段名保持 snake_case，前端适配器负责转 camelCase）
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SmsFetchResult {
    pub status: String,
    pub code: Option<String>,
    pub message: Option<String>,
    pub error: Option<String>,
    pub retry_after_seconds: Option<u64>,
    pub fetched_at: String,
}

impl SmsFetchResult {
    fn base(status: &str) -> Self {
        Self {
            status: status.to_string(),
            code: None,
            message: None,
            error: None,
            retry_after_seconds: None,
            fetched_at: chrono::Utc::now().to_rfc3339(),
        }
    }

    /// 未配置（或配置非法）：error 写明中文原因
    pub fn no_config(error: impl Into<String>) -> Self {
        let mut result = Self::base(STATUS_NO_CONFIG);
        result.error = Some(error.into());
        result
    }

    /// 请求/服务错误：error 写明中文原因（绝不包含完整 URL 与令牌）
    pub fn error(error: impl Into<String>) -> Self {
        let mut result = Self::base(STATUS_ERROR);
        result.error = Some(error.into());
        result
    }

    fn with_status(status: &str, message: Option<String>) -> Self {
        let mut result = Self::base(status);
        result.message = message;
        result
    }

    fn success(code: String, message: Option<String>) -> Self {
        let mut result = Self::base(STATUS_SUCCESS);
        result.code = Some(code);
        result.message = message;
        result
    }

    fn with_retry_after(error: impl Into<String>, retry_after_seconds: u64) -> Self {
        let mut result = Self::error(error);
        result.retry_after_seconds = Some(retry_after_seconds);
        result
    }
}

/// 接码服务：并发限流 + 结果去重 + 最小请求间隔
pub struct SmsService {
    client: reqwest::Client,
    semaphore: Arc<Semaphore>,
    last_result: Mutex<HashMap<String, (Instant, SmsFetchResult)>>,
    last_started: Mutex<HashMap<String, Instant>>,
}

impl Default for SmsService {
    fn default() -> Self {
        Self::new()
    }
}

impl SmsService {
    pub fn new() -> Self {
        let client = match reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(REQUEST_TIMEOUT)
            .user_agent("GoogleManager/0.1 (+desktop)")
            .build()
        {
            Ok(client) => client,
            Err(error) => {
                log::error!("初始化接码 HTTP 客户端失败: {}", error);
                reqwest::Client::new()
            }
        };

        Self {
            client,
            semaphore: Arc::new(Semaphore::new(MAX_CONCURRENCY)),
            last_result: Mutex::new(HashMap::new()),
            last_started: Mutex::new(HashMap::new()),
        }
    }

    /// 获取短信验证码
    pub async fn fetch(&self, url: &str) -> SmsFetchResult {
        let target = url.trim();
        if target.is_empty() {
            return SmsFetchResult::no_config("未配置手机接码地址");
        }

        // 1) URL 校验：必须 https、必须有 host、不得带用户名密码
        let host = match validate_sms_url(target) {
            Ok(host) => host,
            Err(reason) => return SmsFetchResult::no_config(reason),
        };

        // 2) 去重：2 秒内同一 URL 直接复用上次结果
        let now = Instant::now();
        if let Ok(cache) = self.last_result.lock() {
            if let Some((at, result)) = cache.get(target) {
                if now.duration_since(*at) < DEDUP_WINDOW {
                    return result.clone();
                }
            }
        }

        // 3) 最小请求间隔：3 秒内同一 URL 不再真正发起请求
        if let Ok(mut started) = self.last_started.lock() {
            if let Some(at) = started.get(target) {
                let elapsed = now.duration_since(*at);
                if elapsed < MIN_REQUEST_INTERVAL {
                    drop(started);
                    return self.reuse_or_throttle(target, MIN_REQUEST_INTERVAL - elapsed);
                }
            }
            started.retain(|_, at| now.duration_since(*at) < MIN_REQUEST_INTERVAL);
            started.insert(target.to_string(), now);
        }

        // 4) 并发限流（网络等待期间不持有任何数据库锁）
        let permit = match self.semaphore.clone().acquire_owned().await {
            Ok(permit) => permit,
            Err(_) => return SmsFetchResult::error("接码服务繁忙，请稍后重试"),
        };
        let result = self.request_once(target, &host).await;
        drop(permit);

        // 5) 缓存结果
        if let Ok(mut cache) = self.last_result.lock() {
            let fresh = Instant::now();
            cache.retain(|_, (at, _)| fresh.duration_since(*at) < CACHE_TTL);
            if cache.len() >= CACHE_ENTRY_LIMIT {
                cache.clear();
            }
            cache.insert(target.to_string(), (fresh, result.clone()));
        }

        result
    }

    /// 最小间隔期间复用上次结果；没有可用结果时返回带重试秒数的错误
    fn reuse_or_throttle(&self, key: &str, remaining: Duration) -> SmsFetchResult {
        if let Ok(cache) = self.last_result.lock() {
            if let Some((_, result)) = cache.get(key) {
                return result.clone();
            }
        }
        SmsFetchResult::with_retry_after("请求过于频繁，请稍后再试", remaining.as_secs().max(1))
    }

    async fn request_once(&self, url: &str, host: &str) -> SmsFetchResult {
        let mut response = match self.client.get(url).send().await {
            Ok(response) => response,
            Err(error) => {
                // 注意：reqwest 的错误文本可能带完整 URL（含 token），这里只输出分类结果 + host
                return SmsFetchResult::error(format!(
                    "{}（{}）",
                    describe_request_error(&error),
                    host
                ));
            }
        };

        let status = response.status();
        let retry_after_header = response
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|value| value.to_str().ok())
            .map(|value| value.to_string());

        if status == reqwest::StatusCode::OK {
            return match read_body_limited(&mut response).await {
                Ok((body, truncated)) => {
                    if truncated {
                        return SmsFetchResult::with_status(
                            STATUS_UNPARSABLE,
                            Some(format!(
                                "响应内容超过 {} KiB，已截断，无法解析",
                                MAX_BODY_BYTES / 1024
                            )),
                        );
                    }
                    let (status, code, message) = parse_body(&body);
                    match status.as_str() {
                        STATUS_SUCCESS => {
                            SmsFetchResult::success(code.unwrap_or_default(), message)
                        }
                        _ => SmsFetchResult::with_status(&status, message),
                    }
                }
                Err(_) => SmsFetchResult::error(format!("读取响应内容失败（{}）", host)),
            };
        }

        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            let retry_after = retry_after_header
                .as_deref()
                .and_then(parse_retry_after)
                .unwrap_or(DEFAULT_RETRY_AFTER_SECONDS);
            return SmsFetchResult::with_retry_after(
                format!("接码服务返回 {}，请稍后再试", status.as_u16()),
                retry_after,
            );
        }

        match status.as_u16() {
            401 | 403 | 404 => SmsFetchResult::with_status(
                STATUS_INVALID_LINK,
                Some("接码链接无效或已失效，请获取最新链接".to_string()),
            ),
            code if status.is_redirection() => {
                SmsFetchResult::error(format!("接码服务返回重定向（{}），已拒绝跟随", code))
            }
            code => SmsFetchResult::error(format!("接码服务返回异常状态码 {}", code)),
        }
    }
}

/// 校验并解析接码 URL，成功返回小写 host（用于脱敏后的错误提示）
fn validate_sms_url(url: &str) -> Result<String, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("手机接码地址为空".to_string());
    }

    let scheme_end = trimmed
        .find("://")
        .ok_or_else(|| "手机接码地址缺少协议头".to_string())?;
    if !trimmed[..scheme_end].eq_ignore_ascii_case("https") {
        return Err("手机接码地址必须使用 https".to_string());
    }

    let rest = &trimmed[scheme_end + 3..];
    let authority_end = rest
        .find(|c| c == '/' || c == '?' || c == '#')
        .unwrap_or(rest.len());
    let authority = &rest[..authority_end];
    if authority.is_empty() {
        return Err("手机接码地址缺少主机名".to_string());
    }
    // 主机部分带 `@` 即含用户名 / 密码；反斜杠会被 URL 解析器当成 `/`，同样拒绝，避免与实际请求的主机不一致。
    // 查询串里的 `@`（例如邮箱参数）不受影响
    if authority.contains('@') || authority.contains('\\') {
        return Err("手机接码地址不能包含用户名或密码信息".to_string());
    }
    if authority
        .chars()
        .any(|c| c.is_whitespace() || c.is_control())
    {
        return Err("手机接码地址包含非法字符".to_string());
    }

    let host = match authority.rfind(':') {
        Some(index) => &authority[..index],
        None => authority,
    };
    if host.is_empty() {
        return Err("手机接码地址缺少主机名".to_string());
    }

    Ok(host.to_ascii_lowercase())
}

/// 把底层请求错误分类成中文提示，避免泄漏完整 URL 与令牌
fn describe_request_error(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        "网络请求超时".to_string()
    } else if error.is_connect() {
        "无法连接接码服务".to_string()
    } else if error.is_redirect() {
        "接码服务重定向被拒绝".to_string()
    } else if error.is_body() {
        "响应内容读取失败".to_string()
    } else if error.is_decode() {
        "响应内容解析失败".to_string()
    } else if error.is_request() {
        "请求发送失败".to_string()
    } else {
        "网络请求失败".to_string()
    }
}

/// 流式读取响应体，最多 MAX_BODY_BYTES，超出截断
async fn read_body_limited(response: &mut reqwest::Response) -> Result<(String, bool), String> {
    let mut buffer: Vec<u8> = Vec::new();
    let mut truncated = false;

    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if buffer.len() + chunk.len() > MAX_BODY_BYTES {
            let remaining = MAX_BODY_BYTES.saturating_sub(buffer.len());
            buffer.extend_from_slice(&chunk[..remaining]);
            truncated = true;
            break;
        }
        buffer.extend_from_slice(&chunk);
    }

    Ok((String::from_utf8_lossy(&buffer).to_string(), truncated))
}

/// 解析响应体：返回 (status, code, message)
///
/// 第一判据是 `YES|` / `NO|` 前缀；无前缀时只接受纯数字验证码，其余一律 unparsable。
pub fn parse_body(body: &str) -> (String, Option<String>, Option<String>) {
    let trimmed = body.trim().trim_start_matches('\u{feff}').trim();
    if trimmed.is_empty() {
        return (
            STATUS_UNPARSABLE.to_string(),
            None,
            Some("接码服务返回空响应".to_string()),
        );
    }

    if let Some(index) = trimmed.find('|') {
        let prefix = trimmed[..index].trim().to_ascii_uppercase();
        let content = trimmed[index + 1..].trim();

        return match prefix.as_str() {
            "YES" => match extract_code(content) {
                Some(code) => (
                    STATUS_SUCCESS.to_string(),
                    Some(code),
                    optional_message(content),
                ),
                None => (
                    STATUS_UNPARSABLE.to_string(),
                    None,
                    optional_message(content)
                        .or_else(|| Some("短信内容中未识别到验证码".to_string())),
                ),
            },
            "NO" => {
                let lowered = content.to_ascii_lowercase();
                let expired = content.contains("失效")
                    || content.contains("无效")
                    || content.contains("过期")
                    || lowered.contains("expired")
                    || lowered.contains("invalid");
                let status = if expired {
                    STATUS_INVALID_LINK
                } else {
                    STATUS_EMPTY
                };
                (
                    status.to_string(),
                    None,
                    optional_message(content).or_else(|| Some("暂无短信，请稍后重试".to_string())),
                )
            }
            _ => (
                STATUS_UNPARSABLE.to_string(),
                None,
                optional_message(trimmed),
            ),
        };
    }

    // 无 `|`：只接受整串为 4-8 位数字的验证码
    if let Some(code) = pure_digit_code(trimmed) {
        return (STATUS_SUCCESS.to_string(), Some(code), None);
    }

    (
        STATUS_UNPARSABLE.to_string(),
        None,
        optional_message(trimmed),
    )
}

/// 从短信文本中提取验证码（优先级：G-数字 > 关键词上下文 > 关键词存在时的数字兜底）
pub fn extract_code(sms_text: &str) -> Option<String> {
    if sms_text.trim().is_empty() {
        return None;
    }

    // 1) 接码平台固定格式：G-821371
    if let Some(code) = g_prefixed_code(sms_text) {
        return Some(code);
    }

    // 2) 关键词前后 12 字符内的数字
    let keyword_candidates = keyword_context_candidates(sms_text);
    if !keyword_candidates.is_empty() {
        return unique_candidate(&keyword_candidates);
    }

    // 3) 仅当文本含关键词时，才允许 \b\d{4,8}\b 兜底
    if !contains_code_keyword(sms_text) {
        return None;
    }

    let fallback: Vec<String> = digit_runs(sms_text)
        .into_iter()
        .filter(is_acceptable_code)
        .map(|run| run.value)
        .collect();
    unique_candidate(&fallback)
}

/// `G-\d{4,8}`（大小写不敏感）→ 取数字部分，保留前导零
fn g_prefixed_code(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    for index in 0..bytes.len() {
        if bytes[index] != b'G' && bytes[index] != b'g' {
            continue;
        }
        if index + 2 > bytes.len() || bytes[index + 1] != b'-' {
            continue;
        }
        let mut end = index + 2;
        while end < bytes.len() && bytes[end].is_ascii_digit() {
            end += 1;
        }
        let digits = &text[index + 2..end];
        if (4..=8).contains(&digits.len()) {
            return Some(digits.to_string());
        }
    }
    None
}

#[derive(Debug, Clone)]
struct DigitRun {
    value: String,
    start: usize,
    end: usize,
    /// 紧邻 `+` / `-`（如 +8615900001111、1234-5678），不视为验证码
    attached_sign: bool,
}

/// 扫描文本中所有极大数字片段（带边界信息）
fn digit_runs(text: &str) -> Vec<DigitRun> {
    let bytes = text.as_bytes();
    let mut runs = Vec::new();
    let mut index = 0usize;

    while index < bytes.len() {
        if !bytes[index].is_ascii_digit() {
            index += 1;
            continue;
        }
        let start = index;
        while index < bytes.len() && bytes[index].is_ascii_digit() {
            index += 1;
        }
        let end = index;

        let previous = text[..start].chars().next_back();
        let next = text[end..].chars().next();
        let attached_sign = previous.is_some_and(|c| c == '+' || c == '-')
            || next.is_some_and(|c| c == '+' || c == '-');

        runs.push(DigitRun {
            value: text[start..end].to_string(),
            start,
            end,
            attached_sign,
        });
    }

    runs
}

/// 4-8 位、非年份、非紧邻正负号的数字才可能是验证码
fn is_acceptable_code(run: &DigitRun) -> bool {
    (4..=8).contains(&run.value.len()) && !run.attached_sign && !is_year(&run.value)
}

/// 4 位年份（2015-2030）不当作验证码
fn is_year(value: &str) -> bool {
    if value.len() != 4 {
        return false;
    }
    matches!(value.parse::<i32>(), Ok(year) if (2015..=2030).contains(&year))
}

/// 整串（trim 后）为 4-8 位数字且非年份
fn pure_digit_code(text: &str) -> Option<String> {
    let trimmed = text.trim();
    let length = trimmed.len();
    if !(4..=8).contains(&length) || !trimmed.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    if is_year(trimmed) {
        return None;
    }
    Some(trimmed.to_string())
}

fn contains_code_keyword(text: &str) -> bool {
    !keyword_ranges(text).is_empty()
}

/// 所有关键词命中的字节区间（ASCII 大小写不敏感）
fn keyword_ranges(text: &str) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    for (start, _) in text.char_indices() {
        for keyword in CODE_KEYWORDS {
            if matches_at(text, start, keyword) {
                ranges.push((start, start + keyword.len()));
            }
        }
    }
    ranges
}

/// 判断 haystack 从 start 开始的字符序列是否（忽略 ASCII 大小写）等于 needle
fn matches_at(haystack: &str, start: usize, needle: &str) -> bool {
    let mut chars = haystack[start..].chars();
    for expected in needle.chars() {
        match chars.next() {
            Some(actual) if actual.eq_ignore_ascii_case(&expected) => {}
            _ => return false,
        }
    }
    true
}

/// 关键词前后 KEYWORD_WINDOW_CHARS 字符内的数字候选
fn keyword_context_candidates(text: &str) -> Vec<String> {
    let ranges = keyword_ranges(text);
    if ranges.is_empty() {
        return Vec::new();
    }

    let boundaries: Vec<usize> = text.char_indices().map(|(index, _)| index).collect();
    let char_count = boundaries.len();
    let runs = digit_runs(text);
    let mut candidates = Vec::new();

    for (keyword_start, keyword_end) in ranges {
        let start_chars = text[..keyword_start].chars().count();
        let end_chars = text[..keyword_end].chars().count();
        let window_start_chars = start_chars.saturating_sub(KEYWORD_WINDOW_CHARS);
        let window_end_chars = (end_chars + KEYWORD_WINDOW_CHARS).min(char_count);

        let window_start = *boundaries.get(window_start_chars).unwrap_or(&0);
        let window_end = if window_end_chars >= char_count {
            text.len()
        } else {
            *boundaries.get(window_end_chars).unwrap_or(&text.len())
        };

        for run in &runs {
            // 与关键词窗口有重叠即可（候选数字本身还要通过 4-8 位/非年份/非带符号校验）
            let overlaps = run.start < window_end && run.end > window_start;
            if overlaps && is_acceptable_code(run) {
                candidates.push(run.value.clone());
            }
        }
    }

    candidates
}

/// 多个不同候选时返回 None（交由上层报 unparsable）
fn unique_candidate(candidates: &[String]) -> Option<String> {
    let first = candidates.first()?;
    if candidates.iter().all(|candidate| candidate == first) {
        Some(first.clone())
    } else {
        None
    }
}

/// 脱敏 + 折叠空白 + 截断到 200 字符
fn sanitize_message(text: &str) -> String {
    let mut stripped = String::new();
    let mut inside_tag = false;
    for ch in text.chars() {
        match ch {
            '<' => inside_tag = true,
            '>' => {
                inside_tag = false;
                stripped.push(' ');
            }
            _ if inside_tag => {}
            c if c.is_whitespace() => stripped.push(' '),
            c => stripped.push(c),
        }
    }

    let collapsed = stripped.split_whitespace().collect::<Vec<_>>().join(" ");
    truncate_chars(&collapsed, MAX_MESSAGE_CHARS)
}

fn optional_message(text: &str) -> Option<String> {
    let sanitized = sanitize_message(text);
    if sanitized.is_empty() {
        None
    } else {
        Some(sanitized)
    }
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let mut truncated: String = text.chars().take(max_chars).collect();
    truncated.push('…');
    truncated
}

/// 解析 Retry-After：秒数或 HTTP-date，失败返回 None
fn parse_retry_after(value: &str) -> Option<u64> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(seconds) = trimmed.parse::<u64>() {
        return Some(seconds);
    }
    if let Ok(date) = chrono::DateTime::parse_from_rfc2822(trimmed) {
        let seconds = (date.with_timezone(&chrono::Utc) - chrono::Utc::now()).num_seconds();
        return Some(seconds.max(0) as u64);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn token_url(token: &str) -> String {
        format!(
            "https://sms6688.com/api/sms/recordText?token={}&tpl=1",
            token
        )
    }

    #[test]
    fn parse_yes_sample_returns_code() {
        let (status, code, message) = parse_body("YES|G-821371 is your Google verification code.");
        assert_eq!(status, STATUS_SUCCESS);
        assert_eq!(code.as_deref(), Some("821371"));
        assert!(message.is_some());
    }

    #[test]
    fn parse_no_expired_returns_invalid_link() {
        let (status, code, message) = parse_body("NO|已失效，请获取最新链接");
        assert_eq!(status, STATUS_INVALID_LINK);
        assert!(code.is_none());
        assert_eq!(message.as_deref(), Some("已失效，请获取最新链接"));
    }

    #[test]
    fn parse_no_without_expiry_is_empty() {
        let (status, code, _) = parse_body("NO|暂无短信");
        assert_eq!(status, STATUS_EMPTY);
        assert!(code.is_none());
    }

    #[test]
    fn parse_plain_digits_returns_success() {
        let (status, code, _) = parse_body("123456");
        assert_eq!(status, STATUS_SUCCESS);
        assert_eq!(code.as_deref(), Some("123456"));
    }

    #[test]
    fn extract_code_keeps_leading_zeros() {
        assert_eq!(
            extract_code("Your code is 004512").as_deref(),
            Some("004512")
        );
    }

    #[test]
    fn extract_code_prefers_g_prefix() {
        assert_eq!(
            extract_code("G-000123 is your Google verification code.").as_deref(),
            Some("000123")
        );
    }

    #[test]
    fn extract_code_ignores_year() {
        assert_eq!(extract_code("验证码有效期至 2026 年"), None);
        let (status, code, _) = parse_body("您的验证码于 2026 年更新");
        assert_eq!(status, STATUS_UNPARSABLE);
        assert!(code.is_none());
    }

    #[test]
    fn extract_code_ignores_phone_like_numbers() {
        assert_eq!(extract_code("验证码已发送到 +8615900001111"), None);
        assert_eq!(extract_code("验证码发送失败 1234-5678"), None);
    }

    #[test]
    fn extract_code_multiple_candidates_is_unresolved() {
        assert_eq!(extract_code("验证码 123456 或 654321 均可"), None);
        let (status, code, _) = parse_body("YES|验证码 123456 或 654321 均可");
        assert_eq!(status, STATUS_UNPARSABLE);
        assert!(code.is_none());
    }

    #[test]
    fn parse_long_or_html_body_is_unparsable() {
        let html = "<html><body><h1>502 Bad Gateway</h1></body></html>";
        let (status, code, _) = parse_body(html);
        assert_eq!(status, STATUS_UNPARSABLE);
        assert!(code.is_none());

        let long_body = "Y".repeat(MAX_MESSAGE_CHARS * 4);
        let (long_status, long_code, long_message) = parse_body(&long_body);
        assert_eq!(long_status, STATUS_UNPARSABLE);
        assert!(long_code.is_none());
        let message = long_message.unwrap();
        assert!(message.chars().count() <= MAX_MESSAGE_CHARS + 1);
    }

    #[test]
    fn parse_empty_body_is_unparsable() {
        let (status, code, _) = parse_body("");
        assert_eq!(status, STATUS_UNPARSABLE);
        assert!(code.is_none());

        let (blank_status, _, _) = parse_body("   \r\n  ");
        assert_eq!(blank_status, STATUS_UNPARSABLE);
    }

    #[test]
    fn validate_url_accepts_https_with_host() {
        let host =
            validate_sms_url("https://sms6688.com/api/sms/recordText?token=abc&tpl=1").unwrap();
        assert_eq!(host, "sms6688.com");
    }

    #[test]
    fn validate_url_rejects_http_scheme() {
        assert!(validate_sms_url("http://sms6688.com/api/sms/recordText?token=abc").is_err());
    }

    #[test]
    fn validate_url_rejects_credentials() {
        assert!(validate_sms_url("https://user:pass@sms6688.com/api?token=abc").is_err());
    }

    #[test]
    fn validate_url_allows_at_sign_in_query_only() {
        let host = validate_sms_url("https://sms6688.com/api?token=abc&email=a@b.com").unwrap();
        assert_eq!(host, "sms6688.com");
        assert!(validate_sms_url("https://evil.com\\@sms6688.com/api?token=abc").is_err());
    }

    #[test]
    fn validate_url_rejects_missing_host() {
        assert!(validate_sms_url("https:///api/sms/recordText?token=abc").is_err());
        assert!(validate_sms_url("https://").is_err());
        assert!(validate_sms_url("   ").is_err());
    }

    #[test]
    fn parse_retry_after_supports_seconds_and_http_date() {
        assert_eq!(parse_retry_after("120"), Some(120));
        assert_eq!(parse_retry_after(""), None);
        assert_eq!(parse_retry_after("not-a-date"), None);
        // HTTP-date（已过期）→ 归零
        assert_eq!(parse_retry_after("Wed, 21 Oct 2015 07:28:00 GMT"), Some(0));
    }

    #[test]
    fn fetch_rejects_invalid_url_without_leaking_token() {
        let service = SmsService::new();
        let token = "SECRET_TOKEN_9f8e7d";

        let insecure = tauri::async_runtime::block_on(
            service.fetch(&token_url(token).replace("https://", "http://")),
        );
        assert_eq!(insecure.status, STATUS_NO_CONFIG);
        assert!(!insecure.error.clone().unwrap_or_default().contains(token));

        let with_credentials = tauri::async_runtime::block_on(service.fetch(&format!(
            "https://user:{}@sms6688.com/api/sms/recordText",
            token
        )));
        assert_eq!(with_credentials.status, STATUS_NO_CONFIG);
        assert!(!with_credentials
            .error
            .clone()
            .unwrap_or_default()
            .contains(token));

        let missing_host =
            tauri::async_runtime::block_on(service.fetch("https:///api?token=SECRET_TOKEN_9f8e7d"));
        assert_eq!(missing_host.status, STATUS_NO_CONFIG);
        assert!(!missing_host
            .error
            .clone()
            .unwrap_or_default()
            .contains(token));

        let empty = tauri::async_runtime::block_on(service.fetch("   "));
        assert_eq!(empty.status, STATUS_NO_CONFIG);
        assert!(empty.error.is_some());
    }

    #[test]
    fn fetch_rejects_plain_http_and_keeps_result_stable() {
        let service = SmsService::new();
        // 非法 URL 不会发起网络请求，可安全断言校验与去重行为
        let url = "http://sms6688.com/api/sms/recordText?token=dedup";
        let first = tauri::async_runtime::block_on(service.fetch(url));
        let second = tauri::async_runtime::block_on(service.fetch(url));

        assert_eq!(first.status, STATUS_NO_CONFIG);
        assert_eq!(second.status, STATUS_NO_CONFIG);
        // fetched_at 是每次调用时间，不参与比较
        assert_eq!(first.code, second.code);
        assert_eq!(first.error, second.error);
        assert_eq!(first.message, second.message);
    }

    /// 真实接口联调（默认忽略，避免 CI 联网）：
    /// 运行方式：`SMS_LIVE_URL="https://..." cargo test --lib live_fetch -- --ignored --nocapture`
    ///
    /// 通过环境变量传入地址，避免把任何 token 写进源码或提交记录。
    #[test]
    #[ignore = "需要真实接码地址，默认不执行"]
    fn live_fetch_uses_real_endpoint() {
        let Ok(url) = std::env::var("SMS_LIVE_URL") else {
            panic!("请通过 SMS_LIVE_URL 提供接码地址");
        };

        let service = SmsService::new();
        let result = tauri::async_runtime::block_on(service.fetch(&url));
        println!(
            "live status={} code={:?} message={:?} error={:?}",
            result.status, result.code, result.message, result.error
        );

        // 只断言「拿到了一个明确的业务状态」，具体是 success/empty/invalid_link 取决于当时是否有短信
        assert!(
            matches!(
                result.status.as_str(),
                STATUS_SUCCESS | STATUS_EMPTY | STATUS_INVALID_LINK | STATUS_UNPARSABLE
            ),
            "意外的状态: {} ({:?})",
            result.status,
            result.error
        );
    }
}
