# 给其他 Agent 使用

v0.5.0 同时支持标准 stdio MCP 和 JSON CLI。其他 Agent 不需要浏览器自动化才能使用已接入的 NAS HTTP 操作，也不需要得到 Cookie。MCP 服务在保存凭证的本机运行，通过 stdin/stdout 接收调用；没有远程 HTTP 服务。手机界面功能仍需本机 ADB/Python 和已登录手机。

## 所有者先准备连接

```sh
zspace doctor --profile home --json
# 默认只授予 system.status、apps.inventory 和 apps.coverage
zspace agent create nas-reader --profile home --yes
zspace agent doctor nas-reader --json
zspace agent config nas-reader --format json
zspace agent config nas-reader --format codex
```

`agent config` 使用当前 Node 和安装包入口的绝对路径，输出不包含凭证。JSON 是常见 MCP 客户端使用的 `mcpServers` 格式，可用于 Claude Desktop、Cursor 或其他 stdio 客户端；`codex` 输出 TOML。安装路径改变后重新生成配置。具体客户端的配置应合并到原配置中，避免覆盖已有服务器。

也可通过 Codex CLI 注册：

```sh
codex mcp add zspace-reader -- /absolute/path/to/zspace-mcp --agent nas-reader
```

需要在新启动的客户端或重新连接后发现工具。协议验收使用官方 MCP Client SDK 的独立进程；不代表已经逐一验证每款第三方客户端 UI。

配置存在运行 MCP 的这台电脑。另一台电脑的 Agent 需能启动本机的 MCP 进程（由自己的执行环境提供可靠 stdio 通道），或单独安装并导入其获准的 NAS 会话。不要直接把本机配置路径当作远程服务 URL，也不要复制 Cookie 到聊天、仓库或通用 MCP JSON。

## 按应用授权

`--read` 和 `--write` 接受逗号分隔的准确操作名或 `domain.*`。通配符在保存时展开为当前已知操作，升级不会自动授予新增操作。下载虽然不改 NAS，但会写入本机，必须放入 `--write`。v0.5 的 38 个新操作也遵循此规则；已有配置需要所有者显式授权后重新连接，不能由 Agent 自行扩大权限。

```sh
zspace agent create media-reader --profile home \
  --read 'system.status,apps.coverage,photos.*,video.*,music.*,audiobooks.*' --yes

zspace agent create note-editor --profile home \
  --read 'notes.list,notes.info,notes.search,notes.categories' \
  --write 'notes.create,notes.update,notes.delete' --yes

zspace agent update note-editor \
  --write 'notes.create,notes.update' --yes
zspace agent show note-editor --json
zspace agent config note-editor --format json
```

生成器在该配置有写权限时添加 `--allow-write`。MCP 写调用还需要 `confirm:true`，`dry_run:true` 不访问 NAS 或手机。删除权限在已连接进程的下一次调用生效；新增加的操作需要重新连接才能使用。更新省略的字段保持原样，空字符串 `--write ''` 清除写权限。`agent update` 不恢复已经撤销的配置。

```sh
zspace agent revoke note-editor --yes
```

撤销会阻止现有 MCP 连接的后续调用；已发出的 NAS 操作无法撤回。重新启用时由所有者检查权限并创建新名称，不让 Agent 自行修改授权。

## 限定文件目录

先用所有者命令 `zspace files roots --profile home --json` 找到真实池路径，再选择目录。下面均为占位路径。

```sh
zspace agent create file-worker --profile home \
  --read 'files.roots,files.list,files.info' \
  --write 'files.mkdir,files.upload,files.download,files.rename,files.copy,files.move,files.trash' \
  --nas-root /pool/my/data/AgentWorkspace \
  --local-root /absolute/existing/AgentWorkspace --yes
```

两个 root 选项可重复。`--local-root` 必须已经存在，并解析为本机真实路径。上传和下载同时要求 NAS 与本机范围。所有文件操作都需要 `--nas-root`；其作用于传入的文件源、目标和改名目的地。Agent `files.roots` 只返回配置中的根，不代表远端目录已存在或 NAS 已授予访问。

