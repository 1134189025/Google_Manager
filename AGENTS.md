# AGENTS.md — Google Manager 代码库文档（自用桌面版）

> 自用精简版 · 最后更新 2026-09-23

## 项目定位

**Google Manager** — 本地自用的谷歌账号管理器。Tauri 2 桌面应用。

本版本已按自用需求精简：

- **无登录门禁**：删除了 `auth.rs` 与登录页，打开即用
- **无加密层**：删除了 `crypto.rs` / `key_manager.rs` / `master.key`，密码与 2FA 密钥**明文**存于本地 SQLite
- **无 HTTP 服务**：删除了 `http_server.rs` 与 `test-server` feature，不再依赖 actix-web；应用不监听任何端口
  （短信取码用 `reqwest` 发出站请求，`tokio` 只启用 `time` / `sync` 特性）

## 架构总览

```
┌────────────────────────────────────────────────────────┐
│              React 18 前端 (Vite 4/5)                   │
│   App.jsx → AccountListView / ImportView / EditModal   │
│                     ↓ services/api.js (Facade)         │
│              adapters/index.ts (Factory)               │
│                        ↓                               │
│                   TauriAdapter                         │
│              (invoke → Rust，唯一后端)                   │
└────────────────────────┬───────────────────────────────┘
                         ▼
┌────────────────────────────────────────────────────────┐
│                  Tauri/Rust (src-tauri/)               │
│      lib.rs (Builder + 27 个命令注册)                   │
│              commands.rs（薄包装层）                     │
│   database.rs（仓储/迁移/备份/导出）+ browser.rs / sms.rs │
│                      ↓                                 │
│                  SQLite (WAL)                          │
│         %APPDATA%\googlemanager\data.db                │
└────────────────────────────────────────────────────────┘
```

## 目录结构

```
/
├── frontend/src/
│   ├── App.jsx               # 根组件：全局状态、视图路由、搜索防抖、2FA
│   ├── components/           # AccountListView / AccountTable / BatchToolbar /
│   │                         # ImportView / ExportDialog / HistoryDrawer /
│   │                         # EditModal / Pagination / SmsCodeCell / BrowserSettingsDialog
│   ├── hooks/                # useTwoFA / useInlineEdit / useAccountSelection / usePagination /
│   │                         # useSmsCodes / useBrowserStatus
│   ├── services/
│   │   ├── api.js            # 统一 API 门面（Facade）
│   │   ├── types.ts          # ApiAdapter 接口 + 类型定义
│   │   ├── utils.ts          # camelCase ↔ snake_case 转换
│   │   └── adapters/
│   │       ├── index.ts          # 工厂（只有 TauriAdapter）
│   │       └── tauri-adapter.ts  # invoke 封装 + 参数命名转换
│   ├── utils/                # importParser / phoneUtils / multiValueField / buildInfo /
│   │                         # smsUtils / browserUtils / timeUtils / tauriRuntime
│   └── __tests__/            # Vitest 单元测试
│
├── src-tauri/
│   ├── Cargo.toml
│   ├── build.rs              # tauri_build::build()
│   ├── tauri.conf.json       # frontendDist: ../static
│   ├── capabilities/default.json
│   └── src/
│       ├── main.rs           # 入口：app_lib::run()
│       ├── lib.rs            # Tauri builder + 命令注册
│       ├── commands.rs       # #[tauri::command] 命令层
│       ├── database.rs       # Database struct + 仓储/迁移/备份/导出
│       ├── browser.rs        # 账号独立浏览器：配置目录、启动/聚焦、缓存清理
│       ├── sms.rs            # 接码地址取短信验证码（出站请求）
│       ├── totp.rs           # TOTP 生成（SHA1/6位/30秒）
│       └── app_paths.rs      # 数据目录解析
│
├── static/                   # Vite 构建输出（被 tauri.conf.json 引用）
├── Makefile
└── package.json              # 根脚本：dev / build / test
```

## 命令清单（`commands.rs`，27 个）

