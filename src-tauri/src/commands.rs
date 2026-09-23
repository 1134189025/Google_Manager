use crate::database::{
    self, build_export_accounts_output, Account, AccountHistory, AccountInput, BackupInfo,
    Database, ExportConfig,
};
use tauri::State;

#[tauri::command]
pub fn get_accounts(db: State<Database>, search: Option<String>) -> Result<Vec<Account>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    database::query_accounts(&conn, search.as_deref())
}

#[tauri::command]
pub fn create_account(db: State<Database>, account: AccountInput) -> Result<Account, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    database::create_account(&conn, &account)
}

#[tauri::command]
pub fn update_account(
    db: State<Database>,
    id: i64,
    account: AccountInput,
) -> Result<Account, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    database::update_account(&conn, id, &account)
}

#[tauri::command]
pub fn delete_account(db: State<Database>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    database::delete_account(&conn, id)
}

#[tauri::command]
pub fn delete_all_accounts(db: State<Database>) -> Result<usize, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    database::delete_all_accounts(&conn)
}

#[tauri::command]
pub fn get_deleted_accounts(db: State<Database>) -> Result<Vec<Account>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    database::query_deleted_accounts(&conn)
}

#[tauri::command]
pub fn restore_account(db: State<Database>, id: i64) -> Result<Account, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    database::restore_account(&conn, id)
}

#[tauri::command]
pub fn purge_account(db: State<Database>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    database::purge_account(&conn, id)
}

#[tauri::command]
pub fn purge_all_deleted(db: State<Database>) -> Result<usize, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    database::purge_all_deleted(&conn)
}

#[tauri::command]
pub fn create_backup(db: State<Database>, reason: Option<String>) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let path = database::create_backup(&conn, reason.as_deref())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn list_backups(_db: State<Database>) -> Result<Vec<BackupInfo>, String> {
    database::list_backups()
}

#[tauri::command]
pub fn restore_backup(db: State<Database>, backup_name: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    database::restore_backup(&conn, &backup_name)
}

#[tauri::command]
pub fn toggle_status(db: State<Database>, id: i64) -> Result<Account, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    database::toggle_status(&conn, id)
}

#[tauri::command]
pub fn get_account_history(
    db: State<Database>,
    account_id: i64,
) -> Result<Vec<AccountHistory>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    database::get_account_history(&conn, account_id)
}

#[tauri::command]
pub fn get_account_by_id(db: State<Database>, id: i64) -> Result<Account, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    database::get_account_by_id(&conn, id)
}

#[derive(serde::Serialize)]
pub struct TotpResult {
    pub code: String,
    pub remaining: u32,
}

#[tauri::command]
pub fn generate_totp(secret: String) -> Result<TotpResult, String> {
    let result = crate::totp::generate_totp(&secret)?;
    Ok(TotpResult {
        code: result.code,
        remaining: result.remaining,
    })
}

#[derive(serde::Serialize)]
pub struct BatchImportResult {
    pub success_count: i32,
    pub failed_count: i32,
}

#[tauri::command]
pub fn batch_import(
    db: State<Database>,
    accounts: Vec<AccountInput>,
) -> Result<BatchImportResult, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let (success_count, failed_count) = database::batch_import(&conn, &accounts)?;
    Ok(BatchImportResult {
        success_count,
        failed_count,
    })
}

#[tauri::command]
pub async fn fetch_sms_code(
    db: State<'_, Database>,
    sms: State<'_, crate::sms::SmsService>,
    account_id: i64,
) -> Result<crate::sms::SmsFetchResult, String> {
    // 只在块作用域内持有数据库锁，await 之前必须释放，避免网络等待期间阻塞其它命令
    let sms_url = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        database::get_account_by_id(&conn, account_id)
            .ok()
            .and_then(|account| account.sms_url)
            .filter(|url| !url.trim().is_empty())
    };

    let Some(sms_url) = sms_url else {
        return Ok(crate::sms::SmsFetchResult::no_config(
            "该账号未配置手机接码地址",
        ));
    };

    Ok(sms.fetch(&sms_url).await)
}

