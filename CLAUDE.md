# CLAUDE.md — 项目指南（自用桌面版）

> 完整架构与约定见 `AGENTS.md`。本文件只列最常用的命令与易踩的坑。

## 项目定位

Google Manager — **本地自用**的谷歌账号管理器。Tauri 2 桌面应用。

自用精简版：**无登录门禁、无加密层、无 HTTP 服务、不对外分发**。
密码与 2FA 密钥以**明文**存于本地 SQLite。

## 常用命令

```bash
# 安装前端依赖
cd frontend && pnpm install

# 桌面开发模式（热重载）
pnpm run dev

# 构建发布版（Windows：exe + MSI + NSIS；macOS：.app + .dmg）
pnpm run build

# 前端单元测试
pnpm run test

# Rust 单元测试
pnpm run test:rust

# Rust 编译检查
pnpm run check:rust
```

**在线更新签名私钥**：`~/.tauri/googlemanager.key`（密码在 `.password`），已写入仓库 Secrets。
`pnpm run build` 有私钥时自动签名并生成更新包，没有时只打普通安装包。私钥丢失 = 已安装版本再也收不到更新，务必备份。

**发布新版本**：改 4 处版本号（`frontend/package.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`），
新增 `.github/release-notes/v<版本号>.md` 后推送。`.github/workflows/release.yml` 会在 Windows 与 macOS 上并行跑测试、构建，
两边都成功后生成 `latest.json` 并创建 tag 与 Release（Windows 安装版 / MSI / 免安装版 + macOS 通用 dmg + 更新包与签名）；
同名 Release 已存在时跳过。已安装的 0.3.0 及以后版本会通过 `latest.json` 收到在线更新。

## 快速定位

| 我想改… | 去这里 |
| --- | --- |
| 界面布局 / 全局状态 | `frontend/src/App.jsx` |
| 账号表格与行内编辑 | `frontend/src/components/AccountTable.jsx` |
| 导入文本解析规则 | `frontend/src/utils/importParser.js` |
| 导出字段与分隔符 | `frontend/src/components/ExportDialog.jsx` + `commands.rs::export_accounts_to_file` |
| 在线更新 | `frontend/src/hooks/useAppUpdater.js` + `UpdateDialog.jsx` + `scripts/make-latest-json.mjs` |
| 2FA 验证码逻辑 | `frontend/src/hooks/useTwoFA.js` + `src-tauri/src/totp.rs` |
| 手机短信验证码 | `frontend/src/hooks/useSmsCodes.js` + `src-tauri/src/sms.rs` |
| 账号独立浏览器（打开/聚焦/清理） | `src-tauri/src/browser.rs` + `frontend/src/hooks/useBrowserStatus.js` + `BrowserSettingsDialog.jsx` |
| 数据库查询 / 迁移 / 备份 | `src-tauri/src/database.rs` |
| Tauri 命令与参数 | `src-tauri/src/commands.rs` + `src-tauri/src/lib.rs` |
| invoke 参数名转换 | `frontend/src/services/adapters/tauri-adapter.ts` |

## 关键约定（易踩坑）

1. **参数命名**：Tauri 2 的 `#[tauri::command]` 默认按 **camelCase** 匹配 Rust 参数名，而结构体字段按 **snake_case**。
   - 顶层 invoke 参数：`accountIds` / `backupName`
   - 嵌套载荷：`account.reg_year` / `config.include_stats`
   - 转换集中在 `prepareInvokeArgs()`，有单测守住 —— **不要**对整个 args 递归做 snake 转换。
   - 「已售出 / 未售出」功能已移除；`accounts.sold_status` 列作为遗留字段保留，仅用于兼容旧库。

2. **只有一种适配器**：`TauriAdapter`。没有 HTTP 回退，没有 `VITE_USE_HTTP`。

3. **明文存储**：`database.rs` 中不再有加解密调用，`password` / `secret` 直接读写。

4. **业务逻辑在 `database.rs`**：`commands.rs` 只是薄包装，新增功能优先加在 `database.rs` 并在 `lib.rs` 的 `generate_handler![]` 登记。

5. **构建输出**：Vite 输出到仓库根 `static/`，由 `tauri.conf.json` 的 `frontendDist` 引用。直接跑 `pnpm run build`（vite）会覆盖被 git 跟踪的 `static/index.html`。

6. **数据目录**：Windows `%APPDATA%\googlemanager\`，macOS `~/Library/Application Support/googlemanager/`，
   可用 `GOOGLE_MANAGER_DATA_DIR` 覆盖。WAL 模式下会有 `data.db-wal` / `data.db-shm` 伴生文件。

7. **历史追踪不含敏感字段**：`TRACKED_FIELDS` 刻意排除 `password` / `secret`。

8. **账号浏览器**：配置目录名是邮箱 sha256 前 12 位（改哈希方式会让已有目录失联，有固定值单测）。
   运行检测：Windows 靠 Chromium 的 `Chrome_MessageWindow`，路径须反斜杠、无结尾分隔符；
   macOS 读配置目录里的 `SingletonLock` 符号链接（`<主机名>-<进程号>`）。
   路径规范化按平台区分（`normalize_windows_path` / `normalize_posix_path`），macOS 上**不能**把 `/` 改成 `\`。
   Windows 上浏览器是管理器的子进程：`tauri dev` 重新编译时会连带结束已打开的浏览器，正常关闭管理器则不会；
   macOS 上经 `open -n -a` 由系统启动，不受管理器影响。
   开发调试建议设 `GOOGLE_MANAGER_DATA_DIR`，配置目录会跟着放到 `<数据目录>/profiles`。
   macOS 真机自测：`cd src-tauri && cargo test -- --ignored macos_real_chrome --nocapture`（会短暂打开 Chrome 窗口）。

9. **判断是否在桌面环境**：用 `utils/tauriRuntime.js::isTauriRuntime()`，**不要**用 `window.__TAURI__`
   （它只在开启 `withGlobalTauri` 时才注入，本项目没开）。

10. **确认框不要用 `window.confirm` / `window.prompt`**：对话框插件把 `window.confirm` 换成了异步版本（返回 Promise，
    `if (!window.confirm())` 恒为真），macOS 不支持 `window.prompt`。用 `utils/dialogs.js`（`await confirmDialog()`）
    与 `components/PromptDialog.jsx`；普通提示用 `onNotify`。

11. **导出**由后端 `export_accounts_to_file` 直接写文件；前端只负责 `save()` 选位置。

12. **时间戳是 UTC**：数据库里的时间由 SQLite `CURRENT_TIMESTAMP` 写入，显示前用 `formatDbTimestamp` 换算本机时间。

13. **取码失败不抛异常**：`api.fetchSmsCode` 出错时返回 `status: 'error'`，`useSmsCodes` 据此退避并把旧码标为「上次」。

## 已知取舍（刻意未修）

按「不影响本地使用」的取舍保留，改之前请先确认必要性：

- 批量删除无二次确认；批量设置时空输入按回车会清空字段
- `AccountTable` 无行级 memo / 虚拟滚动
- `init_database()` 失败时 `expect` panic
- 导入解析器对含分隔符的密码、空段等边界输入存在误判