| 命令 | 功能 |
|------|------|
| `get_accounts` | 查询列表（search 筛选） |
| `create_account` | 创建账号（默认 inactive） |
| `update_account` | 更新账号 + 追踪字段变更；邮箱变化时同步重命名浏览器配置目录 |
| `delete_account` | 软删除账号 |
| `delete_all_accounts` | 全部软删除（自动先备份） |
| `get_deleted_accounts` | 查询回收站 |
| `restore_account` | 从回收站恢复 |
| `purge_account` | 彻底删除单个 |
| `purge_all_deleted` | 彻底清空回收站 |
| `create_backup` | 创建备份（VACUUM INTO） |
| `list_backups` | 列出备份 |
| `restore_backup` | 从备份恢复 |
| `toggle_status` | 切换 pro ↔ inactive |
| `get_account_history` | 变更历史（时间倒序） |
| `get_account_by_id` | 按 ID 查询 |
| `generate_totp` | 生成 2FA（SHA1/6位/30秒） |
| `batch_import` | 批量导入（单事务） |
| `export_accounts_text` | 导出文本（自定义字段/分隔符/排序/分组） |
| `fetch_sms_code` | 按账号的 `sms_url` 实时获取手机短信验证码（网络等待期间不持有数据库锁） |
| `open_account_browser` | 打开账号浏览器：未运行则启动，运行中则切到已有窗口 |
| `get_browser_statuses` | 按邮箱批量查询配置目录状态（none / created / running） |
| `clear_browser_cache` | 清理缓存（`accountIds` 为空表示全部），运行中的跳过 |
| `delete_browser_profiles` | 按邮箱删除配置目录；仍被账号记录使用或运行中的跳过 |
| `get_browser_settings` | 读取浏览器程序、配置根目录（含自动检测结果与默认值） |
| `save_browser_settings` | 校验并保存浏览器设置 |
| `get_browser_usage` | 统计配置目录数量与总占用 |
| `open_browser_profile_dir` | 用资源管理器打开账号的配置目录 |

## 数据库 Schema

```sql
-- accounts 表
id INTEGER PRIMARY KEY AUTOINCREMENT,
email TEXT NOT NULL,
password TEXT NOT NULL,       -- 自用版：明文
recovery TEXT, phone TEXT,
secret TEXT,                  -- 自用版：明文
sms_url TEXT,                 -- 手机接码地址（含 token，明文；不进历史表）
reg_year TEXT, country TEXT, group_name TEXT, remark TEXT,
status TEXT DEFAULT 'inactive',      -- pro | inactive
sold_status TEXT DEFAULT 'unsold',   -- 遗留字段：UI/命令已不再使用，保留以兼容旧库
created_at TEXT DEFAULT CURRENT_TIMESTAMP,
updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
deleted_at TEXT                -- 软删除标记

-- account_history 表
id, account_id, field_name, old_value, new_value, changed_at
FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE

-- app_settings 表（键值设置；restore_backup 不覆盖）
key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT
-- 已用键：browser.path / browser.profiles_root

-- 索引
idx_accounts_sold_status
idx_accounts_email_active  -- UNIQUE ... WHERE deleted_at IS NULL
idx_accounts_deleted_at
```

**注意**：`PRAGMA foreign_keys = ON` 与 `journal_mode = WAL` 在 `init_database()` 中设置。测试夹具必须自行开启 `foreign_keys` 才能验证级联删除。

**时间戳**：`created_at` / `updated_at` / `deleted_at` / `changed_at` 由 SQLite `CURRENT_TIMESTAMP` 写入，是 **UTC**。
界面显示前用 `utils/timeUtils.js::formatDbTimestamp` 换算本机时间；导出文本在 `database.rs::utc_timestamp_to_local` 换算。

**旧库迁移**：旧版 `email TEXT UNIQUE` 内联约束由 `ensure_soft_delete_unique_migration` 按「建新表 → 复制 → 删旧表 → 改名」重建，
缺失的列用默认值补齐；它自行关闭并还原 `foreign_keys`，不依赖调用顺序。

**备份**：`create_backup` 用 `VACUUM INTO`；启动时的例行备份（文件名含 `_startup_`）最多保留 10 份，
删除全部 / 恢复 / 迁移前等其他备份另外最多保留 20 份，互不挤占。
`restore_backup` 的 `ATTACH` / `DETACH` 必须在事务之外（事务内 `DETACH` 会报 `database backup_db is locked`）。