#[tauri::command]
pub fn export_accounts_text(
    db: State<Database>,
    account_ids: Option<Vec<i64>>,
    search: Option<String>,
    config: ExportConfig,
) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let accounts =
        database::query_accounts_for_export(&conn, account_ids.as_deref(), search.as_deref())?;

    let mut output = String::new();

    // 统计汇总
    if config.include_stats {
        let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let total = accounts.len();
        let pro_count = accounts.iter().filter(|a| a.status == "pro").count();
        let normal_count = total - pro_count;

        output.push_str(&format!("========== 账号统计汇总 ==========\n"));
        output.push_str(&format!("导出时间: {}\n", now));
        output.push_str(&format!("总账号数: {}\n", total));
        output.push_str(&format!(
            "Pro账号: {} | 普通账号: {}\n",
            pro_count, normal_count
        ));

        // 标签分布
        let mut group_counts: std::collections::HashMap<String, usize> =
            std::collections::HashMap::new();
        for acc in &accounts {
            if let Some(ref g) = acc.group_name {
                if !g.is_empty() {
                    for tag in g.split(|c: char| c == ',' || c == '，' || c.is_whitespace()) {
                        let tag = tag.trim();
                        if !tag.is_empty() {
                            *group_counts.entry(tag.to_string()).or_insert(0) += 1;
                        }
                    }
                }
            }
        }
        if !group_counts.is_empty() {
            output.push_str("\n标签分布:\n");
            let mut groups: Vec<_> = group_counts.into_iter().collect();
            groups.sort_by(|a, b| b.1.cmp(&a.1));
            for (name, count) in &groups {
                output.push_str(&format!("  - {}: {} 个\n", name, count));
            }
        }

        // 国家分布
        let mut country_counts: std::collections::HashMap<String, usize> =
            std::collections::HashMap::new();
        for acc in &accounts {
            if let Some(ref c) = acc.country {
                if !c.is_empty() {
                    *country_counts.entry(c.clone()).or_insert(0) += 1;
                }
            }
        }
        if !country_counts.is_empty() {
            output.push_str("\n国家分布:\n");
            let mut countries: Vec<_> = country_counts.into_iter().collect();
            countries.sort_by(|a, b| b.1.cmp(&a.1));
            for (name, count) in &countries {
                output.push_str(&format!("  - {}: {} 个\n", name, count));
            }
        }

        // 注册年份分布
        let mut year_counts: std::collections::HashMap<String, usize> =
            std::collections::HashMap::new();
        for acc in &accounts {
            if let Some(ref y) = acc.reg_year {
                if !y.is_empty() {
                    *year_counts.entry(y.clone()).or_insert(0) += 1;
                }
            }
        }
        if !year_counts.is_empty() {
            output.push_str("\n注册年份分布:\n");
            let mut years: Vec<_> = year_counts.into_iter().collect();
            years.sort_by(|a, b| a.0.cmp(&b.0));
            for (year, count) in &years {
                output.push_str(&format!("  - {}: {} 个\n", year, count));
            }
        }

        output.push_str("=====================================\n\n");
    }

    // 导出账号数据（在内存中完成排序/分组，避免动态 SQL 带来的注入风险）
    output.push_str(&build_export_accounts_output(accounts, &config));

    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::{ExportAccountOrder, ExportCategorySort};
    use rusqlite::{params, Connection};

    fn setup_export_query_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE IF NOT EXISTS accounts (\
                id INTEGER PRIMARY KEY AUTOINCREMENT,\
                email TEXT NOT NULL,\
                password TEXT NOT NULL,\
                recovery TEXT,\
                phone TEXT,\
                secret TEXT,\
                sms_url TEXT,\
                reg_year TEXT,\
                country TEXT,\
                group_name TEXT,\
                remark TEXT,\
                status TEXT DEFAULT \"inactive\",\
                sold_status TEXT DEFAULT \"unsold\",\
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,\
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,\
                deleted_at TEXT\
            )",
            [],
        )
        .unwrap();
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_email_active ON accounts(email) WHERE deleted_at IS NULL",
            [],
        )
        .unwrap();
        conn
    }

    fn build_test_account(id: i64, email: &str, country: Option<&str>) -> Account {
        Account {
            id,
            email: email.to_string(),
            password: "pwd".to_string(),
            recovery: None,
            phone: None,
            secret: None,
            sms_url: None,
            reg_year: None,
            country: country.map(|value| value.to_string()),
            group_name: None,
            remark: None,
            status: "inactive".to_string(),
            sold_status: "unsold".to_string(),
            created_at: "2026-01-01 00:00:00".to_string(),
            updated_at: "2026-01-01 00:00:00".to_string(),
            deleted_at: None,
        }
    }

    fn build_base_export_config() -> ExportConfig {
        ExportConfig {
            separator: "----".to_string(),
            fields: vec!["email".to_string()],
            include_stats: false,
            account_order: ExportAccountOrder::default(),
            category_sort: ExportCategorySort::default(),
            category_label_template: None,
        }
    }

    #[test]
    fn test_export_query_uses_search_branch_when_account_ids_is_empty() {
        let conn = setup_export_query_test_db();

        conn.execute(
            "INSERT INTO accounts (email, password, remark, status, sold_status) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["matched@example.com", "pwd1", "target remark", "pro", "sold"],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO accounts (email, password, remark, status, sold_status) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["other@example.com", "pwd2", "other remark", "inactive", "unsold"],
        )
        .unwrap();

        let empty_ids: [i64; 0] = [];
        let accounts =
            database::query_accounts_for_export(&conn, Some(&empty_ids), Some("target")).unwrap();

        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].email, "matched@example.com");
    }

    #[test]
    fn test_export_output_keeps_original_order_without_sort_or_group() {
        let accounts = vec![
            build_test_account(3, "c@example.com", Some("US")),
            build_test_account(2, "a@example.com", Some("CN")),
        ];
        let config = build_base_export_config();

        let output = build_export_accounts_output(accounts, &config);

        assert_eq!(output, "c@example.com\na@example.com\n");
    }

    #[test]
    fn test_export_output_applies_sort_field_and_direction() {
        let accounts = vec![
            build_test_account(3, "c@example.com", Some("US")),
            build_test_account(2, "a@example.com", Some("CN")),
            build_test_account(1, "b@example.com", Some("CN")),
        ];
        let mut config = build_base_export_config();
        config.account_order.field = Some("email".to_string());
        config.account_order.direction = Some("asc".to_string());

        let asc_output = build_export_accounts_output(accounts.clone(), &config);
        assert_eq!(asc_output, "a@example.com\nb@example.com\nc@example.com\n");

        config.account_order.direction = Some("desc".to_string());
        let desc_output = build_export_accounts_output(accounts, &config);
        assert_eq!(desc_output, "c@example.com\nb@example.com\na@example.com\n");
    }

    #[test]
    fn test_export_output_applies_group_field_direction_and_template() {
        let accounts = vec![
            build_test_account(3, "c@example.com", Some("CN")),
            build_test_account(2, "a@example.com", Some("US")),
            build_test_account(1, "b@example.com", Some("CN")),
        ];
        let mut config = build_base_export_config();
        config.account_order.field = Some("email".to_string());
        config.account_order.direction = Some("asc".to_string());
        config.category_sort.field = Some("country".to_string());
        config.category_sort.direction = Some("desc".to_string());
        config.category_label_template =
            Some("分组:{index}:{groupField}:{groupValue}:{count}".to_string());

        let output = build_export_accounts_output(accounts, &config);

        assert_eq!(
            output,
            "分组:1:country:US:1\na@example.com\n\n分组:2:country:CN:2\nb@example.com\nc@example.com\n"
        );
    }

    #[test]
    fn test_export_output_uses_default_group_template_when_template_empty() {
        let accounts = vec![build_test_account(1, "a@example.com", None)];
        let mut config = build_base_export_config();
        config.category_sort.field = Some("country".to_string());
        config.category_label_template = Some("   ".to_string());

        let output = build_export_accounts_output(accounts, &config);

        assert_eq!(output, "1. country: 未设置（共 1 条）\na@example.com\n");
    }

    #[test]
    fn test_export_output_ignores_invalid_sort_and_group_config() {
        let accounts = vec![
            build_test_account(3, "c@example.com", Some("US")),
            build_test_account(2, "a@example.com", Some("CN")),
        ];
        let mut config = build_base_export_config();
        config.account_order.field = Some("not_exists".to_string());
        config.account_order.direction = Some("invalid_direction".to_string());
        config.category_sort.field = Some("also_not_exists".to_string());
        config.category_sort.direction = Some("invalid_direction".to_string());

        let output = build_export_accounts_output(accounts, &config);

        assert_eq!(output, "c@example.com\na@example.com\n");
    }

    #[test]
    fn test_totp_generation() {
        let secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP".to_string();
        let result = crate::totp::generate_totp(&secret);

        assert!(result.is_ok());
        let totp_result = result.unwrap();
        assert_eq!(totp_result.code.len(), 6);
        assert!(totp_result.remaining <= 30);
        assert!(totp_result.remaining >= 1);
    }

    #[test]
    fn test_totp_with_spaces() {
        let secret = "JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP".to_string();
        let result = crate::totp::generate_totp(&secret);

        assert!(result.is_ok());
        let totp_result = result.unwrap();
        assert_eq!(totp_result.code.len(), 6);
    }

    #[test]
    fn test_totp_lowercase() {
        let secret = "jbswy3dpehpk3pxpjbswy3dpehpk3pxp".to_string();
        let result = crate::totp::generate_totp(&secret);

        assert!(result.is_ok());
    }

    #[test]
    fn test_totp_invalid_secret() {
        let secret = "invalid!@#".to_string();
        let result = crate::totp::generate_totp(&secret);

        assert!(result.is_err());
    }

    #[test]
    fn test_totp_consistency() {
        let secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP".to_string();
        let result1 = crate::totp::generate_totp(&secret).unwrap();
        let result2 = crate::totp::generate_totp(&secret).unwrap();

        if result1.remaining == result2.remaining {
            assert_eq!(result1.code, result2.code);
        }
    }

    /// 无接码地址的账号：必须直接返回 no_config，且不发起任何网络请求
    #[test]
    fn test_sms_command_without_config_returns_no_config() {
        let conn = setup_export_query_test_db();
        conn.execute(
            "INSERT INTO accounts (email, password, status, sold_status) VALUES (?1, ?2, 'inactive', 'unsold')",
            params!["no_sms@example.com", "pwd"],
        )
        .unwrap();

        let account_id: i64 = conn
            .query_row(
                "SELECT id FROM accounts WHERE email = 'no_sms@example.com'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        // 复现命令里「读取 sms_url」的取值逻辑
        let sms_url = database::get_account_by_id(&conn, account_id)
            .ok()
            .and_then(|account| account.sms_url)
            .filter(|url| !url.trim().is_empty());

        assert!(sms_url.is_none(), "未配置接码地址时不应触发网络请求");
    }

    /// 有接码地址的账号：命令应把完整的 URL 交给取码服务（含查询参数）
    #[test]
    fn test_sms_command_reads_full_url_from_database() {
        let conn = setup_export_query_test_db();
        let url = "https://sms6688.com/api/sms/recordText?token=abc123&tpl=1";
        conn.execute(
            "INSERT INTO accounts (email, password, sms_url, status, sold_status) VALUES (?1, ?2, ?3, 'inactive', 'unsold')",
            params!["with_sms@example.com", "pwd", url],
        )
        .unwrap();

        let account_id: i64 = conn
            .query_row(
                "SELECT id FROM accounts WHERE email = 'with_sms@example.com'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        let sms_url = database::get_account_by_id(&conn, account_id)
            .ok()
            .and_then(|account| account.sms_url)
            .filter(|value| !value.trim().is_empty());

        // token 与 tpl 必须完整保留，不能被截断
        assert_eq!(sms_url.as_deref(), Some(url));
    }
}
