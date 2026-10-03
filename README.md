# 极空间 CLI

极空间 NAS 的终端工具、Node.js SDK 与标准 stdio MCP 服务。v0.5.1 提供 40 个功能域、291 个操作和 318 条 CLI 命令，涵盖文件、媒体库、记事本、Docker/Compose、虚拟机、备份、搜索、监控及应用管理。

应用支持范围由代码中的操作目录确定，**不等于每个应用的全部功能已经实现**。业务操作、状态查询、应用管理和未接入部分分别标注在 [应用覆盖表](docs/coverage.md)。

**这是独立的非官方客户端。** 接口契约和脱敏验收记录对应 Web 版本 `2.3.2026082801`。不同设备或固件需要重新验收；公开记录不包含验证设备身份。

- Node.js 22+；运行时依赖官方 MCP SDK v2 与 Zod。
- 通过已登录网页的会话认证；无需开启 SSH 或在 NAS 上安装服务。
- 支持多个 NAS 配置；凭证保存在本机私有文件中。
- 写入命令要求 `--yes`，支持 `--dry-run`；同名目标默认拒绝。
- 单文件流式传输，下载用临时文件和原子提交，返回 SHA-256。
- 文件任务区分同步和异步结果；默认等待异步任务并检查错误。
- GitHub 仓库公开；npm 包仍设为 `private: true`，未发布到 npm。

## 安装

```sh
gh repo clone fand75076-collab/zspace-cli
cd zspace-cli
npm install -g . --ignore-scripts
zspace --version
```

也可在 `npm ci --ignore-scripts` 后直接运行 `node bin/zspace.js --help`。分发包可用 `npm pack` 生成，再用 `npm install -g ./包名.tgz --ignore-scripts` 安装。安装时需要从 npm 获取依赖；tgz 本身不是完整离线依赖包。

## 首次连接

先按下方认证说明导入自己的 NAS 会话，再检查连接。示例中的 `home` 是可自定义的配置名，不附带任何预置账号或设备：

```sh
zspace doctor
zspace status
zspace files roots
zspace storage pools --json
```

配置不在代码仓库内。`zspace config path` 可查看具体位置。

## MCP 与应用命令

```sh
zspace notes list --json
zspace notes create --title "测试笔记" --body "正文" --yes
zspace music songs --page 1 --page-size 20 --json
zspace docker containers --json
zspace compose list --json
zspace vm list --json
zspace apps coverage --json
zspace api describe notes.update

# 默认仅提供读取工具
zspace-mcp --profile home
# 完整工具；写调用仍要求 confirm=true，可先 dry_run=true
zspace-mcp --profile home --allow-write
# 使用任意支持 stdio 的 MCP 客户端，例如 Codex
codex mcp add zspace -- zspace-mcp --profile home --allow-write
```

MCP 使用相同的会话、参数校验和操作实现。默认提供 42 个工具；启用写入后为 57 个。按应用分组的工具通过 `request.action` 和 `request.params` 调用；见 [MCP 使用文档](docs/mcp.md)。MCP 进程不监听网络端口，不需要在 NAS 安装后台服务。凭证继续保存在本机私有文件中。

例如 `zspace_notes` 的参数为 `{"request":{"action":"list","params":{"num":20}}}`。写入工具 `zspace_notes_write` 的参数为 `{"request":{"action":"create","params":{"title":"我的笔记","body":"正文"}},"confirm":true}`。

## v0.5 应用功能

新增 38 个操作，CLI、SDK 和 MCP 共用实现：

| 应用 | 新增能力 |
| --- | --- |
| 记事本 | 分类分页、批量移动分类、颜色标签；列表支持颜色和排序筛选 |
| 极相册 | 按路径找照片、查看所属相册、收藏、移出相册、索引目录增删和扫描 |
| 极音乐 | 曲目详情、歌词读写、CUE 分轨、四类收藏、来源导入/移除/重扫和任务状态 |
| 有声读物 | 书库目录增删、章节移除、排序位置、重新扫描、导入和外部存储状态 |
| 极影视 | 指定库分页、创建/解散自定义合集、收藏与取消收藏 |