## 关键约定

1. **语言**：中文（注释、UI、commit message）
2. **前端**：组件用 JSX，`services/` 与 `adapters/` 用 TypeScript
3. **包管理**：pnpm（前端）、cargo（Rust）
4. **命名**：前端 camelCase ↔ 后端 snake_case。**Tauri 顶层参数用 camelCase，嵌套载荷用 snake_case** —— 由 `tauri-adapter.ts::prepareInvokeArgs()` 转换
5. **构建**：Vite 输出到根 `static/`
6. **数据目录**：`%APPDATA%\googlemanager\`，可用 `GOOGLE_MANAGER_DATA_DIR` 覆盖；
   浏览器配置目录另见「账号独立浏览器」
7. **状态值**：`status` = `"pro"` | `"inactive"`。`sold_status` 为遗留列，界面与命令均不再暴露
8. **历史追踪**：`database.rs::TRACKED_FIELDS` 只含 `email`/`recovery`/`phone`/`reg_year`/`country`/`group_name`/`remark`（不含 `password`/`secret`）

## 测试

| 层 | 框架 | 命令 |
|----|------|------|
| 前端单元 | Vitest + jsdom | `cd frontend && pnpm test -- --run` |
| Rust 单元 | cargo test | `cd src-tauri && cargo test` |

## 开发指南

### 添加新字段

1. **数据库**：在 `database.rs::init_database()` 的迁移数组添加列名
2. **Rust 模型**：更新 `Account` / `AccountInput` struct
3. **Database 方法**：更新 INSERT / UPDATE / `ACCOUNT_COLUMNS`
4. **命令层**：`commands.rs` 一般无需改动
5. **前端类型**：更新 `frontend/src/services/types.ts`
6. **前端组件**：更新相关视图

### 手机接码地址与短信验证码

- 一个账号绑定**一个手机号 + 一个接码地址**（`sms_url`），不存运行时验证码
- 表格列顺序：`2FA → 手机 → 手机验证码 → 标签`；该列不参与排序
- 轮询范围：**只查当前页**已配置接码地址的账号，默认约 5 秒一轮；
  账号越多单账号周期越长（账号数 × 1 秒，保证整体约 1 次/秒），并发上限 3
- 失败退避 10/20/40/60 秒；`NO|已失效...` 会暂停自动重试，需手动点刷新；
  窗口隐藏时暂停，恢复可见立即刷新一次
- 验证码、短信原文只存在于前端内存（`useSmsCodes`），不写数据库、不写账号历史、
  不改变 `updated_at`；`sms_url` 含 token，故也不进 `TRACKED_FIELDS`
- 界面与 tooltip 只展示来源域名（`describeSmsUrl`），不展示 token；复制验证码时只复制验证码本身
- 请求失败时保留的旧验证码会标注「上次」，倒计时表示「下次刷新」，不是短信有效期
- `api.fetchSmsCode` 出错时不抛异常，而是返回 `status: 'error'`；`useSmsCodes` 必须把它当失败处理（退避 + 「上次」），
  测试里要用这种返回形状，而不是只用 `mockRejectedValue`
- 迁移保护：`init_database()` 在改动旧库前会先做一次 `before_migration` 备份，
  备份失败则中止升级；旧备份（无 `sms_url` 列）恢复时按 `NULL` 处理

### 账号独立浏览器

- 一个账号对应一个 Chrome / Edge 配置目录（`--user-data-dir`），只做会话隔离：
  不做指纹伪装，不用 CDP / 远程调试等自动化接口
- **目录名**：`sha256(小写(去首尾空格(email)))` 前 12 位十六进制（`browser::profile_key`，有固定值单测守住）。
  不用 id：「删除全部 → 重新导入」会换 id；不用邮箱原文：Chrome 内部路径很深，易超 260 字符
- **配置根目录**：设置 `browser.profiles_root` 优先；否则设置了 `GOOGLE_MANAGER_DATA_DIR` 时为
  `<数据目录>\profiles`；否则 `%LOCALAPPDATA%\googlemanager\profiles`。首次点「打开」前会弹设置确认
- **运行检测**：Chromium 单实例消息窗口（类名 `Chrome_MessageWindow`，标题为配置目录路径）。
  `FindWindowExW(HWND_MESSAGE, …)` 即可拿到主进程号；标题须反斜杠、无结尾分隔符（`normalize_path_str`），
  比较不区分大小写。无内存状态，管理器重启后照样有效。已实测 Chrome 与 Edge
- **聚焦**：取该进程最上层、**无所有者**的可见 `Chrome_WidgetWin_1`（跳过「要恢复页面吗？」等气泡），
  最小化则还原；`SetForegroundWindow` 被拒时最小化再还原
- **启动参数**：`--user-data-dir --no-first-run --no-default-browser-check --window-name=<邮箱>`；
  首次打开附带 Google 登录页。以 `DETACHED_PROCESS` 启动，正常关闭管理器不影响浏览器
  （但「结束进程树」会连带结束浏览器，`tauri dev` 重新编译时即如此）
- **缓存清理**白名单：根层 `GrShaderCache` / `ShaderCache` / `GraphiteDawnCache` / `*Metrics`；
  `Default` 与 `Profile *` 下 `Cache` / `Code Cache` / `GPUCache` / `Dawn*Cache` / `Service Worker` 缓存。
  不碰 `Network`（cookie）、`Local Storage`、`IndexedDB`、`optimization_guide_model_store`
- **删除**：进回收站保留目录；彻底删除时前端询问，后端跳过仍被任意账号记录（含回收站）使用或运行中的目录
- **改邮箱**：运行中拒绝；目标目录已存在拒绝（不自动合并）；数据库失败则回滚目录名
- 配置目录**不在备份范围**；cookie 由 Windows 加密并绑定当前系统用户，换机或重装需重新登录
- 状态轮询 `useBrowserStatus`：只查当前页，3 秒一轮，页面隐藏时暂停；状态表以**原始邮箱**为键，
  适配器不能对它做 `snakeToCamel`（邮箱里可能有下划线）
- 首次打开某账号时，前端在**启动前**复制邮箱：浏览器窗口出现会抢走焦点，之后写剪贴板会失败

### 添加新 API 端点

1. **Database**：在 `database.rs` 添加公共方法
2. **命令层**：在 `commands.rs` 添加 `#[tauri::command]` 薄包装
3. **注册**：在 `lib.rs` 的 `generate_handler![]` 中登记
4. **前端**：在 `types.ts` 扩展 `ApiAdapter`，在 `tauri-adapter.ts` 实现，在 `api.js` 暴露

