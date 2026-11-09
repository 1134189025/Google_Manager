//! 账号独立浏览器：每个账号对应一个 Chrome / Edge 配置目录（--user-data-dir）
//!
//! 运行检测：
//! - Windows（已在本机 Chrome 与 Edge 实测确认）：
//!   Chromium 在 Windows 上用一个隐藏的消息窗口实现单实例，
//!   类名 `Chrome_MessageWindow`，标题为配置目录的绝对路径。
//!   标题比较不区分大小写，但必须是反斜杠分隔、无结尾分隔符的形式。
//!   用 FindWindowExW(HWND_MESSAGE, ...) 按目录查找即可拿到浏览器主进程号，
//!   不必扫描进程，也不会与浏览器争抢 lockfile；管理器重启后同样有效。
//! - macOS（已在本机 Chrome 实测确认）：
//!   Chromium 在配置目录里放一个符号链接 `SingletonLock`，指向 `<主机名>-<主进程号>`。
//!   读链接拿到进程号，再核对该进程仍存在、且启动时间不晚于链接的创建时间
//!   （浏览器崩溃后链接会残留，进程号可能已被别的程序复用）。
//!
//! 本模块不访问数据库：设置由命令层读出后以 `BrowserSettings` 传入。

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// 设置键：浏览器程序路径（未设置时自动检测）
pub const SETTING_BROWSER_PATH: &str = "browser.path";
/// 设置键：配置根目录（首次保存设置后写入）
pub const SETTING_PROFILES_ROOT: &str = "browser.profiles_root";

/// 首次打开时进入的 Google 登录页
pub const LOGIN_URL: &str = "https://accounts.google.com/";

/// 配置目录名长度（sha256 十六进制前缀）
const PROFILE_KEY_LEN: usize = 12;

pub const STATUS_NONE: &str = "none";
pub const STATUS_CREATED: &str = "created";
pub const STATUS_RUNNING: &str = "running";

pub const ACTION_LAUNCHED: &str = "launched";
pub const ACTION_FOCUSED: &str = "focused";
pub const ACTION_NEW_WINDOW: &str = "new_window";

/// 配置根目录下可安全删除的缓存目录
const ROOT_CACHE_DIRS: &[&str] = &[
    "GrShaderCache",
    "ShaderCache",
    "GraphiteDawnCache",
    "BrowserMetrics",
    "DeferredBrowserMetrics",
];

/// 每个 Chrome 用户（Default / Profile N）下可安全删除的缓存目录；
/// 刻意不含 Network（cookie）、Local Storage、IndexedDB、Login Data、Preferences
const PROFILE_CACHE_DIRS: &[&str] = &[
    "Cache",
    "Code Cache",
    "GPUCache",
    "DawnWebGPUCache",
    "DawnGraphiteCache",
    "Service Worker/CacheStorage",
    "Service Worker/ScriptCache",
];

/// 已保存的浏览器设置（均为规范化后的值）
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BrowserSettings {
    pub browser_path: Option<String>,
    pub profiles_root: Option<String>,
}

/// 前端提交的设置（嵌套载荷，字段为 snake_case）
#[derive(Debug, Clone, Default, Deserialize)]
pub struct BrowserSettingsInput {
    #[serde(default)]
    pub browser_path: Option<String>,
    #[serde(default)]
    pub profiles_root: Option<String>,
}

