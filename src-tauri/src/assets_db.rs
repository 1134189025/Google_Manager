use chrono::{Datelike, Local, NaiveDate};
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// 新增扩展表初始化（幂等，在 PRAGMA foreign_keys = ON 之后调用）
pub fn init_asset_tables(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS vault_folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            sort_order INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS vault_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL DEFAULT 'account',
            name TEXT NOT NULL,
            url TEXT,
            username TEXT,
            secret_value TEXT,
            totp_secret TEXT,
            folder_id INTEGER REFERENCES vault_folders(id) ON DELETE SET NULL,
            google_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
            tags TEXT,
            notes TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS payment_cards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            issuer TEXT,
            bank_code TEXT,
            network TEXT,
            funding TEXT,
            form_factor TEXT,
            region TEXT,
            region_group TEXT DEFAULT 'unknown',
            last4 TEXT,
            expiry_month TEXT,
            card_number TEXT,
            cvv TEXT,
            cardholder TEXT,
            billing_address TEXT,
            billing_amount REAL,
            billing_currency TEXT DEFAULT 'USD',
            billing_cycle TEXT DEFAULT 'year',
            expires_at TEXT,
            tags TEXT,
            notes TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS ai_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            provider TEXT NOT NULL,
            plan TEXT,
            account_email TEXT,
            key_hint TEXT,
            billing_amount REAL,
            billing_currency TEXT DEFAULT 'USD',
            billing_cycle TEXT DEFAULT 'month',
            renews_at TEXT,
            google_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
            payment_card_id INTEGER REFERENCES payment_cards(id) ON DELETE SET NULL,
            oauth_provider TEXT,
            oauth_account_id TEXT,
            oauth_token_json TEXT,
            usage_json TEXT,
            usage_checked_at TEXT,
            usage_error TEXT,
            tags TEXT,
            notes TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS servers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            host TEXT NOT NULL,
            port INTEGER NOT NULL DEFAULT 22,
            username TEXT NOT NULL DEFAULT 'root',
            auth_kind TEXT NOT NULL DEFAULT 'password',
            credential TEXT,
            passphrase TEXT,
            region TEXT,
            os TEXT,
            kernel TEXT,
            collect_enabled INTEGER NOT NULL DEFAULT 1,
            billing_amount REAL,
            billing_currency TEXT DEFAULT 'USD',
            billing_cycle TEXT DEFAULT 'month',
            expires_at TEXT,
            status TEXT NOT NULL DEFAULT 'unknown',
            cpu REAL,
            memory REAL,
            disk REAL,
            mem_total_kb INTEGER,
            disk_total_kb INTEGER,
            loadavg TEXT,
            uptime TEXT,
            services_json TEXT,
            host_fingerprint TEXT,
            probed_at TEXT,
            probe_error TEXT,
            tags TEXT,
            notes TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS cloudflare_connections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            api_token TEXT NOT NULL,
            account_summary TEXT,
            last_synced_at TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS domains (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            registrar TEXT,
            nameservers_json TEXT,
            statuses_json TEXT,
            auto_renew INTEGER NOT NULL DEFAULT 0,
            billing_amount REAL,
            billing_currency TEXT DEFAULT 'USD',
            billing_cycle TEXT DEFAULT 'year',
            expires_at TEXT,
            cf_connection_id INTEGER REFERENCES cloudflare_connections(id) ON DELETE SET NULL,
            cf_zone_id TEXT,
            server_id INTEGER REFERENCES servers(id) ON DELETE SET NULL,
            probed_at TEXT,
            probe_error TEXT,
            tags TEXT,
            notes TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS reminders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            note TEXT,
            due_at TEXT NOT NULL,
            repeat TEXT NOT NULL DEFAULT 'none',
            lead_days INTEGER NOT NULL DEFAULT 3,
            done INTEGER NOT NULL DEFAULT 0,
            done_at TEXT,
            ref_kind TEXT,
            ref_id INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS agent_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL DEFAULT 'default',
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            proposals_json TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_vault_items_folder ON vault_items(folder_id);
        CREATE INDEX IF NOT EXISTS idx_vault_items_google ON vault_items(google_account_id);
        CREATE INDEX IF NOT EXISTS idx_ai_subscriptions_google ON ai_subscriptions(google_account_id);
        CREATE INDEX IF NOT EXISTS idx_ai_subscriptions_card ON ai_subscriptions(payment_card_id);
        CREATE INDEX IF NOT EXISTS idx_domains_cf ON domains(cf_connection_id);
        CREATE INDEX IF NOT EXISTS idx_domains_server ON domains(server_id);
        CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(done, due_at);
        CREATE INDEX IF NOT EXISTS idx_agent_messages_session ON agent_messages(session_id, id);
        ",
    )
}

/// 所有扩展表定义（按外键依赖拓扑序排列，删除时倒序，恢复时正序）
const ASSET_TABLE_NAMES: &[&str] = &[
    "vault_folders",
    "vault_items",
    "payment_cards",
    "ai_subscriptions",
    "servers",
    "cloudflare_connections",
    "domains",
    "reminders",
    "agent_messages",
];

fn table_columns(conn: &Connection, schema: &str, table: &str) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA {}.table_info({})", schema, table))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?;
    let mut cols = Vec::new();
    for row in rows {
        cols.push(row.map_err(|e| e.to_string())?);
    }
    Ok(cols)
}

fn backup_has_table(conn: &Connection, table: &str) -> Result<bool, String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(1) FROM backup_db.sqlite_master WHERE type='table' AND name=?1",
            [table],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(count > 0)
}

/// 在 restore 事务内同步恢复所有扩展表（兼容缺少这些表的老版本备份）
pub fn restore_asset_tables_in_tx(
    tx: &rusqlite::Transaction<'_>,
    conn: &Connection,
) -> Result<(), String> {
    for table in ASSET_TABLE_NAMES.iter().rev() {
        tx.execute(&format!("DELETE FROM main.{}", table), [])
            .map_err(|e| format!("清空主库 {} 失败: {}", table, e))?;
    }

    for table in ASSET_TABLE_NAMES {
        if !backup_has_table(conn, table)? {
            continue;
        }
        let main_cols = table_columns(conn, "main", table)?;
        let backup_cols: HashSet<String> = table_columns(conn, "backup_db", table)?
            .into_iter()
            .map(|c| c.to_lowercase())
            .collect();

        let common: Vec<String> = main_cols
            .into_iter()
            .filter(|col| backup_cols.contains(&col.to_lowercase()))
            .collect();

        if common.is_empty() {
            continue;
        }
        let cols_sql = common.join(", ");
        let sql = format!(
            "INSERT INTO main.{table} ({cols}) SELECT {cols} FROM backup_db.{table}",
            table = table,
            cols = cols_sql
        );
        tx.execute_batch(&sql)
            .map_err(|e| format!("恢复 {} 失败: {}", table, e))?;
    }

    Ok(())
}

// ─── 通用工具 ──────────────────────────────────────────────────────

pub fn normalize_optional(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(|v| v.to_string())
}

pub fn normalize_currency(value: Option<&str>, default: &str) -> String {
    match value.map(|s| s.trim().to_ascii_uppercase()).as_deref() {
        Some("CNY") => "CNY".to_string(),
        Some("USD") => "USD".to_string(),
        _ => default.to_string(),
    }
}

pub fn normalize_cycle(value: Option<&str>, default: &str) -> String {
    match value.map(|s| s.trim().to_ascii_lowercase()).as_deref() {
        Some("month") => "month".to_string(),
        Some("year") => "year".to_string(),
        Some("once") => "once".to_string(),
        _ => default.to_string(),
    }
}

pub fn validate_calendar_day(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("日期不能为空".to_string());
    }
    if trimmed.len() != 10 {
        return Err(format!(
            "日期格式必须为 4 位年份 YYYY-MM-DD（1970-2099）：{}",
            trimmed
        ));
    }
    let parsed = NaiveDate::parse_from_str(trimmed, "%Y-%m-%d")
        .map_err(|_| format!("日期格式必须为 YYYY-MM-DD：{}", trimmed))?;
    if !(1970..=2099).contains(&parsed.year()) {
        return Err(format!(
            "年份必须在 1970 到 2099 之间：{}",
            trimmed
        ));
    }
    Ok(parsed.format("%Y-%m-%d").to_string())
}

pub fn normalize_optional_day(value: Option<&str>) -> Result<Option<String>, String> {
    match normalize_optional(value) {
        Some(day) => validate_calendar_day(&day).map(Some),
        None => Ok(None),
    }
}

pub fn today_local() -> NaiveDate {
    Local::now().date_naive()
}

pub fn shift_day(day: &str, repeat: &str) -> Result<String, String> {
    let date = NaiveDate::parse_from_str(day.trim(), "%Y-%m-%d")
        .map_err(|_| format!("无效日期：{}", day))?;
    let shifted = match repeat {
        "week" => date + chrono::Duration::days(7),
        "month" => add_months_clamped(date, 1),
        "year" => add_months_clamped(date, 12),
        _ => date,
    };
    Ok(shifted.format("%Y-%m-%d").to_string())
}

fn add_months_clamped(date: NaiveDate, months: i32) -> NaiveDate {
    let total_months = date.year() * 12 + (date.month0() as i32) + months;
    let ny = total_months.div_euclid(12);
    let nm0 = total_months.rem_euclid(12) as u32;
    let nm = nm0 + 1;
    let max_day = days_in_month(ny, nm);
    let nd = date.day().min(max_day);
    NaiveDate::from_ymd_opt(ny, nm, nd).unwrap_or(date)
}

fn days_in_month(year: i32, month: u32) -> u32 {
    let (ny, nm) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    NaiveDate::from_ymd_opt(ny, nm, 1)
        .and_then(|d| d.pred_opt())
        .map(|d| d.day())
        .unwrap_or(28)
}

pub fn days_until(day: &str, today: NaiveDate) -> Option<i64> {
    let parsed = NaiveDate::parse_from_str(day.trim(), "%Y-%m-%d").ok()?;
    Some((parsed - today).num_days())
}

// ─── 备忘提醒 (reminders) ──────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Reminder {
    pub id: i64,
    pub title: String,
    pub note: Option<String>,
    pub due_at: String,
    pub repeat: String,
    pub lead_days: i64,
    pub done: bool,
    pub done_at: Option<String>,
    pub ref_kind: Option<String>,
    pub ref_id: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReminderInput {
    pub title: String,
    #[serde(default)]
    pub note: Option<String>,
    pub due_at: String,
    #[serde(default)]
    pub repeat: Option<String>,
    #[serde(default)]
    pub lead_days: Option<i64>,
    #[serde(default)]
    pub ref_kind: Option<String>,
    #[serde(default)]
    pub ref_id: Option<i64>,
}

