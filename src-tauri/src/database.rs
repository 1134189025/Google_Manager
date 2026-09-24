use crate::app_paths;
use rusqlite::{params, Connection, Result, Row};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Account {
    pub id: i64,
    pub email: String,
    pub password: String,
    pub recovery: Option<String>,
    pub phone: Option<String>,
    pub secret: Option<String>,
    /// 手机接码地址（含令牌，自用版明文存储）
    pub sms_url: Option<String>,
    pub reg_year: Option<String>,
    pub country: Option<String>,
    pub group_name: Option<String>,
    pub remark: Option<String>,
    pub status: String,
    pub sold_status: String,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AccountInput {
    pub email: String,
    pub password: String,
    pub recovery: Option<String>,
    pub phone: Option<String>,
    pub secret: Option<String>,
    /// 旧前端可能不传该字段，缺省即为 None
    #[serde(default)]
    pub sms_url: Option<String>,
    pub reg_year: Option<String>,
    pub country: Option<String>,
    pub group_name: Option<String>,
    pub remark: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AccountHistory {
    pub id: i64,
    pub account_id: i64,
    pub field_name: String,
    pub old_value: Option<String>,
    pub new_value: Option<String>,
    pub changed_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BackupInfo {
    pub name: String,
    pub size_bytes: u64,
    pub created_at: String,
    pub checksum: Option<String>,
}

pub struct Database(pub Mutex<Connection>);

/// SELECT 列列表常量
pub const ACCOUNT_COLUMNS: &str = "id, email, password, recovery, phone, secret, sms_url, reg_year, country, group_name, remark, status, sold_status, created_at, updated_at, deleted_at";

/// 空字符串一律归一化为 None，避免写出空串而不是 NULL
fn normalize_optional(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
}

/// 需要追踪历史变更的字段（敏感字段 password/secret/sms_url 不记录明文历史）
const TRACKED_FIELDS: &[(&str, fn(&Account) -> Option<&str>)] = &[
    ("email", |a| Some(&a.email)),
    ("recovery", |a| a.recovery.as_deref()),
    ("phone", |a| a.phone.as_deref()),
    ("reg_year", |a| a.reg_year.as_deref()),
    ("country", |a| a.country.as_deref()),
    ("group_name", |a| a.group_name.as_deref()),
    ("remark", |a| a.remark.as_deref()),
];

/// 从 Row 映射到 Account（自用版：password / secret 以明文存取）
pub fn map_row_to_account(row: &Row) -> rusqlite::Result<Account> {
    let raw_secret: Option<String> = row.get("secret")?;
    let secret = raw_secret.filter(|s| !s.is_empty());

    Ok(Account {
        id: row.get("id")?,
        email: row.get("email")?,
        password: row.get("password")?,
        recovery: row.get("recovery")?,
        phone: row.get("phone")?,
        secret,
        sms_url: row
            .get::<_, Option<String>>("sms_url")?
            .filter(|value| !value.is_empty()),
        reg_year: row.get("reg_year")?,
        country: row.get("country")?,
        group_name: row.get("group_name")?,
        remark: row.get("remark")?,
        status: row.get("status")?,
        // 遗留列：只写不读，容错历史 NULL，避免整行查询失败
        sold_status: row
            .get::<_, Option<String>>("sold_status")?
            .unwrap_or_else(|| "unsold".to_string()),
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        deleted_at: row.get("deleted_at")?,
    })
}

/// 通过 ID 查询单个账号
pub fn get_account_by_id(conn: &Connection, id: i64) -> Result<Account, String> {
    conn.query_row(
        &format!(
            "SELECT {} FROM accounts WHERE id = ?1 AND deleted_at IS NULL",
            ACCOUNT_COLUMNS
        ),
        [id],
        map_row_to_account,
    )
    .map_err(|e| e.to_string())
}

/// 查询账号列表（支持搜索）
pub fn query_accounts(conn: &Connection, search: Option<&str>) -> Result<Vec<Account>, String> {
    let mut where_clauses = vec!["deleted_at IS NULL".to_string()];
    let mut params_vec: Vec<String> = Vec::new();

    if let Some(s) = search {
        if !s.is_empty() {
            let pattern = format!("%{}%", s);
            where_clauses.push("(email LIKE ? OR remark LIKE ?)".to_string());
            params_vec.push(pattern.clone());
            params_vec.push(pattern);
        }
    }

    let query = format!(
        "SELECT {} FROM accounts WHERE {} ORDER BY id DESC",
        ACCOUNT_COLUMNS,
        where_clauses.join(" AND ")
    );

    let mut stmt = conn.prepare_cached(&query).map_err(|e| e.to_string())?;
    let params_refs: Vec<&dyn rusqlite::ToSql> = params_vec
        .iter()
        .map(|p| p as &dyn rusqlite::ToSql)
        .collect();

    let rows = stmt
        .query_map(params_refs.as_slice(), map_row_to_account)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

/// 按 ID 列表查询账号
pub fn query_accounts_by_ids(conn: &Connection, ids: &[i64]) -> Result<Vec<Account>, String> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders: Vec<String> = ids.iter().map(|_| "?".to_string()).collect();
    let query = format!(
        "SELECT {} FROM accounts WHERE id IN ({}) AND deleted_at IS NULL ORDER BY id DESC",
        ACCOUNT_COLUMNS,
        placeholders.join(", ")
    );
    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
    let params_refs: Vec<&dyn rusqlite::ToSql> =
        ids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
    let rows = stmt
        .query_map(params_refs.as_slice(), map_row_to_account)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

/// 导出查询：按 ID 列表或搜索条件
pub fn query_accounts_for_export(
    conn: &Connection,
    account_ids: Option<&[i64]>,
    search: Option<&str>,
) -> Result<Vec<Account>, String> {
    if let Some(ids) = account_ids.filter(|ids| !ids.is_empty()) {
        query_accounts_by_ids(conn, ids)
    } else {
        query_accounts(conn, search)
    }
}

/// 查询回收站账号
pub fn query_deleted_accounts(conn: &Connection) -> Result<Vec<Account>, String> {
    let query = format!(
        "SELECT {} FROM accounts WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, id DESC",
        ACCOUNT_COLUMNS
    );
    let mut stmt = conn.prepare_cached(&query).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], map_row_to_account)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

/// 创建账号（自用版：明文入库）
pub fn create_account(conn: &Connection, input: &AccountInput) -> Result<Account, String> {
    let plain_password = input.password.clone();
    let plain_secret = match &input.secret {
        Some(secret) if !secret.is_empty() => Some(secret.clone()),
        _ => None,
    };
    let sms_url = normalize_optional(input.sms_url.as_deref());

    conn.execute(
        "INSERT INTO accounts (email, password, recovery, phone, secret, sms_url, reg_year, country, group_name, remark, status, sold_status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![input.email, plain_password, input.recovery, input.phone, plain_secret, sms_url, input.reg_year, input.country, input.group_name, input.remark, "inactive", "unsold"],
    ).map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();
    get_account_by_id(conn, id)
}

/// 更新账号（含历史追踪，自用版：明文入库）
pub fn update_account(conn: &Connection, id: i64, input: &AccountInput) -> Result<Account, String> {
    let old = get_account_by_id(conn, id)?;

    let plain_password = input.password.clone();
    let plain_secret = match &input.secret {
        Some(secret) if !secret.is_empty() => Some(secret.clone()),
        _ => None,
    };
    let sms_url = normalize_optional(input.sms_url.as_deref());

    // 构造新账号用于字段对比
    let new_account = Account {
        id,
        email: input.email.clone(),
        password: input.password.clone(),
        recovery: input.recovery.clone(),
        phone: input.phone.clone(),
        secret: input.secret.clone(), // 历始 secret（用于历史记录）
        sms_url: input.sms_url.clone(),
        reg_year: input.reg_year.clone(),
        country: input.country.clone(),
        group_name: input.group_name.clone(),
        remark: input.remark.clone(),
        status: old.status.clone(),
        sold_status: old.sold_status.clone(),
        created_at: old.created_at.clone(),
        updated_at: old.updated_at.clone(),
        deleted_at: old.deleted_at.clone(),
    };

    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("开启事务失败: {}", e))?;
    record_field_changes(&tx, id, &old, &new_account)?;
    tx.execute(
        "UPDATE accounts SET email = ?1, password = ?2, recovery = ?3, phone = ?4, secret = ?5, sms_url = ?6, reg_year = ?7, country = ?8, group_name = ?9, remark = ?10, updated_at = CURRENT_TIMESTAMP WHERE id = ?11 AND deleted_at IS NULL",
        params![input.email, plain_password, input.recovery, input.phone, plain_secret, sms_url, input.reg_year, input.country, input.group_name, input.remark, id],
    ).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;

    get_account_by_id(conn, id)
}

/// 删除账号
pub fn delete_account(conn: &Connection, id: i64) -> Result<(), String> {
    let changed = conn
        .execute(
            "UPDATE accounts SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND deleted_at IS NULL",
            [id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("账号不存在或已删除".to_string());
    }
    Ok(())
}

/// 删除所有账号
pub fn delete_all_accounts(conn: &Connection) -> Result<usize, String> {
    create_backup(conn, Some("before_delete_all"))?;
    let deleted = conn
        .execute(
            "UPDATE accounts SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE deleted_at IS NULL",
            [],
        )
        .map_err(|e| e.to_string())?;
    Ok(deleted)
}

/// 恢复账号
pub fn restore_account(conn: &Connection, id: i64) -> Result<Account, String> {
    let changed = conn
        .execute(
            "UPDATE accounts SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND deleted_at IS NOT NULL",
            [id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("账号不存在或未删除".to_string());
    }
    get_account_by_id(conn, id)
}

/// 永久删除账号
pub fn purge_account(conn: &Connection, id: i64) -> Result<(), String> {
    let changed = conn
        .execute(
            "DELETE FROM accounts WHERE id = ?1 AND deleted_at IS NOT NULL",
            [id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("账号不存在或未进入回收站".to_string());
    }
    Ok(())
}

/// 清空回收站
pub fn purge_all_deleted(conn: &Connection) -> Result<usize, String> {
    conn.execute("DELETE FROM accounts WHERE deleted_at IS NOT NULL", [])
        .map_err(|e| e.to_string())
}

/// 切换 status（inactive/pro）
pub fn toggle_status(conn: &Connection, id: i64) -> Result<Account, String> {
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("开启事务失败: {}", e))?;
    let current: String = tx
        .query_row(
            "SELECT status FROM accounts WHERE id = ?1 AND deleted_at IS NULL",
            [id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let new_status = if current == "pro" { "inactive" } else { "pro" };
    tx.execute(
        "INSERT INTO account_history (account_id, field_name, old_value, new_value) VALUES (?1, ?2, ?3, ?4)",
        params![id, "status", current, new_status],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE accounts SET status = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2 AND deleted_at IS NULL",
        params![new_status, id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    get_account_by_id(conn, id)
}

/// 批量导入（使用事务保证原子性，自用版：明文入库）
pub fn batch_import(conn: &Connection, accounts: &[AccountInput]) -> Result<(i32, i32), String> {
    let mut success_count = 0i32;
    let mut failed_count = 0i32;
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("开始事务失败: {}", e))?;
    let mut insert_stmt = tx
        .prepare_cached(
            "INSERT INTO accounts (email, password, recovery, phone, secret, sms_url, reg_year, country, group_name, remark, status, sold_status, deleted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, NULL)"
        )
        .map_err(|e| format!("准备批量导入语句失败: {}", e))?;

    for account in accounts {
        let plain_password = account.password.clone();
        let plain_secret = match &account.secret {
            Some(secret) if !secret.is_empty() => Some(secret.clone()),
            _ => None,
        };

        let result = insert_stmt.execute(params![
            account.email,
            plain_password,
            account.recovery,
            account.phone,
            plain_secret,
            normalize_optional(account.sms_url.as_deref()),
            account.reg_year,
            account.country,
            account.group_name,
            account.remark,
            "inactive",
            "unsold"
        ]);
        match result {
            Ok(_) => success_count += 1,
            Err(e) => {
                log::warn!("批量导入单条失败 (email={}): {}", account.email, e);
                failed_count += 1;
            }
        }
    }

    drop(insert_stmt);
    tx.commit()
        .map_err(|e| format!("提交事务失败（已回滚）: {}", e))?;

    Ok((success_count, failed_count))
}

/// 获取账号历史
pub fn get_account_history(
    conn: &Connection,
    account_id: i64,
) -> Result<Vec<AccountHistory>, String> {
    let mut stmt = conn.prepare(
        "SELECT id, account_id, field_name, old_value, new_value, changed_at FROM account_history WHERE account_id = ?1 ORDER BY changed_at DESC"
    ).map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([account_id], |row| {
            Ok(AccountHistory {
                id: row.get(0)?,
                account_id: row.get(1)?,
                field_name: row.get(2)?,
                old_value: row.get(3)?,
                new_value: row.get(4)?,
                changed_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

/// 记录字段变更历史（循环对比所有追踪字段）
fn record_field_changes(
    conn: &Connection,
    account_id: i64,
    old: &Account,
    new: &Account,
) -> Result<(), String> {
    for &(field_name, getter) in TRACKED_FIELDS {
        let old_val = getter(old);
        let new_val = getter(new);
        if old_val != new_val {
            conn.execute(
                "INSERT INTO account_history (account_id, field_name, old_value, new_value) VALUES (?1, ?2, ?3, ?4)",
                params![account_id, field_name, old_val, new_val],
            )
            .map_err(|e| format!("记录字段变更失败 (account_id={}, field={}): {}", account_id, field_name, e))?;
        }
    }
    Ok(())
}

// ─── 应用设置（键值表） ───────────────────────────────────────────────

/// app_settings 表结构：init_database 与测试夹具共用
pub const APP_SETTINGS_SCHEMA: &str = "CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
)";

/// 读取设置；未设置时返回 None
pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    let mut stmt = conn
        .prepare_cached("SELECT value FROM app_settings WHERE key = ?1")
        .map_err(|e| format!("读取设置失败: {}", e))?;
    let mut rows = stmt.query([key]).map_err(|e| format!("读取设置失败: {}", e))?;
    match rows.next().map_err(|e| format!("读取设置失败: {}", e))? {
        Some(row) => row.get(0).map(Some).map_err(|e| format!("读取设置失败: {}", e)),
        None => Ok(None),
    }
}

/// 写入设置；value 为 None 或空白时删除该键（回到默认值）
pub fn set_setting(conn: &Connection, key: &str, value: Option<&str>) -> Result<(), String> {
    match value.map(str::trim).filter(|v| !v.is_empty()) {
        Some(value) => conn.execute(
            "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, CURRENT_TIMESTAMP)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
            params![key, value],
        ),
        None => conn.execute("DELETE FROM app_settings WHERE key = ?1", [key]),
    }
    .map(|_| ())
    .map_err(|e| format!("保存设置失败: {}", e))
}

/// 是否还有任意账号记录（含回收站）使用该邮箱，比较时忽略大小写与首尾空格
pub fn email_in_use(conn: &Connection, email: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM accounts WHERE lower(trim(email)) = lower(trim(?1)))",
        [email],
        |row| row.get::<_, bool>(0),
    )
    .map_err(|e| format!("查询邮箱占用失败: {}", e))
}

fn data_dir() -> PathBuf {
    app_paths::data_dir()
}

pub fn get_db_path() -> PathBuf {
    let mut path = data_dir();
    path.push("data.db");
    path
}

fn backups_dir() -> Result<PathBuf, String> {
    let mut path = data_dir();
    path.push("backups");
    fs::create_dir_all(&path).map_err(|e| format!("创建备份目录失败: {}", e))?;
    Ok(path)
}

fn sanitize_backup_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("备份名称不能为空".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains("..") {
        return Err("备份名称非法".to_string());
    }
    if !trimmed.ends_with(".db") {
        return Err("备份文件必须是 .db".to_string());
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
    {
        return Err("备份名称包含非法字符".to_string());
    }
    Ok(trimmed.to_string())
}

fn sanitize_reason(reason: Option<&str>) -> String {
    let mut cleaned = reason
        .unwrap_or("manual")
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect::<String>();
    while cleaned.contains("__") {
        cleaned = cleaned.replace("__", "_");
    }
    cleaned.trim_matches('_').to_string()
}

fn compute_file_sha256(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| format!("读取备份失败: {}", e))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 8 * 1024];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|e| format!("读取备份失败: {}", e))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// 启动时的例行备份最多保留份数
const KEEP_STARTUP_BACKUPS: usize = 10;
/// 其余备份（删除全部 / 恢复 / 迁移前等保护性备份）最多保留份数
const KEEP_OTHER_BACKUPS: usize = 20;

/// 是否为启动时的例行备份（文件名形如 `data_<时间>_startup_<纳秒>.db`）
fn is_startup_backup(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.contains("_startup_"))
        .unwrap_or(false)
}

fn remove_backup_files(path: &Path) {
    if let Err(e) = fs::remove_file(path) {
        log::warn!("清理旧备份失败 ({}): {}", path.display(), e);
    }
    let manifest = path.with_extension("json");
    if let Err(e) = fs::remove_file(&manifest) {
        if e.kind() != std::io::ErrorKind::NotFound {
            log::warn!("清理旧备份清单失败 ({}): {}", manifest.display(), e);
        }
    }
}

/// 清理旧备份：例行备份与保护性备份分开计数，
/// 频繁启动产生的例行备份不会把删除 / 恢复 / 迁移前的备份挤掉
fn cleanup_old_backups(dir: &Path) -> Result<(), String> {
    let mut startup = Vec::new();
    let mut others = Vec::new();
    for entry in fs::read_dir(dir)
        .map_err(|e| format!("读取备份目录失败: {}", e))?
        .filter_map(|entry| entry.ok())
    {
        let path = entry.path();
        if !path.extension().map(|ext| ext == "db").unwrap_or(false) {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        if is_startup_backup(&path) {
            startup.push((modified, path));
        } else {
            others.push((modified, path));
        }
    }

    for (mut group, keep) in [
        (startup, KEEP_STARTUP_BACKUPS),
        (others, KEEP_OTHER_BACKUPS),
    ] {
        group.sort_by(|a, b| b.0.cmp(&a.0));
        for (_, path) in group.into_iter().skip(keep) {
            remove_backup_files(&path);
        }
    }
    Ok(())
}

/// 创建一致性备份（WAL 模式下使用 VACUUM INTO）
pub fn create_backup(conn: &Connection, reason: Option<&str>) -> Result<PathBuf, String> {
    match conn.path() {
        None => return Ok(PathBuf::from(":memory:backup_skipped")),
        Some(path) if path.is_empty() || path == ":memory:" => {
            return Ok(PathBuf::from(":memory:backup_skipped"));
        }
        _ => {}
    }

    create_backup_in(conn, &backups_dir()?, reason)
}

/// 在指定目录创建备份（测试可传临时目录，不依赖全局数据目录）
fn create_backup_in(
    conn: &Connection,
    dir: &Path,
    reason: Option<&str>,
) -> Result<PathBuf, String> {
    fs::create_dir_all(dir).map_err(|e| format!("创建备份目录失败: {}", e))?;
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S%.3f");
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let suffix = sanitize_reason(reason);
    let file_name = if suffix.is_empty() {
        format!("data_{}_{}.db", timestamp, nanos)
    } else {
        format!("data_{}_{}_{}.db", timestamp, suffix, nanos)
    };
    let backup_path = dir.join(file_name);
    if backup_path.exists() {
        let _ = fs::remove_file(&backup_path);
    }
    let escaped = backup_path.to_string_lossy().replace('\'', "''");

    conn.execute_batch("PRAGMA wal_checkpoint(FULL);")
        .map_err(|e| format!("WAL checkpoint 失败: {}", e))?;
    conn.execute_batch(&format!("VACUUM INTO '{}';", escaped))
        .map_err(|e| format!("创建备份失败: {}", e))?;

    let checksum = compute_file_sha256(&backup_path)?;
    let metadata = fs::metadata(&backup_path).map_err(|e| format!("读取备份信息失败: {}", e))?;
    let manifest = serde_json::json!({
        "created_at": chrono::Local::now().to_rfc3339(),
        "size_bytes": metadata.len(),
        "checksum": checksum,
    });
    let manifest_path = backup_path.with_extension("json");
    fs::write(
        &manifest_path,
        serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("写入备份清单失败: {}", e))?;

    cleanup_old_backups(dir)?;
    Ok(backup_path)
}

pub fn list_backups() -> Result<Vec<BackupInfo>, String> {
    let dir = backups_dir()?;
    let mut backups = Vec::new();

    for entry in fs::read_dir(&dir).map_err(|e| format!("读取备份目录失败: {}", e))? {
        let entry = match entry {
            Ok(v) => v,
            Err(_) => continue,
        };
        let path = entry.path();
        if !path.extension().map(|ext| ext == "db").unwrap_or(false) {
            continue;
        }

        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(v) => v.to_string(),
            None => continue,
        };
        let metadata = fs::metadata(&path).map_err(|e| format!("读取备份信息失败: {}", e))?;
        let modified = metadata.modified().ok();
        let created_at = modified
            .map(chrono::DateTime::<chrono::Local>::from)
            .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
            .unwrap_or_else(|| "".to_string());

        let checksum = fs::read(path.with_extension("json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
            .and_then(|json| {
                json.get("checksum")
                    .and_then(|v| v.as_str())
                    .map(|v| v.to_string())
            });

        backups.push(BackupInfo {
            name,
            size_bytes: metadata.len(),
            created_at,
            checksum,
        });
    }

    backups.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(backups)
}

/// accounts 表结构（init_database 与旧库迁移共用），`{name}` 为表名
fn accounts_table_sql(name: &str) -> String {
    format!(
        "CREATE TABLE IF NOT EXISTS {} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            password TEXT NOT NULL,
            recovery TEXT,
            phone TEXT,
            secret TEXT,
            sms_url TEXT,
            reg_year TEXT,
            country TEXT,
            group_name TEXT,
            remark TEXT,
            status TEXT DEFAULT 'inactive',
            sold_status TEXT DEFAULT 'unsold',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            deleted_at TEXT
        )",
        name
    )
}

/// 复制 accounts 数据时的可选列与缺列默认表达式（旧备份 / 旧库可能缺少部分列）
const ACCOUNT_COPY_COLUMNS: &[(&str, &str)] = &[
    ("recovery", "NULL"),
    ("phone", "NULL"),
    ("secret", "NULL"),
    ("sms_url", "NULL"),
    ("reg_year", "NULL"),
    ("country", "NULL"),
    ("group_name", "NULL"),
    ("remark", "NULL"),
    ("status", "'inactive'"),
    ("sold_status", "'unsold'"),
    ("created_at", "CURRENT_TIMESTAMP"),
    ("updated_at", "CURRENT_TIMESTAMP"),
    ("deleted_at", "NULL"),
];

/// 读取指定 schema（main / backup_db）中 accounts 表的实际列名集合（小写）
fn account_columns(
    conn: &Connection,
    schema: &str,
) -> Result<std::collections::HashSet<String>, String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA {}.table_info(accounts)", schema))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?;

    let mut columns = std::collections::HashSet::new();
    for row in rows {
        let name = row.map_err(|e| e.to_string())?;
        columns.insert(name.to_lowercase());
    }
    Ok(columns)
}

/// 按源表实际列拼出复制语句：`INSERT INTO <target> (...) SELECT ... FROM <source>`，
/// 源表缺少的可选列用默认表达式补齐；缺少 id / email / password 时报错
fn build_account_copy_sql(
    target: &str,
    source: &str,
    source_columns: &std::collections::HashSet<String>,
) -> Result<String, String> {
    let mut insert_columns: Vec<&str> = Vec::new();
    let mut select_exprs: Vec<&str> = Vec::new();
    for required in ["id", "email", "password"] {
        if !source_columns.contains(required) {
            return Err(format!("数据缺少必要字段: {}", required));
        }
        insert_columns.push(required);
        select_exprs.push(required);
    }
    for (column, fallback) in ACCOUNT_COPY_COLUMNS {
        insert_columns.push(column);
        select_exprs.push(if source_columns.contains(*column) {
            column
        } else {
            fallback
        });
    }
    Ok(format!(
        "INSERT INTO {} ({}) SELECT {} FROM {}",
        target,
        insert_columns.join(", "),
        select_exprs.join(", "),
        source
    ))
}

pub fn restore_backup(conn: &Connection, backup_name: &str) -> Result<(), String> {
    let backup_name = sanitize_backup_name(backup_name)?;
    let backup_path = backups_dir()?.join(&backup_name);
    if !backup_path.exists() {
        return Err("备份文件不存在".to_string());
    }

    check_backup_integrity(&backup_path)?;
    create_backup(conn, Some("before_restore"))?;
    restore_from_file(conn, &backup_path)
}

fn check_backup_integrity(backup_path: &Path) -> Result<(), String> {
    let backup_conn = Connection::open(backup_path).map_err(|e| format!("打开备份失败: {}", e))?;
    let integrity: String = backup_conn
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|e| format!("备份完整性检查失败: {}", e))?;
    if integrity.to_lowercase() != "ok" {
        return Err(format!("备份文件损坏: {}", integrity));
    }
    Ok(())
}

/// 用备份文件整体替换 accounts 与 account_history。
///
/// ATTACH / DETACH 必须放在事务之外：事务内读过备份库后它一直持有读锁，
/// 在 commit 之前 DETACH 会报 `database backup_db is locked`。
/// 无论复制成功与否都要卸载备份库，否则下一次恢复会报「already in use」。
fn restore_from_file(conn: &Connection, backup_path: &Path) -> Result<(), String> {
    conn.execute(
        "ATTACH DATABASE ?1 AS backup_db",
        [backup_path.to_string_lossy().to_string()],
    )
    .map_err(|e| format!("挂载备份库失败: {}", e))?;

    let copied = copy_from_attached_backup(conn);
    let detached = conn
        .execute_batch("DETACH DATABASE backup_db")
        .map_err(|e| format!("卸载备份库失败: {}", e));
    copied?;
    detached
}

/// 在单个事务里把已挂载的 backup_db 数据复制到主库；任何一步失败都整体回滚
fn copy_from_attached_backup(conn: &Connection) -> Result<(), String> {
    // 先校验备份结构，再动主库数据
    let backup_columns = account_columns(conn, "backup_db")?;
    let copy_sql = build_account_copy_sql("main.accounts", "backup_db.accounts", &backup_columns)?;
    let has_history_table: i64 = conn
        .query_row(
            "SELECT COUNT(1) FROM backup_db.sqlite_master WHERE type='table' AND name='account_history'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("恢复事务启动失败: {}", e))?;
    tx.execute("DELETE FROM main.account_history", [])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM main.accounts", [])
        .map_err(|e| e.to_string())?;
    tx.execute_batch(&copy_sql)
        .map_err(|e| format!("恢复 accounts 失败: {}", e))?;

    if has_history_table > 0 {
        // 旧库可能残留已无对应账号的历史记录：外键开启时跳过它们，避免整体恢复失败
        tx.execute_batch(
            "INSERT INTO main.account_history (id, account_id, field_name, old_value, new_value, changed_at)
             SELECT id, account_id, field_name, old_value, new_value, changed_at
             FROM backup_db.account_history
             WHERE account_id IN (SELECT id FROM main.accounts)",
        )
        .map_err(|e| format!("恢复 account_history 失败: {}", e))?;
    }

    tx.commit().map_err(|e| format!("提交恢复事务失败: {}", e))
}

/// 旧版 accounts 表的 email 带内联 UNIQUE（含回收站记录），
/// 迁移为「无内联约束 + 仅约束未删除记录的部分唯一索引」。
///
/// 按 SQLite 推荐的重建流程：建新表 → 复制 → 删旧表 → 新表改名，全部在一个事务内。
/// 删旧表时必须关闭外键，否则会级联删掉 account_history；这里自行关闭并在结束后还原。
fn ensure_soft_delete_unique_migration(conn: &Connection) -> Result<(), String> {
    let schema: String = conn
        .query_row(
            "SELECT COALESCE(sql, '') FROM sqlite_master WHERE type='table' AND name='accounts'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let has_inline_unique = schema.to_lowercase().contains("email text unique");
    if !has_inline_unique {
        return Ok(());
    }

    let foreign_keys_on: bool = conn
        .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if foreign_keys_on {
        conn.execute_batch("PRAGMA foreign_keys = OFF;")
            .map_err(|e| format!("关闭外键失败: {}", e))?;
    }
    let result = rebuild_accounts_table(conn);
    if foreign_keys_on {
        if let Err(e) = conn.execute_batch("PRAGMA foreign_keys = ON;") {
            log::error!("迁移后恢复外键失败: {}", e);
        }
    }
    result
}

fn rebuild_accounts_table(conn: &Connection) -> Result<(), String> {
    // 旧表的列可能不全：按实际列复制，缺的列用默认值补齐
    let columns = account_columns(conn, "main")?;
    let copy_sql = build_account_copy_sql("accounts_new", "accounts", &columns)?;

    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("迁移事务启动失败: {}", e))?;
    // 旧版迁移只复制不改名，可能遗留半成品 accounts_new，先清掉
    tx.execute_batch("DROP TABLE IF EXISTS accounts_new;")
        .map_err(|e| format!("清理旧迁移表失败: {}", e))?;
    tx.execute_batch(&accounts_table_sql("accounts_new"))
        .map_err(|e| format!("创建迁移表失败: {}", e))?;
    tx.execute_batch(&copy_sql)
        .map_err(|e| format!("迁移数据失败: {}", e))?;
    tx.execute_batch(
        "DROP TABLE accounts;
         ALTER TABLE accounts_new RENAME TO accounts;",
    )
    .map_err(|e| format!("替换旧表失败: {}", e))?;
    tx.commit().map_err(|e| format!("迁移提交失败: {}", e))?;
    Ok(())
}

/// 迁移前备份：仅当数据库文件已存在（即用户已有数据）时执行。
///
/// 目的：升级可能新增列或重建 accounts 表，
/// 一旦中途失败必须能从升级前的完整副本恢复。
/// 备份失败直接返回错误并中止升级，避免在无保护的情况下改动旧库。
fn backup_before_migration(db_path: &Path, backups: &Path) -> Result<(), String> {
    if !db_path.exists() {
        // 全新安装，没有旧数据需要保护
        return Ok(());
    }

    // 合并 WAL，保证备份到的是最新且完整的旧库
    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {}", e))?;
    conn.execute_batch("PRAGMA wal_checkpoint(FULL);")
        .map_err(|e| format!("迁移前 WAL checkpoint 失败: {}", e))?;
    create_backup_in(&conn, backups, Some("before_migration"))
        .map_err(|e| format!("迁移前备份失败，已中止升级以保护旧数据: {}", e))?;

    Ok(())
}

fn string_to_sql_error(message: String) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(
        std::io::ErrorKind::Other,
        message,
    )))
}

pub fn init_database() -> Result<Connection> {
    let backups = backups_dir().map_err(string_to_sql_error)?;
    init_database_at(&get_db_path(), &backups)
}

/// 打开（必要时创建 / 迁移）指定路径的数据库；迁移前备份写到 `backups`
fn init_database_at(db_path: &Path, backups: &Path) -> Result<Connection> {
    // 迁移前保护：先对「已有旧库」做一次完整备份，备份失败就中止升级，不冒险改动旧数据
    backup_before_migration(db_path, backups).map_err(string_to_sql_error)?;

    let conn = Connection::open(db_path)?;

    conn.execute(&accounts_table_sql("accounts"), [])?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS account_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id INTEGER NOT NULL,
            field_name TEXT NOT NULL,
            old_value TEXT,
            new_value TEXT,
            changed_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
        )",
        [],
    )?;

    conn.execute(APP_SETTINGS_SCHEMA, [])?;

    // 数据库迁移：补齐字段（字段已存在时忽略）
    for col in &[
        "phone",
        "reg_year",
        "country",
        "group_name",
        "sms_url",
        "deleted_at",
    ] {
        let _ = conn.execute(&format!("ALTER TABLE accounts ADD COLUMN {} TEXT", col), []);
    }

    // 迁移旧版 email UNIQUE 约束到软删除友好的部分唯一索引
    ensure_soft_delete_unique_migration(&conn)
        .map_err(|e| string_to_sql_error(format!("软删除迁移失败: {}", e)))?;

    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;",
    )?;

    // 创建索引，加速常用查询
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_accounts_sold_status ON accounts(sold_status)",
        [],
    )?;
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_email_active ON accounts(email) WHERE deleted_at IS NULL",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_accounts_deleted_at ON accounts(deleted_at)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_account_history_account_id ON account_history(account_id)",
        [],
    )?;

    Ok(conn)
}