/// 返回给前端的设置视图
#[derive(Debug, Clone, Serialize)]
pub struct BrowserSettingsView {
    /// 用户手动指定的浏览器程序（未指定为 None）
    pub browser_path: Option<String>,
    /// 自动检测到的浏览器程序
    pub detected_browser_path: Option<String>,
    /// 实际将使用的浏览器程序
    pub effective_browser_path: Option<String>,
    /// 已保存的配置根目录（未保存为 None）
    pub profiles_root: Option<String>,
    /// 默认配置根目录
    pub default_profiles_root: String,
    /// 实际使用的配置根目录
    pub effective_profiles_root: String,
    /// 是否已确认过配置根目录（首次打开前需要确认）
    pub configured: bool,
    /// 运行平台：`windows` / `macos` / `linux`，前端据此决定选择框的文件类型与提示文案
    pub platform: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct OpenBrowserResult {
    pub action: String,
    pub first_launch: bool,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
pub struct ClearCacheResult {
    pub cleared: usize,
    pub skipped_running: usize,
    pub freed_bytes: u64,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
pub struct DeleteProfilesResult {
    pub deleted: usize,
    pub skipped: usize,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
pub struct BrowserUsage {
    pub profiles: usize,
    pub total_bytes: u64,
}

// ─── 纯函数 ─────────────────────────────────────────────────────────

/// 由邮箱计算配置目录名：sha256(小写(去首尾空格(email))) 的前 12 位十六进制
pub fn profile_key(email: &str) -> String {
    let normalized = email.trim().to_lowercase();
    let digest = Sha256::digest(normalized.as_bytes());
    digest
        .iter()
        .take(PROFILE_KEY_LEN / 2)
        .map(|byte| format!("{:02x}", byte))
        .collect()
}

/// 是否是本模块生成的配置目录名（12 位小写十六进制），用于「清理全部」时避开无关目录
pub fn is_profile_key(name: &str) -> bool {
    name.len() == PROFILE_KEY_LEN
        && name
            .chars()
            .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
}

/// Windows 路径规范化：去首尾空格、统一为反斜杠、去掉结尾分隔符（保留盘符根 `X:\`）。
/// 浏览器消息窗口的标题就是这种形式，路径不一致会导致找不到运行中的窗口。
pub fn normalize_windows_path(value: &str) -> String {
    let mut path = value.trim().replace('/', "\\");
    while path.len() > 1 && path.ends_with('\\') {
        if path.len() == 3 && path.as_bytes()[1] == b':' {
            break;
        }
        path.pop();
    }
    path
}

/// macOS / Linux 路径规范化：去首尾空格、去掉结尾的 `/`（保留根目录 `/`）
pub fn normalize_posix_path(value: &str) -> String {
    let mut path = value.trim().to_string();
    while path.len() > 1 && path.ends_with('/') {
        path.pop();
    }
    path
}

/// 按当前平台规范化路径字符串
pub fn normalize_path_str(value: &str) -> String {
    if cfg!(windows) {
        normalize_windows_path(value)
    } else {
        normalize_posix_path(value)
    }
}

/// 默认配置根目录：设置了数据目录环境变量时放在其下（便于开发隔离），否则放在本地应用数据目录
pub fn default_profiles_root(env_data_dir: Option<&str>, local_app_data: Option<PathBuf>) -> PathBuf {
    if let Some(dir) = env_data_dir.map(str::trim).filter(|v| !v.is_empty()) {
        return PathBuf::from(normalize_path_str(dir)).join("profiles");
    }
    local_app_data
        .unwrap_or_else(|| PathBuf::from("."))
        .join("googlemanager")
        .join("profiles")
}

/// 实际配置根目录：已保存的设置优先，否则用默认值
pub fn resolve_profiles_root(
    saved: Option<&str>,
    env_data_dir: Option<&str>,
    local_app_data: Option<PathBuf>,
) -> PathBuf {
    match saved.map(str::trim).filter(|v| !v.is_empty()) {
        Some(root) => PathBuf::from(normalize_path_str(root)),
        None => default_profiles_root(env_data_dir, local_app_data),
    }
}

/// Windows 候选浏览器路径：Chrome 优先，其次 Edge
pub fn windows_browser_candidates(
    program_files: Option<PathBuf>,
    program_files_x86: Option<PathBuf>,
    local_app_data: Option<PathBuf>,
) -> Vec<PathBuf> {
    let chrome = ["Google", "Chrome", "Application", "chrome.exe"];
    let edge = ["Microsoft", "Edge", "Application", "msedge.exe"];
    let join = |base: &Option<PathBuf>, parts: &[&str]| {
        base.as_ref()
            .map(|base| parts.iter().fold(base.clone(), |path, part| path.join(part)))
    };

    [
        join(&program_files, &chrome),
        join(&program_files_x86, &chrome),
        join(&local_app_data, &chrome),
        join(&program_files_x86, &edge),
        join(&program_files, &edge),
    ]
    .into_iter()
    .flatten()
    .collect()
}

/// macOS 候选浏览器（`.app` 应用包）：Chrome 优先，其次 Edge；
/// 每种先找 `/Applications`，再找用户自己的 `~/Applications`
pub fn macos_browser_candidates(home: Option<PathBuf>) -> Vec<PathBuf> {
    let system = PathBuf::from("/Applications");
    let user = home.map(|home| home.join("Applications"));
    ["Google Chrome.app", "Microsoft Edge.app"]
        .iter()
        .flat_map(|app| {
            [Some(system.join(app)), user.as_ref().map(|dir| dir.join(app))]
                .into_iter()
                .flatten()
        })
        .collect()
}

/// 是否是 macOS 应用包（以 `.app` 结尾的目录）
pub fn is_app_bundle(path: &Path) -> bool {
    path.extension()
        .map(|ext| ext.eq_ignore_ascii_case("app"))
        .unwrap_or(false)
        && path.is_dir()
}

/// 浏览器程序是否存在：可执行文件；macOS 上也可以是 `.app` 应用包
pub fn browser_program_exists(path: &Path) -> bool {
    path.is_file() || (cfg!(target_os = "macos") && is_app_bundle(path))
}

/// macOS 上包含该程序的应用包：本身就是 `.app` 时返回自身，
/// 是 `.app` 内部的可执行文件时返回外层应用包
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn enclosing_app_bundle(path: &Path) -> Option<PathBuf> {
    path.ancestors()
        .find(|candidate| is_app_bundle(candidate))
        .map(Path::to_path_buf)
}

/// macOS 上 Chromium 的缓存目录：配置目录在 `~/Library/Application Support` 下时，
/// 浏览器会把磁盘缓存放到 `~/Library/Caches` 下相同的相对路径（已在本机 Chrome 实测确认）。
/// 返回值只是推算的路径，可能并不存在。
pub fn macos_cache_mirror(profile_dir: &Path, home: &Path) -> Option<PathBuf> {
    let relative = profile_dir
        .strip_prefix(home.join("Library").join("Application Support"))
        .ok()?;
    if relative.as_os_str().is_empty() {
        return None;
    }
    Some(home.join("Library").join("Caches").join(relative))
}

/// 本机上该配置目录对应的额外缓存目录（只有 macOS 有，且需实际存在）
fn cache_mirror(profile_dir: &Path) -> Option<PathBuf> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    dirs::home_dir()
        .and_then(|home| macos_cache_mirror(profile_dir, &home))
        .filter(|mirror| mirror.is_dir())
}

/// 按顺序返回第一个存在的浏览器程序
pub fn detect_browser(candidates: &[PathBuf], exists: impl Fn(&Path) -> bool) -> Option<PathBuf> {
    candidates.iter().find(|path| exists(path)).cloned()
}

/// 启动参数；首次打开时直接进入 Google 登录页
pub fn build_launch_args(profile_dir: &Path, email: &str, first_launch: bool) -> Vec<OsString> {
    let mut user_data_dir = OsString::from("--user-data-dir=");
    user_data_dir.push(profile_dir.as_os_str());

    let mut args = vec![
        user_data_dir,
        OsString::from("--no-first-run"),
        OsString::from("--no-default-browser-check"),
        OsString::from(format!("--window-name={}", email.trim())),
    ];
    if first_launch {
        args.push(OsString::from(LOGIN_URL));
    }
    args
}

// ─── 运行环境解析 ─────────────────────────────────────────────────────

fn env_data_dir() -> Option<String> {
    std::env::var(crate::app_paths::DATA_DIR_ENV).ok()
}

fn env_path(name: &str) -> Option<PathBuf> {
    std::env::var_os(name)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

/// 本机的默认配置根目录
pub fn system_default_profiles_root() -> PathBuf {
    default_profiles_root(env_data_dir().as_deref(), dirs::data_local_dir())
}

/// 按设置解析配置根目录
pub fn profiles_root(settings: &BrowserSettings) -> PathBuf {
    resolve_profiles_root(
        settings.profiles_root.as_deref(),
        env_data_dir().as_deref(),
        dirs::data_local_dir(),
    )
}

/// 自动检测本机浏览器
pub fn detect_system_browser() -> Option<PathBuf> {
    let candidates = if cfg!(windows) {
        windows_browser_candidates(
            env_path("ProgramFiles"),
            env_path("ProgramFiles(x86)"),
            dirs::data_local_dir(),
        )
    } else if cfg!(target_os = "macos") {
        macos_browser_candidates(dirs::home_dir())
    } else {
        Vec::new()
    };
    detect_browser(&candidates, browser_program_exists)
}

/// 实际使用的浏览器程序：手动指定优先，其次自动检测
pub fn effective_browser(settings: &BrowserSettings) -> Option<PathBuf> {
    settings
        .browser_path
        .as_deref()
        .map(PathBuf::from)
        .or_else(detect_system_browser)
}

pub fn profile_dir(root: &Path, email: &str) -> PathBuf {
    root.join(profile_key(email))
}

pub fn settings_view(settings: &BrowserSettings) -> BrowserSettingsView {
    let detected = detect_system_browser().map(|p| p.to_string_lossy().into_owned());
    BrowserSettingsView {
        browser_path: settings.browser_path.clone(),
        effective_browser_path: settings.browser_path.clone().or_else(|| detected.clone()),
        detected_browser_path: detected,
        profiles_root: settings.profiles_root.clone(),
        default_profiles_root: system_default_profiles_root().to_string_lossy().into_owned(),
        effective_profiles_root: profiles_root(settings).to_string_lossy().into_owned(),
        configured: settings.profiles_root.is_some(),
        platform: std::env::consts::OS.to_string(),
    }
}

/// 校验手动指定的浏览器程序（已规范化的绝对路径）
fn check_browser_program(path: &str) -> Result<(), String> {
    let candidate = Path::new(path);
    let ok = if cfg!(windows) {
        let is_exe = candidate
            .extension()
            .map(|ext| ext.eq_ignore_ascii_case("exe"))
            .unwrap_or(false);
        candidate.is_absolute() && is_exe && candidate.is_file()
    } else {
        candidate.is_absolute() && browser_program_exists(candidate)
    };
    if ok {
        return Ok(());
    }
    Err(if cfg!(windows) {
        format!("浏览器程序不存在或不是 .exe 文件：{}", path)
    } else if cfg!(target_os = "macos") {
        format!("浏览器程序不存在：{}（请选择 .app 应用，例如 /Applications/Google Chrome.app）", path)
    } else {
        format!("浏览器程序不存在：{}", path)
    })
}

/// 校验并规范化前端提交的设置；配置根目录留空时写入默认值（视为已确认）
pub fn validate_settings(
    input: &BrowserSettingsInput,
    default_root: &Path,
) -> Result<BrowserSettings, String> {
    let browser_path = match input.browser_path.as_deref().map(normalize_path_str) {
        Some(path) if !path.is_empty() => {
            check_browser_program(&path)?;
            Some(path)
        }
        _ => None,
    };

    let root = match input.profiles_root.as_deref().map(normalize_path_str) {
        Some(root) if !root.is_empty() => root,
        _ => normalize_path_str(&default_root.to_string_lossy()),
    };
    if !Path::new(&root).is_absolute() {
        return Err(format!("配置目录必须是绝对路径：{}", root));
    }
    fs::create_dir_all(&root).map_err(|e| format!("无法创建配置目录 {}：{}", root, e))?;

    Ok(BrowserSettings {
        browser_path,
        profiles_root: Some(root),
    })
}

// ─── 文件系统操作 ─────────────────────────────────────────────────────

/// 目录总大小（不跟随符号链接，读取失败的条目按 0 计）
pub fn dir_size(path: &Path) -> u64 {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return 0;
    };
    if !meta.is_dir() {
        return meta.len();
    }
    fs::read_dir(path)
        .map(|entries| {
            entries
                .flatten()
                .map(|entry| dir_size(&entry.path()))
                .sum()
        })
        .unwrap_or(0)
}

/// 某个配置目录中实际存在的缓存目录（macOS 上包括 `~/Library/Caches` 下对应目录里的缓存）
pub fn cache_targets(profile_dir: &Path) -> Vec<PathBuf> {
    let mut bases = vec![profile_dir.to_path_buf()];
    bases.extend(cache_mirror(profile_dir));

    let mut targets = Vec::new();
    for base in &bases {
        targets.extend(ROOT_CACHE_DIRS.iter().map(|name| base.join(name)));
        if let Ok(entries) = fs::read_dir(base) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                let is_user_dir = name == "Default" || name.starts_with("Profile ");
                if is_user_dir && entry.path().is_dir() {
                    for sub in PROFILE_CACHE_DIRS {
                        targets.push(entry.path().join(sub));
                    }
                }
            }
        }
    }

    targets.into_iter().filter(|path| path.is_dir()).collect()
}

/// 删除配置目录对应的额外缓存目录（只有 macOS 有；目录里只有缓存，失败只记日志）
fn remove_cache_mirror(profile_dir: &Path) {
    if let Some(mirror) = cache_mirror(profile_dir) {
        if let Err(e) = fs::remove_dir_all(&mirror) {
            log::warn!("删除浏览器缓存目录失败 {}: {}", mirror.display(), e);
        }
    }
}

/// 配置目录占用（含 macOS 上 `~/Library/Caches` 下的对应缓存）
pub fn profile_size(profile_dir: &Path) -> u64 {
    dir_size(profile_dir) + cache_mirror(profile_dir).map(|m| dir_size(&m)).unwrap_or(0)
}

/// 删除一个配置目录中的缓存，返回释放的字节数（调用方需确保浏览器未运行）
pub fn clear_cache_dir(profile_dir: &Path) -> u64 {
    let mut freed = 0;
    for target in cache_targets(profile_dir) {
        let before = dir_size(&target);
        if let Err(e) = fs::remove_dir_all(&target) {
            log::warn!("清理缓存目录失败 {}: {}", target.display(), e);
        }
        freed += before.saturating_sub(dir_size(&target));
    }
    freed
}

/// 配置根目录下由本模块创建的全部配置目录
pub fn list_profile_dirs(root: &Path) -> Vec<PathBuf> {
    fs::read_dir(root)
        .map(|entries| {
            entries
                .flatten()
                .filter(|entry| entry.path().is_dir())
                .filter(|entry| is_profile_key(&entry.file_name().to_string_lossy()))
                .map(|entry| entry.path())
                .collect()
        })
        .unwrap_or_default()
}

/// 清理若干配置目录的缓存；运行中的跳过
pub fn clear_profiles_cache(dirs: &[PathBuf], is_running: impl Fn(&Path) -> bool) -> ClearCacheResult {
    let mut result = ClearCacheResult::default();
    for dir in dirs.iter().filter(|dir| dir.is_dir()) {
        if is_running(dir) {
            result.skipped_running += 1;
            continue;
        }
        result.freed_bytes += clear_cache_dir(dir);
        result.cleared += 1;
    }
    result
}

/// 按邮箱删除配置目录。仍有账号记录使用该邮箱、或浏览器正在运行时跳过
pub fn delete_profiles(
    root: &Path,
    emails: &[String],
    in_use: impl Fn(&str) -> bool,
    is_running: impl Fn(&Path) -> bool,
) -> DeleteProfilesResult {
    let mut result = DeleteProfilesResult::default();
    let mut seen = std::collections::HashSet::new();
    for email in emails {
        let dir = profile_dir(root, email);
        if !seen.insert(dir.clone()) || !dir.is_dir() {
            continue;
        }
        if in_use(email) || is_running(&dir) {
            result.skipped += 1;
            continue;
        }
        match fs::remove_dir_all(&dir) {
            Ok(()) => {
                remove_cache_mirror(&dir);
                result.deleted += 1
            }
            Err(e) => {
                log::warn!("删除浏览器配置目录失败 {}: {}", dir.display(), e);
                result.skipped += 1;
            }
        }
    }
    result
}

/// 修改邮箱时同步重命名配置目录。返回 (旧目录, 新目录) 以便数据库更新失败时回滚
pub fn rename_for_email_change(
    root: &Path,
    old_email: &str,
    new_email: &str,
    is_running: impl Fn(&Path) -> bool,
) -> Result<Option<(PathBuf, PathBuf)>, String> {
    let old_dir = profile_dir(root, old_email);
    let new_dir = profile_dir(root, new_email);
    if old_dir == new_dir || !old_dir.is_dir() {
        return Ok(None);
    }
    if is_running(&old_dir) {
        return Err("该账号的浏览器正在运行，请先关闭窗口再修改邮箱".to_string());
    }
    if new_dir.exists() {
        return Err(format!(
            "新邮箱已有浏览器配置目录，未自动合并：{}",
            new_dir.display()
        ));
    }
    fs::rename(&old_dir, &new_dir).map_err(|e| format!("重命名浏览器配置目录失败: {}", e))?;
    // 旧路径对应的缓存不会再被使用，直接删掉；浏览器会在新路径下重建
    remove_cache_mirror(&old_dir);
    Ok(Some((old_dir, new_dir)))
}

/// 回滚 `rename_for_email_change` 的重命名
pub fn rollback_rename(renamed: &(PathBuf, PathBuf)) {
    let (old_dir, new_dir) = renamed;
    if let Err(e) = fs::rename(new_dir, old_dir) {
        log::error!(
            "回滚浏览器配置目录失败 {} -> {}: {}",
            new_dir.display(),
            old_dir.display(),
            e
        );
    }
}

pub fn usage(root: &Path) -> BrowserUsage {
    let dirs = list_profile_dirs(root);
    BrowserUsage {
        profiles: dirs.len(),
        total_bytes: dirs.iter().map(|dir| profile_size(dir)).sum(),
    }
}

// ─── 进程与窗口 ─────────────────────────────────────────────────────

/// 配置目录是否有浏览器正在运行
pub fn is_running(profile_dir: &Path) -> bool {
    find_running_pid(profile_dir).is_some()
}

pub fn profile_status(profile_dir: &Path) -> &'static str {
    if !profile_dir.is_dir() {
        STATUS_NONE
    } else if is_running(profile_dir) {
        STATUS_RUNNING
    } else {
        STATUS_CREATED
    }
}

