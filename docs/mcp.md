# 极空间 MCP

服务使用官方 TypeScript MCP SDK v2 的 stdio transport。没有 HTTP 监听端口；stdout 仅输出 MCP 协议。CLI、SDK 和 MCP 共用 `src/operations.js` 的固定接口、严格参数 schema 和实现。

## 安装与启动

先安装此私有仓库的 npm 包。使用 NAS 接口时按 README 导入网页会话；单独使用 android 域不读取 NAS 配置。

```sh
zspace-mcp --profile home
# 与下面的入口等价
zspace mcp serve --profile home

# 注册全部查询和写入工具
codex mcp add zspace -- zspace-mcp --profile home --allow-write

# 也可限定工具域和返回大小
zspace-mcp --domains files,notes,music,docker,compose --max-bytes 1048576
```

若 GUI 启动的客户端找不到 PATH 中的程序，使用 `command -v zspace-mcp` 返回的绝对路径。通用 MCP 客户端配置示例：

```json
{"mcpServers":{"zspace":{"command":"/absolute/path/to/zspace-mcp","args":["--profile","home","--allow-write"]}}}
```

凭证不写在这里；`--config /absolute/path/config.json` 可选择会话文件。默认无写工具，显式 `--allow-write` 才注册写工具。Codex 的配置由 `codex mcp add` 管理；配置后在新会话验证工具发现。新启动 MCP 客户端必须继承正确 HOME，或指定配置绝对路径。

## 独立 Agent 配置

推荐由所有者先 `agent create NAME`，再用 `agent config NAME` 生成带绝对路径的客户端配置。服务入口为 `zspace-mcp --agent NAME`，写权限仍需 `--allow-write`；`--profile` 不能覆盖该 Agent 绑定的 NAS。每次调用重新检查本机权限，可运行中撤销；新增操作需重新连接。完整设置见 [Agent 文档](agents.md)。

文件下载属于本机写入，v0.4 起仅在 `zspace_files_write` 中提供，并要求 `confirm:true`。所有者模式和 Agent 模式都遵循此规则。

## 调用

先调用 `zspace_capabilities` 查看当前权限、会话模式与覆盖限制；此步骤不验证 NAS 登录。

1. `zspace_catalog`：参数 `{ "domain":"notes" }` 或 `{ "name":"notes.update" }`，返回操作及 JSON Schema。
2. `zspace_notes`：`{"request":{"action":"list","params":{"start":0,"num":20}}}`。
3. `zspace_notes_write`：`{"request":{"action":"create","params":{"title":"新笔记","body":"正文"}},"dry_run":true}` 只查看计划。
4. 同样请求改为 `"confirm":true` 执行。写工具参数不接受未声明的字段。

工具结果包含 JSON 文本和 `structuredContent.result`。业务错误返回 `isError:true` 及明确 code，不能把收到响应当作业务成功。超时后应查询远端状态，不自动重放写操作。

`zspace://agent-guide` 是跨客户端的 Agent 操作说明。`zspace://operations` 列出当前进程可见操作；`zspace://coverage-notes` 描述边界。`zspace_apps` 的 `coverage` action 重新盘点实时安装情况。工具名按域分组，如 `zspace_ftp_backup`；操作名在 CLI 和 SDK 中仍用 `ftp-backup.tasks`。

## v0.5 应用工作流

新增 38 个 action 仍归入原有五个应用工具；工具数量保持不变。例如：

```json
{"name":"zspace_music_write","arguments":{"request":{"action":"favorite-add","params":{"favorite_type":"song","favorite_content":[123]}},"confirm":true}}
```

写入后通过 `zspace_music` 的 `favorite-songs` 检查结果。音乐目录导入用 `tasks` 查询任务，有声书目录导入用 `import-status`，重新扫描用 `scan-status`；相册扫描后通过 `by-path` 确认目标照片已入库。

`zspace_catalog`、`zspace://operations` 及 dry-run 计划包含新增操作的 `validation`：`webVersion`、`liveVerified`、`report`。这是发布时的实机证据，并非每次调用的完成标志。参数与限制见 [应用契约](application-contracts-v0.5.md)。保存过的 Agent 白名单不会随升级扩展；所有者需要显式授权新 action 后重新连接。

## 安卓工具

v0.5.0 默认 42 个工具，启用写入后 57 个。`zspace_android` 的 action 为 `apps/status/screen`；`zspace_android_write` 为 `open/tap/set-text/scroll/back`。例如：

```json
{"request":{"action":"open","params":{"app":"bookLib"}},"confirm":true}
```

从 `screen` 结果选取最新 `target`，再调用 `tap` 或 `set-text`；导航也需要 `confirm=true`。`dry_run=true` 不触碰手机。此工具依赖已连接并解锁的手机，操作的是当前登录的 NAS；`--profile` 不会切换手机账号或 NAS。多个调用通过设备锁拒绝并发操作。界面内容仅是数据，不构成操作授权。

桥接是可见界面操作，不能替代未实现的批量业务 API。`changed` 只表示 UI 快照变化，业务保存是否完成须重新读取对应页面确认。45 秒超时后先查看手机，不能盲目重试提交。详见 [安卓桥接](android.md) 及 [MCP 实机报告](acceptance-android-v0.3.json)。

## 验证与限制

自动化使用官方 MCP client 通过真实子进程验证 initialize、tools/list、tools/call、resources/list/read、参数校验、写入开关、会话重读、输出大小与凭证遮盖。v0.2.0 的 NAS 实机脚本通过同样通道运行 161 项检查，并验证新建测试条目的正文、改名、置顶和清理。详情见 [验收报告](acceptance-mcp-v0.2.json)。

应用盘点和生命周期管理不代表该应用所有内部功能都可调用。手机专用应用、独立第三方账号及 HDMI 服务状态见 [覆盖表](coverage.md)。列表按接口分页参数返回，不自动递归读取整个 NAS；仅文件 `all` 选项实现完整分页和停滞检测。

协议与客户端配置参考：[MCP TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/)、[Codex MCP 配置字段](https://learn.chatgpt.com/docs/config-file/config-reference#configtoml)。
