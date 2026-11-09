# Google Manager（自用桌面版）

<p>
  <img src="https://img.shields.io/badge/React-18.x-61DAFB?style=for-the-badge&logo=react" alt="React">
  <img src="https://img.shields.io/badge/Tauri-2.x-FFC131?style=for-the-badge&logo=tauri" alt="Tauri">
  <img src="https://img.shields.io/badge/Rust-1.77+-000000?style=for-the-badge&logo=rust" alt="Rust">
  <img src="https://img.shields.io/badge/SQLite-3-003B57?style=for-the-badge&logo=sqlite" alt="SQLite">
</p>

一个**本地自用**的谷歌账号管理器，支持 **Windows 与 macOS**。基于 Tauri + Rust + React 构建，支持批量导入、2FA 验证码生成、字段变更历史、回收站与本地备份。

> 本版本为个人自用精简版：**无登录门禁、无加密层、无 HTTP 服务**，只面向单机本地使用，打开即用。
>
> 本项目基于 [yynxxxxx/Google_Manager](https://github.com/yynxxxxx/Google_Manager) 修改，详见文末[来源与致谢](#来源与致谢)。
>
> ⚠️ 密码与 2FA 密钥以**明文**存储于本地 SQLite（Windows：`%APPDATA%\googlemanager\data.db`；macOS：`~/Library/Application Support/googlemanager/data.db`）。请自行确保该目录所在磁盘的物理与账号安全，不要把这台机器或这个目录共享给他人。

---

## 功能

- 📥 **批量导入** - 粘贴文本自动解析，兼容 `----`、`——`、`---`、`|`、`--` 分隔符与「卡号/密码」特殊格式
- 🔐 **2FA 验证码** - 内置 TOTP 生成，列表内直接显示实时验证码与倒计时
- ✏️ **行内编辑** - 双击单元格直接改，标签/备注支持多值合并与自动补全
- 🗂️ **分组与筛选** - 按标签组织账号，支持关键词搜索
- 🕘 **修改历史** - 字段级变更追踪（`email`/`recovery`/`phone`/`reg_year`/`country`/`group_name`/`remark`/`status`）
- 🗑️ **回收站** - 软删除 + 恢复 + 彻底清除
- 💾 **本地备份** - 基于 `VACUUM INTO` 的一致性备份，启动时自动备份（保留最近 10 份），删除全部 / 恢复 / 升级前的保护性备份另外保留最近 20 份
- 📤 **文本导出** - 自定义字段、分隔符、排序与分组，实时预览；选好保存位置后直接写出文件
- 🔄 **在线更新** - 启动时自动检查 GitHub 上的新版本，一键下载安装并重启（更新前自动备份；更新包带签名校验）
- 📱 **手机验证码** - 账号绑定「手机号 + 接码地址」，列表内实时获取短信验证码（只查当前页、失败退避、验证码不落库）
- 🌐 **账号独立浏览器** - 每个账号一个独立的 Chrome / Edge 配置，登录状态互不干扰且长期保留；点一下打开，已打开则切到该窗口。支持缓存清理与占用统计（只做会话隔离，不做指纹伪装）

## 环境要求

- Windows 10/11 或 macOS 10.15+（Apple 芯片与 Intel 均可）
- [Rust](https://rustup.rs/)（Windows 需 MSVC 工具链；macOS 需 Xcode 命令行工具：`xcode-select --install`）
- [Node.js](https://nodejs.org/) 20+ 与 [pnpm](https://pnpm.io/)
- Windows：Microsoft Edge WebView2 Runtime（Win11 与较新 Win10 已预装）；macOS 使用系统自带 WebKit，无需额外安装

## 快速开始

```bash
# 1. 安装依赖
pnpm install && cd frontend && pnpm install && cd ..

# 2. 开发模式（热重载）
pnpm run dev

# 3. 构建发布版（在哪个系统上构建就生成哪个系统的安装包）
pnpm run build
```

构建产物（`<版本号>` 取自 `src-tauri/tauri.conf.json`）：

| 系统 | 文件 | 说明 |
| --- | --- | --- |
| Windows | `src-tauri/target/release/google-manager.exe` | 免安装可执行文件 |
| Windows | `src-tauri/target/release/bundle/msi/GoogleManager_<版本号>_x64_en-US.msi` | MSI 安装包 |
| Windows | `src-tauri/target/release/bundle/nsis/GoogleManager_<版本号>_x64-setup.exe` | NSIS 安装包 |
| macOS | `src-tauri/target/release/bundle/macos/GoogleManager.app` | 应用，可直接拖进「应用程序」 |
| macOS | `src-tauri/target/release/bundle/dmg/GoogleManager_<版本号>_aarch64.dmg` | 磁盘映像（Intel 机器上为 `_x64`） |

在 macOS 上要同时支持 Apple 芯片与 Intel，可构建通用二进制（发布流程用的就是这种）：

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
pnpm run build -- --target universal-apple-darwin
# 产物：src-tauri/target/universal-apple-darwin/release/bundle/dmg/GoogleManager_<版本号>_universal.dmg
```

### 在线更新与签名私钥

打包时会额外生成在线更新包，并用私钥签名（应用内置对应公钥，签名不符的更新包会被拒绝）：

- 私钥放在本机 `~/.tauri/googlemanager.key`（密码在同目录的 `.password` 文件），**不入库**；
  GitHub Actions 使用仓库 Secrets 中的 `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `pnpm run build` 找到私钥就签名，找不到就跳过更新包、只打普通安装包
- **私钥丢失后，已安装的版本将无法再收到在线更新**（只能手动重新安装），请把 `~/.tauri/` 另外备份一份
- 发布时 CI 自动生成 `latest.json` 上传到 Release，应用从
  `https://github.com/1134189025/Google_Manager/releases/latest/download/latest.json` 检查新版本
- Windows 免安装版在应用内更新后会变成安装版

### macOS 首次打开

应用只做了 ad-hoc 签名，没有经过 Apple 公证。从网上下载的 dmg 首次打开时会提示「无法验证开发者」：
在「系统设置 → 隐私与安全性」底部点「仍要打开」；或在终端执行
`xattr -dr com.apple.quarantine /Applications/GoogleManager.app` 后再打开。本机自己构建的不受影响。

## 测试

```bash
pnpm run test          # 前端单元测试（Vitest）
pnpm run test:rust     # Rust 单元测试（cargo test）
pnpm run check:rust    # Rust 编译检查
```

## 数据位置

| 内容 | Windows | macOS |
| --- | --- | --- |
| 数据库 | `%APPDATA%\googlemanager\data.db` | `~/Library/Application Support/googlemanager/data.db` |
| 自动备份 | `%APPDATA%\googlemanager\backups\data_*.db` | `~/Library/Application Support/googlemanager/backups/data_*.db` |
| 账号浏览器配置 | `%LOCALAPPDATA%\googlemanager\profiles\<邮箱哈希>\` | `~/Library/Application Support/googlemanager/profiles/<邮箱哈希>/` |

浏览器配置目录都可在侧栏「账号浏览器设置」中修改。
可通过环境变量 `GOOGLE_MANAGER_DATA_DIR` 覆盖数据目录（此时浏览器配置默认放在 `<数据目录>/profiles`）。

> macOS 上，配置目录位于 `~/Library/Application Support` 下时，Chrome / Edge 会把网页缓存放到
> `~/Library/Caches` 下的同名路径（例如 `~/Library/Caches/googlemanager/profiles/<邮箱哈希>/`）。
> 「清理缓存」「计算占用」「彻底删除」都会一并处理这里。

> 浏览器配置目录不在备份范围内。其中的登录 cookie 由系统加密（Windows 为 DPAPI，macOS 为钥匙串）并绑定当前系统用户，
> 复制到其他电脑或重装系统后需要重新登录。

> 数据库使用 WAL 模式，因此同目录下会同时存在 `data.db-wal` 与 `data.db-shm`。手工备份请连同这两个文件一起复制，或直接复制 `backups/` 下的 `VACUUM INTO` 产物。

## 项目结构

```
Google_Manager/
├── frontend/                     # React 18 + Vite + TailwindCSS
│   └── src/
│       ├── App.jsx               # 应用根组件与全局状态
│       ├── components/           # 表格、导入、导出、历史抽屉、分页等
│       ├── hooks/                # useTwoFA / useInlineEdit / useAccountSelection / usePagination /
│       │                         # useSmsCodes / useBrowserStatus
│       ├── services/
│       │   ├── api.js            # 统一 API 门面
│       │   └── adapters/         # tauri-adapter（invoke 调用）+ 工厂
│       └── utils/                # importParser / phoneUtils / multiValueField / smsUtils / browserUtils / timeUtils
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── lib.rs                # Tauri 应用入口与命令注册
│   │   ├── commands.rs           # #[tauri::command] 命令层
│   │   ├── database.rs           # SQLite 仓储 / 迁移 / 备份 / 导出渲染
│   │   ├── browser.rs            # 账号独立浏览器（配置目录、启动/聚焦、缓存清理）
│   │   ├── sms.rs                # 接码地址取短信验证码
│   │   ├── totp.rs               # TOTP 生成
│   │   └── app_paths.rs          # 数据目录解析
│   └── tauri.conf.json
└── package.json                  # 根脚本（dev / build / test）
```

## 参数命名约定

Tauri 2 的 `#[tauri::command]` 默认按 **camelCase** 匹配 Rust 参数名，而命令内部结构体字段仍按 **snake_case** 反序列化。因此：

- **顶层** invoke 参数用 camelCase（如 `accountIds`、`backupName`）
- **嵌套** 载荷用 snake_case（如 `account.reg_year`、`config.include_stats`）

`frontend/src/services/adapters/tauri-adapter.ts` 的 `prepareInvokeArgs()` 负责这一转换，并有对应单测守住。

## 来源与致谢

本项目在以下项目的基础上修改而来，感谢原作者的工作：

| 项目 | 说明 |
| --- | --- |
| [yynxxxxx/Google_Manager](https://github.com/yynxxxxx/Google_Manager) | 原始项目（Flask 版），作者 yyyyyynnn，MIT 许可 |
| [chengguijin-maker/Google_Manager](https://github.com/chengguijin-maker/Google_Manager) | 上述项目的 fork，由 Flask 迁移到 Tauri 桌面架构 |

本仓库在此基础上的主要改动：

- 精简为单机自用版：移除登录门禁、加密层、HTTP 服务，以及 CI、部署脚本、e2e 等运维文件
- 界面改为浮动仪表盘风格，全局使用系统字体；移除「已售出 / 未售出」功能（数据库列保留以兼容旧库）
- 新增手机验证码列：号码与接码地址绑定、导入解析、实时获取
- 新增账号独立浏览器：每个账号一个 Chrome / Edge 配置目录，一键打开或切换窗口
- 支持 macOS（Apple 芯片与 Intel）：浏览器检测、运行检测、窗口切换与缓存清理均按 macOS 实现
完整的早期提交历史请查看上述原仓库。

## 许可

MIT，原作者版权声明保留在 [LICENSE](LICENSE) 中。