/// 批量查询状态，键为调用方传入的原始邮箱
pub fn statuses(root: &Path, emails: &[String]) -> HashMap<String, String> {
    emails
        .iter()
        .map(|email| {
            let status = profile_status(&profile_dir(root, email));
            (email.clone(), status.to_string())
        })
        .collect()
}

/// 以独立进程启动浏览器，不等待其退出；关闭管理器不影响已打开的浏览器
fn spawn_detached(browser: &Path, args: &[OsString]) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    if let Some(bundle) = enclosing_app_bundle(browser) {
        return open_app_bundle(&bundle, args);
    }

    let mut command = Command::new(browser);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }

    #[cfg(unix)]
    {
        // 放进独立的进程组，管理器收到的终端信号不会连带结束浏览器
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    command
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("启动浏览器失败 {}: {}", browser.display(), e))
}

/// macOS：用 `open -n -a <应用包> --args ...` 启动一个新的浏览器实例。
/// 由 LaunchServices 启动，浏览器不是管理器的子进程，系统权限弹窗也会算在浏览器自己名下。
/// 该配置目录已有实例在运行时，新实例会把参数转交给它（由它新开窗口）然后立即退出。
#[cfg(target_os = "macos")]
fn open_app_bundle(bundle: &Path, args: &[OsString]) -> Result<(), String> {
    let output = Command::new("/usr/bin/open")
        .arg("-n")
        .arg("-a")
        .arg(bundle)
        .arg("--args")
        .args(args)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("启动浏览器失败 {}: {}", bundle.display(), e))?;
    if output.status.success() {
        return Ok(());
    }
    Err(format!(
        "启动浏览器失败 {}: {}",
        bundle.display(),
        String::from_utf8_lossy(&output.stderr).trim()
    ))
}