fn map_reminder(row: &Row) -> rusqlite::Result<Reminder> {
    let done_int: i64 = row.get("done")?;
    Ok(Reminder {
        id: row.get("id")?,
        title: row.get("title")?,
        note: row.get("note")?,
        due_at: row.get("due_at")?,
        repeat: row.get("repeat")?,
        lead_days: row.get("lead_days")?,
        done: done_int != 0,
        done_at: row.get("done_at")?,
        ref_kind: row.get("ref_kind")?,
        ref_id: row.get("ref_id")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn validate_reminder_input(input: &ReminderInput) -> Result<(String, Option<String>, String, String, i64), String> {
    let title = input.title.trim();
    if title.is_empty() || title.chars().count() > 80 {
        return Err("提醒标题不能为空且不能超过 80 个字符".to_string());
    }
    let note = normalize_optional(input.note.as_deref());
    if let Some(ref n) = note {
        if n.chars().count() > 1000 {
            return Err("提醒备注不能超过 1000 个字符".to_string());
        }
    }
    let due_at = validate_calendar_day(&input.due_at)?;
    let repeat = match input.repeat.as_deref().map(str::trim) {
        Some("week") => "week".to_string(),
        Some("month") => "month".to_string(),
        Some("year") => "year".to_string(),
        _ => "none".to_string(),
    };
    let lead_days = input.lead_days.unwrap_or(3);
    if !(0..=90).contains(&lead_days) {
        return Err("提前提醒天数必须在 0 到 90 之间".to_string());
    }
    Ok((title.to_string(), note, due_at, repeat, lead_days))
}

pub fn query_reminders(conn: &Connection) -> Result<Vec<Reminder>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, note, due_at, repeat, lead_days, done, done_at, ref_kind, ref_id, created_at, updated_at
             FROM reminders
             ORDER BY done ASC, due_at ASC, id DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], map_reminder)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn get_reminder_by_id(conn: &Connection, id: i64) -> Result<Reminder, String> {
    conn.query_row(
        "SELECT id, title, note, due_at, repeat, lead_days, done, done_at, ref_kind, ref_id, created_at, updated_at
         FROM reminders WHERE id = ?1",
        [id],
        map_reminder,
    )
    .map_err(|e| e.to_string())
}

pub fn create_reminder(conn: &Connection, input: &ReminderInput) -> Result<Reminder, String> {
    let (title, note, due_at, repeat, lead_days) = validate_reminder_input(input)?;
    conn.execute(
        "INSERT INTO reminders (title, note, due_at, repeat, lead_days, done, ref_kind, ref_id)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7)",
        params![
            title,
            note,
            due_at,
            repeat,
            lead_days,
            normalize_optional(input.ref_kind.as_deref()),
            input.ref_id
        ],
    )
    .map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    get_reminder_by_id(conn, id)
}

pub fn update_reminder(
    conn: &Connection,
    id: i64,
    input: &ReminderInput,
) -> Result<Reminder, String> {
    let (title, note, due_at, repeat, lead_days) = validate_reminder_input(input)?;
    let changed = conn
        .execute(
            "UPDATE reminders
             SET title = ?1, note = ?2, due_at = ?3, repeat = ?4, lead_days = ?5,
                 ref_kind = ?6, ref_id = ?7, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?8",
            params![
                title,
                note,
                due_at,
                repeat,
                lead_days,
                normalize_optional(input.ref_kind.as_deref()),
                input.ref_id,
                id
            ],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("提醒不存在".to_string());
    }
    get_reminder_by_id(conn, id)
}

pub fn delete_reminder(conn: &Connection, id: i64) -> Result<(), String> {
    let changed = conn
        .execute("DELETE FROM reminders WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("提醒不存在".to_string());
    }
    Ok(())
}

pub fn complete_reminder(conn: &Connection, id: i64, today: NaiveDate) -> Result<Reminder, String> {
    let item = get_reminder_by_id(conn, id)?;
    let today_str = today.format("%Y-%m-%d").to_string();
    if item.repeat == "none" {
        conn.execute(
            "UPDATE reminders SET done = 1, done_at = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
            params![today_str, id],
        )
        .map_err(|e| e.to_string())?;
    } else {
        let mut next = shift_day(&item.due_at, &item.repeat)?;
        for _ in 0..1000 {
            if next > today_str {
                break;
            }
            next = shift_day(&next, &item.repeat)?;
        }
        conn.execute(
            "UPDATE reminders SET due_at = ?1, done = 0, done_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
            params![next, id],
        )
        .map_err(|e| e.to_string())?;
    }
    get_reminder_by_id(conn, id)
}

// ─── 费用与续费聚合 ────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RenewalItem {
    pub kind: String,
    pub id: i64,
    pub name: String,
    pub subtitle: Option<String>,
    pub date: String,
    pub days: i64,
    pub billing_amount: Option<f64>,
    pub billing_currency: String,
    pub billing_cycle: String,
    pub fixed_expiry: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct SpendCurrencyTotals {
    pub monthly: f64,
    pub yearly: f64,
    pub once: f64,
    pub count: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SpendSummary {
    pub cny: SpendCurrencyTotals,
    pub usd: SpendCurrencyTotals,
    pub unpriced: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RenewalsSummary {
    pub timeline: Vec<RenewalItem>,
    pub spend: SpendSummary,
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

fn accumulate_spend(
    summary: &mut SpendSummary,
    amount: Option<f64>,
    currency: &str,
    cycle: &str,
) {
    let Some(amt) = amount.filter(|a| a.is_finite() && *a >= 0.0) else {
        summary.unpriced += 1;
        return;
    };
    let bucket = if currency == "CNY" {
        &mut summary.cny
    } else {
        &mut summary.usd
    };
    bucket.count += 1;
    match cycle {
        "month" => {
            bucket.monthly = round2(bucket.monthly + amt);
            bucket.yearly = round2(bucket.yearly + amt * 12.0);
        }
        "year" => {
            bucket.monthly = round2(bucket.monthly + amt / 12.0);
            bucket.yearly = round2(bucket.yearly + amt);
        }
        "once" => {
            bucket.once = round2(bucket.once + amt);
        }
        _ => {}
    }
}

pub fn get_renewals_summary(
    conn: &Connection,
    within_days: i64,
    today: NaiveDate,
) -> Result<RenewalsSummary, String> {
    let mut timeline: Vec<RenewalItem> = Vec::new();
    let mut spend = SpendSummary {
        cny: SpendCurrencyTotals::default(),
        usd: SpendCurrencyTotals::default(),
        unpriced: 0,
    };

    let push_if_window = |timeline: &mut Vec<RenewalItem>,
                          kind: &str,
                          id: i64,
                          name: String,
                          subtitle: Option<String>,
                          date_opt: Option<String>,
                          amount: Option<f64>,
                          currency: String,
                          cycle: String,
                          fixed_expiry: bool| {
        let Some(day) = date_opt.filter(|d| !d.trim().is_empty()) else {
            return;
        };
        let Some(days) = days_until(&day, today) else {
            return;
        };
        if days >= -30 && days <= within_days {
            timeline.push(RenewalItem {
                kind: kind.to_string(),
                id,
                name,
                subtitle,
                date: day,
                days,
                billing_amount: amount,
                billing_currency: currency,
                billing_cycle: cycle,
                fixed_expiry,
            });
        }
    };

    // 1. 服务器
    {
        let mut stmt = conn
            .prepare(
                "SELECT id, name, host, billing_amount, billing_currency, billing_cycle, expires_at FROM servers",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<f64>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for r in rows {
            let (id, name, host, amt, cur, cyc, exp) = r.map_err(|e| e.to_string())?;
            let currency = normalize_currency(cur.as_deref(), "USD");
            let cycle = normalize_cycle(cyc.as_deref(), "month");
            accumulate_spend(&mut spend, amt, &currency, &cycle);
            push_if_window(
                &mut timeline,
                "server",
                id,
                name,
                Some(host),
                exp,
                amt,
                currency,
                cycle,
                false,
            );
        }
    }

    // 2. 域名
    {
        let mut stmt = conn
            .prepare(
                "SELECT id, name, registrar, billing_amount, billing_currency, billing_cycle, expires_at FROM domains",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<f64>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for r in rows {
            let (id, name, registrar, amt, cur, cyc, exp) = r.map_err(|e| e.to_string())?;
            let currency = normalize_currency(cur.as_deref(), "USD");
            let cycle = normalize_cycle(cyc.as_deref(), "year");
            accumulate_spend(&mut spend, amt, &currency, &cycle);
            push_if_window(
                &mut timeline,
                "domain",
                id,
                name,
                registrar,
                exp,
                amt,
                currency,
                cycle,
                false,
            );
        }
    }

    // 3. AI 订阅
    {
        let mut stmt = conn
            .prepare(
                "SELECT id, name, provider, plan, billing_amount, billing_currency, billing_cycle, renews_at FROM ai_subscriptions",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<f64>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for r in rows {
            let (id, name, provider, plan, amt, cur, cyc, renews) = r.map_err(|e| e.to_string())?;
            let currency = normalize_currency(cur.as_deref(), "USD");
            let cycle = normalize_cycle(cyc.as_deref(), "month");
            accumulate_spend(&mut spend, amt, &currency, &cycle);
            let sub = match plan.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                Some(p) => Some(format!("{} · {}", provider, p)),
                None => Some(provider),
            };
            push_if_window(
                &mut timeline,
                "ai_subscription",
                id,
                name,
                sub,
                renews,
                amt,
                currency,
                cycle,
                false,
            );
        }
    }

    // 4. U 卡与支付卡
    {
        let mut stmt = conn
            .prepare(
                "SELECT id, name, issuer, last4, billing_amount, billing_currency, billing_cycle, expires_at FROM payment_cards",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<f64>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for r in rows {
            let (id, name, issuer, last4, amt, cur, cyc, exp) = r.map_err(|e| e.to_string())?;
            let currency = normalize_currency(cur.as_deref(), "USD");
            let cycle = normalize_cycle(cyc.as_deref(), "year");
            accumulate_spend(&mut spend, amt, &currency, &cycle);
            let sub = match (
                issuer.as_deref().map(str::trim).filter(|s| !s.is_empty()),
                last4.as_deref().map(str::trim).filter(|s| !s.is_empty()),
            ) {
                (Some(i), Some(l)) => Some(format!("{} · •••• {}", i, l)),
                (Some(i), None) => Some(i.to_string()),
                (None, Some(l)) => Some(format!("•••• {}", l)),
                _ => None,
            };
            push_if_window(
                &mut timeline,
                "payment_card",
                id,
                name,
                sub,
                exp,
                amt,
                currency,
                cycle,
                true,
            );
        }
    }

    timeline.sort_by(|a, b| a.date.cmp(&b.date).then_with(|| a.name.cmp(&b.name)));
    Ok(RenewalsSummary { timeline, spend })
}

pub fn advance_renewal(conn: &Connection, kind: &str, id: i64) -> Result<String, String> {
    let (table, col) = match kind {
        "server" => ("servers", "expires_at"),
        "domain" => ("domains", "expires_at"),
        "ai_subscription" => ("ai_subscriptions", "renews_at"),
        _ => return Err("不支持顺延该类型的到期日".to_string()),
    };

    let (current_date, cycle): (Option<String>, Option<String>) = conn
        .query_row(
            &format!(
                "SELECT {}, billing_cycle FROM {} WHERE id = ?1",
                col, table
            ),
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| "目标资产不存在".to_string())?;

    let date_str = current_date
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "该资产尚未设置到期或续费日期".to_string())?;

    let repeat = match cycle.as_deref().map(str::trim) {
        Some("month") => "month",
        Some("year") => "year",
        _ => return Err("一次性费用无法按周期顺延".to_string()),
    };

    let next = shift_day(&date_str, repeat)?;
    conn.execute(
        &format!(
            "UPDATE {} SET {} = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
            table, col
        ),
        params![next, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(next)
}

// ─── 全局首页概览 ──────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspaceOverview {
    pub google_accounts_count: usize,
    pub vault_items_count: usize,
    pub payment_cards_count: usize,
    pub ai_subscriptions_count: usize,
    pub servers_count: usize,
    pub servers_online_count: usize,
    pub domains_count: usize,
    pub pending_reminders_count: usize,
    pub upcoming_renewals: Vec<RenewalItem>,
    pub due_reminders: Vec<Reminder>,
    pub spend: SpendSummary,
}

fn count_table(conn: &Connection, sql: &str) -> Result<usize, String> {
    conn.query_row(sql, [], |row| row.get::<_, i64>(0))
        .map(|v| v.max(0) as usize)
        .map_err(|e| e.to_string())
}

pub fn get_workspace_overview(
    conn: &Connection,
    today: NaiveDate,
) -> Result<WorkspaceOverview, String> {
    let google_accounts_count = count_table(
        conn,
        "SELECT COUNT(*) FROM accounts WHERE deleted_at IS NULL",
    )?;
    let vault_items_count = count_table(conn, "SELECT COUNT(*) FROM vault_items")?;
    let payment_cards_count = count_table(conn, "SELECT COUNT(*) FROM payment_cards")?;
    let ai_subscriptions_count = count_table(conn, "SELECT COUNT(*) FROM ai_subscriptions")?;
    let servers_count = count_table(conn, "SELECT COUNT(*) FROM servers")?;
    let servers_online_count = count_table(
        conn,
        "SELECT COUNT(*) FROM servers WHERE status = 'online'",
    )?;
    let domains_count = count_table(conn, "SELECT COUNT(*) FROM domains")?;
    let pending_reminders_count =
        count_table(conn, "SELECT COUNT(*) FROM reminders WHERE done = 0")?;

    let renewals = get_renewals_summary(conn, 90, today)?;
    let reminders = query_reminders(conn)?;
    let due_reminders: Vec<Reminder> = reminders
        .into_iter()
        .filter(|r| !r.done)
        .filter(|r| {
            days_until(&r.due_at, today)
                .map(|d| d <= r.lead_days.max(30))
                .unwrap_or(false)
        })
        .take(6)
        .collect();

    Ok(WorkspaceOverview {
        google_accounts_count,
        vault_items_count,
        payment_cards_count,
        ai_subscriptions_count,
        servers_count,
        servers_online_count,
        domains_count,
        pending_reminders_count,
        upcoming_renewals: renewals.timeline.into_iter().take(6).collect(),
        due_reminders,
        spend: renewals.spend,
    })
}

// ─── 账号与密钥库 (vault_folders / vault_items) ──────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VaultFolder {
    pub id: i64,
    pub name: String,
    pub sort_order: i64,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VaultFolderInput {
    pub name: String,
    #[serde(default)]
    pub sort_order: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VaultItem {
    pub id: i64,
    pub kind: String,
    pub name: String,
    pub url: Option<String>,
    pub username: Option<String>,
    pub secret_value: Option<String>,
    pub totp_secret: Option<String>,
    pub folder_id: Option<i64>,
    pub google_account_id: Option<i64>,
    pub google_account_email: Option<String>,
    pub tags: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VaultItemInput {
    #[serde(default)]
    pub kind: Option<String>,
    pub name: String,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub secret_value: Option<String>,
    #[serde(default)]
    pub totp_secret: Option<String>,
    #[serde(default)]
    pub folder_id: Option<i64>,
    #[serde(default)]
    pub google_account_id: Option<i64>,
    #[serde(default)]
    pub tags: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VaultBatchImportResult {
    pub created_count: usize,
    pub skipped_count: usize,
}

fn normalize_vault_kind(value: Option<&str>) -> String {
    match value.map(|s| s.trim().to_ascii_lowercase()).as_deref() {
        Some("api") => "api".to_string(),
        Some("ssh") => "ssh".to_string(),
        Some("token") => "token".to_string(),
        Some("password") => "password".to_string(),
        _ => "account".to_string(),
    }
}

fn normalize_totp_secret(value: Option<&str>) -> Option<String> {
    value
        .map(|s| s.chars().filter(|c| !c.is_whitespace()).collect::<String>())
        .filter(|s| !s.is_empty())
}

pub fn query_vault_folders(conn: &Connection) -> Result<Vec<VaultFolder>, String> {
    let mut stmt = conn
        .prepare("SELECT id, name, sort_order, created_at FROM vault_folders ORDER BY sort_order ASC, id ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(VaultFolder {
                id: row.get(0)?,
                name: row.get(1)?,
                sort_order: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn create_vault_folder(conn: &Connection, input: &VaultFolderInput) -> Result<VaultFolder, String> {
    let name = input.name.trim();
    if name.is_empty() || name.chars().count() > 60 {
        return Err("文件夹名称不能为空且不超过 60 个字符".to_string());
    }
    conn.execute(
        "INSERT INTO vault_folders (name, sort_order) VALUES (?1, ?2)",
        params![name, input.sort_order.unwrap_or(0)],
    )
    .map_err(|e| format!("创建文件夹失败: {}", e))?;
    let id = conn.last_insert_rowid();
    conn.query_row(
        "SELECT id, name, sort_order, created_at FROM vault_folders WHERE id = ?1",
        [id],
        |row| {
            Ok(VaultFolder {
                id: row.get(0)?,
                name: row.get(1)?,
                sort_order: row.get(2)?,
                created_at: row.get(3)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

pub fn update_vault_folder(
    conn: &Connection,
    id: i64,
    input: &VaultFolderInput,
) -> Result<VaultFolder, String> {
    let name = input.name.trim();
    if name.is_empty() || name.chars().count() > 60 {
        return Err("文件夹名称不能为空且不超过 60 个字符".to_string());
    }
    let changed = conn
        .execute(
            "UPDATE vault_folders SET name = ?1, sort_order = COALESCE(?2, sort_order) WHERE id = ?3",
            params![name, input.sort_order, id],
        )
        .map_err(|e| format!("更新文件夹失败: {}", e))?;
    if changed == 0 {
        return Err("文件夹不存在".to_string());
    }
    conn.query_row(
        "SELECT id, name, sort_order, created_at FROM vault_folders WHERE id = ?1",
        [id],
        |row| {
            Ok(VaultFolder {
                id: row.get(0)?,
                name: row.get(1)?,
                sort_order: row.get(2)?,
                created_at: row.get(3)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

pub fn delete_vault_folder(conn: &Connection, id: i64) -> Result<(), String> {
    let changed = conn
        .execute("DELETE FROM vault_folders WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("文件夹不存在".to_string());
    }
    Ok(())
}

fn map_vault_item(row: &Row) -> rusqlite::Result<VaultItem> {
    Ok(VaultItem {
        id: row.get("id")?,
        kind: row.get("kind")?,
        name: row.get("name")?,
        url: row.get("url")?,
        username: row.get("username")?,
        secret_value: row.get("secret_value")?,
        totp_secret: row.get("totp_secret")?,
        folder_id: row.get("folder_id")?,
        google_account_id: row.get("google_account_id")?,
        google_account_email: row.get("google_account_email")?,
        tags: row.get("tags")?,
        notes: row.get("notes")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

const VAULT_SELECT_SQL: &str = "
    SELECT v.id, v.kind, v.name, v.url, v.username, v.secret_value, v.totp_secret,
           v.folder_id, v.google_account_id,
           CASE WHEN a.deleted_at IS NULL THEN a.email ELSE NULL END AS google_account_email,
           v.tags, v.notes, v.created_at, v.updated_at
    FROM vault_items v
    LEFT JOIN accounts a ON a.id = v.google_account_id
";

pub fn get_vault_item_by_id(conn: &Connection, id: i64) -> Result<VaultItem, String> {
    conn.query_row(
        &format!("{} WHERE v.id = ?1", VAULT_SELECT_SQL),
        [id],
        map_vault_item,
    )
    .map_err(|e| e.to_string())
}

pub fn query_vault_items(conn: &Connection, search: Option<&str>) -> Result<Vec<VaultItem>, String> {
    let mut sql = VAULT_SELECT_SQL.to_string();
    let mut params_vec: Vec<String> = Vec::new();
    if let Some(q) = normalize_optional(search) {
        let pattern = format!("%{}%", q);
        sql.push_str(
            " WHERE (v.name LIKE ?1 OR v.url LIKE ?1 OR v.username LIKE ?1 OR v.tags LIKE ?1 OR v.notes LIKE ?1)",
        );
        params_vec.push(pattern);
    }
    sql.push_str(" ORDER BY v.updated_at DESC, v.id DESC");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
    let rows = stmt
        .query_map(refs.as_slice(), map_vault_item)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn create_vault_item(conn: &Connection, input: &VaultItemInput) -> Result<VaultItem, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("条目标题不能为空".to_string());
    }
    let kind = normalize_vault_kind(input.kind.as_deref());
    conn.execute(
        "INSERT INTO vault_items
         (kind, name, url, username, secret_value, totp_secret, folder_id, google_account_id, tags, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            kind,
            name,
            normalize_optional(input.url.as_deref()),
            normalize_optional(input.username.as_deref()),
            input.secret_value.as_deref().filter(|s| !s.is_empty()),
            normalize_totp_secret(input.totp_secret.as_deref()),
            input.folder_id,
            input.google_account_id,
            normalize_optional(input.tags.as_deref()),
            normalize_optional(input.notes.as_deref()),
        ],
    )
    .map_err(|e| format!("创建密钥条目失败: {}", e))?;
    get_vault_item_by_id(conn, conn.last_insert_rowid())
}

pub fn update_vault_item(
    conn: &Connection,
    id: i64,
    input: &VaultItemInput,
) -> Result<VaultItem, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("条目标题不能为空".to_string());
    }
    let kind = normalize_vault_kind(input.kind.as_deref());
    let changed = conn
        .execute(
            "UPDATE vault_items
             SET kind = ?1, name = ?2, url = ?3, username = ?4, secret_value = ?5,
                 totp_secret = ?6, folder_id = ?7, google_account_id = ?8, tags = ?9,
                 notes = ?10, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?11",
            params![
                kind,
                name,
                normalize_optional(input.url.as_deref()),
                normalize_optional(input.username.as_deref()),
                input.secret_value.as_deref().filter(|s| !s.is_empty()),
                normalize_totp_secret(input.totp_secret.as_deref()),
                input.folder_id,
                input.google_account_id,
                normalize_optional(input.tags.as_deref()),
                normalize_optional(input.notes.as_deref()),
                id
            ],
        )
        .map_err(|e| format!("更新密钥条目失败: {}", e))?;
    if changed == 0 {
        return Err("密钥条目不存在".to_string());
    }
    get_vault_item_by_id(conn, id)
}

pub fn delete_vault_item(conn: &Connection, id: i64) -> Result<(), String> {
    let changed = conn
        .execute("DELETE FROM vault_items WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("密钥条目不存在".to_string());
    }
    Ok(())
}

pub fn batch_import_vault_items(
    conn: &Connection,
    items: &[VaultItemInput],
) -> Result<VaultBatchImportResult, String> {
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("开启导入事务失败: {}", e))?;
    let mut created_count = 0usize;
    let mut skipped_count = 0usize;

    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO vault_items
                 (kind, name, url, username, secret_value, totp_secret, folder_id, google_account_id, tags, notes)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            )
            .map_err(|e| e.to_string())?;

        for item in items {
            let name = item.name.trim();
            if name.is_empty() {
                skipped_count += 1;
                continue;
            }
            let kind = normalize_vault_kind(item.kind.as_deref());
            stmt.execute(params![
                kind,
                name,
                normalize_optional(item.url.as_deref()),
                normalize_optional(item.username.as_deref()),
                item.secret_value.as_deref().filter(|s| !s.is_empty()),
                normalize_totp_secret(item.totp_secret.as_deref()),
                item.folder_id,
                item.google_account_id,
                normalize_optional(item.tags.as_deref()),
                normalize_optional(item.notes.as_deref()),
            ])
            .map_err(|e| format!("批量导入密钥条目失败: {}", e))?;
            created_count += 1;
        }
    }

    tx.commit().map_err(|e| format!("提交导入事务失败: {}", e))?;
    Ok(VaultBatchImportResult {
        created_count,
        skipped_count,
    })
}

// ─── U 卡与支付卡 (payment_cards) ─────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PaymentCard {
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
    pub card_number: Option<String>,
    pub cvv: Option<String>,
    pub cardholder: Option<String>,
    pub billing_address: Option<String>,
    pub billing_amount: Option<f64>,
    pub billing_currency: String,
    pub billing_cycle: String,
    pub expires_at: Option<String>,
    pub tags: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PaymentCardInput {
    pub name: String,
    #[serde(default)]
    pub issuer: Option<String>,
    #[serde(default)]
    pub bank_code: Option<String>,
    #[serde(default)]
    pub network: Option<String>,
    #[serde(default)]
    pub funding: Option<String>,
    #[serde(default)]
    pub form_factor: Option<String>,
    #[serde(default)]
    pub region: Option<String>,
    #[serde(default)]
    pub region_group: Option<String>,
    #[serde(default)]
    pub last4: Option<String>,
    #[serde(default)]
    pub expiry_month: Option<String>,
    #[serde(default)]
    pub card_number: Option<String>,
    #[serde(default)]
    pub cvv: Option<String>,
    #[serde(default)]
    pub cardholder: Option<String>,
    #[serde(default)]
    pub billing_address: Option<String>,
    #[serde(default)]
    pub billing_amount: Option<f64>,
    #[serde(default)]
    pub billing_currency: Option<String>,
    #[serde(default)]
    pub billing_cycle: Option<String>,
    #[serde(default)]
    pub expires_at: Option<String>,
    #[serde(default)]
    pub tags: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

fn map_payment_card(row: &Row) -> rusqlite::Result<PaymentCard> {
    Ok(PaymentCard {
        id: row.get("id")?,
        name: row.get("name")?,
        issuer: row.get("issuer")?,
        bank_code: row.get("bank_code")?,
        network: row.get("network")?,
        funding: row.get("funding")?,
        form_factor: row.get("form_factor")?,
        region: row.get("region")?,
        region_group: row
            .get::<_, Option<String>>("region_group")?
            .unwrap_or_else(|| "unknown".to_string()),
        last4: row.get("last4")?,
        expiry_month: row.get("expiry_month")?,
        card_number: row.get("card_number")?,
        cvv: row.get("cvv")?,
        cardholder: row.get("cardholder")?,
        billing_address: row.get("billing_address")?,
        billing_amount: row.get("billing_amount")?,
        billing_currency: row
            .get::<_, Option<String>>("billing_currency")?
            .unwrap_or_else(|| "USD".to_string()),
        billing_cycle: row
            .get::<_, Option<String>>("billing_cycle")?
            .unwrap_or_else(|| "year".to_string()),
        expires_at: row.get("expires_at")?,
        tags: row.get("tags")?,
        notes: row.get("notes")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn derive_last4(last4: Option<&str>, card_number: Option<&str>) -> Option<String> {
    if let Some(explicit) = normalize_optional(last4) {
        let digits: String = explicit.chars().filter(|c| c.is_ascii_digit()).collect();
        if digits.len() >= 4 {
            return Some(digits[digits.len() - 4..].to_string());
        }
        return Some(explicit);
    }
    let digits: String = card_number
        .unwrap_or("")
        .chars()
        .filter(|c| c.is_ascii_digit())
        .collect();
    if digits.len() >= 4 {
        Some(digits[digits.len() - 4..].to_string())
    } else {
        None
    }
}

fn normalize_region_group(value: Option<&str>) -> String {
    match value.map(|s| s.trim().to_ascii_lowercase()).as_deref() {
        Some("mainland") | Some("hmt") | Some("overseas") | Some("global") => {
            value.unwrap().trim().to_ascii_lowercase()
        }
        _ => "unknown".to_string(),
    }
}

fn normalize_billing_amount(value: Option<f64>) -> Result<Option<f64>, String> {
    match value {
        None => Ok(None),
        Some(v) => {
            if !v.is_finite() || v < 0.0 || v > 1e9 {
                return Err("费用金额必须是非负有限数字".to_string());
            }
            Ok(Some((v * 100.0).round() / 100.0))
        }
    }
}

const PAYMENT_CARD_COLUMNS: &str = "id, name, issuer, bank_code, network, funding, form_factor, region, region_group, last4, expiry_month, card_number, cvv, cardholder, billing_address, billing_amount, billing_currency, billing_cycle, expires_at, tags, notes, created_at, updated_at";

pub fn query_payment_cards(conn: &Connection) -> Result<Vec<PaymentCard>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {} FROM payment_cards ORDER BY updated_at DESC, id DESC",
            PAYMENT_CARD_COLUMNS
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], map_payment_card)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn get_payment_card_by_id(conn: &Connection, id: i64) -> Result<PaymentCard, String> {
    conn.query_row(
        &format!(
            "SELECT {} FROM payment_cards WHERE id = ?1",
            PAYMENT_CARD_COLUMNS
        ),
        [id],
        map_payment_card,
    )
    .map_err(|e| e.to_string())
}

pub fn create_payment_card(
    conn: &Connection,
    input: &PaymentCardInput,
) -> Result<PaymentCard, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("卡片名称不能为空".to_string());
    }
    let billing_amount = normalize_billing_amount(input.billing_amount)?;
    let billing_currency = normalize_currency(input.billing_currency.as_deref(), "USD");
    let billing_cycle = normalize_cycle(input.billing_cycle.as_deref(), "year");
    let expires_at = normalize_optional_day(input.expires_at.as_deref())?;
    let last4 = derive_last4(input.last4.as_deref(), input.card_number.as_deref());
    let region_group = normalize_region_group(input.region_group.as_deref());

    conn.execute(
        "INSERT INTO payment_cards
         (name, issuer, bank_code, network, funding, form_factor, region, region_group,
          last4, expiry_month, card_number, cvv, cardholder, billing_address,
          billing_amount, billing_currency, billing_cycle, expires_at, tags, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)",
        params![
            name,
            normalize_optional(input.issuer.as_deref()),
            normalize_optional(input.bank_code.as_deref()),
            normalize_optional(input.network.as_deref()),
            normalize_optional(input.funding.as_deref()),
            normalize_optional(input.form_factor.as_deref()),
            normalize_optional(input.region.as_deref()),
            region_group,
            last4,
            normalize_optional(input.expiry_month.as_deref()),
            normalize_optional(input.card_number.as_deref()),
            normalize_optional(input.cvv.as_deref()),
            normalize_optional(input.cardholder.as_deref()),
            normalize_optional(input.billing_address.as_deref()),
            billing_amount,
            billing_currency,
            billing_cycle,
            expires_at,
            normalize_optional(input.tags.as_deref()),
            normalize_optional(input.notes.as_deref()),
        ],
    )
    .map_err(|e| format!("创建支付卡失败: {}", e))?;
    get_payment_card_by_id(conn, conn.last_insert_rowid())
}

pub fn update_payment_card(
    conn: &Connection,
    id: i64,
    input: &PaymentCardInput,
) -> Result<PaymentCard, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("卡片名称不能为空".to_string());
    }
    let billing_amount = normalize_billing_amount(input.billing_amount)?;
    let billing_currency = normalize_currency(input.billing_currency.as_deref(), "USD");
    let billing_cycle = normalize_cycle(input.billing_cycle.as_deref(), "year");
    let expires_at = normalize_optional_day(input.expires_at.as_deref())?;
    let last4 = derive_last4(input.last4.as_deref(), input.card_number.as_deref());
    let region_group = normalize_region_group(input.region_group.as_deref());

    let changed = conn
        .execute(
            "UPDATE payment_cards
             SET name = ?1, issuer = ?2, bank_code = ?3, network = ?4, funding = ?5,
                 form_factor = ?6, region = ?7, region_group = ?8, last4 = ?9, expiry_month = ?10,
                 card_number = ?11, cvv = ?12, cardholder = ?13, billing_address = ?14,
                 billing_amount = ?15, billing_currency = ?16, billing_cycle = ?17, expires_at = ?18,
                 tags = ?19, notes = ?20, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?21",
            params![
                name,
                normalize_optional(input.issuer.as_deref()),
                normalize_optional(input.bank_code.as_deref()),
                normalize_optional(input.network.as_deref()),
                normalize_optional(input.funding.as_deref()),
                normalize_optional(input.form_factor.as_deref()),
                normalize_optional(input.region.as_deref()),
                region_group,
                last4,
                normalize_optional(input.expiry_month.as_deref()),
                normalize_optional(input.card_number.as_deref()),
                normalize_optional(input.cvv.as_deref()),
                normalize_optional(input.cardholder.as_deref()),
                normalize_optional(input.billing_address.as_deref()),
                billing_amount,
                billing_currency,
                billing_cycle,
                expires_at,
                normalize_optional(input.tags.as_deref()),
                normalize_optional(input.notes.as_deref()),
                id
            ],
        )
        .map_err(|e| format!("更新支付卡失败: {}", e))?;
    if changed == 0 {
        return Err("支付卡不存在".to_string());
    }
    get_payment_card_by_id(conn, id)
}

pub fn delete_payment_card(conn: &Connection, id: i64) -> Result<(), String> {
    let changed = conn
        .execute("DELETE FROM payment_cards WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("支付卡不存在".to_string());
    }
    Ok(())
}

// ─── Cloudflare 连接与域名管理 (cloudflare_connections / domains) ─

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CloudflareConnection {
    pub id: i64,
    pub name: String,
    pub api_token: String,
    pub account_summary: Option<String>,
    pub last_synced_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CloudflareConnectionView {
    pub id: i64,
    pub name: String,
    pub token_hint: String,
    pub account_summary: Option<String>,
    pub last_synced_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CloudflareConnectionInput {
    pub name: String,
    #[serde(default)]
    pub api_token: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DomainItem {
    pub id: i64,
    pub name: String,
    pub registrar: Option<String>,
    pub nameservers: Vec<String>,
    pub statuses: Vec<String>,
    pub auto_renew: bool,
    pub billing_amount: Option<f64>,
    pub billing_currency: String,
    pub billing_cycle: String,
    pub expires_at: Option<String>,
    pub cf_connection_id: Option<i64>,
    pub cf_zone_id: Option<String>,
    pub server_id: Option<i64>,
    pub probed_at: Option<String>,
    pub probe_error: Option<String>,
    pub tags: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DomainInput {
    pub name: String,
    #[serde(default)]
    pub registrar: Option<String>,
    #[serde(default)]
    pub nameservers: Option<Vec<String>>,
    #[serde(default)]
    pub statuses: Option<Vec<String>>,
    #[serde(default)]
    pub auto_renew: Option<bool>,
    #[serde(default)]
    pub billing_amount: Option<f64>,
    #[serde(default)]
    pub billing_currency: Option<String>,
    #[serde(default)]
    pub billing_cycle: Option<String>,
    #[serde(default)]
    pub expires_at: Option<String>,
    #[serde(default)]
    pub cf_connection_id: Option<i64>,
    #[serde(default)]
    pub cf_zone_id: Option<String>,
    #[serde(default)]
    pub server_id: Option<i64>,
    #[serde(default)]
    pub tags: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

fn mask_token_hint(token: &str) -> String {
    let trimmed = token.trim();
    if trimmed.len() <= 8 {
        "••••••••".to_string()
    } else {
        format!("{}••••{}", &trimmed[..4], &trimmed[trimmed.len() - 4..])
    }
}

pub fn query_cloudflare_connections(conn: &Connection) -> Result<Vec<CloudflareConnectionView>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, api_token, account_summary, last_synced_at, created_at, updated_at
             FROM cloudflare_connections ORDER BY id DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let token: String = row.get(2)?;
            Ok(CloudflareConnectionView {
                id: row.get(0)?,
                name: row.get(1)?,
                token_hint: mask_token_hint(&token),
                account_summary: row.get(3)?,
                last_synced_at: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn get_cloudflare_connection(conn: &Connection, id: i64) -> Result<CloudflareConnection, String> {
    conn.query_row(
        "SELECT id, name, api_token, account_summary, last_synced_at, created_at, updated_at
         FROM cloudflare_connections WHERE id = ?1",
        [id],
        |row| {
            Ok(CloudflareConnection {
                id: row.get(0)?,
                name: row.get(1)?,
                api_token: row.get(2)?,
                account_summary: row.get(3)?,
                last_synced_at: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        },
    )
    .map_err(|_| "Cloudflare 连接不存在".to_string())
}

pub fn save_cloudflare_connection(
    conn: &Connection,
    id: Option<i64>,
    input: &CloudflareConnectionInput,
    summary: Option<&str>,
) -> Result<CloudflareConnectionView, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("连接名称不能为空".to_string());
    }
    let conn_id = match id {
        None => {
            let token = crate::cloudflare::validate_cf_token(
                input.api_token.as_deref().unwrap_or(""),
            )?;
            conn.execute(
                "INSERT INTO cloudflare_connections (name, api_token, account_summary, last_synced_at)
                 VALUES (?1, ?2, ?3, CASE WHEN ?3 IS NOT NULL THEN CURRENT_TIMESTAMP ELSE NULL END)",
                params![name, token, summary],
            )
            .map_err(|e| e.to_string())?;
            conn.last_insert_rowid()
        }
        Some(existing_id) => {
            let existing = get_cloudflare_connection(conn, existing_id)?;
            let token = match normalize_optional(input.api_token.as_deref()) {
                Some(t) => crate::cloudflare::validate_cf_token(&t)?,
                None => existing.api_token,
            };
            conn.execute(
                "UPDATE cloudflare_connections
                 SET name = ?1, api_token = ?2, account_summary = COALESCE(?3, account_summary),
                     last_synced_at = CASE WHEN ?3 IS NOT NULL THEN CURRENT_TIMESTAMP ELSE last_synced_at END,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?4",
                params![name, token, summary, existing_id],
            )
            .map_err(|e| e.to_string())?;
            existing_id
        }
    };

    let full = get_cloudflare_connection(conn, conn_id)?;
    Ok(CloudflareConnectionView {
        id: full.id,
        name: full.name,
        token_hint: mask_token_hint(&full.api_token),
        account_summary: full.account_summary,
        last_synced_at: full.last_synced_at,
        created_at: full.created_at,
        updated_at: full.updated_at,
    })
}

pub fn update_cloudflare_sync_summary(
    conn: &Connection,
    id: i64,
    summary: Option<&str>,
) -> Result<(), String> {
    conn.execute(
        "UPDATE cloudflare_connections
         SET account_summary = COALESCE(?1, account_summary), last_synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?2",
        params![summary, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_cloudflare_connection(conn: &Connection, id: i64) -> Result<(), String> {
    let changed = conn
        .execute("DELETE FROM cloudflare_connections WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Cloudflare 连接不存在".to_string());
    }
    Ok(())
}

fn parse_string_vec_json(raw: Option<String>) -> Vec<String> {
    raw.and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .unwrap_or_default()
}

fn map_domain_row(row: &Row) -> rusqlite::Result<DomainItem> {
    let auto_int: i64 = row.get("auto_renew")?;
    Ok(DomainItem {
        id: row.get("id")?,
        name: row.get("name")?,
        registrar: row.get("registrar")?,
        nameservers: parse_string_vec_json(row.get("nameservers_json")?),
        statuses: parse_string_vec_json(row.get("statuses_json")?),
        auto_renew: auto_int != 0,
        billing_amount: row.get("billing_amount")?,
        billing_currency: row
            .get::<_, Option<String>>("billing_currency")?
            .unwrap_or_else(|| "USD".to_string()),
        billing_cycle: row
            .get::<_, Option<String>>("billing_cycle")?
            .unwrap_or_else(|| "year".to_string()),
        expires_at: row.get("expires_at")?,
        cf_connection_id: row.get("cf_connection_id")?,
        cf_zone_id: row.get("cf_zone_id")?,
        server_id: row.get("server_id")?,
        probed_at: row.get("probed_at")?,
        probe_error: row.get("probe_error")?,
        tags: row.get("tags")?,
        notes: row.get("notes")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

const DOMAIN_COLUMNS: &str = "id, name, registrar, nameservers_json, statuses_json, auto_renew, billing_amount, billing_currency, billing_cycle, expires_at, cf_connection_id, cf_zone_id, server_id, probed_at, probe_error, tags, notes, created_at, updated_at";

pub fn query_domains(conn: &Connection) -> Result<Vec<DomainItem>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {} FROM domains ORDER BY CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END, expires_at ASC, name ASC",
            DOMAIN_COLUMNS
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], map_domain_row)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn get_domain_by_id(conn: &Connection, id: i64) -> Result<DomainItem, String> {
    conn.query_row(
        &format!("SELECT {} FROM domains WHERE id = ?1", DOMAIN_COLUMNS),
        [id],
        map_domain_row,
    )
    .map_err(|_| "域名不存在".to_string())
}

pub fn create_domain(conn: &Connection, input: &DomainInput) -> Result<DomainItem, String> {
    let name = crate::domain_probe::normalize_domain_name(&input.name)?;
    let billing_amount = normalize_billing_amount(input.billing_amount)?;
    let billing_currency = normalize_currency(input.billing_currency.as_deref(), "USD");
    let billing_cycle = normalize_cycle(input.billing_cycle.as_deref(), "year");
    let expires_at = normalize_optional_day(input.expires_at.as_deref())?;
    let ns_json = input
        .nameservers
        .as_ref()
        .map(|v| serde_json::to_string(v).unwrap_or_else(|_| "[]".to_string()));
    let st_json = input
        .statuses
        .as_ref()
        .map(|v| serde_json::to_string(v).unwrap_or_else(|_| "[]".to_string()));

    conn.execute(
        "INSERT INTO domains
         (name, registrar, nameservers_json, statuses_json, auto_renew, billing_amount,
          billing_currency, billing_cycle, expires_at, cf_connection_id, cf_zone_id, server_id, tags, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            name,
            normalize_optional(input.registrar.as_deref()),
            ns_json,
            st_json,
            if input.auto_renew.unwrap_or(false) { 1 } else { 0 },
            billing_amount,
            billing_currency,
            billing_cycle,
            expires_at,
            input.cf_connection_id,
            normalize_optional(input.cf_zone_id.as_deref()),
            input.server_id,
            normalize_optional(input.tags.as_deref()),
            normalize_optional(input.notes.as_deref()),
        ],
    )
    .map_err(|e| format!("创建域名失败: {}", e))?;
    get_domain_by_id(conn, conn.last_insert_rowid())
}

pub fn update_domain(conn: &Connection, id: i64, input: &DomainInput) -> Result<DomainItem, String> {
    let name = crate::domain_probe::normalize_domain_name(&input.name)?;
    let billing_amount = normalize_billing_amount(input.billing_amount)?;
    let billing_currency = normalize_currency(input.billing_currency.as_deref(), "USD");
    let billing_cycle = normalize_cycle(input.billing_cycle.as_deref(), "year");
    let expires_at = normalize_optional_day(input.expires_at.as_deref())?;
    let ns_json = input
        .nameservers
        .as_ref()
        .map(|v| serde_json::to_string(v).unwrap_or_else(|_| "[]".to_string()));
    let st_json = input
        .statuses
        .as_ref()
        .map(|v| serde_json::to_string(v).unwrap_or_else(|_| "[]".to_string()));

    let changed = conn
        .execute(
            "UPDATE domains
             SET name = ?1, registrar = ?2,
                 nameservers_json = COALESCE(?3, nameservers_json),
                 statuses_json = COALESCE(?4, statuses_json),
                 auto_renew = ?5, billing_amount = ?6, billing_currency = ?7, billing_cycle = ?8,
                 expires_at = ?9, cf_connection_id = ?10, cf_zone_id = ?11, server_id = ?12,
                 tags = ?13, notes = ?14, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?15",
            params![
                name,
                normalize_optional(input.registrar.as_deref()),
                ns_json,
                st_json,
                if input.auto_renew.unwrap_or(false) { 1 } else { 0 },
                billing_amount,
                billing_currency,
                billing_cycle,
                expires_at,
                input.cf_connection_id,
                normalize_optional(input.cf_zone_id.as_deref()),
                input.server_id,
                normalize_optional(input.tags.as_deref()),
                normalize_optional(input.notes.as_deref()),
                id
            ],
        )
        .map_err(|e| format!("更新域名失败: {}", e))?;
    if changed == 0 {
        return Err("域名不存在".to_string());
    }
    get_domain_by_id(conn, id)
}

pub fn save_domain_probe_result(
    conn: &Connection,
    id: i64,
    result: Result<&crate::domain_probe::DomainProbeResult, &str>,
) -> Result<DomainItem, String> {
    match result {
        Ok(r) => {
            let ns_json = serde_json::to_string(&r.nameservers).unwrap_or_else(|_| "[]".to_string());
            let st_json = serde_json::to_string(&r.statuses).unwrap_or_else(|_| "[]".to_string());
            conn.execute(
                "UPDATE domains
                 SET registrar = COALESCE(?1, registrar),
                     nameservers_json = ?2,
                     statuses_json = ?3,
                     expires_at = COALESCE(?4, expires_at),
                     auto_renew = CASE WHEN ?5 = 1 THEN 1 ELSE auto_renew END,
                     probed_at = CURRENT_TIMESTAMP,
                     probe_error = NULL,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?6",
                params![
                    r.registrar,
                    ns_json,
                    st_json,
                    r.expires_at,
                    if r.auto_renew { 1 } else { 0 },
                    id
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        Err(err) => {
            conn.execute(
                "UPDATE domains SET probed_at = CURRENT_TIMESTAMP, probe_error = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
                params![err, id],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    get_domain_by_id(conn, id)
}

pub fn upsert_cloudflare_domains(
    conn: &Connection,
    cf_connection_id: i64,
    zones: &[crate::cloudflare::CloudflareZone],
) -> Result<usize, String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let mut imported = 0usize;
    for z in zones {
        let name = crate::domain_probe::normalize_domain_name(&z.name)?;
        let ns_json = serde_json::to_string(&z.name_servers).unwrap_or_else(|_| "[]".to_string());
        let existing_id: Option<i64> = tx
            .query_row("SELECT id FROM domains WHERE lower(name) = ?1", [&name], |r| r.get(0))
            .ok();
        if let Some(id) = existing_id {
            tx.execute(
                "UPDATE domains
                 SET cf_connection_id = ?1, cf_zone_id = ?2,
                     nameservers_json = ?3,
                     registrar = COALESCE(?4, registrar),
                     expires_at = COALESCE(?5, expires_at),
                     auto_renew = COALESCE(?6, auto_renew),
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?7",
                params![
                    cf_connection_id,
                    z.zone_id,
                    ns_json,
                    z.registrar,
                    z.expires_at,
                    z.auto_renew.map(|b| if b { 1 } else { 0 }),
                    id
                ],
            )
            .map_err(|e| e.to_string())?;
        } else {
            tx.execute(
                "INSERT INTO domains
                 (name, registrar, nameservers_json, auto_renew, billing_currency, billing_cycle, expires_at, cf_connection_id, cf_zone_id)
                 VALUES (?1, ?2, ?3, ?4, 'USD', 'year', ?5, ?6, ?7)",
                params![
                    name,
                    z.registrar,
                    ns_json,
                    if z.auto_renew.unwrap_or(false) { 1 } else { 0 },
                    z.expires_at,
                    cf_connection_id,
                    z.zone_id,
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        imported += 1;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(imported)
}

pub fn delete_domain(conn: &Connection, id: i64) -> Result<(), String> {
    let changed = conn
        .execute("DELETE FROM domains WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("域名不存在".to_string());
    }
    Ok(())
}

// ─── AI 订阅管理 (ai_subscriptions) ───────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AiSubscription {
    pub id: i64,
    pub name: String,
    pub provider: String,
    pub plan: Option<String>,
    pub account_email: Option<String>,
    pub key_hint: Option<String>,
    pub billing_amount: Option<f64>,
    pub billing_currency: String,
    pub billing_cycle: String,
    pub renews_at: Option<String>,
    pub google_account_id: Option<i64>,
    pub google_account_email: Option<String>,
    pub payment_card_id: Option<i64>,
    pub payment_card_name: Option<String>,
    pub oauth_provider: Option<String>,
    pub oauth_account_id: Option<String>,
    pub oauth_connected: bool,
    pub usage: Option<crate::ai_quota::NormalizedUsage>,
    pub usage_checked_at: Option<String>,
    pub usage_error: Option<String>,
    pub tags: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AiSubscriptionInput {
    pub name: String,
    pub provider: String,
    #[serde(default)]
    pub plan: Option<String>,
    #[serde(default)]
    pub account_email: Option<String>,
    #[serde(default)]
    pub key_hint: Option<String>,
    #[serde(default)]
    pub billing_amount: Option<f64>,
    #[serde(default)]
    pub billing_currency: Option<String>,
    #[serde(default)]
    pub billing_cycle: Option<String>,
    #[serde(default)]
    pub renews_at: Option<String>,
    #[serde(default)]
    pub google_account_id: Option<i64>,
    #[serde(default)]
    pub payment_card_id: Option<i64>,
    #[serde(default)]
    pub oauth_provider: Option<String>,
    #[serde(default)]
    pub tags: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

const AI_SUB_SELECT: &str = "
    SELECT s.id, s.name, s.provider, s.plan, s.account_email, s.key_hint,
           s.billing_amount, s.billing_currency, s.billing_cycle, s.renews_at,
           s.google_account_id,
           CASE WHEN a.deleted_at IS NULL THEN a.email ELSE NULL END AS google_account_email,
           s.payment_card_id,
           c.name AS payment_card_name,
           s.oauth_provider, s.oauth_account_id, s.oauth_token_json,
           s.usage_json, s.usage_checked_at, s.usage_error,
           s.tags, s.notes, s.created_at, s.updated_at
    FROM ai_subscriptions s
    LEFT JOIN accounts a ON a.id = s.google_account_id
    LEFT JOIN payment_cards c ON c.id = s.payment_card_id
";

fn map_ai_subscription(row: &Row) -> rusqlite::Result<AiSubscription> {
    let token_raw: Option<String> = row.get("oauth_token_json")?;
    let usage_raw: Option<String> = row.get("usage_json")?;
    let usage = usage_raw.and_then(|s| serde_json::from_str::<crate::ai_quota::NormalizedUsage>(&s).ok());
    Ok(AiSubscription {
        id: row.get("id")?,
        name: row.get("name")?,
        provider: row.get("provider")?,
        plan: row.get("plan")?,
        account_email: row.get("account_email")?,
        key_hint: row.get("key_hint")?,
        billing_amount: row.get("billing_amount")?,
        billing_currency: row
            .get::<_, Option<String>>("billing_currency")?
            .unwrap_or_else(|| "USD".to_string()),
        billing_cycle: row
            .get::<_, Option<String>>("billing_cycle")?
            .unwrap_or_else(|| "month".to_string()),
        renews_at: row.get("renews_at")?,
        google_account_id: row.get("google_account_id")?,
        google_account_email: row.get("google_account_email")?,
        payment_card_id: row.get("payment_card_id")?,
        payment_card_name: row.get("payment_card_name")?,
        oauth_provider: row.get("oauth_provider")?,
        oauth_account_id: row.get("oauth_account_id")?,
        oauth_connected: token_raw.as_deref().map(|s| !s.trim().is_empty()).unwrap_or(false),
        usage,
        usage_checked_at: row.get("usage_checked_at")?,
        usage_error: row.get("usage_error")?,
        tags: row.get("tags")?,
        notes: row.get("notes")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn query_ai_subscriptions(conn: &Connection) -> Result<Vec<AiSubscription>, String> {
    let mut stmt = conn
        .prepare(&format!("{} ORDER BY s.updated_at DESC, s.id DESC", AI_SUB_SELECT))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], map_ai_subscription)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn get_ai_subscription_by_id(conn: &Connection, id: i64) -> Result<AiSubscription, String> {
    conn.query_row(
        &format!("{} WHERE s.id = ?1", AI_SUB_SELECT),
        [id],
        map_ai_subscription,
    )
    .map_err(|_| "AI 订阅不存在".to_string())
}

pub fn create_ai_subscription(
    conn: &Connection,
    input: &AiSubscriptionInput,
) -> Result<AiSubscription, String> {
    let name = input.name.trim();
    let provider = input.provider.trim();
    if name.is_empty() || provider.is_empty() {
        return Err("订阅名称与服务商不能为空".to_string());
    }
    let billing_amount = normalize_billing_amount(input.billing_amount)?;
    let billing_currency = normalize_currency(input.billing_currency.as_deref(), "USD");
    let billing_cycle = normalize_cycle(input.billing_cycle.as_deref(), "month");
    let renews_at = normalize_optional_day(input.renews_at.as_deref())?;

    conn.execute(
        "INSERT INTO ai_subscriptions
         (name, provider, plan, account_email, key_hint, billing_amount, billing_currency, billing_cycle,
          renews_at, google_account_id, payment_card_id, oauth_provider, tags, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            name,
            provider,
            normalize_optional(input.plan.as_deref()),
            normalize_optional(input.account_email.as_deref()),
            normalize_optional(input.key_hint.as_deref()),
            billing_amount,
            billing_currency,
            billing_cycle,
            renews_at,
            input.google_account_id,
            input.payment_card_id,
            normalize_optional(input.oauth_provider.as_deref()),
            normalize_optional(input.tags.as_deref()),
            normalize_optional(input.notes.as_deref()),
        ],
    )
    .map_err(|e| format!("创建 AI 订阅失败: {}", e))?;
    get_ai_subscription_by_id(conn, conn.last_insert_rowid())
}

pub fn update_ai_subscription(
    conn: &Connection,
    id: i64,
    input: &AiSubscriptionInput,
) -> Result<AiSubscription, String> {
    let name = input.name.trim();
    let provider = input.provider.trim();
    if name.is_empty() || provider.is_empty() {
        return Err("订阅名称与服务商不能为空".to_string());
    }
    let billing_amount = normalize_billing_amount(input.billing_amount)?;
    let billing_currency = normalize_currency(input.billing_currency.as_deref(), "USD");
    let billing_cycle = normalize_cycle(input.billing_cycle.as_deref(), "month");
    let renews_at = normalize_optional_day(input.renews_at.as_deref())?;

    let changed = conn
        .execute(
            "UPDATE ai_subscriptions
             SET name = ?1, provider = ?2, plan = ?3, account_email = ?4, key_hint = ?5,
                 billing_amount = ?6, billing_currency = ?7, billing_cycle = ?8, renews_at = ?9,
                 google_account_id = ?10, payment_card_id = ?11,
                 oauth_provider = COALESCE(?12, oauth_provider),
                 tags = ?13, notes = ?14, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?15",
            params![
                name,
                provider,
                normalize_optional(input.plan.as_deref()),
                normalize_optional(input.account_email.as_deref()),
                normalize_optional(input.key_hint.as_deref()),
                billing_amount,
                billing_currency,
                billing_cycle,
                renews_at,
                input.google_account_id,
                input.payment_card_id,
                normalize_optional(input.oauth_provider.as_deref()),
                normalize_optional(input.tags.as_deref()),
                normalize_optional(input.notes.as_deref()),
                id
            ],
        )
        .map_err(|e| format!("更新 AI 订阅失败: {}", e))?;
    if changed == 0 {
        return Err("AI 订阅不存在".to_string());
    }
    get_ai_subscription_by_id(conn, id)
}

pub fn delete_ai_subscription(conn: &Connection, id: i64) -> Result<(), String> {
    let changed = conn
        .execute("DELETE FROM ai_subscriptions WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("AI 订阅不存在".to_string());
    }
    Ok(())
}

pub fn save_ai_oauth_tokens(
    conn: &Connection,
    subscription_id: i64,
    oauth_provider: &str,
    tokens: &crate::ai_quota::StoredOAuthTokens,
) -> Result<AiSubscription, String> {
    let json = serde_json::to_string(tokens).map_err(|e| e.to_string())?;
    let changed = conn
        .execute(
            "UPDATE ai_subscriptions
             SET oauth_provider = ?1,
                 oauth_account_id = ?2,
                 oauth_token_json = ?3,
                 account_email = COALESCE(?4, account_email),
                 plan = COALESCE(?5, plan),
                 usage_error = NULL,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?6",
            params![
                oauth_provider,
                tokens.account_id,
                json,
                tokens.email,
                tokens.plan,
                subscription_id
            ],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("AI 订阅不存在".to_string());
    }
    get_ai_subscription_by_id(conn, subscription_id)
}

pub fn disconnect_ai_oauth(conn: &Connection, subscription_id: i64) -> Result<AiSubscription, String> {
    let changed = conn
        .execute(
            "UPDATE ai_subscriptions
             SET oauth_account_id = NULL, oauth_token_json = NULL, usage_error = NULL, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?1",
            [subscription_id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("AI 订阅不存在".to_string());
    }
    get_ai_subscription_by_id(conn, subscription_id)
}

pub fn get_ai_oauth_credentials(
    conn: &Connection,
    subscription_id: i64,
) -> Result<(String, crate::ai_quota::StoredOAuthTokens), String> {
    let (provider_opt, token_raw): (Option<String>, Option<String>) = conn
        .query_row(
            "SELECT oauth_provider, oauth_token_json FROM ai_subscriptions WHERE id = ?1",
            [subscription_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| "AI 订阅不存在".to_string())?;
    let provider = provider_opt
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| "该订阅尚未绑定 OAuth 服务商".to_string())?;
    let raw = token_raw
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| "该订阅尚未授权，请先点击 OAuth 授权".to_string())?;
    let tokens: crate::ai_quota::StoredOAuthTokens =
        serde_json::from_str(&raw).map_err(|_| "已保存的 OAuth 令牌损坏，请重新授权".to_string())?;
    Ok((provider, tokens))
}

pub fn save_ai_usage_result(
    conn: &Connection,
    subscription_id: i64,
    tokens: &crate::ai_quota::StoredOAuthTokens,
    usage_res: Result<&crate::ai_quota::NormalizedUsage, &str>,
) -> Result<AiSubscription, String> {
    let token_json = serde_json::to_string(tokens).map_err(|e| e.to_string())?;
    match usage_res {
        Ok(usage) => {
            let usage_json = serde_json::to_string(usage).map_err(|e| e.to_string())?;
            conn.execute(
                "UPDATE ai_subscriptions
                 SET oauth_token_json = ?1,
                     plan = COALESCE(?2, plan),
                     usage_json = ?3,
                     usage_checked_at = ?4,
                     usage_error = NULL,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?5",
                params![
                    token_json,
                    usage.plan.as_deref().or(tokens.plan.as_deref()),
                    usage_json,
                    usage.checked_at,
                    subscription_id
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        Err(err_msg) => {
            // 保留上次用量并标记 stale，不清空旧数据
            let current = get_ai_subscription_by_id(conn, subscription_id)?;
            let stale_json = current.usage.map(|mut u| {
                u.status = "stale".to_string();
                for w in &mut u.windows {
                    w.stale = true;
                }
                serde_json::to_string(&u).unwrap_or_default()
            });
            conn.execute(
                "UPDATE ai_subscriptions
                 SET oauth_token_json = ?1,
                     usage_json = COALESCE(?2, usage_json),
                     usage_error = ?3,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?4",
                params![token_json, stale_json, err_msg, subscription_id],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    get_ai_subscription_by_id(conn, subscription_id)
}

// ─── 服务器台账与监控 (servers) ────────────────────────────────────

pub const SETTING_SERVER_MONITOR_MINUTES: &str = "server.monitor_minutes";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppMonitorSettings {
    pub server_monitor_minutes: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServerItem {
    pub id: i64,
    pub name: String,
    pub host: String,
    pub port: i64,
    pub username: String,
    pub auth_kind: String,
    pub credential: Option<String>,
    pub passphrase: Option<String>,
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
    pub mem_total_kb: Option<i64>,
    pub disk_total_kb: Option<i64>,
    pub loadavg: Option<String>,
    pub uptime: Option<String>,
    pub services_json: Option<String>,
    pub host_fingerprint: Option<String>,
    pub probed_at: Option<String>,
    pub probe_error: Option<String>,
    pub tags: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServerInput {
    pub name: String,
    pub host: String,
    #[serde(default)]
    pub port: Option<i64>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub auth_kind: Option<String>,
    #[serde(default)]
    pub credential: Option<String>,
    #[serde(default)]
    pub passphrase: Option<String>,
    #[serde(default)]
    pub region: Option<String>,
    #[serde(default)]
    pub os: Option<String>,
    #[serde(default)]
    pub kernel: Option<String>,
    #[serde(default)]
    pub collect_enabled: Option<bool>,
    #[serde(default)]
    pub billing_amount: Option<f64>,
    #[serde(default)]
    pub billing_currency: Option<String>,
    #[serde(default)]
    pub billing_cycle: Option<String>,
    #[serde(default)]
    pub expires_at: Option<String>,
    #[serde(default)]
    pub tags: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServerProbeUpdate {
    pub status: String,
    pub os: Option<String>,
    pub kernel: Option<String>,
    pub cpu: Option<f64>,
    pub memory: Option<f64>,
    pub disk: Option<f64>,
    pub mem_total_kb: Option<i64>,
    pub disk_total_kb: Option<i64>,
    pub loadavg: Option<String>,
    pub uptime: Option<String>,
    pub services_json: Option<String>,
    pub probe_error: Option<String>,
}

const SERVER_COLUMNS: &str = "
    id, name, host, port, username, auth_kind, credential, passphrase,
    region, os, kernel, collect_enabled,
    billing_amount, billing_currency, billing_cycle, expires_at,
    status, cpu, memory, disk, mem_total_kb, disk_total_kb, loadavg, uptime,
    services_json, host_fingerprint, probed_at, probe_error,
    tags, notes, created_at, updated_at
";

fn map_server(row: &Row) -> rusqlite::Result<ServerItem> {
    let collect_int: i64 = row.get("collect_enabled")?;
    Ok(ServerItem {
        id: row.get("id")?,
        name: row.get("name")?,
        host: row.get("host")?,
        port: row.get("port")?,
        username: row.get("username")?,
        auth_kind: row.get("auth_kind")?,
        credential: row.get("credential")?,
        passphrase: row.get("passphrase")?,
        region: row.get("region")?,
        os: row.get("os")?,
        kernel: row.get("kernel")?,
        collect_enabled: collect_int != 0,
        billing_amount: row.get("billing_amount")?,
        billing_currency: row
            .get::<_, Option<String>>("billing_currency")?
            .unwrap_or_else(|| "USD".to_string()),
        billing_cycle: row
            .get::<_, Option<String>>("billing_cycle")?
            .unwrap_or_else(|| "month".to_string()),
        expires_at: row.get("expires_at")?,
        status: row
            .get::<_, Option<String>>("status")?
            .unwrap_or_else(|| "unknown".to_string()),
        cpu: row.get("cpu")?,
        memory: row.get("memory")?,
        disk: row.get("disk")?,
        mem_total_kb: row.get("mem_total_kb")?,
        disk_total_kb: row.get("disk_total_kb")?,
        loadavg: row.get("loadavg")?,
        uptime: row.get("uptime")?,
        services_json: row.get("services_json")?,
        host_fingerprint: row.get("host_fingerprint")?,
        probed_at: row.get("probed_at")?,
        probe_error: row.get("probe_error")?,
        tags: row.get("tags")?,
        notes: row.get("notes")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn validate_server_input(input: &ServerInput) -> Result<(String, String, i64, String, String, Option<f64>, String, String, Option<String>), String> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err("服务器名称不能为空".to_string());
    }
    let host = input.host.trim().to_string();
    if host.is_empty() || host.contains('\n') || host.contains('\r') {
        return Err("主机地址不能为空且不能包含换行".to_string());
    }
    let port = input.port.unwrap_or(22);
    if !(1..=65535).contains(&port) {
        return Err("SSH 端口必须在 1-65535 之间".to_string());
    }
    let username = input
        .username
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("root")
        .to_string();
    let auth_kind = match input.auth_kind.as_deref().map(str::trim) {
        None | Some("") | Some("password") => "password".to_string(),
        Some("key") => "key".to_string(),
        Some(other) => return Err(format!("不支持的认证方式：{}", other)),
    };
    let billing_amount = normalize_billing_amount(input.billing_amount)?;
    let billing_currency = normalize_currency(input.billing_currency.as_deref(), "USD");
    let billing_cycle = normalize_cycle(input.billing_cycle.as_deref(), "month");
    let expires_at = normalize_optional_day(input.expires_at.as_deref())?;
    Ok((
        name,
        host,
        port,
        username,
        auth_kind,
        billing_amount,
        billing_currency,
        billing_cycle,
        expires_at,
    ))
}

pub fn query_servers(conn: &Connection, search: Option<&str>) -> Result<Vec<ServerItem>, String> {
    let kw = search.map(str::trim).filter(|s| !s.is_empty());
    let mut sql = format!("SELECT {} FROM servers", SERVER_COLUMNS);
    let mut rows_out: Vec<ServerItem> = Vec::new();
    if let Some(q) = kw {
        sql.push_str(
            " WHERE name LIKE ?1 OR host LIKE ?1 OR COALESCE(region, '') LIKE ?1 OR COALESCE(tags, '') LIKE ?1 OR COALESCE(notes, '') LIKE ?1",
        );
        sql.push_str(" ORDER BY id DESC");
        let pattern = format!("%{}%", q);
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let iter = stmt.query_map([pattern], map_server).map_err(|e| e.to_string())?;
        for r in iter {
            rows_out.push(r.map_err(|e| e.to_string())?);
        }
    } else {
        sql.push_str(" ORDER BY id DESC");
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let iter = stmt.query_map([], map_server).map_err(|e| e.to_string())?;
        for r in iter {
            rows_out.push(r.map_err(|e| e.to_string())?);
        }
    }
    Ok(rows_out)
}

pub fn get_server_by_id(conn: &Connection, id: i64) -> Result<Option<ServerItem>, String> {
    let sql = format!("SELECT {} FROM servers WHERE id = ?1", SERVER_COLUMNS);
    match conn.query_row(&sql, [id], map_server) {
        Ok(item) => Ok(Some(item)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn require_server_by_id(conn: &Connection, id: i64) -> Result<ServerItem, String> {
    get_server_by_id(conn, id)?.ok_or_else(|| "服务器不存在".to_string())
}

pub fn create_server(conn: &Connection, input: ServerInput) -> Result<ServerItem, String> {
    let (
        name,
        host,
        port,
        username,
        auth_kind,
        billing_amount,
        billing_currency,
        billing_cycle,
        expires_at,
    ) = validate_server_input(&input)?;
    let collect_int: i64 = if input.collect_enabled.unwrap_or(true) { 1 } else { 0 };
    conn.execute(
        "INSERT INTO servers
         (name, host, port, username, auth_kind, credential, passphrase,
          region, os, kernel, collect_enabled,
          billing_amount, billing_currency, billing_cycle, expires_at, tags, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
        params![
            name,
            host,
            port,
            username,
            auth_kind,
            normalize_optional(input.credential.as_deref()),
            normalize_optional(input.passphrase.as_deref()),
            normalize_optional(input.region.as_deref()),
            normalize_optional(input.os.as_deref()),
            normalize_optional(input.kernel.as_deref()),
            collect_int,
            billing_amount,
            billing_currency,
            billing_cycle,
            expires_at,
            normalize_optional(input.tags.as_deref()),
            normalize_optional(input.notes.as_deref()),
        ],
    )
    .map_err(|e| format!("创建服务器失败: {}", e))?;
    require_server_by_id(conn, conn.last_insert_rowid())
}

pub fn update_server(conn: &Connection, id: i64, input: ServerInput) -> Result<ServerItem, String> {
    let existing = require_server_by_id(conn, id)?;
    let (
        name,
        host,
        port,
        username,
        auth_kind,
        billing_amount,
        billing_currency,
        billing_cycle,
        expires_at,
    ) = validate_server_input(&input)?;
    let collect_int: i64 = if input.collect_enabled.unwrap_or(existing.collect_enabled) {
        1
    } else {
        0
    };
    let endpoint_changed = existing.host != host || existing.port != port;
    let next_fingerprint = if endpoint_changed {
        None
    } else {
        existing.host_fingerprint
    };
    conn.execute(
        "UPDATE servers
         SET name = ?1, host = ?2, port = ?3, username = ?4, auth_kind = ?5,
             credential = ?6, passphrase = ?7,
             region = ?8, os = ?9, kernel = ?10, collect_enabled = ?11,
             billing_amount = ?12, billing_currency = ?13, billing_cycle = ?14, expires_at = ?15,
             host_fingerprint = ?16, tags = ?17, notes = ?18, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?19",
        params![
            name,
            host,
            port,
            username,
            auth_kind,
            normalize_optional(input.credential.as_deref()),
            normalize_optional(input.passphrase.as_deref()),
            normalize_optional(input.region.as_deref()),
            normalize_optional(input.os.as_deref()),
            normalize_optional(input.kernel.as_deref()),
            collect_int,
            billing_amount,
            billing_currency,
            billing_cycle,
            expires_at,
            next_fingerprint,
            normalize_optional(input.tags.as_deref()),
            normalize_optional(input.notes.as_deref()),
            id
        ],
    )
    .map_err(|e| format!("更新服务器失败: {}", e))?;
    require_server_by_id(conn, id)
}

pub fn delete_server(conn: &Connection, id: i64) -> Result<(), String> {
    let changed = conn
        .execute("DELETE FROM servers WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("服务器不存在".to_string());
    }
    Ok(())
}

pub fn save_server_probe_result(
    conn: &Connection,
    id: i64,
    update: &ServerProbeUpdate,
) -> Result<ServerItem, String> {
    let changed = conn
        .execute(
            "UPDATE servers
             SET status = ?1,
                 os = COALESCE(?2, os),
                 kernel = COALESCE(?3, kernel),
                 cpu = COALESCE(?4, cpu),
                 memory = COALESCE(?5, memory),
                 disk = COALESCE(?6, disk),
                 mem_total_kb = COALESCE(?7, mem_total_kb),
                 disk_total_kb = COALESCE(?8, disk_total_kb),
                 loadavg = COALESCE(?9, loadavg),
                 uptime = COALESCE(?10, uptime),
                 services_json = COALESCE(?11, services_json),
                 probe_error = ?12,
                 probed_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?13",
            params![
                update.status,
                update.os,
                update.kernel,
                update.cpu,
                update.memory,
                update.disk,
                update.mem_total_kb,
                update.disk_total_kb,
                update.loadavg,
                update.uptime,
                update.services_json,
                update.probe_error,
                id
            ],
        )
        .map_err(|e| format!("保存探测结果失败: {}", e))?;
    if changed == 0 {
        return Err("服务器不存在".to_string());
    }
    require_server_by_id(conn, id)
}

pub fn set_server_host_fingerprint(
    conn: &Connection,
    id: i64,
    fingerprint: &str,
) -> Result<(), String> {
    let trimmed = fingerprint.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    conn.execute(
        "UPDATE servers SET host_fingerprint = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
        params![trimmed, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn reset_server_host_fingerprint(conn: &Connection, id: i64) -> Result<ServerItem, String> {
    let changed = conn
        .execute(
            "UPDATE servers SET host_fingerprint = NULL, probe_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
            [id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("服务器不存在".to_string());
    }
    require_server_by_id(conn, id)
}

pub fn get_app_monitor_settings(conn: &Connection) -> Result<AppMonitorSettings, String> {
    let raw = crate::database::get_setting(conn, SETTING_SERVER_MONITOR_MINUTES)?;
    let parsed = raw
        .as_deref()
        .and_then(|s| s.trim().parse::<u64>().ok())
        .filter(|m| matches!(m, 0 | 1 | 5 | 15 | 30 | 60))
        .unwrap_or(5);
    Ok(AppMonitorSettings {
        server_monitor_minutes: parsed,
    })
}

pub fn save_app_monitor_settings(
    conn: &Connection,
    minutes: u64,
) -> Result<AppMonitorSettings, String> {
    if !matches!(minutes, 0 | 1 | 5 | 15 | 30 | 60) {
        return Err("采集周期只允许设为 0 / 1 / 5 / 15 / 30 / 60 分钟".to_string());
    }
    crate::database::set_setting(
        conn,
        SETTING_SERVER_MONITOR_MINUTES,
        Some(&minutes.to_string()),
    )?;
    get_app_monitor_settings(conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::{create_backup_in_dir_for_test, init_database_at_for_test, restore_from_file_for_test};

    fn open_temp_db(dir: &std::path::Path) -> Connection {
        init_database_at_for_test(&dir.join("data.db"), &dir.join("backups")).unwrap()
    }

    #[test]
    fn test_all_9_asset_tables_exist_after_init() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = open_temp_db(tmp.path());
        for table in ASSET_TABLE_NAMES {
            let exists: i64 = conn
                .query_row(
                    "SELECT COUNT(1) FROM sqlite_master WHERE type='table' AND name=?1",
                    [table],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(exists, 1, "missing table {}", table);
        }
    }

    #[test]
    fn test_reminder_crud_and_repeat_completion() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = open_temp_db(tmp.path());

        let monthly = create_reminder(
            &conn,
            &ReminderInput {
                title: "VPS 续费".to_string(),
                note: Some("检查流量".to_string()),
                due_at: "2026-01-31".to_string(),
                repeat: Some("month".to_string()),
                lead_days: Some(5),
                ref_kind: None,
                ref_id: None,
            },
        )
        .unwrap();

        let today = NaiveDate::from_ymd_opt(2026, 2, 1).unwrap();
        let completed = complete_reminder(&conn, monthly.id, today).unwrap();
        assert!(!completed.done);
        // 1月31日顺延一月，二月只有28天，应钳制到 2026-02-28
        assert_eq!(completed.due_at, "2026-02-28");

        let once = create_reminder(
            &conn,
            &ReminderInput {
                title: "一次性任务".to_string(),
                note: None,
                due_at: "2026-02-01".to_string(),
                repeat: Some("none".to_string()),
                lead_days: Some(3),
                ref_kind: None,
                ref_id: None,
            },
        )
        .unwrap();
        let done_once = complete_reminder(&conn, once.id, today).unwrap();
        assert!(done_once.done);
        assert_eq!(done_once.done_at.as_deref(), Some("2026-02-01"));

        delete_reminder(&conn, once.id).unwrap();
        assert!(get_reminder_by_id(&conn, once.id).is_err());
    }

    #[test]
    fn test_renewals_summary_and_advance() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = open_temp_db(tmp.path());

        conn.execute(
            "INSERT INTO servers (name, host, billing_amount, billing_currency, billing_cycle, expires_at)
             VALUES ('Tokyo-1', '1.2.3.4', 5.0, 'USD', 'month', '2026-11-30')",
            [],
        )
        .unwrap();
        let server_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO domains (name, registrar, billing_amount, billing_currency, billing_cycle, expires_at)
             VALUES ('example.com', 'Cloudflare', 72.0, 'CNY', 'year', '2026-12-10')",
            [],
        )
        .unwrap();

        let today = NaiveDate::from_ymd_opt(2026, 11, 24).unwrap();
        let summary = get_renewals_summary(&conn, 30, today).unwrap();
        assert_eq!(summary.timeline.len(), 2);
        assert_eq!(summary.spend.usd.monthly, 5.0);
        assert_eq!(summary.spend.usd.yearly, 60.0);
        assert_eq!(summary.spend.cny.yearly, 72.0);
        assert_eq!(summary.spend.cny.monthly, 6.0);

        let next = advance_renewal(&conn, "server", server_id).unwrap();
        assert_eq!(next, "2026-12-30");
    }

    #[test]
    fn test_backup_restore_roundtrip_with_asset_tables_and_legacy_compat() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = open_temp_db(tmp.path());

        create_reminder(
            &conn,
            &ReminderInput {
                title: "续费域名".to_string(),
                note: None,
                due_at: "2026-12-01".to_string(),
                repeat: Some("year".to_string()),
                lead_days: Some(7),
                ref_kind: None,
                ref_id: None,
            },
        )
        .unwrap();

        let backup = create_backup_in_dir_for_test(&conn, &tmp.path().join("backups")).unwrap();
        conn.execute("DELETE FROM reminders", []).unwrap();
        assert_eq!(query_reminders(&conn).unwrap().len(), 0);

        restore_from_file_for_test(&conn, &backup).unwrap();
        assert_eq!(query_reminders(&conn).unwrap().len(), 1);

        // 兼容没有新表的旧版备份文件：恢复时新表安全清空，不报错
        let legacy = tmp.path().join("legacy_no_assets.db");
        {
            let old = Connection::open(&legacy).unwrap();
            old.execute_batch(
                "CREATE TABLE accounts (id INTEGER PRIMARY KEY, email TEXT, password TEXT);
                 INSERT INTO accounts VALUES (1, 'legacy@example.com', 'pw');",
            )
            .unwrap();
        }
        restore_from_file_for_test(&conn, &legacy).unwrap();
        assert_eq!(query_reminders(&conn).unwrap().len(), 0);
    }

    #[test]
    fn test_vault_folders_items_and_google_account_set_null() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = open_temp_db(tmp.path());

        // 插入一个关联的谷歌账号
        conn.execute(
            "INSERT INTO accounts (email, password, status, sold_status) VALUES ('linked@gmail.com', 'pw', 'inactive', 'unsold')",
            [],
        )
        .unwrap();
        let g_id = conn.last_insert_rowid();

        let folder = create_vault_folder(
            &conn,
            &VaultFolderInput {
                name: "常用服务".to_string(),
                sort_order: Some(1),
            },
        )
        .unwrap();

        let item = create_vault_item(
            &conn,
            &VaultItemInput {
                kind: Some("account".to_string()),
                name: "GitHub".to_string(),
                url: Some("https://github.com".to_string()),
                username: Some("octocat".to_string()),
                secret_value: Some("s3cr3t".to_string()),
                totp_secret: Some("JBSW Y3DP EHPK 3PXP".to_string()),
                folder_id: Some(folder.id),
                google_account_id: Some(g_id),
                tags: Some("dev".to_string()),
                notes: None,
            },
        )
        .unwrap();
        assert_eq!(item.totp_secret.as_deref(), Some("JBSWY3DPEHPK3PXP"));
        assert_eq!(item.google_account_email.as_deref(), Some("linked@gmail.com"));

        // 批量导入
        let batch = batch_import_vault_items(
            &conn,
            &[
                VaultItemInput {
                    kind: Some("password".to_string()),
                    name: "Notion".to_string(),
                    url: Some("https://notion.so".to_string()),
                    username: Some("u".to_string()),
                    secret_value: Some("p".to_string()),
                    totp_secret: None,
                    folder_id: Some(folder.id),
                    google_account_id: None,
                    tags: None,
                    notes: None,
                },
                VaultItemInput {
                    kind: None,
                    name: "  ".to_string(),
                    url: None,
                    username: None,
                    secret_value: None,
                    totp_secret: None,
                    folder_id: None,
                    google_account_id: None,
                    tags: None,
                    notes: None,
                },
            ],
        )
        .unwrap();
        assert_eq!(batch.created_count, 1);
        assert_eq!(batch.skipped_count, 1);

        // 删除谷歌账号与文件夹后，外键置空而不级联删除条目
        conn.execute("DELETE FROM accounts WHERE id = ?1", [g_id]).unwrap();
        delete_vault_folder(&conn, folder.id).unwrap();
        let reloaded = get_vault_item_by_id(&conn, item.id).unwrap();
        assert!(reloaded.folder_id.is_none());
        assert!(reloaded.google_account_id.is_none());
    }

    #[test]
    fn test_payment_card_crud_and_renewals_integration() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = open_temp_db(tmp.path());

        let card = create_payment_card(
            &conn,
            &PaymentCardInput {
                name: "RedotPay U卡".to_string(),
                issuer: Some("RedotPay".to_string()),
                bank_code: None,
                network: Some("Visa".to_string()),
                funding: Some("预付卡".to_string()),
                form_factor: Some("虚拟卡".to_string()),
                region: Some("中国香港".to_string()),
                region_group: Some("hmt".to_string()),
                last4: None,
                expiry_month: Some("12/29".to_string()),
                card_number: Some("4111 2222 3333 4455".to_string()),
                cvv: Some("888".to_string()),
                cardholder: Some("ZHANG SAN".to_string()),
                billing_address: Some("HK".to_string()),
                billing_amount: Some(10.0),
                billing_currency: Some("USD".to_string()),
                billing_cycle: Some("year".to_string()),
                expires_at: Some("2026-12-15".to_string()),
                tags: Some("U卡".to_string()),
                notes: None,
            },
        )
        .unwrap();
        assert_eq!(card.last4.as_deref(), Some("4455"));

        let summary = get_renewals_summary(
            &conn,
            30,
            NaiveDate::from_ymd_opt(2026, 11, 24).unwrap(),
        )
        .unwrap();
        assert_eq!(summary.timeline.len(), 1);
        assert_eq!(summary.timeline[0].kind, "payment_card");
        assert!(summary.timeline[0].fixed_expiry);
        assert_eq!(summary.spend.usd.yearly, 10.0);

        delete_payment_card(&conn, card.id).unwrap();
        assert_eq!(query_payment_cards(&conn).unwrap().len(), 0);
    }

    #[test]
    fn test_domains_cloudflare_and_ai_subscriptions_crud() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = open_temp_db(tmp.path());

        let cf = save_cloudflare_connection(
            &conn,
            None,
            &CloudflareConnectionInput {
                name: "主账号".to_string(),
                api_token: Some("cf_secret_token_1234567890".to_string()),
            },
            Some("1 个域名"),
        )
        .unwrap();
        assert!(cf.token_hint.contains("••••"));
        assert!(!cf.token_hint.contains("secret_token"));

        let imported = upsert_cloudflare_domains(
            &conn,
            cf.id,
            &[crate::cloudflare::CloudflareZone {
                zone_id: "0123456789abcdef0123456789abcdef".to_string(),
                account_id: None,
                name: "example.org".to_string(),
                status: "active".to_string(),
                name_servers: vec!["a.ns.cloudflare.com".to_string()],
                registrar: Some("Cloudflare".to_string()),
                expires_at: Some("2027-06-01".to_string()),
                auto_renew: Some(true),
            }],
        )
        .unwrap();
        assert_eq!(imported, 1);
        let domains = query_domains(&conn).unwrap();
        assert_eq!(domains.len(), 1);
        assert_eq!(domains[0].cf_connection_id, Some(cf.id));

        let sub = create_ai_subscription(
            &conn,
            &AiSubscriptionInput {
                name: "Claude Pro".to_string(),
                provider: "Claude".to_string(),
                plan: Some("Pro".to_string()),
                account_email: Some("ai@example.com".to_string()),
                key_hint: None,
                billing_amount: Some(20.0),
                billing_currency: Some("USD".to_string()),
                billing_cycle: Some("month".to_string()),
                renews_at: Some("2026-12-05".to_string()),
                google_account_id: None,
                payment_card_id: None,
                oauth_provider: Some("claude".to_string()),
                tags: None,
                notes: None,
            },
        )
        .unwrap();
        assert!(!sub.oauth_connected);

        let tokens = crate::ai_quota::StoredOAuthTokens {
            access_token: "at".to_string(),
            refresh_token: Some("rt".to_string()),
            id_token: None,
            token_expires_at: "2026-12-01T00:00:00Z".to_string(),
            account_id: "acct-1".to_string(),
            email: Some("ai@example.com".to_string()),
            plan: Some("max".to_string()),
        };
        let connected = save_ai_oauth_tokens(&conn, sub.id, "claude", &tokens).unwrap();
        assert!(connected.oauth_connected);
        assert_eq!(connected.plan.as_deref(), Some("max"));

        let usage = crate::ai_quota::normalize_usage(
            "claude",
            &serde_json::json!({ "five_hour": { "utilization": 15.0 } }),
            "2026-11-24T10:00:00Z",
        );
        let with_usage = save_ai_usage_result(&conn, sub.id, &tokens, Ok(&usage)).unwrap();
        assert_eq!(with_usage.usage.as_ref().unwrap().status, "available");

        let stale = save_ai_usage_result(&conn, sub.id, &tokens, Err("网络失败")).unwrap();
        assert_eq!(stale.usage.as_ref().unwrap().status, "stale");
        assert_eq!(stale.usage_error.as_deref(), Some("网络失败"));
    }

    #[test]
    fn test_servers_crud_fingerprint_reset_and_monitor_settings() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = open_temp_db(tmp.path());

        let created = create_server(
            &conn,
            ServerInput {
                name: "Tokyo-VPS".to_string(),
                host: "10.0.0.1".to_string(),
                port: Some(22),
                username: Some("ubuntu".to_string()),
                auth_kind: Some("password".to_string()),
                credential: Some("secret".to_string()),
                passphrase: None,
                region: Some("日本东京".to_string()),
                os: None,
                kernel: None,
                collect_enabled: Some(true),
                billing_amount: Some(5.0),
                billing_currency: Some("USD".to_string()),
                billing_cycle: Some("month".to_string()),
                expires_at: Some("2026-12-30".to_string()),
                tags: Some("prod".to_string()),
                notes: None,
            },
        )
        .unwrap();
        assert_eq!(created.port, 22);
        assert_eq!(created.status, "unknown");
        assert!(created.collect_enabled);

        set_server_host_fingerprint(&conn, created.id, "SHA256:abc123").unwrap();
        let pinned = require_server_by_id(&conn, created.id).unwrap();
        assert_eq!(pinned.host_fingerprint.as_deref(), Some("SHA256:abc123"));

        // 变更端口应自动清除旧指纹
        let changed_port = update_server(
            &conn,
            created.id,
            ServerInput {
                name: "Tokyo-VPS".to_string(),
                host: "10.0.0.1".to_string(),
                port: Some(2222),
                username: Some("ubuntu".to_string()),
                auth_kind: Some("password".to_string()),
                credential: Some("secret".to_string()),
                passphrase: None,
                region: Some("日本东京".to_string()),
                os: None,
                kernel: None,
                collect_enabled: Some(true),
                billing_amount: Some(5.0),
                billing_currency: Some("USD".to_string()),
                billing_cycle: Some("month".to_string()),
                expires_at: Some("2026-12-30".to_string()),
                tags: Some("prod".to_string()),
                notes: None,
            },
        )
        .unwrap();
        assert!(changed_port.host_fingerprint.is_none());

        set_server_host_fingerprint(&conn, created.id, "SHA256:newpin").unwrap();
        let reset = reset_server_host_fingerprint(&conn, created.id).unwrap();
        assert!(reset.host_fingerprint.is_none());

        let updated = save_server_probe_result(
            &conn,
            created.id,
            &ServerProbeUpdate {
                status: "online".to_string(),
                os: Some("Ubuntu 24.04".to_string()),
                kernel: Some("6.8.0".to_string()),
                cpu: Some(12.0),
                memory: Some(45.0),
                disk: Some(30.0),
                mem_total_kb: Some(2_048_000),
                disk_total_kb: Some(20_000_000),
                loadavg: Some("0.10 0.20 0.15".to_string()),
                uptime: Some("10 天".to_string()),
                services_json: Some("{\"ports\":[]}".to_string()),
                probe_error: None,
            },
        )
        .unwrap();
        assert_eq!(updated.status, "online");
        assert_eq!(updated.cpu, Some(12.0));

        assert_eq!(get_app_monitor_settings(&conn).unwrap().server_monitor_minutes, 5);
        assert!(save_app_monitor_settings(&conn, 7).is_err());
        assert_eq!(
            save_app_monitor_settings(&conn, 15)
                .unwrap()
                .server_monitor_minutes,
            15
        );

        assert_eq!(query_servers(&conn, Some("Tokyo")).unwrap().len(), 1);
        delete_server(&conn, created.id).unwrap();
        assert!(get_server_by_id(&conn, created.id).unwrap().is_none());
    }

    #[test]
    fn test_validate_calendar_day_enforces_4_digit_year_bounds() {
        assert_eq!(validate_calendar_day("2026-12-04").unwrap(), "2026-12-04");
        assert!(validate_calendar_day("202612-12-04").is_err());
        assert!(validate_calendar_day("1969-12-31").is_err());
        assert!(validate_calendar_day("2100-01-01").is_err());
        assert!(validate_calendar_day("2026-2-4").is_err());
    }
}