// ─── 导出功能 ─────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, Default)]
pub struct ExportAccountOrder {
    pub field: Option<String>,
    pub direction: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, Default)]
pub struct ExportCategorySort {
    pub field: Option<String>,
    pub direction: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct ExportConfig {
    pub separator: String,
    pub fields: Vec<String>,
    pub include_stats: bool,
    #[serde(default)]
    pub account_order: ExportAccountOrder,
    #[serde(default)]
    pub category_sort: ExportCategorySort,
    #[serde(default)]
    pub category_label_template: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ExportField {
    Id,
    Email,
    Password,
    Recovery,
    Phone,
    Secret,
    /// 手机接码地址（含令牌，仅本机自用导出）
    SmsUrl,
    RegYear,
    Country,
    GroupName,
    Remark,
    Status,
    CreatedAt,
    UpdatedAt,
    DeletedAt,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SortDirection {
    Asc,
    Desc,
}

const DEFAULT_GROUP_LABEL_TEMPLATE: &str = "{index}. {groupField}: {groupValue}（共 {count} 条）";

impl ExportField {
    fn from_config(field: Option<&str>) -> Option<Self> {
        let normalized = field?.trim().to_ascii_lowercase();
        match normalized.as_str() {
            "id" => Some(Self::Id),
            "email" => Some(Self::Email),
            "password" => Some(Self::Password),
            "recovery" => Some(Self::Recovery),
            "phone" => Some(Self::Phone),
            "secret" => Some(Self::Secret),
            "sms_url" => Some(Self::SmsUrl),
            "reg_year" => Some(Self::RegYear),
            "country" => Some(Self::Country),
            "group_name" => Some(Self::GroupName),
            "remark" => Some(Self::Remark),
            "status" => Some(Self::Status),
            "created_at" => Some(Self::CreatedAt),
            "updated_at" => Some(Self::UpdatedAt),
            "deleted_at" => Some(Self::DeletedAt),
            _ => None,
        }
    }

    fn as_config_name(self) -> &'static str {
        match self {
            Self::Id => "id",
            Self::Email => "email",
            Self::Password => "password",
            Self::Recovery => "recovery",
            Self::Phone => "phone",
            Self::Secret => "secret",
            Self::SmsUrl => "sms_url",
            Self::RegYear => "reg_year",
            Self::Country => "country",
            Self::GroupName => "group_name",
            Self::Remark => "remark",
            Self::Status => "status",
            Self::CreatedAt => "created_at",
            Self::UpdatedAt => "updated_at",
            Self::DeletedAt => "deleted_at",
        }
    }

    fn compare_accounts(self, left: &Account, right: &Account) -> std::cmp::Ordering {
        match self {
            Self::Id => left.id.cmp(&right.id),
            Self::Email => left.email.cmp(&right.email),
            Self::Password => left.password.cmp(&right.password),
            Self::Recovery => left
                .recovery
                .as_deref()
                .unwrap_or("")
                .cmp(right.recovery.as_deref().unwrap_or("")),
            Self::Phone => left
                .phone
                .as_deref()
                .unwrap_or("")
                .cmp(right.phone.as_deref().unwrap_or("")),
            Self::Secret => left
                .secret
                .as_deref()
                .unwrap_or("")
                .cmp(right.secret.as_deref().unwrap_or("")),
            Self::SmsUrl => left
                .sms_url
                .as_deref()
                .unwrap_or("")
                .cmp(right.sms_url.as_deref().unwrap_or("")),
            Self::RegYear => left
                .reg_year
                .as_deref()
                .unwrap_or("")
                .cmp(right.reg_year.as_deref().unwrap_or("")),
            Self::Country => left
                .country
                .as_deref()
                .unwrap_or("")
                .cmp(right.country.as_deref().unwrap_or("")),
            Self::GroupName => left
                .group_name
                .as_deref()
                .unwrap_or("")
                .cmp(right.group_name.as_deref().unwrap_or("")),
            Self::Remark => left
                .remark
                .as_deref()
                .unwrap_or("")
                .cmp(right.remark.as_deref().unwrap_or("")),
            Self::Status => left.status.cmp(&right.status),
            Self::CreatedAt => left.created_at.cmp(&right.created_at),
            Self::UpdatedAt => left.updated_at.cmp(&right.updated_at),
            Self::DeletedAt => left
                .deleted_at
                .as_deref()
                .unwrap_or("")
                .cmp(right.deleted_at.as_deref().unwrap_or("")),
        }
    }

    fn export_value(self, account: &Account) -> String {
        match self {
            Self::Id => account.id.to_string(),
            Self::Email => account.email.clone(),
            Self::Password => account.password.clone(),
            Self::Recovery => account.recovery.clone().unwrap_or_default(),
            Self::Phone => account.phone.clone().unwrap_or_default(),
            Self::Secret => account.secret.clone().unwrap_or_default(),
            Self::SmsUrl => account.sms_url.clone().unwrap_or_default(),
            Self::RegYear => account.reg_year.clone().unwrap_or_default(),
            Self::Country => account.country.clone().unwrap_or_default(),
            Self::GroupName => account.group_name.clone().unwrap_or_default(),
            Self::Remark => account.remark.clone().unwrap_or_default(),
            Self::Status => account.status.clone(),
            Self::CreatedAt => utc_timestamp_to_local(&account.created_at),
            Self::UpdatedAt => utc_timestamp_to_local(&account.updated_at),
            Self::DeletedAt => account
                .deleted_at
                .as_deref()
                .map(utc_timestamp_to_local)
                .unwrap_or_default(),
        }
    }
}

/// 数据库时间戳由 SQLite `CURRENT_TIMESTAMP` 写入，是 UTC；导出时换算成本机时间
fn utc_timestamp_to_local(value: &str) -> String {
    utc_timestamp_to_tz(value, &chrono::Local)
}

/// 把 `YYYY-MM-DD HH:MM:SS`（UTC）换算到指定时区；无法解析时原样返回
fn utc_timestamp_to_tz<Tz: chrono::TimeZone>(value: &str, tz: &Tz) -> String
where
    Tz::Offset: std::fmt::Display,
{
    match chrono::NaiveDateTime::parse_from_str(value.trim(), "%Y-%m-%d %H:%M:%S") {
        Ok(naive) => naive
            .and_utc()
            .with_timezone(tz)
            .format("%Y-%m-%d %H:%M:%S")
            .to_string(),
        Err(_) => value.to_string(),
    }
}

impl ExportField {
    /// 字段的中文标签（用于分组标题模板的 {groupFieldLabel} 占位符）
    fn label(self) -> &'static str {
        match self {
            Self::Id => "ID",
            Self::Email => "邮箱",
            Self::Password => "密码",
            Self::Recovery => "恢复邮箱",
            Self::Phone => "手机号",
            Self::Secret => "2FA密钥",
            Self::SmsUrl => "手机接码地址",
            Self::RegYear => "注册年份",
            Self::Country => "国家",
            Self::GroupName => "标签",
            Self::Remark => "备注",
            Self::Status => "状态",
            Self::CreatedAt => "创建时间",
            Self::UpdatedAt => "更新时间",
            Self::DeletedAt => "删除时间",
        }
    }
}
impl SortDirection {
    fn from_config(direction: Option<&str>) -> Self {
        let normalized = direction
            .map(|value| value.trim().to_ascii_lowercase())
            .unwrap_or_default();

        match normalized.as_str() {
            "desc" | "descending" => Self::Desc,
            _ => Self::Asc,
        }
    }
}

fn apply_export_sort(accounts: &mut [Account], config: &ExportConfig) {
    let Some(sort_field) = ExportField::from_config(config.account_order.field.as_deref()) else {
        return;
    };

    let sort_direction = SortDirection::from_config(config.account_order.direction.as_deref());
    accounts.sort_by(|left, right| {
        let ordering = sort_field.compare_accounts(left, right);
        match sort_direction {
            SortDirection::Asc => ordering,
            SortDirection::Desc => ordering.reverse(),
        }
    });
}

fn build_account_export_line(account: &Account, config: &ExportConfig) -> String {
    let field_values: Vec<String> = config
        .fields
        .iter()
        .map(|field| {
            ExportField::from_config(Some(field.as_str()))
                .map(|parsed_field| parsed_field.export_value(account))
                .unwrap_or_default()
        })
        .collect();
    field_values.join(&config.separator)
}

fn render_group_label(
    group_label_template: &str,
    group_field: ExportField,
    group_value: &str,
    group_count: usize,
    group_index: usize,
) -> String {
    let display_value = if group_value.trim().is_empty() {
        "未设置"
    } else {
        group_value
    };
    let field_name = group_field.as_config_name();

    group_label_template
        .replace("{index}", &group_index.to_string())
        .replace("{groupFieldLabel}", group_field.label())
        .replace("{groupField}", field_name)
        .replace("{field}", field_name)
        .replace("{groupValue}", display_value)
        .replace("{value}", display_value)
        .replace("{count}", &group_count.to_string())
}

fn build_flat_export_output(accounts: &[Account], config: &ExportConfig) -> String {
    let mut output = String::new();
    for account in accounts {
        output.push_str(&build_account_export_line(account, config));
        output.push('\n');
    }
    output
}

fn build_grouped_export_output(
    accounts: Vec<Account>,
    config: &ExportConfig,
    group_field: ExportField,
) -> String {
    let mut grouped_accounts: std::collections::HashMap<String, Vec<Account>> =
        std::collections::HashMap::new();
    for account in accounts {
        let group_key = group_field.export_value(&account);
        grouped_accounts.entry(group_key).or_default().push(account);
    }

    let mut group_keys: Vec<String> = grouped_accounts.keys().cloned().collect();
    group_keys.sort();
    if SortDirection::from_config(config.category_sort.direction.as_deref()) == SortDirection::Desc
    {
        group_keys.reverse();
    }

    let group_label_template = config
        .category_label_template
        .as_deref()
        .map(str::trim)
        .filter(|template| !template.is_empty())
        .unwrap_or(DEFAULT_GROUP_LABEL_TEMPLATE);

    let mut output = String::new();
    let group_count = group_keys.len();
    for (index, group_key) in group_keys.into_iter().enumerate() {
        let Some(accounts_in_group) = grouped_accounts.remove(&group_key) else {
            continue;
        };

        output.push_str(&render_group_label(
            group_label_template,
            group_field,
            &group_key,
            accounts_in_group.len(),
            index + 1,
        ));
        output.push('\n');

        for account in &accounts_in_group {
            output.push_str(&build_account_export_line(account, config));
            output.push('\n');
        }

        if index + 1 < group_count {
            output.push('\n');
        }
    }

    output
}

pub fn build_export_accounts_output(mut accounts: Vec<Account>, config: &ExportConfig) -> String {
    apply_export_sort(&mut accounts, config);

    if let Some(group_field) = ExportField::from_config(config.category_sort.field.as_deref()) {
        return build_grouped_export_output(accounts, config, group_field);
    }

    build_flat_export_output(&accounts, config)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE IF NOT EXISTS accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL,
                password TEXT NOT NULL,
                recovery TEXT,
                phone TEXT,
                secret TEXT,
                sms_url TEXT,
                reg_year TEXT,
                country TEXT,
                group_name TEXT,
                remark TEXT,
                status TEXT DEFAULT 'inactive',
                sold_status TEXT DEFAULT 'unsold',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                deleted_at TEXT
            )",
            [],
        )
        .unwrap();
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_email_active ON accounts(email) WHERE deleted_at IS NULL",
            [],
        )
        .unwrap();
        conn.execute(
            "CREATE TABLE IF NOT EXISTS account_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL,
                field_name TEXT NOT NULL,
                old_value TEXT,
                new_value TEXT,
                changed_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
            )",
            [],
        )
        .unwrap();
        conn.execute(APP_SETTINGS_SCHEMA, []).unwrap();
        conn
    }

    #[test]
    fn test_settings_roundtrip_and_clear() {
        let conn = setup_test_db();
        assert_eq!(get_setting(&conn, "browser.path").unwrap(), None);

        set_setting(&conn, "browser.path", Some("  C:\\chrome.exe  ")).unwrap();
        assert_eq!(
            get_setting(&conn, "browser.path").unwrap().as_deref(),
            Some("C:\\chrome.exe")
        );

        set_setting(&conn, "browser.path", Some("D:\\edge.exe")).unwrap();
        assert_eq!(
            get_setting(&conn, "browser.path").unwrap().as_deref(),
            Some("D:\\edge.exe")
        );

        set_setting(&conn, "browser.path", Some("   ")).unwrap();
        assert_eq!(get_setting(&conn, "browser.path").unwrap(), None);

        set_setting(&conn, "browser.path", Some("x")).unwrap();
        set_setting(&conn, "browser.path", None).unwrap();
        assert_eq!(get_setting(&conn, "browser.path").unwrap(), None);
    }

    #[test]
    fn test_email_in_use_ignores_case_and_includes_deleted() {
        let conn = setup_test_db();
        assert!(!email_in_use(&conn, "user@gmail.com").unwrap());
        conn.execute(
            "INSERT INTO accounts (email, password, deleted_at) VALUES ('User@Gmail.com', 'pw', CURRENT_TIMESTAMP)",
            [],
        )
        .unwrap();
        assert!(email_in_use(&conn, " user@gmail.com ").unwrap());
        assert!(!email_in_use(&conn, "other@gmail.com").unwrap());
    }

    #[test]
    fn test_create_account() {
        let conn = setup_test_db();
        let input = AccountInput {
            email: "test@example.com".to_string(),
            password: "password123".to_string(),
            recovery: None,
            phone: None,
            secret: None,
            sms_url: None,
            reg_year: None,
            country: None,
            group_name: None,
            remark: Some("old-remark".to_string()),
        };
        let account = create_account(&conn, &input).unwrap();
        assert_eq!(account.email, "test@example.com");
        assert_eq!(account.status, "inactive");
    }

    #[test]
    fn test_update_account() {
        let conn = setup_test_db();
        let input = AccountInput {
            email: "test@example.com".to_string(),
            password: "password123".to_string(),
            recovery: None,
            phone: None,
            secret: None,
            sms_url: None,
            reg_year: None,
            country: None,
            group_name: None,
            remark: None,
        };
        let account = create_account(&conn, &input).unwrap();

        // 验证密码已解密回原文
        assert_eq!(account.password, "password123");

        let updated_input = AccountInput {
            email: "test@example.com".to_string(),
            password: "newpassword".to_string(),
            recovery: None,
            phone: None,
            secret: None,
            sms_url: None,
            reg_year: None,
            country: None,
            group_name: None,
            remark: Some("new-remark".to_string()),
        };
        let updated = update_account(&conn, account.id, &updated_input).unwrap();

        // 验证新密码已解密回原文
        assert_eq!(updated.password, "newpassword");

        // 验证历史追踪
        let history = get_account_history(&conn, account.id).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].field_name, "remark");
        assert!(history.iter().all(|h| h.field_name != "password"));
    }

    #[test]
    fn test_update_secret_should_not_write_history() {
        let conn = setup_test_db();
        let input = AccountInput {
            email: "secret-history@example.com".to_string(),
            password: "password123".to_string(),
            recovery: None,
            phone: None,
            secret: Some("JBSWY3DPEHPK3PXP".to_string()),
            sms_url: None,
            reg_year: None,
            country: None,
            group_name: None,
            remark: None,
        };
        let account = create_account(&conn, &input).unwrap();

        let updated_input = AccountInput {
            email: "secret-history@example.com".to_string(),
            password: "password123".to_string(),
            recovery: None,
            phone: None,
            secret: Some("GEZDGNBVGY3TQOJQ".to_string()),
            sms_url: None,
            reg_year: None,
            country: None,
            group_name: None,
            remark: None,
        };
        let _ = update_account(&conn, account.id, &updated_input).unwrap();

        let history = get_account_history(&conn, account.id).unwrap();
        assert!(history.iter().all(|h| h.field_name != "secret"));
    }

    #[test]
    fn test_delete_account() {
        let conn = setup_test_db();
        let input = AccountInput {
            email: "test@example.com".to_string(),
            password: "password123".to_string(),
            recovery: None,
            phone: None,
            secret: None,
            sms_url: None,
            reg_year: None,
            country: None,
            group_name: None,
            remark: None,
        };
        let account = create_account(&conn, &input).unwrap();
        delete_account(&conn, account.id).unwrap();

        let active = query_accounts(&conn, None).unwrap();
        assert_eq!(active.len(), 0);

        let deleted_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM accounts WHERE deleted_at IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(deleted_count, 1);
    }

    #[test]
    fn test_history_tracking() {
        let conn = setup_test_db();
        let input = AccountInput {
            email: "test@example.com".to_string(),
            password: "password123".to_string(),
            recovery: None,
            phone: None,
            secret: None,
            sms_url: None,
            reg_year: None,
            country: None,
            group_name: None,
            remark: None,
        };
        let account = create_account(&conn, &input).unwrap();

        conn.execute(
            "INSERT INTO account_history (account_id, field_name, old_value, new_value) VALUES (?1, ?2, ?3, ?4)",
            params![account.id, "password", "password123", "newpassword"],
        ).unwrap();

        let history = get_account_history(&conn, account.id).unwrap();
        assert_eq!(history.len(), 1);
    }

    #[test]
    fn test_unique_email_constraint() {
        let conn = setup_test_db();
        let input = AccountInput {
            email: "test@example.com".to_string(),
            password: "password123".to_string(),
            recovery: None,
            phone: None,
            secret: None,
            sms_url: None,
            reg_year: None,
            country: None,
            group_name: None,
            remark: None,
        };
        create_account(&conn, &input).unwrap();
        let result = create_account(&conn, &input);
        assert!(result.is_err());
    }

    /// 生成全量测试数据（覆盖所有字段组合）
    fn generate_test_accounts() -> Vec<AccountInput> {
        vec![
            AccountInput {
                email: "alice@gmail.com".into(),
                password: "p0ss1899".into(),
                recovery: Some("recovery_alice@gmail.com".into()),
                phone: None,
                secret: Some("JBSWY3DPEHPK3PXP".into()),
                sms_url: None,
                reg_year: None,
                country: None,
                group_name: None,
                remark: Some("备注A".into()),
            },
            AccountInput {
                email: "bob@gmail.com".into(),
                password: "b0bp@ss".into(),
                recovery: Some("recovery_bob@gmail.com".into()),
                phone: None,
                secret: Some("MFZWQ5DJNZTSA3TP".into()),
                sms_url: None,
                reg_year: Some("2021".into()),
                country: Some("India".into()),
                group_name: None,
                remark: None,
            },
            AccountInput {
                email: "charlie@gmail.com".into(),
                password: "ch@r1ie99".into(),
                recovery: Some("rec_charlie@gmail.com".into()),
                phone: Some("13812345678".into()),
                secret: Some("GEZDGNBVGY3TQOJQ".into()),
                sms_url: None,
                reg_year: None,
                country: None,
                group_name: None,
                remark: None,
            },
            AccountInput {
                email: "david@gmail.com".into(),
                password: "d@v1d890".into(),
                recovery: Some("rec_david@gmail.com".into()),
                phone: Some("+8615900001111".into()),
                secret: Some("KBAFEWSYJBCFQ3DP".into()),
                sms_url: None,
                reg_year: None,
                country: None,
                group_name: None,
                remark: None,
            },
            AccountInput {
                email: "echo@gmail.com".into(),
                password: "ech0p@ss".into(),
                recovery: Some("rec_echo@gmail.com".into()),
                phone: None,
                secret: Some("JBSWY3DPEHPK3PXP".into()),
                sms_url: None,
                reg_year: None,
                country: None,
                group_name: None,
                remark: None,
            },
            AccountInput {
                email: "frank@gmail.com".into(),
                password: "fr@nk890".into(),
                recovery: Some("rec_frank@gmail.com".into()),
                phone: None,
                secret: None,
                sms_url: None,
                reg_year: None,
                country: None,
                group_name: Some("主号".into()),
                remark: Some("VIP".into()),
            },
            AccountInput {
                email: "grace@gmail.com".into(),
                password: "gr@ce901".into(),
                recovery: None,
                phone: None,
                secret: None,
                sms_url: None,
                reg_year: Some("2020".into()),
                country: Some("China".into()),
                group_name: None,
                remark: None,
            },
            AccountInput {
                email: "min1@gmail.com".into(),
                password: "m1np@ss01".into(),
                recovery: None,
                phone: None,
                secret: None,
                sms_url: None,
                reg_year: None,
                country: None,
                group_name: None,
                remark: None,
            },
        ]
    }

    #[test]
    fn test_batch_import_from_zero() {
        let conn = setup_test_db();
        let accounts = generate_test_accounts();
        let total = accounts.len() as i32;

        let (success, failed) = batch_import(&conn, &accounts).unwrap();
        assert_eq!(success, total);
        assert_eq!(failed, 0);

        // 验证数据库中的数量
        let all = query_accounts(&conn, None).unwrap();
        assert_eq!(all.len(), total as usize);

        // 逐条验证邮箱存在
        for input in &accounts {
            let found = all.iter().find(|a| a.email == input.email);
            assert!(found.is_some(), "未找到账号: {}", input.email);
        }
    }

    #[test]
    fn test_batch_import_fields_correct() {
        let conn = setup_test_db();
        let accounts = generate_test_accounts();
        batch_import(&conn, &accounts).unwrap();

        let all = query_accounts(&conn, None).unwrap();

        // 验证 bob 的年份和国家
        let bob = all.iter().find(|a| a.email == "bob@gmail.com").unwrap();
        assert_eq!(bob.reg_year.as_deref(), Some("2021"));
        assert_eq!(bob.country.as_deref(), Some("India"));

        // 验证 charlie 的手机号
        let charlie = all.iter().find(|a| a.email == "charlie@gmail.com").unwrap();
        assert_eq!(charlie.phone.as_deref(), Some("13812345678"));

        // 验证 frank 的分组和备注
        let frank = all.iter().find(|a| a.email == "frank@gmail.com").unwrap();
        assert_eq!(frank.group_name.as_deref(), Some("主号"));
        assert_eq!(frank.remark.as_deref(), Some("VIP"));

        // 验证 grace 的年份和国家
        let grace = all.iter().find(|a| a.email == "grace@gmail.com").unwrap();
        assert_eq!(grace.reg_year.as_deref(), Some("2020"));
        assert_eq!(grace.country.as_deref(), Some("China"));

        // 验证 min1 的可选字段为 None
        let min1 = all.iter().find(|a| a.email == "min1@gmail.com").unwrap();
        assert!(min1.recovery.is_none() || min1.recovery.as_deref() == Some(""));
        assert!(min1.secret.is_none() || min1.secret.as_deref() == Some(""));

        // 验证所有账号默认状态
        for acc in &all {
            assert_eq!(acc.status, "inactive");
            assert_eq!(acc.sold_status, "unsold");
        }
    }

    #[test]
    fn test_delete_all_then_reimport() {
        let conn = setup_test_db();
        let accounts = generate_test_accounts();
        let total = accounts.len() as i32;

        // 第一次导入
        batch_import(&conn, &accounts).unwrap();
        let count1 = query_accounts(&conn, None).unwrap().len();
        assert_eq!(count1, total as usize);

        // 清空
        let deleted = delete_all_accounts(&conn).unwrap();
        assert_eq!(deleted, total as usize);
        let count_after_delete = query_accounts(&conn, None).unwrap().len();
        assert_eq!(count_after_delete, 0);

        // 第二次导入
        let (success2, failed2) = batch_import(&conn, &accounts).unwrap();
        assert_eq!(success2, total);
        assert_eq!(failed2, 0);
        let count2 = query_accounts(&conn, None).unwrap().len();
        assert_eq!(count2, total as usize);
    }

    #[test]
    fn test_idempotent_clear_and_import_3_rounds() {
        let conn = setup_test_db();
        let accounts = generate_test_accounts();
        let total = accounts.len() as i32;

        for round in 1..=3 {
            // 清空（第一轮可能为空）
            delete_all_accounts(&conn).unwrap();
            let empty = query_accounts(&conn, None).unwrap();
            assert_eq!(empty.len(), 0, "第 {} 轮清空后不为空", round);

            // 导入
            let (success, failed) = batch_import(&conn, &accounts).unwrap();
            assert_eq!(success, total, "第 {} 轮导入成功数不一致", round);
            assert_eq!(failed, 0, "第 {} 轮有失败记录", round);

            // 验证
            let all = query_accounts(&conn, None).unwrap();
            assert_eq!(all.len(), total as usize, "第 {} 轮查询数量不一致", round);

            // 逐条验证邮箱
            for input in &accounts {
                let found = all.iter().find(|a| a.email == input.email);
                assert!(found.is_some(), "第 {} 轮未找到: {}", round, input.email);
            }
        }
    }

    #[test]
    fn test_batch_import_duplicate_email_fails_gracefully() {
        let conn = setup_test_db();
        let accounts = generate_test_accounts();
        batch_import(&conn, &accounts).unwrap();

        // 再次导入相同数据，应该全部失败（email UNIQUE 约束）
        let (success, failed) = batch_import(&conn, &accounts).unwrap();
        assert_eq!(success, 0);
        assert_eq!(failed, accounts.len() as i32);

        // 原数据不受影响
        let all = query_accounts(&conn, None).unwrap();
        assert_eq!(all.len(), accounts.len());
    }

    #[test]
    fn test_batch_import_secret_encryption() {
        let conn = setup_test_db();
        let accounts = vec![AccountInput {
            email: "secret_test@gmail.com".into(),
            password: "p@ss123".into(),
            recovery: None,
            phone: None,
            secret: Some("JBSWY3DPEHPK3PXP".into()),
            sms_url: None,
            reg_year: None,
            country: None,
            group_name: None,
            remark: None,
        }];
        batch_import(&conn, &accounts).unwrap();

        // 通过 map_row_to_account 查询
        let all = query_accounts(&conn, None).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].secret.as_deref(), Some("JBSWY3DPEHPK3PXP"));

        // 自用版：直接查数据库，secret 应为明文原值
        let raw: String = conn
            .query_row(
                "SELECT secret FROM accounts WHERE email = 'secret_test@gmail.com'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(raw, "JBSWY3DPEHPK3PXP", "自用版 secret 应以明文存储");
    }

    #[test]
    fn test_plaintext_password_roundtrip() {
        let conn = setup_test_db();
        let input = AccountInput {
            email: "plain_pwd@example.com".to_string(),
            password: "MyPlainPass123".to_string(),
            recovery: None,
            phone: None,
            secret: Some("JBSWY3DPEHPK3PXP".to_string()),
            sms_url: None,
            reg_year: None,
            country: None,
            group_name: None,
            remark: None,
        };
        create_account(&conn, &input).unwrap();

        // 直接读库：password 与 secret 均为明文
        let (raw_pwd, raw_secret): (String, String) = conn
            .query_row(
                "SELECT password, secret FROM accounts WHERE email = 'plain_pwd@example.com'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(raw_pwd, "MyPlainPass123");
        assert_eq!(raw_secret, "JBSWY3DPEHPK3PXP");

        // 读回也一致
        let fetched = query_accounts(&conn, None).unwrap();
        assert_eq!(fetched[0].password, "MyPlainPass123");
        assert_eq!(fetched[0].secret.as_deref(), Some("JBSWY3DPEHPK3PXP"));
    }

    #[test]
    fn test_sms_url_roundtrip_and_clear() {
        let conn = setup_test_db();
        let sms_url = "https://sms6688.com/api/sms/recordText?token=abc123&tpl=1";
        let input = AccountInput {
            email: "sms_url@example.com".to_string(),
            password: "password123".to_string(),
            recovery: None,
            phone: Some("+12025550123".to_string()),
            secret: None,
            sms_url: Some(sms_url.to_string()),
            reg_year: None,
            country: None,
            group_name: None,
            remark: None,
        };

        let created = create_account(&conn, &input).unwrap();
        assert_eq!(created.sms_url.as_deref(), Some(sms_url));

        // 查询要完整保留查询参数（token、tpl 不能丢）
        let fetched = query_accounts(&conn, None).unwrap();
        let row = fetched
            .iter()
            .find(|account| account.email == "sms_url@example.com")
            .expect("账号应存在");
        assert_eq!(row.sms_url.as_deref(), Some(sms_url));

        // 修改其他字段时不应丢失接码地址
        let updated = update_account(
            &conn,
            created.id,
            &AccountInput {
                remark: Some("只改了备注".to_string()),
                ..input.clone()
            },
        )
        .unwrap();
        assert_eq!(updated.remark.as_deref(), Some("只改了备注"));
        assert_eq!(updated.sms_url.as_deref(), Some(sms_url));

        // 主动清空接码地址（空串应归一化为 NULL）
        let cleared = update_account(
            &conn,
            created.id,
            &AccountInput {
                sms_url: Some("   ".to_string()),
                ..input.clone()
            },
        )
        .unwrap();
        assert!(cleared.sms_url.is_none());
    }

    #[test]
    fn test_legacy_plaintext_password_is_readable() {
        // 回归：旧版用无 v2: 前缀的明文写的行，现在必须能正常读出
        let conn = setup_test_db();
        conn.execute(
            "INSERT INTO accounts (email, password, status, sold_status) VALUES (?1, ?2, ?3, ?4)",
            params![
                "legacy_pwd@example.com",
                "plain-password",
                "inactive",
                "unsold"
            ],
        )
        .unwrap();

        let all = query_accounts(&conn, None).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].password, "plain-password");
    }

    #[test]
    fn test_query_accounts() {
        let conn = setup_test_db();
        let input1 = AccountInput {
            email: "alice@example.com".to_string(),
            password: "pwd1".to_string(),
            recovery: None,
            phone: None,
            secret: None,
            sms_url: None,
            reg_year: None,
            country: None,
            group_name: None,
            remark: Some("target remark".to_string()),
        };
        let input2 = AccountInput {
            email: "bob@example.com".to_string(),
            password: "pwd2".to_string(),
            recovery: None,
            phone: None,
            secret: None,
            sms_url: None,
            reg_year: None,
            country: None,
            group_name: None,
            remark: Some("other".to_string()),
        };
        create_account(&conn, &input1).unwrap();
        create_account(&conn, &input2).unwrap();

        // 全量查询
        let all = query_accounts(&conn, None).unwrap();
        assert_eq!(all.len(), 2);

        // 搜索
        let found = query_accounts(&conn, Some("alice")).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].email, "alice@example.com");
    }

    fn count(conn: &Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |row| row.get(0)).unwrap()
    }

    fn open_temp_db(dir: &Path) -> Connection {
        init_database_at(&dir.join("data.db"), &dir.join("backups")).unwrap()
    }

    fn sample_input(email: &str) -> AccountInput {
        AccountInput {
            email: email.to_string(),
            password: "pw".to_string(),
            recovery: None,
            phone: None,
            secret: None,
            sms_url: None,
            reg_year: None,
            country: None,
            group_name: None,
            remark: None,
        }
    }

    #[test]
    fn test_restore_from_file_roundtrip_and_repeatable() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = open_temp_db(tmp.path());
        let kept = create_account(&conn, &sample_input("kept@example.com")).unwrap();
        update_account(
            &conn,
            kept.id,
            &AccountInput {
                remark: Some("备注".to_string()),
                ..sample_input("kept@example.com")
            },
        )
        .unwrap();
        let backup = create_backup_in(&conn, &tmp.path().join("backups"), Some("manual")).unwrap();

        create_account(&conn, &sample_input("later@example.com")).unwrap();
        delete_account(&conn, kept.id).unwrap();

        // 第一次恢复：回到备份时的状态（含历史记录）
        restore_from_file(&conn, &backup).unwrap();
        let accounts = query_accounts(&conn, None).unwrap();
        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].email, "kept@example.com");
        assert_eq!(accounts[0].remark.as_deref(), Some("备注"));
        assert_eq!(get_account_history(&conn, kept.id).unwrap().len(), 1);

        // 第二次恢复必须同样成功（备份库已正确卸载，不会报 already in use）
        create_account(&conn, &sample_input("again@example.com")).unwrap();
        restore_from_file(&conn, &backup).unwrap();
        assert_eq!(query_accounts(&conn, None).unwrap().len(), 1);
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM pragma_database_list WHERE name = 'backup_db'"
            ),
            0
        );
    }

    #[test]
    fn test_restore_fills_missing_columns_and_skips_orphan_history() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = open_temp_db(tmp.path());
        create_account(&conn, &sample_input("current@example.com")).unwrap();

        let legacy = tmp.path().join("legacy.db");
        {
            let old = Connection::open(&legacy).unwrap();
            old.execute_batch(
                "CREATE TABLE accounts (id INTEGER PRIMARY KEY, email TEXT, password TEXT);
                 INSERT INTO accounts VALUES (7, 'old@example.com', 'pw');
                 CREATE TABLE account_history (id INTEGER PRIMARY KEY, account_id INTEGER, field_name TEXT,
                     old_value TEXT, new_value TEXT, changed_at TEXT);
                 INSERT INTO account_history VALUES (1, 7, 'remark', 'a', 'b', '2026-01-01 00:00:00');
                 INSERT INTO account_history VALUES (2, 99, 'remark', 'a', 'b', '2026-01-01 00:00:00');",
            )
            .unwrap();
        }

        restore_from_file(&conn, &legacy).unwrap();
        let restored = get_account_by_id(&conn, 7).unwrap();
        assert_eq!(restored.email, "old@example.com");
        assert_eq!(restored.status, "inactive");
        assert!(restored.sms_url.is_none());
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM account_history"), 1);
    }

    #[test]
    fn test_restore_rejects_invalid_backup_without_touching_data() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = open_temp_db(tmp.path());
        create_account(&conn, &sample_input("current@example.com")).unwrap();

        let broken = tmp.path().join("broken.db");
        Connection::open(&broken)
            .unwrap()
            .execute_batch("CREATE TABLE accounts (id INTEGER PRIMARY KEY, email TEXT);")
            .unwrap();

        let err = restore_from_file(&conn, &broken).unwrap_err();
        assert!(err.contains("password"), "{}", err);
        assert_eq!(query_accounts(&conn, None).unwrap().len(), 1);

        // 失败后备份库也已卸载，之后仍可正常恢复
        let good = create_backup_in(&conn, &tmp.path().join("backups"), None).unwrap();
        restore_from_file(&conn, &good).unwrap();
    }

    fn write_legacy_unique_db(path: &Path) {
        let old = Connection::open(path).unwrap();
        old.execute_batch(
            "CREATE TABLE accounts (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 email TEXT UNIQUE NOT NULL,
                 password TEXT NOT NULL,
                 recovery TEXT,
                 secret TEXT,
                 remark TEXT
             );
             CREATE TABLE account_history (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 account_id INTEGER NOT NULL,
                 field_name TEXT NOT NULL,
                 old_value TEXT,
                 new_value TEXT,
                 changed_at TEXT DEFAULT CURRENT_TIMESTAMP,
                 FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
             );
             INSERT INTO accounts (email, password, remark) VALUES ('x@example.com', 'pw', 'r');
             INSERT INTO account_history (account_id, field_name, old_value, new_value) VALUES (1, 'remark', NULL, 'r');",
        )
        .unwrap();
    }

    #[test]
    fn test_legacy_unique_migration_survives_restarts() {
        let tmp = tempfile::tempdir().unwrap();
        write_legacy_unique_db(&tmp.path().join("data.db"));

        for _ in 0..3 {
            let conn = open_temp_db(tmp.path());
            let schema: String = conn
                .query_row(
                    "SELECT sql FROM sqlite_master WHERE name = 'accounts'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert!(!schema.to_lowercase().contains("email text unique"));
            assert_eq!(
                count(
                    &conn,
                    "SELECT COUNT(*) FROM sqlite_master WHERE name = 'accounts_new'"
                ),
                0
            );
            assert_eq!(count(&conn, "SELECT COUNT(*) FROM accounts"), 1);
            assert_eq!(count(&conn, "SELECT COUNT(*) FROM account_history"), 1);
        }

        // 迁移后：软删除再导入同一邮箱不再冲突，默认值也已补齐
        let conn = open_temp_db(tmp.path());
        let migrated = get_account_by_id(&conn, 1).unwrap();
        assert_eq!(migrated.status, "inactive");
        assert_eq!(migrated.remark.as_deref(), Some("r"));
        delete_account(&conn, 1).unwrap();
        create_account(&conn, &sample_input("x@example.com")).unwrap();
        assert!(create_account(&conn, &sample_input("x@example.com")).is_err());
    }

    #[test]
    fn test_legacy_migration_cleans_leftover_accounts_new() {
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("data.db");
        write_legacy_unique_db(&db_path);
        // 模拟旧版迁移留下的半成品：只复制了数据，没有删旧表、没有改名
        Connection::open(&db_path)
            .unwrap()
            .execute_batch(&format!(
                "{}; INSERT INTO accounts_new (id, email, password) SELECT id, email, password FROM accounts;",
                accounts_table_sql("accounts_new")
            ))
            .unwrap();

        let conn = open_temp_db(tmp.path());
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM sqlite_master WHERE name = 'accounts_new'"
            ),
            0
        );
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM accounts"), 1);
        let foreign_keys: i64 = count(&conn, "PRAGMA foreign_keys");
        assert_eq!(foreign_keys, 1);
    }

    #[test]
    fn test_cleanup_keeps_protective_backups() {
        let tmp = tempfile::tempdir().unwrap();
        let base = std::time::SystemTime::now() - std::time::Duration::from_secs(10_000);
        let touch = |name: &str, age_secs: u64| {
            let path = tmp.path().join(name);
            let file = fs::File::create(&path).unwrap();
            file.set_modified(base + std::time::Duration::from_secs(age_secs))
                .unwrap();
            fs::write(path.with_extension("json"), b"{}").unwrap();
        };
        // 保护性备份最旧，例行备份更新且数量超过上限
        touch("data_1_before_delete_all_1.db", 0);
        touch("data_2_before_migration_2.db", 1);
        for i in 0..(KEEP_STARTUP_BACKUPS + 5) {
            touch(&format!("data_s{}_startup_{}.db", i, i), 100 + i as u64);
        }

        cleanup_old_backups(tmp.path()).unwrap();

        assert!(tmp.path().join("data_1_before_delete_all_1.db").exists());
        assert!(tmp.path().join("data_2_before_migration_2.db").exists());
        let startup_left = fs::read_dir(tmp.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                is_startup_backup(&e.path())
                    && e.path().extension().map(|x| x == "db").unwrap_or(false)
            })
            .count();
        assert_eq!(startup_left, KEEP_STARTUP_BACKUPS);
        // 最旧的例行备份连同清单一起被删除，最新的保留
        assert!(!tmp.path().join("data_s0_startup_0.db").exists());
        assert!(!tmp.path().join("data_s0_startup_0.json").exists());
        assert!(tmp
            .path()
            .join(format!(
                "data_s{0}_startup_{0}.db",
                KEEP_STARTUP_BACKUPS + 4
            ))
            .exists());
    }

    #[test]
    fn test_group_label_supports_chinese_field_label() {
        let label = render_group_label(
            "{groupFieldLabel}={groupValue}",
            ExportField::Country,
            "US",
            1,
            1,
        );
        assert_eq!(label, "国家=US");
    }

    #[test]
    fn test_utc_timestamp_converts_to_target_timezone() {
        let beijing = chrono::FixedOffset::east_opt(8 * 3600).unwrap();
        assert_eq!(
            utc_timestamp_to_tz("2026-01-01 16:30:00", &beijing),
            "2026-01-02 00:30:00"
        );
        assert_eq!(utc_timestamp_to_tz("not a time", &beijing), "not a time");
        assert_eq!(utc_timestamp_to_tz("", &beijing), "");
    }
}