/// 打开账号浏览器：未运行则启动；运行中则把已有窗口切到前台
pub fn open_profile(
    browser: Option<&Path>,
    root: &Path,
    email: &str,
) -> Result<OpenBrowserResult, String> {
    let browser = browser.ok_or("未找到 Chrome 或 Edge，请在设置里指定浏览器程序")?;
    if !browser_program_exists(browser) {
        return Err(format!("浏览器程序不存在：{}", browser.display()));
    }
    let dir = profile_dir(root, email);

    if let Some(pid) = find_running_pid(&dir) {
        if focus_browser_window(pid) {
            return Ok(OpenBrowserResult {
                action: ACTION_FOCUSED.to_string(),
                first_launch: false,
            });
        }
        // 浏览器在后台运行但没有可见窗口：再次启动会由已运行的实例新开一个窗口
        spawn_detached(browser, &build_launch_args(&dir, email, false))?;
        return Ok(OpenBrowserResult {
            action: ACTION_NEW_WINDOW.to_string(),
            first_launch: false,
        });
    }

    let first_launch = !dir.is_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("创建浏览器配置目录失败: {}", e))?;
    spawn_detached(browser, &build_launch_args(&dir, email, first_launch))?;
    Ok(OpenBrowserResult {
        action: ACTION_LAUNCHED.to_string(),
        first_launch,
    })
}

/// 用系统文件管理器（Windows 资源管理器 / macOS 访达）打开配置目录
pub fn open_in_file_manager(dir: &Path) -> Result<(), String> {
    if !dir.is_dir() {
        return Err("该账号还没有浏览器配置目录".to_string());
    }
    let program = if cfg!(windows) {
        "explorer"
    } else if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    Command::new(program)
        .arg(dir)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("打开目录失败: {}", e))
}

#[cfg(windows)]
pub use win::{find_running_pid, focus_browser_window};

#[cfg(target_os = "macos")]
pub use mac::focus_browser_window;

#[cfg(unix)]
pub use unix_lock::find_running_pid;

#[cfg(not(any(windows, unix)))]
pub fn find_running_pid(_profile_dir: &Path) -> Option<u32> {
    None
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn focus_browser_window(_pid: u32) -> bool {
    false
}

/// 解析 `SingletonLock` 符号链接的目标 `<主机名>-<进程号>`（主机名里也可能有 `-`）
#[cfg_attr(not(unix), allow(dead_code))]
pub fn parse_singleton_lock(target: &str) -> Option<(&str, u32)> {
    let (host, pid) = target.rsplit_once('-')?;
    let pid: u32 = pid.parse().ok()?;
    (!host.is_empty() && pid != 0).then_some((host, pid))
}

/// macOS / Linux：按配置目录里的 `SingletonLock` 判断浏览器是否在运行
#[cfg(unix)]
mod unix_lock {
    use std::path::Path;
    use std::time::{Duration, SystemTime};

    /// 进程启动时间与链接创建时间的比较容差
    const START_TIME_TOLERANCE: Duration = Duration::from_secs(2);

    pub fn find_running_pid(profile_dir: &Path) -> Option<u32> {
        let lock = profile_dir.join("SingletonLock");
        let target = std::fs::read_link(&lock).ok()?;
        let (_host, pid) = super::parse_singleton_lock(&target.to_string_lossy())?;
        let lock_created = std::fs::symlink_metadata(&lock)
            .and_then(|meta| meta.modified())
            .ok();
        process_is_lock_owner(pid, lock_created).then_some(pid)
    }

    /// 进程存在，且（能取到时）启动时间不晚于锁链接的创建时间：
    /// 浏览器崩溃后锁链接会残留，进程号可能已被之后启动的其他程序复用
    #[cfg(target_os = "macos")]
    fn process_is_lock_owner(pid: u32, lock_created: Option<SystemTime>) -> bool {
        let Some(started) = process_start_time(pid) else {
            return false;
        };
        match lock_created {
            Some(created) => started <= created + START_TIME_TOLERANCE,
            None => true,
        }
    }

    #[cfg(target_os = "macos")]
    fn process_start_time(pid: u32) -> Option<SystemTime> {
        let pid = libc::c_int::try_from(pid).ok()?;
        let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
        let size = std::mem::size_of::<libc::proc_bsdinfo>() as libc::c_int;
        // SAFETY: info 是大小为 size 的可写缓冲区
        let written = unsafe {
            libc::proc_pidinfo(
                pid,
                libc::PROC_PIDTBSDINFO,
                0,
                &mut info as *mut libc::proc_bsdinfo as *mut libc::c_void,
                size,
            )
        };
        if written != size {
            return None;
        }
        Some(
            SystemTime::UNIX_EPOCH
                + Duration::from_secs(info.pbi_start_tvsec)
                + Duration::from_micros(info.pbi_start_tvusec),
        )
    }

    #[cfg(not(target_os = "macos"))]
    fn process_is_lock_owner(pid: u32, _lock_created: Option<SystemTime>) -> bool {
        let Ok(pid) = libc::pid_t::try_from(pid) else {
            return false;
        };
        // SAFETY: 信号 0 只检查进程是否存在，不会发送任何信号
        unsafe { libc::kill(pid, 0) == 0 }
    }
}

/// macOS：把浏览器实例切到前台
#[cfg(target_os = "macos")]
mod mac {
    use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication};
    use objc2_core_foundation::{CFArray, CFDictionary, CFNumber, CFRetained, CFString, CFType};
    use objc2_core_graphics::{
        kCGNullWindowID, kCGWindowBounds, kCGWindowLayer, kCGWindowOwnerPID,
        CGWindowListCopyWindowInfo, CGWindowListOption,
    };

    /// 小于这个尺寸的窗口视为辅助窗口，不算浏览器窗口
    const MIN_WINDOW_SIZE: f64 = 100.0;

    fn number(dict: &CFDictionary<CFString, CFType>, key: &CFString) -> Option<f64> {
        let value = dict.get(key)?;
        value.downcast_ref::<CFNumber>()?.as_f64()
    }

    /// 该进程在当前桌面（Space）上是否有可见的普通窗口。
    /// 只读取进程号、层级与尺寸，不需要「屏幕录制」权限。
    pub(super) fn has_visible_window(pid: u32) -> bool {
        let options =
            CGWindowListOption::OptionOnScreenOnly | CGWindowListOption::ExcludeDesktopElements;
        let Some(list) = CGWindowListCopyWindowInfo(options, kCGNullWindowID) else {
            return false;
        };
        // SAFETY: CGWindowListCopyWindowInfo 返回的是「字符串键 → 任意值」字典的数组
        let list: CFRetained<CFArray<CFDictionary<CFString, CFType>>> =
            unsafe { CFRetained::cast_unchecked(list) };
        // SAFETY: 以下均为 CoreGraphics 导出的常量字符串
        let (owner_key, layer_key, bounds_key) =
            unsafe { (kCGWindowOwnerPID, kCGWindowLayer, kCGWindowBounds) };
        let width_key = CFString::from_static_str("Width");
        let height_key = CFString::from_static_str("Height");

        (0..list.len()).filter_map(|i| list.get(i)).any(|window| {
            if number(&window, owner_key) != Some(f64::from(pid)) {
                return false;
            }
            if number(&window, layer_key) != Some(0.0) {
                return false;
            }
            let Some(bounds) = window.get(bounds_key) else {
                return false;
            };
            let Some(bounds) = bounds.downcast_ref::<CFDictionary>() else {
                return false;
            };
            // SAFETY: kCGWindowBounds 的值是「字符串键 → 数字」字典
            let bounds: &CFDictionary<CFString, CFType> = unsafe { bounds.cast_unchecked() };
            let width = number(bounds, &width_key).unwrap_or(0.0);
            let height = number(bounds, &height_key).unwrap_or(0.0);
            width >= MIN_WINDOW_SIZE && height >= MIN_WINDOW_SIZE
        })
    }

    /// 把浏览器实例的窗口切到前台。
    /// 当前桌面上没有可见窗口时（全部关闭、最小化或在其他桌面）返回 false，
    /// 由调用方让该实例新开一个窗口。
    pub fn focus_browser_window(pid: u32) -> bool {
        let Ok(pid_t) = libc::pid_t::try_from(pid) else {
            return false;
        };
        let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid_t) else {
            return false;
        };
        if app.isHidden() {
            // 被「隐藏」(⌘H) 的应用窗口不在屏幕上，先取消隐藏
            app.unhide();
        } else if !has_visible_window(pid) {
            return false;
        }
        app.activateWithOptions(NSApplicationActivationOptions::ActivateAllWindows);
        true
    }
}

