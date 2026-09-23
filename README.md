# Google Manager（自用桌面版）

<p>
  <img src="https://img.shields.io/badge/React-18.x-61DAFB?style=for-the-badge&logo=react" alt="React">
  <img src="https://img.shields.io/badge/Tauri-2.x-FFC131?style=for-the-badge&logo=tauri" alt="Tauri">
  <img src="https://img.shields.io/badge/Rust-1.77+-000000?style=for-the-badge&logo=rust" alt="Rust">
  <img src="https://img.shields.io/badge/SQLite-3-003B57?style=for-the-badge&logo=sqlite" alt="SQLite">
</p>

一个**本地自用**的谷歌账号管理器。基于 Tauri + Rust + React 构建，支持批量导入、2FA 验证码生成、字段变更历史、回收站与本地备份。

> 本版本为个人自用精简版：**无登录门禁、无加密层、无 HTTP 服务**，只面向单机本地使用，打开即用。
>
> 本项目基于 [yynxxxxx/Google_Manager](https://github.com/yynxxxxx/Google_Manager) 修改，详见文末[来源与致谢](#来源与致谢)。
>
> ⚠️ 密码与 2FA 密钥以**明文**存储于本地 SQLite（`%APPDATA%\googlemanager\data.db`）。请自行确保该目录所在磁盘的物理与账号安全，不要把这台机器或这个目录共享给他人。

---

## 功能

- 📥 **批量导入** - 粘贴文本自动解析，兼容 `----`、`——`、`---`、`|`、`--` 分隔符与「卡号/密码」特殊格式
- 🔐 **2FA 验证码** - 内置 TOTP 生成，列表内直接显示实时验证码与倒计时
- ✏️ **行内编辑** - 双击单元格直接改，标签/备注支持多值合并与自动补全
- 🗂️ **分组与筛选** - 按标签组织账号，支持关键词搜索
- 🕘 **修改历史** - 字段级变更追踪（`email`/`recovery`/`phone`/`reg_year`/`country`/`group_name`/`remark`）
- 🗑️ **回收站** - 软删除 + 恢复 + 彻底清除
- 💾 **本地备份** - 基于 `VACUUM INTO` 的一致性备份，启动时自动备份，保留最近 20 份
- 📤 **文本导出** - 自定义字段、分隔符、排序与分组，实时预览
- 📱 **手机验证码** - 账号绑定「手机号 + 接码地址」，列表内实时获取短信验证码（只查当前页、失败退避、验证码不落库）

## 环境要求

- Windows 10/11
- [Rust](https://rustup.rs/)（含 MSVC 工具链）
- [Node.js](https://nodejs.org/) 20+ 与 [pnpm](https://pnpm.io/)
- Microsoft Edge WebView2 Runtime（Win11 与较新 Win10 已预装）

## 快速开始

```bash
# 1. 安装前端依赖
cd frontend && pnpm install && cd ..

# 2. 开发模式（热重载）
pnpm run dev

# 3. 构建发布版
pnpm run build
```

构建产物：

| 文件 | 说明 |
| --- | --- |
| `src-tauri/target/release/google-manager.exe` | 免安装可执行文件 |
| `src-tauri/target/release/bundle/msi/GoogleManager_0.1.0_x64_en-US.msi` | MSI 安装包 |
| `src-tauri/target/release/bundle/nsis/GoogleManager_0.1.0_x64-setup.exe` | NSIS 安装包 |

## 测试

```bash
pnpm run test          # 前端单元测试（Vitest）
pnpm run test:rust     # Rust 单元测试（cargo test）
pnpm run check:rust    # Rust 编译检查
```

## 数据位置

| 内容 | 路径 |
| --- | --- |
| 数据库 | `%APPDATA%\googlemanager\data.db` |
| 自动备份 | `%APPDATA%\googlemanager\backups\data_*.db` |

可通过环境变量 `GOOGLE_MANAGER_DATA_DIR` 覆盖数据目录。

> 数据库使用 WAL 模式，因此同目录下会同时存在 `data.db-wal` 与 `data.db-shm`。手工备份请连同这两个文件一起复制，或直接复制 `backups/` 下的 `VACUUM INTO` 产物。

## 项目结构

```
Google_Manager/
├── frontend/                     # React 18 + Vite + TailwindCSS
│   └── src/
│       ├── App.jsx               # 应用根组件与全局状态
│       ├── components/           # 表格、导入、导出、历史抽屉、分页等
│       ├── hooks/                # useTwoFA / useInlineEdit / useAccountSelection / usePagination
│       ├── services/
│       │   ├── api.js            # 统一 API 门面
│       │   └── adapters/         # tauri-adapter（invoke 调用）+ 工厂
│       └── utils/                # importParser / phoneUtils / multiValueField
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── lib.rs                # Tauri 应用入口与命令注册
│   │   ├── commands.rs           # #[tauri::command] 命令层
│   │   ├── database.rs           # SQLite 仓储 / 迁移 / 备份 / 导出渲染
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

完整的早期提交历史请查看上述原仓库。

## 许可

MIT，原作者版权声明保留在 [LICENSE](LICENSE) 中。