最近文件、回收站、文件分类和全局任务等接口无法按这个目录范围限制，所以 Agent 模式不开放这些文件操作；`files.*` 会因包含这些操作而被拒绝。按需列出上面的操作。文件任务等待仍在已授权的复制、移动和回收站操作内部进行。

这是输入路径检查，**不是 NAS 服务端目录 ACL**。NAS 符号链接的解析范围未验证；其他应用（如笔记、照片或搜索）不受文件 roots 限制，仍遵循 NAS 账号本身的范围。给不受信任的 Agent 应使用单独 NAS 账号和隔离的执行环境。拥有相同系统用户下任意 Shell 权限的程序可绕开这些本地限制；本项目不宣称解决这个问题。

## Agent 的发现与调用

MCP 先调用 `zspace_capabilities`，然后按任务查询 `zspace_catalog`。能力响应的 `authentication: not-checked` 表示仅读取了本机配置；实际业务读取或所有者 `agent doctor` 才验证 NAS。`zspace://agent-guide` 提供随包分发的操作和恢复说明。

```json
{"name":"zspace_catalog","arguments":{"name":"notes.create"}}
```

```json
{"name":"zspace_notes_write","arguments":{"request":{"action":"create","params":{"title":"测试","body":"正文"}},"dry_run":true}}
```

用户已经授权后，用 `confirm:true` 执行，并用 `notes.info` 核对结果。MCP 文本和 `structuredContent.result` 为相同结果；失败有 `isError:true` 和 code，不能只判断协议有没有回复。

CLI 可以执行相同权限下的操作：

```sh
zspace agent call nas-reader system.status --json
zspace agent call note-editor notes.create --params '{"title":"测试","body":"正文"}' --dry-run --json
zspace agent call note-editor notes.create --params '{"title":"测试","body":"正文"}' --yes --json
```

`api describe` 是全局 schema 目录，不意味着该 Agent 获准调用。被拒绝后不要改用不受限的所有者命令。

## 会话失效与轮换

支持所有者导入新会话，以及绑定私密 JSON 文件的热更新。**未验证厂商 OAuth、refresh token 或无人值守重新登录流程**；轮换文件需要由所有者或其可信会话导出流程更新。CLI 不保存密码、不自动登录，不把旧会话复制一遍冒充续期。

```sh
chmod 600 /absolute/private/session.json
zspace auth source --profile home --file /absolute/private/session.json --yes
zspace auth session --profile home --json
zspace auth refresh --profile home --json
# 不再使用轮换文件
zspace auth source --profile home --clear --yes
```

每次需要 NAS 的调用前读取来源；Cookie 未变化时不增加验证请求。变化时先调用 `/auth/token` 验证，再原子替换本机凭证。来源必须是当前用户的普通文件、600 权限、小于等于 1 MiB，且 NAS origin 与 profile 相同。拒绝符号链接、跨 NAS 来源、损坏和无效会话；失败保留原凭证，但阻止本次调用。

`auth import --replace` 是一次完整的手动替换，会解除原来的文件绑定，避免下一次调用被旧来源覆盖。没有来源时 `auth refresh` 只验证现有会话，不能凭空生成新 token。任何写操作发生超时、认证失败或多步中断后都不自动重放；先查业务状态。

## 技能和交付

安装包包含 `skills/zspace/SKILL.md`，适用于支持 Agent Skills 的客户端。由所有者把这个目录安装到该客户端认可的 skills 目录；CLI/MCP 不会通过操作工具修改其他客户端配置。MCP 资源同时提供这份说明，因此不支持 Skill 的客户端也可以读取。

v0.4 实机验收：[20 项 Agent 验收](acceptance-agent-v0.4.json)。测试覆盖两个独立 MCP 客户端、权限发现、运行中撤销、同源会话来源验证、合成文件上传/下载哈希、中文文件名、笔记增改删和回收站清理。过期与轮换失败使用合成 HTTP 夹具验证，没有使用户真实登录失效。完整应用边界见 [覆盖表](coverage.md)。

协议配置参考：[Codex MCP](https://learn.chatgpt.com/docs/extend/mcp)、[MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/v2/)。