#[cfg(windows)]
mod win {
    use std::path::Path;
    use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, FindWindowExW, GetClassNameW, GetWindow, GetWindowThreadProcessId, IsIconic,
        IsWindowVisible, SetForegroundWindow, ShowWindow, GW_OWNER, HWND_MESSAGE, SW_MINIMIZE,
        SW_RESTORE,
    };

    const MESSAGE_WINDOW_CLASS: &str = "Chrome_MessageWindow";
    const BROWSER_WINDOW_CLASS: &str = "Chrome_WidgetWin_1";

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// 按配置目录查找浏览器主进程号
    pub fn find_running_pid(profile_dir: &Path) -> Option<u32> {
        let class = wide(MESSAGE_WINDOW_CLASS);
        let title = wide(&super::normalize_path_str(&profile_dir.to_string_lossy()));
        // SAFETY: 两个字符串均以 0 结尾且在调用期间有效
        let hwnd = unsafe {
            FindWindowExW(
                HWND_MESSAGE,
                std::ptr::null_mut(),
                class.as_ptr(),
                title.as_ptr(),
            )
        };
        if hwnd.is_null() {
            return None;
        }
        let mut pid = 0u32;
        // SAFETY: hwnd 为刚查到的窗口句柄，pid 指向有效内存
        unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
        (pid != 0).then_some(pid)
    }

    struct FindContext {
        pid: u32,
        found: HWND,
    }

    unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let ctx = &mut *(lparam as *mut FindContext);
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid != ctx.pid || IsWindowVisible(hwnd) == 0 {
            return 1;
        }
        // 跳过有所有者的窗口：「要恢复页面吗？」等气泡也是 Chrome_WidgetWin_1，
        // 且 Z 序在浏览器窗口之上；真正的浏览器窗口没有所有者
        if !GetWindow(hwnd, GW_OWNER).is_null() {
            return 1;
        }
        let mut buf = [0u16; 64];
        let len = GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
        if len > 0 && String::from_utf16_lossy(&buf[..len as usize]) == BROWSER_WINDOW_CLASS {
            // EnumWindows 按 Z 序从上到下枚举，第一个命中的就是最上层窗口
            ctx.found = hwnd;
            return 0;
        }
        1
    }

    /// 把浏览器进程最上层的可见主窗口还原并切到前台；没有可见窗口时返回 false
    pub fn focus_browser_window(pid: u32) -> bool {
        let mut ctx = FindContext {
            pid,
            found: std::ptr::null_mut(),
        };
        // SAFETY: 回调只在 EnumWindows 调用期间使用 ctx 指针
        unsafe { EnumWindows(Some(enum_proc), &mut ctx as *mut FindContext as LPARAM) };
        if ctx.found.is_null() {
            return false;
        }
        // SAFETY: found 为枚举得到的有效窗口句柄
        unsafe {
            if IsIconic(ctx.found) != 0 {
                ShowWindow(ctx.found, SW_RESTORE);
            }
            if SetForegroundWindow(ctx.found) == 0 {
                // 系统焦点规则拒绝时（例如管理器本身不在前台），
                // 最小化后再还原会让窗口重新激活到前台（已在本机实测）
                ShowWindow(ctx.found, SW_MINIMIZE);
                ShowWindow(ctx.found, SW_RESTORE);
            }
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_file(path: &Path, bytes: usize) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, vec![b'x'; bytes]).unwrap();
    }

    #[test]
    fn profile_key_is_stable_case_insensitive_and_trimmed() {
        let key = profile_key("User@Gmail.com");
        assert_eq!(key.len(), 12);
        assert!(is_profile_key(&key));
        assert_eq!(key, profile_key("  user@gmail.com "));
        assert_ne!(key, profile_key("other@gmail.com"));
        // 固定值：防止哈希方式被意外修改，导致已有配置目录与账号失联
        assert_eq!(profile_key("user@gmail.com"), "02ee7bdc4ccf");
    }

    #[test]
    fn is_profile_key_rejects_other_names() {
        assert!(!is_profile_key("Default"));
        assert!(!is_profile_key("ABCDEF123456"));
        assert!(!is_profile_key("abcdef12345"));
        assert!(is_profile_key("abcdef123456"));
    }

    #[test]
    fn normalize_windows_path_uses_backslashes_without_trailing_separator() {
        assert_eq!(normalize_windows_path(" E:/Profiles/ "), "E:\\Profiles");
        assert_eq!(normalize_windows_path("E:\\Profiles\\\\"), "E:\\Profiles");
        assert_eq!(normalize_windows_path("E:\\"), "E:\\");
        assert_eq!(normalize_windows_path("E:/"), "E:\\");
    }

    #[test]
    fn normalize_posix_path_trims_trailing_slashes_but_keeps_root() {
        assert_eq!(
            normalize_posix_path(" /Users/me/Profiles// "),
            "/Users/me/Profiles"
        );
        assert_eq!(normalize_posix_path("/Users/me/My Profiles"), "/Users/me/My Profiles");
        assert_eq!(normalize_posix_path("/"), "/");
        assert_eq!(normalize_posix_path("///"), "/");
        // 反斜杠在 macOS 上是普通文件名字符，不能改写
        assert_eq!(normalize_posix_path("/tmp/a\\b"), "/tmp/a\\b");
    }

    #[cfg(windows)]
    #[test]
    fn resolve_profiles_root_prefers_saved_then_env_then_local() {
        let local = Some(PathBuf::from("C:\\Users\\me\\AppData\\Local"));
        assert_eq!(
            resolve_profiles_root(Some("E:/GoogleManagerProfiles/"), Some("D:\\data"), local.clone()),
            PathBuf::from("E:\\GoogleManagerProfiles")
        );
        assert_eq!(
            resolve_profiles_root(Some("  "), Some("D:\\data"), local.clone()),
            PathBuf::from("D:\\data").join("profiles")
        );
        assert_eq!(
            resolve_profiles_root(None, Some(" "), local.clone()),
            local.unwrap().join("googlemanager").join("profiles")
        );
    }

    #[cfg(unix)]
    #[test]
    fn resolve_profiles_root_prefers_saved_then_env_then_local_posix() {
        let local = Some(PathBuf::from("/Users/me/Library/Application Support"));
        assert_eq!(
            resolve_profiles_root(Some("/Volumes/Data/GMProfiles/"), Some("/tmp/data"), local.clone()),
            PathBuf::from("/Volumes/Data/GMProfiles")
        );
        assert_eq!(
            resolve_profiles_root(Some("  "), Some("/tmp/data/"), local.clone()),
            PathBuf::from("/tmp/data/profiles")
        );
        assert_eq!(
            resolve_profiles_root(None, Some(" "), local.clone()),
            local.unwrap().join("googlemanager").join("profiles")
        );
    }

    #[test]
    fn detect_browser_prefers_chrome_then_falls_back_to_edge() {
        let candidates = windows_browser_candidates(
            Some(PathBuf::from("C:\\PF")),
            Some(PathBuf::from("C:\\PF86")),
            Some(PathBuf::from("C:\\Local")),
        );
        assert_eq!(candidates.len(), 5);
        assert!(candidates[0].ends_with(
            Path::new("Google")
                .join("Chrome")
                .join("Application")
                .join("chrome.exe")
        ));

        let only_edge = |p: &Path| p.to_string_lossy().ends_with("msedge.exe");
        let found = detect_browser(&candidates, only_edge).unwrap();
        assert!(found.starts_with("C:\\PF86"));

        let local_chrome_and_edge = |p: &Path| {
            let s = p.to_string_lossy();
            s.starts_with("C:\\Local") || s.ends_with("msedge.exe")
        };
        let found = detect_browser(&candidates, local_chrome_and_edge).unwrap();
        assert!(found.starts_with("C:\\Local"));

        assert_eq!(detect_browser(&candidates, |_| false), None);
    }

    #[test]
    fn build_launch_args_includes_login_url_only_on_first_launch() {
        let dir = PathBuf::from("E:\\Profiles\\abcdef123456");
        let first = build_launch_args(&dir, " demo@gmail.com ", true);
        assert_eq!(first[0], OsString::from("--user-data-dir=E:\\Profiles\\abcdef123456"));
        assert!(first.contains(&OsString::from("--no-first-run")));
        assert!(first.contains(&OsString::from("--no-default-browser-check")));
        assert!(first.contains(&OsString::from("--window-name=demo@gmail.com")));
        assert_eq!(first.last().unwrap(), &OsString::from(LOGIN_URL));

        let later = build_launch_args(&dir, "demo@gmail.com", false);
        assert!(!later.contains(&OsString::from(LOGIN_URL)));
        assert_eq!(later.len(), first.len() - 1);
    }

    #[test]
    fn clear_cache_only_removes_whitelisted_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let profile = tmp.path().join("abcdef123456");
        write_file(&profile.join("GrShaderCache/data"), 100);
        write_file(&profile.join("Default/Cache/Cache_Data/f1"), 200);
        write_file(&profile.join("Default/Service Worker/CacheStorage/x"), 50);
        write_file(&profile.join("Profile 1/GPUCache/y"), 30);
        write_file(&profile.join("Default/Network/Cookies"), 10);
        write_file(&profile.join("Default/Local Storage/leveldb/z"), 10);
        write_file(&profile.join("Default/Service Worker/Database/db"), 10);
        write_file(&profile.join("optimization_guide_model_store/m"), 10);

        let targets = cache_targets(&profile);
        assert_eq!(targets.len(), 4);

        let freed = clear_cache_dir(&profile);
        assert_eq!(freed, 380);
        assert!(!profile.join("GrShaderCache").exists());
        assert!(!profile.join("Default/Cache").exists());
        assert!(!profile.join("Profile 1/GPUCache").exists());
        assert!(profile.join("Default/Network/Cookies").exists());
        assert!(profile.join("Default/Local Storage/leveldb/z").exists());
        assert!(profile.join("Default/Service Worker/Database/db").exists());
        assert!(profile.join("optimization_guide_model_store/m").exists());
    }

    #[test]
    fn clear_profiles_cache_skips_running() {
        let tmp = tempfile::tempdir().unwrap();
        let a = tmp.path().join("aaaaaaaaaaaa");
        let b = tmp.path().join("bbbbbbbbbbbb");
        write_file(&a.join("Default/Cache/f"), 10);
        write_file(&b.join("Default/Cache/f"), 20);
        let missing = tmp.path().join("cccccccccccc");

        let result = clear_profiles_cache(&[a.clone(), b.clone(), missing], |dir| dir == b);
        assert_eq!(
            result,
            ClearCacheResult {
                cleared: 1,
                skipped_running: 1,
                freed_bytes: 10
            }
        );
        assert!(b.join("Default/Cache/f").exists());
    }

    #[test]
    fn list_profile_dirs_ignores_unrelated_entries() {
        let tmp = tempfile::tempdir().unwrap();
        let key = profile_key("a@gmail.com");
        fs::create_dir_all(tmp.path().join(&key)).unwrap();
        fs::create_dir_all(tmp.path().join("my-notes")).unwrap();
        write_file(&tmp.path().join("abcdef123456"), 1); // 同名文件而非目录
        let dirs = list_profile_dirs(tmp.path());
        assert_eq!(dirs, vec![tmp.path().join(key)]);
    }

    #[test]
    fn delete_profiles_skips_in_use_and_running() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        for email in ["free@gmail.com", "used@gmail.com", "run@gmail.com"] {
            write_file(&profile_dir(root, email).join("Default/Preferences"), 1);
        }
        let emails: Vec<String> = [
            "free@gmail.com",
            "FREE@gmail.com",
            "used@gmail.com",
            "run@gmail.com",
            "none@gmail.com",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let running = profile_dir(root, "run@gmail.com");

        let result = delete_profiles(root, &emails, |e| e == "used@gmail.com", |d| d == running);
        assert_eq!(result, DeleteProfilesResult { deleted: 1, skipped: 2 });
        assert!(!profile_dir(root, "free@gmail.com").exists());
        assert!(profile_dir(root, "used@gmail.com").exists());
        assert!(profile_dir(root, "run@gmail.com").exists());
    }

    #[test]
    fn rename_for_email_change_moves_dir_and_can_roll_back() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let old_dir = profile_dir(root, "old@gmail.com");
        write_file(&old_dir.join("Default/Preferences"), 1);

        // 仅大小写变化：同一目录，不改名
        assert_eq!(
            rename_for_email_change(root, "old@gmail.com", "OLD@gmail.com", |_| false).unwrap(),
            None
        );

        let renamed = rename_for_email_change(root, "old@gmail.com", "new@gmail.com", |_| false)
            .unwrap()
            .unwrap();
        let new_dir = profile_dir(root, "new@gmail.com");
        assert!(!old_dir.exists());
        assert!(new_dir.join("Default/Preferences").exists());

        rollback_rename(&renamed);
        assert!(old_dir.join("Default/Preferences").exists());
        assert!(!new_dir.exists());
    }

    #[test]
    fn rename_for_email_change_refuses_running_or_existing_target() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write_file(&profile_dir(root, "old@gmail.com").join("f"), 1);

        let err = rename_for_email_change(root, "old@gmail.com", "new@gmail.com", |_| true)
            .unwrap_err();
        assert!(err.contains("正在运行"));

        write_file(&profile_dir(root, "taken@gmail.com").join("f"), 1);
        let err = rename_for_email_change(root, "old@gmail.com", "taken@gmail.com", |_| false)
            .unwrap_err();
        assert!(err.contains("未自动合并"));

        // 旧目录不存在：无需处理
        assert_eq!(
            rename_for_email_change(root, "nobody@gmail.com", "x@gmail.com", |_| true).unwrap(),
            None
        );
    }

    /// 路径规范化按 Windows 语义（统一为反斜杠），只在 Windows 上验证
    #[cfg(windows)]
    #[test]
    fn validate_settings_defaults_root_and_checks_browser() {
        let tmp = tempfile::tempdir().unwrap();
        let default_root = tmp.path().join("default-profiles");

        let saved = validate_settings(&BrowserSettingsInput::default(), &default_root).unwrap();
        assert_eq!(saved.browser_path, None);
        assert_eq!(
            saved.profiles_root.as_deref(),
            Some(normalize_path_str(&default_root.to_string_lossy()).as_str())
        );
        assert!(default_root.is_dir());

        let custom = tmp.path().join("custom");
        let fake_exe = tmp.path().join("browser.exe");
        write_file(&fake_exe, 1);
        let saved = validate_settings(
            &BrowserSettingsInput {
                browser_path: Some(fake_exe.to_string_lossy().into_owned()),
                profiles_root: Some(format!("{}/", custom.to_string_lossy())),
            },
            &default_root,
        )
        .unwrap();
        assert_eq!(
            saved.browser_path.as_deref(),
            Some(normalize_path_str(&fake_exe.to_string_lossy()).as_str())
        );
        assert!(!saved.profiles_root.unwrap().ends_with('\\'));
        assert!(custom.is_dir());

        let err = validate_settings(
            &BrowserSettingsInput {
                browser_path: Some(tmp.path().join("missing.exe").to_string_lossy().into_owned()),
                profiles_root: None,
            },
            &default_root,
        )
        .unwrap_err();
        assert!(err.contains("浏览器程序不存在"));

        let err = validate_settings(
            &BrowserSettingsInput {
                browser_path: None,
                profiles_root: Some("relative\\dir".to_string()),
            },
            &default_root,
        )
        .unwrap_err();
        assert!(err.contains("绝对路径"));
    }

    #[test]
    fn macos_browser_candidates_prefer_chrome_and_system_applications() {
        let candidates = macos_browser_candidates(Some(PathBuf::from("/Users/me")));
        assert_eq!(
            candidates,
            vec![
                PathBuf::from("/Applications/Google Chrome.app"),
                PathBuf::from("/Users/me/Applications/Google Chrome.app"),
                PathBuf::from("/Applications/Microsoft Edge.app"),
                PathBuf::from("/Users/me/Applications/Microsoft Edge.app"),
            ]
        );
        assert_eq!(macos_browser_candidates(None).len(), 2);
    }

    #[test]
    fn enclosing_app_bundle_accepts_bundle_or_inner_executable() {
        let tmp = tempfile::tempdir().unwrap();
        let bundle = tmp.path().join("Google Chrome.app");
        let exe = bundle.join("Contents/MacOS/Google Chrome");
        write_file(&exe, 1);
        let plain = tmp.path().join("chromium");
        write_file(&plain, 1);

        assert!(is_app_bundle(&bundle));
        assert!(!is_app_bundle(&exe));
        assert_eq!(enclosing_app_bundle(&bundle), Some(bundle.clone()));
        assert_eq!(enclosing_app_bundle(&exe), Some(bundle.clone()));
        assert_eq!(enclosing_app_bundle(&plain), None);
        // 名字以 .app 结尾的普通文件不是应用包
        let fake = tmp.path().join("fake.app");
        write_file(&fake, 1);
        assert!(!is_app_bundle(&fake));
    }

    #[test]
    fn macos_cache_mirror_maps_application_support_to_caches() {
        let home = Path::new("/Users/me");
        assert_eq!(
            macos_cache_mirror(
                Path::new("/Users/me/Library/Application Support/googlemanager/profiles/abcdef123456"),
                home
            ),
            Some(PathBuf::from("/Users/me/Library/Caches/googlemanager/profiles/abcdef123456"))
        );
        // 不在 Application Support 下（例如外置磁盘）：缓存就在配置目录里
        assert_eq!(macos_cache_mirror(Path::new("/Volumes/Data/abcdef123456"), home), None);
        assert_eq!(
            macos_cache_mirror(Path::new("/Users/me/Library/Application Support"), home),
            None
        );
    }

    #[test]
    fn parse_singleton_lock_reads_host_and_pid() {
        assert_eq!(
            parse_singleton_lock("macdeMacBook-Air.local-92322"),
            Some(("macdeMacBook-Air.local", 92322))
        );
        assert_eq!(parse_singleton_lock("host-0"), None);
        assert_eq!(parse_singleton_lock("host-abc"), None);
        assert_eq!(parse_singleton_lock("-123"), None);
        assert_eq!(parse_singleton_lock("nohyphen"), None);
    }

    #[cfg(unix)]
    #[test]
    fn find_running_pid_ignores_missing_or_stale_lock() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("abcdef123456");
        fs::create_dir_all(&dir).unwrap();
        assert_eq!(find_running_pid(&dir), None);

        // 指向不存在进程的残留锁（进程号取一个几乎不可能存在的值）
        std::os::unix::fs::symlink("somehost-999999", dir.join("SingletonLock")).unwrap();
        assert_eq!(find_running_pid(&dir), None);
        assert_eq!(profile_status(&dir), STATUS_CREATED);
    }

    /// 锁指向本测试进程：进程存在且早于锁创建，应判为运行中
    #[cfg(unix)]
    #[test]
    fn find_running_pid_accepts_live_owner() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("abcdef123456");
        fs::create_dir_all(&dir).unwrap();
        let pid = std::process::id();
        std::os::unix::fs::symlink(format!("my-host-{}", pid), dir.join("SingletonLock")).unwrap();
        assert_eq!(find_running_pid(&dir), Some(pid));
        assert_eq!(profile_status(&dir), STATUS_RUNNING);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn validate_settings_accepts_app_bundle_on_macos() {
        let tmp = tempfile::tempdir().unwrap();
        let default_root = tmp.path().join("default-profiles");
        let bundle = tmp.path().join("Google Chrome.app");
        write_file(&bundle.join("Contents/MacOS/Google Chrome"), 1);

        let saved = validate_settings(
            &BrowserSettingsInput {
                browser_path: Some(format!("{}/", bundle.to_string_lossy())),
                profiles_root: Some(format!(" {}/ ", tmp.path().join("custom").to_string_lossy())),
            },
            &default_root,
        )
        .unwrap();
        assert_eq!(saved.browser_path, Some(bundle.to_string_lossy().into_owned()));
        assert_eq!(
            saved.profiles_root,
            Some(tmp.path().join("custom").to_string_lossy().into_owned())
        );
        assert!(tmp.path().join("custom").is_dir());

        let saved = validate_settings(&BrowserSettingsInput::default(), &default_root).unwrap();
        assert_eq!(saved.browser_path, None);
        assert!(default_root.is_dir());

        let err = validate_settings(
            &BrowserSettingsInput {
                browser_path: Some(tmp.path().join("Missing.app").to_string_lossy().into_owned()),
                profiles_root: None,
            },
            &default_root,
        )
        .unwrap_err();
        assert!(err.contains("浏览器程序不存在"));

        let err = validate_settings(
            &BrowserSettingsInput {
                browser_path: None,
                profiles_root: Some("relative/dir".to_string()),
            },
            &default_root,
        )
        .unwrap_err();
        assert!(err.contains("绝对路径"));
    }

    /// 手动验证：在本机真实启动 Chrome，检查运行检测、聚焦与「无窗口时新开窗口」。
    /// 运行：`cargo test -- --ignored macos_real_chrome --nocapture`
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore]
    fn macos_real_chrome_detection_and_focus() {
        use std::thread::sleep;
        use std::time::Duration;

        let browser = detect_system_browser().expect("本机未安装 Chrome / Edge");
        let home = dirs::home_dir().unwrap();
        let root = home.join("Library/Application Support/googlemanager-selftest/profiles");
        let email = "selftest@example.com";
        let dir = profile_dir(&root, email);
        let _ = fs::remove_dir_all(&root);

        let first = open_profile(Some(&browser), &root, email).unwrap();
        println!("首次打开: {:?}", first);
        assert_eq!(first.action, ACTION_LAUNCHED);
        assert!(first.first_launch);

        let pid = (0..40)
            .find_map(|_| {
                sleep(Duration::from_millis(250));
                find_running_pid(&dir)
            })
            .expect("浏览器启动后应能检测到运行中");
        println!("运行中，主进程号 {}", pid);
        sleep(Duration::from_secs(2));

        let again = open_profile(Some(&browser), &root, email).unwrap();
        println!("再次打开: {:?}", again);
        assert_eq!(again.action, ACTION_FOCUSED);

        println!("缓存目录: {:?}", cache_mirror(&dir));
        println!("缓存清理目标: {:?}", cache_targets(&dir));

        // SAFETY: 结束本测试启动的浏览器进程
        unsafe { libc::kill(pid as libc::pid_t, libc::SIGTERM) };
        let stopped = (0..40).any(|_| {
            sleep(Duration::from_millis(250));
            find_running_pid(&dir).is_none()
        });
        assert!(stopped, "浏览器退出后应检测为未运行");
        assert_eq!(profile_status(&dir), STATUS_CREATED);

        let result = delete_profiles(&root, &[email.to_string()], |_| false, |_| false);
        assert_eq!(result.deleted, 1);
        assert!(macos_cache_mirror(&dir, &home).map_or(true, |m| !m.exists()));
        let _ = fs::remove_dir_all(home.join("Library/Application Support/googlemanager-selftest"));
        let _ = fs::remove_dir_all(home.join("Library/Caches/googlemanager-selftest"));
    }

    /// 手动验证：浏览器在运行但没有窗口（macOS 关掉最后一个窗口时浏览器不退出）时，
    /// 再次打开应让该实例新开窗口。运行：`cargo test -- --ignored macos_real_chrome --nocapture`
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore]
    fn macos_real_chrome_opens_new_window_when_none_visible() {
        use std::thread::sleep;
        use std::time::Duration;

        let browser = detect_system_browser().expect("本机未安装 Chrome / Edge");
        let home = dirs::home_dir().unwrap();
        let base = home.join("Library/Application Support/googlemanager-selftest2");
        let root = base.join("profiles");
        let email = "nowindow@example.com";
        let dir = profile_dir(&root, email);
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&dir).unwrap();

        let mut args = build_launch_args(&dir, email, false);
        args.push(OsString::from("--no-startup-window"));
        spawn_detached(&browser, &args).unwrap();
        let pid = (0..40)
            .find_map(|_| {
                sleep(Duration::from_millis(250));
                find_running_pid(&dir)
            })
            .expect("浏览器启动后应能检测到运行中");
        sleep(Duration::from_secs(2));
        assert!(!mac::has_visible_window(pid), "--no-startup-window 不应有窗口");

        let result = open_profile(Some(&browser), &root, email).unwrap();
        println!("无窗口时打开: {:?}", result);
        assert_eq!(result.action, ACTION_NEW_WINDOW);
        let shown = (0..40).any(|_| {
            sleep(Duration::from_millis(250));
            mac::has_visible_window(pid)
        });
        assert!(shown, "已运行的实例应新开一个窗口");
        assert_eq!(find_running_pid(&dir), Some(pid), "不应启动第二个实例");

        // SAFETY: 结束本测试启动的浏览器进程
        unsafe { libc::kill(pid as libc::pid_t, libc::SIGTERM) };
        sleep(Duration::from_secs(2));
        let _ = fs::remove_dir_all(&base);
        let _ = fs::remove_dir_all(home.join("Library/Caches/googlemanager-selftest2"));
    }

    #[test]
    fn usage_counts_profile_dirs_and_bytes() {
        let tmp = tempfile::tempdir().unwrap();
        write_file(&profile_dir(tmp.path(), "a@gmail.com").join("Default/x"), 40);
        write_file(&profile_dir(tmp.path(), "b@gmail.com").join("Default/y"), 2);
        write_file(&tmp.path().join("unrelated/z"), 1000);
        assert_eq!(
            usage(tmp.path()),
            BrowserUsage {
                profiles: 2,
                total_bytes: 42
            }
        );
    }

    #[test]
    fn status_is_none_or_created_for_idle_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let emails = vec!["a@gmail.com".to_string(), "b@gmail.com".to_string()];
        fs::create_dir_all(profile_dir(tmp.path(), "a@gmail.com")).unwrap();
        let result = statuses(tmp.path(), &emails);
        assert_eq!(result.get("a@gmail.com").map(String::as_str), Some(STATUS_CREATED));
        assert_eq!(result.get("b@gmail.com").map(String::as_str), Some(STATUS_NONE));
    }
}