### 导入格式

解析逻辑位于 `frontend/src/utils/importParser.js`：

- `parseImportText(text)` → `{ parsed, formatStats, detectedFormats }`
- 分隔符：`----`、`——`、`---`、`|`、`--`；混合分隔符（如 `----` 与 `|` 混用）会自动选择能拆出「合法邮箱 + 密码」的方案
- 字段识别：邮箱 → 恢复邮箱 → 2FA密钥（含 `2fa.live` URL 提取）→ 年份(2015-2030) → 手机号 → 国家 → 密码 → 备注
- 手机接码地址：支持 `手机号|接码地址` 整串，例如
  `12025550123|https://sms6688.com/api/sms/recordText?token=<令牌>&tpl=1`
  （`|` 前是号码，后面是接码地址，写入 `sms_url` 字段）
  解析前会先把「接码类」URL 换成占位符，避免地址里的 `|` 被当分隔符截断，
  也避免 token / tpl 里的数字被误判为手机号、年份或 2FA 密钥；
  `2fa.live` 等 2FA 链接保持原样，仍由既有逻辑提取密钥

## 已知取舍（自用版刻意保留未改）

以下问题在审查中被确认存在，但按「不影响本地使用」的取舍**未修复**：

- 批量删除无二次确认；批量设置时空输入按回车会清空字段
- `AccountTable` 无行级 memo/虚拟滚动（大列表会重渲染）
- `init_database()` 失败时直接 `expect` panic
- 导入解析器对含分隔符的密码、空段等边界输入存在误判