```sh
zspace notes move --ids '[12,13]' --classify-id 7 --dry-run
zspace notes label --id 12 --label-id 0 --yes
zspace notes list --label-id 0 --sortby 6 --json
zspace music library-add --file-path '["/sata1/my/data/音乐"]' --yes
zspace music tasks --json
zspace music favorite-add --favorite-type song --favorite-content '[123]' --yes
zspace photos by-path --paths '["/sata1/my/data/照片.jpg"]' --json
zspace audiobooks directory-add --playlist-id 5 --dirs '["/sata1/my/data/有声书"]' --yes
zspace audiobooks import-status --playlist-id 5 --json
zspace video collections --classification-id 8 --start 1 --limit 20 --json
```

ID 和路径需要从自己的 NAS 查询。应用扫描/导入返回的是任务提交结果，请继续查询状态并读取业务列表。自定义影视合集要求普通影视库；不刮削库会返回 `N120039`。新操作的发现和 dry-run 结果包含协议版本与脱敏报告路径；`liveVerified` 只对应报告中的测试范围。功能说明、参数差异和验收边界见 [v0.5 应用工作流](docs/application-contracts-v0.5.md)。

## 其他 Agent 接入

v0.4 新增固定 NAS 的 Agent 配置、操作白名单、目录范围、运行中撤销、私密会话文件热更新和能力发现。默认 MCP 的下载操作移到写工具中；CLI 下载也需要 `--yes`。

```sh
# 所有者创建最小查询配置，再生成标准客户端配置
zspace agent create nas-reader --profile home --yes
zspace agent doctor nas-reader --json
zspace agent config nas-reader --format json
# Agent 在这个配置内调用
zspace agent call nas-reader system.status --json
zspace-mcp --agent nas-reader
```

可按需授权媒体、笔记、文件或其他应用；详见 [Agent 接入与权限](docs/agents.md)。技能随包分发于 [skills/zspace/SKILL.md](skills/zspace/SKILL.md)，MCP 也可读取 `zspace://agent-guide`。本地权限层不等同于厂商 OAuth 或操作系统沙箱。

## 安卓手机桥接

v0.3.0 新增极阅读、极漫画、亲情设置和手机备份的安卓 UI 桥接。需要通过 ADB 连接已解锁、已登录的手机；无需导入手机凭证，也不需要 NAS 网页会话。它操作当前可见控件，尚未实现这些应用的独立 NAS 业务 API，不能代表完整书库分页或所有业务功能。

```sh
zspace android status --json
zspace android apps --json
zspace android open --app bookLib --yes --json
zspace android screen --json
# 使用刚返回的 target；点击后重新观察结果
zspace android tap --target <target> --yes --json
```

手机桥接额外依赖 Python 3、adb 和 uiautomator2，原有 NAS 命令不需要这些依赖。MCP 使用 `zspace_android` 和 `zspace_android_write` 两个工具。安装、输入、滚动、错误处理与边界见 [安卓桥接文档](docs/android.md)。

## 认证与会话续期

