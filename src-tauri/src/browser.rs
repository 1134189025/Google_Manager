//! 账号独立浏览器：每个账号对应一个 Chrome / Edge 配置目录（--user-data-dir）
//!
//! 运行检测（已在本机 Chrome 与 Edge 实测确认）：
//!   Chromium 在 Windows 上用一个隐藏的消息窗口实现单实例，
//!   类名 `Chrome_MessageWindow`，标题为配置目录的绝对路径。
//!   标题比较不区分大小写，但必须是反斜杠分隔、无结尾分隔符的形式。
//!   用 FindWindowExW(HWND_MESSAGE, ...) 按目录查找即可拿到浏览器主进程号，
//!   不必扫描进程，也不会与浏览器争抢 lockfile；管理器重启后同样有效。
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

/// 规范化路径字符串：去首尾空格、统一为反斜杠、去掉结尾分隔符（保留盘符根 `X:\`）。
/// 浏览器消息窗口的标题就是这种形式，路径不一致会导致找不到运行中的窗口。
pub fn normalize_path_str(value: &str) -> String {
    let mut path = value.trim().replace('/', "\\");
    while path.len() > 1 && path.ends_with('\\') {
        if path.len() == 3 && path.as_bytes()[1] == b':' {
            break;
        }
        path.pop();
    }
    path
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

/// 候选浏览器路径：Chrome 优先，其次 Edge
pub fn browser_candidates(
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
    let candidates = browser_candidates(
        env_path("ProgramFiles"),
        env_path("ProgramFiles(x86)"),
        dirs::data_local_dir(),
    );
    detect_browser(&candidates, |path| path.is_file())
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
    }
}

/// 校验并规范化前端提交的设置；配置根目录留空时写入默认值（视为已确认）
pub fn validate_settings(
    input: &BrowserSettingsInput,
    default_root: &Path,
) -> Result<BrowserSettings, String> {
    let browser_path = match input.browser_path.as_deref().map(normalize_path_str) {
        Some(path) if !path.is_empty() => {
            let candidate = Path::new(&path);
            let is_exe = candidate
                .extension()
                .map(|ext| ext.eq_ignore_ascii_case("exe"))
                .unwrap_or(false);
            if !candidate.is_absolute() || !is_exe || !candidate.is_file() {
                return Err(format!("浏览器程序不存在或不是 .exe 文件：{}", path));
            }
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

/// 某个配置目录中实际存在的缓存目录
pub fn cache_targets(profile_dir: &Path) -> Vec<PathBuf> {
    let mut targets: Vec<PathBuf> = ROOT_CACHE_DIRS
        .iter()
        .map(|name| profile_dir.join(name))
        .collect();

    if let Ok(entries) = fs::read_dir(profile_dir) {
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

    targets.into_iter().filter(|path| path.is_dir()).collect()
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
            Ok(()) => result.deleted += 1,
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
        total_bytes: dirs.iter().map(|dir| dir_size(dir)).sum(),
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

    command
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("启动浏览器失败 {}: {}", browser.display(), e))
}

/// 打开账号浏览器：未运行则启动；运行中则把已有窗口切到前台
pub fn open_profile(
    browser: Option<&Path>,
    root: &Path,
    email: &str,
) -> Result<OpenBrowserResult, String> {
    let browser = browser.ok_or("未找到 Chrome 或 Edge，请在设置里指定浏览器程序")?;
    if !browser.is_file() {
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

/// 用 explorer 打开配置目录
pub fn open_in_explorer(dir: &Path) -> Result<(), String> {
    if !dir.is_dir() {
        return Err("该账号还没有浏览器配置目录".to_string());
    }
    Command::new("explorer")
        .arg(dir)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("打开目录失败: {}", e))
}

#[cfg(windows)]
pub use win::{find_running_pid, focus_browser_window};

#[cfg(not(windows))]
pub fn find_running_pid(_profile_dir: &Path) -> Option<u32> {
    None
}

#[cfg(not(windows))]
pub fn focus_browser_window(_pid: u32) -> bool {
    false
}

#[cfg(windows)]
mod win {
    use std::path::Path;
    use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, FindWindowExW, GetClassNameW, GetWindowThreadProcessId, IsIconic,
        IsWindowVisible, SetForegroundWindow, ShowWindow, HWND_MESSAGE, SW_RESTORE,
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
        let mut buf = [0u16; 64];
        let len = GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
        if len > 0 && String::from_utf16_lossy(&buf[..len as usize]) == BROWSER_WINDOW_CLASS {
            // EnumWindows 按 Z 序从上到下枚举，第一个命中的就是最上层窗口
            ctx.found = hwnd;
            return 0;
        }
        1
    }

    /// 把浏览器进程最上层的可见窗口还原并切到前台；没有可见窗口时返回 false
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
                log::warn!("切换浏览器窗口到前台失败（可能被系统焦点规则拦截）");
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
    fn normalize_path_str_uses_backslashes_without_trailing_separator() {
        assert_eq!(normalize_path_str(" E:/Profiles/ "), "E:\\Profiles");
        assert_eq!(normalize_path_str("E:\\Profiles\\\\"), "E:\\Profiles");
        assert_eq!(normalize_path_str("E:\\"), "E:\\");
        assert_eq!(normalize_path_str("E:/"), "E:\\");
    }

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

    #[test]
    fn detect_browser_prefers_chrome_then_falls_back_to_edge() {
        let candidates = browser_candidates(
            Some(PathBuf::from("C:\\PF")),
            Some(PathBuf::from("C:\\PF86")),
            Some(PathBuf::from("C:\\Local")),
        );
        assert_eq!(candidates.len(), 5);
        assert!(candidates[0].ends_with("Google\\Chrome\\Application\\chrome.exe"));

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
