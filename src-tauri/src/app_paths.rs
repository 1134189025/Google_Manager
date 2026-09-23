use std::fs;
use std::path::PathBuf;

const DATA_DIR_ENV: &str = "GOOGLE_MANAGER_DATA_DIR";

pub fn resolve_data_dir(env_value: Option<&str>, default_base: Option<PathBuf>) -> PathBuf {
    if let Some(value) = env_value.map(str::trim).filter(|value| !value.is_empty()) {
        return PathBuf::from(value);
    }

    let mut path =
        default_base.unwrap_or_else(|| dirs::data_dir().unwrap_or_else(|| PathBuf::from(".")));
    path.push("googlemanager");
    path
}

pub fn data_dir() -> PathBuf {
    let path = resolve_data_dir(std::env::var(DATA_DIR_ENV).ok().as_deref(), None);
    if let Err(error) = fs::create_dir_all(&path) {
        log::error!("创建数据目录失败: {}", error);
    }
    path
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_data_dir_prefers_env_value() {
        let resolved = resolve_data_dir(Some("/tmp/google-manager-preview/demo"), None);
        assert_eq!(resolved, PathBuf::from("/tmp/google-manager-preview/demo"));
    }

    #[test]
    fn resolve_data_dir_falls_back_to_default_base() {
        let resolved = resolve_data_dir(None, Some(PathBuf::from("/tmp/base-dir")));
        assert_eq!(resolved, PathBuf::from("/tmp/base-dir/googlemanager"));
    }

    #[test]
    fn resolve_data_dir_ignores_blank_env_value() {
        let resolved = resolve_data_dir(Some("   "), Some(PathBuf::from("/tmp/base-dir")));
        assert_eq!(resolved, PathBuf::from("/tmp/base-dir/googlemanager"));
    }

    #[test]
    fn resolve_data_dir_trims_env_value() {
        let resolved = resolve_data_dir(Some("  /tmp/google-manager-preview/trimmed  "), None);
        assert_eq!(
            resolved,
            PathBuf::from("/tmp/google-manager-preview/trimmed")
        );
    }
}