当前版本使用**网页会话导入**，不实现账号密码、短信验证码或 MFA 登录。会话失效时，请先在极空间网页重新登录，再导入新会话。CLI 不尝试绕过验证，也不自动重放失败的写操作。可用 `auth source` 绑定同源的私密轮换文件，后续调用会验证并载入其中的新会话；这不等同于自动登录或厂商 refresh-token 流程，详见 [会话轮换](docs/agents.md#会话失效与轮换)。

会话 JSON 格式：

```json
{
  "baseUrl": "https://nas.example.com:5056",
  "cookie": "zenithtoken=<当前会话>; device_id=<设备标识>; device=<编码后的设备名>; plat=web; version=<网页版本>"
}
```

`cookies` 也可为 Cookie 名值对象，或浏览器导出的 Cookie 数组（包含 `name`、`value`、可选 `domain` 和 `expires`）。导入时会过滤其他域、过期 Cookie 和无关 Cookie。

可以在已登录 NAS 页面自己的开发者控制台中导出可见 Cookie：

```js
copy(JSON.stringify({baseUrl: location.origin, cookie: document.cookie}))
```

把剪贴板内容保存为仅本人可读的 JSON 文件。如果认证 Cookie 是 HttpOnly，则需使用浏览器开发者工具中该 NAS 请求的 Cookie；控制台无法读取 HttpOnly Cookie。Codex 也可通过授权的当前 NAS 标签页将会话直接保存到本机，而不在聊天中显示它。

```sh
chmod 600 /path/to/session.json
zspace auth import --file /path/to/session.json --name home
# 续期时更新已有配置
zspace auth import --file /path/to/session.json --name home --replace
zspace auth status
```

也支持 `cat /path/to/session.json | zspace auth import --stdin --name home --replace`。不支持把 token 作为命令行参数，以免进入 shell 历史。导入会先验证会话，成功后才保存。不要将会话文件或包含 Cookie 的 HAR、日志提交到 GitHub。

地址应使用网页当前的 NAS HTTPS 直连地址；公网中转、桌面客户端代理和特殊集群路由尚未验证。HTTP 默认被拒绝；明确使用明文局域网 HTTP 时，导入需要 `--allow-http`。没有关闭证书校验的选项；自建 CA 可用 `NODE_EXTRA_CA_CERTS`。

`zspace auth logout --yes` 只清除本机所选配置，不会使共享的网页登录失效。

## 常用命令

先用 `files roots` 找到真实存储池路径。下面的 `sata1` 仅为示例。

```sh
# 系统、存储和应用
zspace status --json
zspace system network
zspace system services
zspace system processes --json
zspace system versions
zspace storage pools
zspace storage hardware
zspace storage status
zspace apps list --json

# 文件与完整分页
zspace ls /sata1/my/data --all
zspace files ls /sata1/my/data --limit 100 --start 100 --hidden
zspace stat '/sata1/my/data/照片.jpg' --json

# 写入先看计划，再执行
zspace mkdir /sata1/my/data/CLI备份 --dry-run
zspace mkdir /sata1/my/data/CLI备份 --yes
zspace put ./report.pdf /sata1/my/data/CLI备份/report.pdf --yes
zspace get /sata1/my/data/CLI备份/report.pdf ./downloaded.pdf --yes
zspace files rename /sata1/my/data/CLI备份/report.pdf 报告.pdf --yes
zspace cp /sata1/my/data/CLI备份/报告.pdf --to /sata1/my/data --yes
zspace mv /sata1/my/data/报告.pdf --to /sata1/my/data/另一个目录 --yes

# files 命令仅移入回收站，不提供永久删除或清空回收站命令
zspace rm /sata1/my/data/CLI备份 --yes
zspace files recycle --limit 100
zspace files tasks --json
zspace files task 12345 --wait --wait-ms 30000
```

`copy`/`move` 可以接收多个源路径；目标必须是已存在的目录。`mkdir` 不隐式创建缺失的父目录。命令不默认使用 NAS 根路径 `/`，因为它不是个人文件空间。

复制、移动和删除默认最多等待 30 秒，可用 `--wait-ms` 调整；`--no-wait` 立即返回任务信息。返回 `completed: false` 表示尚未完成。同步操作的任务可能不保留在任务列表中，且固件返回的 `task.state` 可能仍为 `new`；CLI 按 `otype=sync` 和实际文件元数据确认操作，顶层 `completed`、`verified` 表示 CLI 的确认结果。

上传和下载默认超时一小时，可用 `--timeout <毫秒>` 调整。当前只支持单文件，不支持目录递归传输、断点续传、保险箱或加密目录。上传 SHA-256 来自本机输入流；下载 SHA-256 来自接收流。上传时额外确认远端大小；如需远端内容校验，应下载后比对 SHA-256。

## 多 NAS、脚本与 SDK

```sh
zspace auth import --file office-session.json --name office
zspace profile list
zspace profile use office
zspace status --profile home --json
zspace commands --json
zspace api list --json
zspace api call storage.pools --json
zspace api call files.tasks --param start=0 --param num=20 --json
```

`api call` 只接受内置只读目录中的名称，不提供任意 URL 或原始写接口通道。完整命令清单见 [docs/commands.md](docs/commands.md)，操作参数见 [docs/operations.json](docs/operations.json)。新增命令支持 `--params JSON`、`--param key=value` 或命名参数；数组和嵌套对象使用 JSON，未知参数会拒绝。旧版文件命令保留位置参数语法。

成功结果输出到 stdout，错误输出到 stderr。`--json` 输出标准 JSON，不混入进度文本。退出码：`0` 成功，`2` 参数错误或缺少写入确认，`3` 认证失败，`4` 网络/超时，`5` NAS/协议/任务错误，`6` 同名冲突，`7` Agent 权限拒绝/撤销。超时或连接断开后，远端写入可能已经生效，应检查状态，不要立即重复提交。

```js
import { Client, ConfigStore, listFiles } from '@fand75076-collab/zspace-cli';
const { profile } = await new ConfigStore().select('home');
const client = new Client(profile);
const result = await listFiles(client, '/sata1/my/data', { all: true });
console.log(result.items.map(file => file.name));
```

SDK 导出的底层文件写函数是直接调用，CLI 的 `--yes` 保护不适用于这些函数；建议通过 `runOperation(client, name, params, {allowWrite:true})` 使用统一参数校验。调用方需自行确认作用路径。SDK 结果可能含 NAS 的原始私有信息，输出日志前可调用 `redact()`。

可用 `zspace completion zsh` 或 `zspace completion bash` 输出顶级命令补全脚本；命令不会修改 shell 配置。

## 验证与边界

```sh
npm ci --ignore-scripts
npm run check
npm test
# 可选：在真实 NAS 新建专用目录，使用生成的数据测试，结束时移入回收站
npm run test:live -- --parent /sata1/my/data --yes --report work/acceptance.json
# 通过实际 MCP 子进程验证应用读取及临时媒体/笔记 CRUD
npm run test:live:apps -- --yes --report work/mcp-acceptance.json
# 手机 UI 验收；可选中文输入会打开并取消合成分类对话框
npm run test:live:android -- --yes --text-input --report work/android-acceptance.json
# 五个应用的完整工作流：需要 ffmpeg，生成独立媒体并清理测试对象
npm run test:live:workflows -- --parent /sata1/my/data --yes --report work/workflows.json
# 可选 --domains notes,music,audiobooks,photos,video 限定测试域
# 两个独立 Agent MCP 客户端与合成文件、笔记验收
npm run test:live:agent -- --parent /sata1/my/data --yes --report work/agent-acceptance.json
```

离线测试使用合成凭证和本机 HTTP 模拟服务，CI 不访问真实 NAS。公开的实机测试报告只保留协议版本、测试项与结果；设备信息、会话细节和运行标识已移除。见 [docs/acceptance-v0.1.json](docs/acceptance-v0.1.json)。

CLI 已在 macOS 验证；GitHub CI 检查 Linux 上的 Node.js 22/24。NAS 未公开稳定接口契约，固件升级后应重跑验收。v0.5.1 有 125 项 Node 离线测试，其中一项运行 10 项 Python 桥接测试。新增 38 个操作已在五组 MCP 实机工作流中调用，14 项清理检查通过，见 [v0.5 实机报告](docs/acceptance-app-workflows-v0.5.json)。历史 v0.4 两个独立客户端的 20 项 Agent 实机检查全部通过，见 [Agent 报告](docs/acceptance-agent-v0.4.json)。安卓 MCP 实机结果见 [安卓验收报告](docs/acceptance-android-v0.3.json)。原 v0.2.0 NAS MCP 实机验收通过 161 项检查；详见 [MCP 实机报告](docs/acceptance-mcp-v0.2.json)。危险写操作仅验证参数和请求契约，没有为了测试去停止现有容器、重启虚拟机、卸载现有应用。尚未实现密码登录、NAS 重启关机、RAID/磁盘变更、文件永久删除、手机专用阅读/漫画的直连 NAS API、第三方应用全部内部功能。

同名保护会在操作前检查目录并使用不自动改名的请求参数，但服务端未提供已验证的原子排他写入契约；不要同时由多个进程写入相同目标。目录复制的内容完整性由 NAS 任务完成结果报告，CLI 只额外检查目标目录存在，未递归逐文件计算哈希。

公开内容的隐私约定见 [隐私说明](docs/privacy.md)。

协议与研究来源见 [docs/protocol.md](docs/protocol.md)、[NOTICE.md](NOTICE.md)。安全约定见 [SECURITY.md](SECURITY.md)。
