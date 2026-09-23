use std::time::{SystemTime, UNIX_EPOCH};
use totp_rs::{Algorithm, Secret, TOTP};

pub struct TotpResult {
    pub code: String,
    pub remaining: u32,
}

/// 共享 TOTP 生成逻辑（供 commands 和 http_server 共用）
pub fn generate_totp(secret: &str) -> Result<TotpResult, String> {
    let secret_clean = secret.replace(" ", "").to_uppercase();

    let totp = TOTP::new(
        Algorithm::SHA1,
        6,
        1,
        30,
        Secret::Encoded(secret_clean)
            .to_bytes()
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    let code = totp.generate_current().map_err(|e| e.to_string())?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let remaining = 30 - (now % 30) as u32;

    Ok(TotpResult { code, remaining })
}
