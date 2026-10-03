# 协议记录

协议研究版本：Web `2.3.2026082801`，NAS HTTPS 接口默认使用 5056 端口。该版本来自 `/system/polling2`，不应推断为所有后台组件的版本。

## 请求与认证

API 请求使用当前 NAS origin，附带登录会话 Cookie、`webagent=v2` 及网页客户端参数 `plat/version/device_id/device/_l`。本次验证 `zenithtoken` Cookie 可用于全部已实现命令；也接受旧式 `token` Cookie，但旧固件尚未实测。

普通 POST 使用 `application/x-www-form-urlencoded`。数组用重复的 `paths[]` / `ids[]` 字段。响应通常为 `{code, msg, data}`；数字 `200` 和字符串 `"200"` 表示成功。HTTP 200 本身不能证明业务成功。`S000200` 兼容分支只有离线测试依据。

当前认证只复用用户已完成的网页登录。不申请新的设备授权、不绕过短信验证码或 MFA、不访问系统数据库。会话能否持续有效由 NAS 决定；CLI 不假设固定有效期。

## 已验证接口

| 接口 | 方法 | 用途 |
| --- | --- | --- |
| `/auth/token` | POST | 验证会话、可访问存储池 |
| `/system/polling2` | POST | 系统轮询和 Web 版本 |
| `/system/recent` | POST | CPU、内存、温度、网络 |
| `/system/versions` | POST | 组件版本 |
| `/system/diskusage3` | POST | 磁盘空间 |
| `/manager/services` | POST | 服务资源 |
| `/manager/v2/processes` | POST | 进程资源 |
| `/network-settings/v1/interface/list` | GET | 网络接口 |
| `/zspool/info` | POST | 存储池与磁盘 |
| `/zspool/hardware/info` | POST | 硬盘槽位 |
| `/zspool/polling` | POST | 存储实时状态 |
| `/zspool/capability` | POST | 存储能力 |
| `/AppStore/v1/list` | POST | 应用目录 |
| `/v2/file/list` | POST | 文件列表，`path/start/num/sortby/order/show_hidden/dup` |
| `/v2/file/info` | POST | 元数据，`path` |
| `/v2/file/newdir` | POST | 新建目录，`parent/name/rename=0` |
| `/v2/file/modify` | POST | 改名，`path/newname` |
| `/v2/file/copy`、`/v2/file/move` | POST | `paths[]/to` |
| `/v2/file/create` | POST binary | 文件内容，URL 编码的 `path` header、`rename=0`、`app=file` |
| `/v2/file/download` | GET | `path/remote_port=8050` |
| `/v2/file/remove` | POST | `paths[]/skip_bin=0` |
| `/v2/file/recycle/config/get` | POST | 回收站策略 |
| `/v2/file/nb/list` | POST | 个人回收站，`path=/.recycle/my/start/num` |
| `/v2/file/tasks` | POST | 文件任务 |
| `/v2/file/taskbyids` | POST | 保留的任务，`ids[]` |
| `/v2/file/categories` | POST | 文件类型统计 |

`/system` 根端点实测 404，未作为命令发布。社区文档中“所有 `/system/*` 外部均 404”的结论不适用于本次会话：表中的系统子端点已实测成功。

## 文件细节

个人文件根由 `/auth/token` 的 `sp_perms[].pool` 构造为 `/<pool>/my/data`，不能把 `/` 当作个人空间根。列表中的数量、大小、布尔标记经常以字符串返回。分页根据服务端 `total` 和已收条数推进，检测重复页和空页停滞；正在修改的目录不具备快照一致性。

上传的 `path` 是 **header**，不是只放在 URL 查询串；后者本次返回 `N001212`。已验证 Unicode、空格、`&`、`%`、`+` 文件名、空文件、普通 JSON 和 2 MiB 二进制文件。更大文件使用同一流式实现，但未宣称验证 TB 级文件或断点续传。

传输完成后检查大小；验收通过下载后的 SHA-256 与原始数据比对内容。下载不把 HTTP 200 下的认证错误 JSON 当成文件，并保留带附件标识的真实 JSON 文件。

## 任务完成语义

复制、移动、移入回收站返回 `data.otype` 和 `data.task`。网页代码对 `otype=async` 轮询 `/taskbyids`，对 `otype=sync` 直接处理结果。

实机发现：同步移动可能返回 `task.state="new"`，随后任务也不在 `/taskbyids` 中，但目标已经存在、源路径已经消失。因此 CLI 不把所有 `state=new` 都当作异步任务。它按 `otype` 区分：同步操作检查失败计数并读取目标/源元数据确认；异步操作等到任务完成，再检查元数据。目录内容完整性仍依赖 NAS 的任务报告，不递归做内容哈希。

保留的历史任务查询已验证；同步任务 ID 不保证可以再次查询。任务超时不执行取消，不重放请求。`--no-wait` 返回尚未完成的异步状态。

## 回收站

删除固定发送 `skip_bin=0`。仅接受个人或团队空间内的具体路径，拒绝根目录和回收站路径。网页回收站设置明确把 `my_cycle/public_cycle=-1` 显示为“不自动清理”，不是禁用回收站。CLI 还读取策略以拒绝未知状态。

实机验收创建独立测试目录，并确认删除后原目录消失、回收站存在对应记录。未测试也未实现永久删除、清空回收站和恢复覆盖。

## 保留边界

没有官方稳定性保证；未检验其他 NAS 机型/版本、中转登录、代理模式、保险箱、加密池、断点续传或高并发同路径写入。原始请求和凭证不得作为测试 fixture；仓库内测试数据均为合成数据。

## v0.2.0 应用接口

完整路径、方法、参数 schema 由 `src/operations.js` 生成到 [operations.json](operations.json)。这份注册表记录实现，不等同于所有写接口已实机执行。实机证据与限制见 [coverage.md](coverage.md)。

- 极音乐曲目查询使用 POST `/zmusic/api/v2/song/list`，分页为 `page/page_size`。多数音乐目录接口使用 GET。音乐歌单删除的 `playlist_id` 为数组；有声书库删除的同名字段为标量。
- 记事本 `location=2` 为普通空间，`1` 为保险箱内空间。新建分类返回直接数字 ID，重命名与删除使用 `id`。置顶 `cancel=0`，取消置顶 `cancel=1`。
- 当前 Docker 通过 NAS 同源 `/zdocker/*` 访问，不另行获取 Portainer token。`container_create/update` 的容器配置是 JSON body，容器名和 ID 为 query。Compose 列表是 JSON POST，其创建接口是 form POST。
- 监控中心 `data` form 字段内再包含 JSON。Time Machine 状态请求使用 `type=7` 和含用户名的 JSON `data` 字段。
- DDNS 列表使用 GET；备份详情使用 `task_id`；极课堂资源和最近记录需要 `course_id`。
- 网盘路径按 provider 固定映射，使用当前客户端的 form 编码。未授权状态、未安装服务、账户权限不足与接口不存在应分别保留原始错误码，不把错误的空结果视为成功。
- 应用目录合并原生 AppStore 和 Docker AppStore；只输出选定元数据，不输出安装包密码等字段。应用启停、卸载先检查目录中的 toggleable/removable；原生安装/升级采用当前目录的 version_int。Docker 商店的专用安装配置未实现，使用原生商店或显式 docker/compose 操作。

CLI 使用显式导入的网页会话，不读取原生客户端数据库；原生客户端代理与 NAS 直连是不同的连接方式。


## v0.3.0 安卓 UI transport

安卓桥接的接口适配版本为极空间 Android 2.5.632。阅读、漫画、亲情设置的 Web 元数据没有给出可验证的完整业务契约；本版本没有据接口前缀猜测业务请求。

`android.*` 的 `transport` 为 `android-ui`，`requiresNas=false`，没有 HTTP method/endpoint。Node 通过 stdin 发送严格 JSON 到随包 Python 桥接，调用现有 ADB/uiautomator2。控件 target 来自可见 UI，包含 activity、控件位置、文本、类型与状态的摘要；每次操作重新读取并校验，不暴露任意 shell、包名、URL 或坐标接口。

已验证入口为 `BookMainActivity`、`ComicMainActivity`、`FamilyServiceActivity` 和 `BackupMainActivity`。客户端版本改变后，界面文字、资源 ID 或 activity 可能变化；应重新验收。打开应用不代表已实现其完整书库、阅读器、亲情账号或备份协议。


## v0.5.0 应用工作流

新增契约来自同版本厂商网页的请求封装和实际调用位置，再通过合成数据执行与回读。文件名、摘要、完整分组及验收范围见 [应用契约](application-contracts-v0.5.md)。

- 笔记颜色为 0–5，0 是红色；`action=1/2` 设置/取消。详情返回 `label_id` 字符串，列表条目的标签字段不同。`classify_id=0` 移出分类，不等同于省略参数。
- 相册成员移除的 `feed_ids` 和索引目录的 `dir_ids` 使用逗号串；CLI 接受数组后转换，拒绝含逗号的 ID。普通相册移除固定带 `confirm=1`，不调用源文件删除端点；实机回读确认源文件仍在。
- 音乐收藏按 `favorite_type` 区分 song/album/artist/playlist；`favorite_content[]` 中歌手使用名称，其他使用对应 ID。歌曲和歌单收藏列表额外带 `source=2`。`library-remove` 使用 `remove_type=file`、`remove_value[]` 移除索引引用，保留源文件。
- 有声书目录用 `dirs[]`，移除章节用 `track_id[]`；定位保留厂商参数拼写 `sort_filed=title`。前端遗留的 `/zaudio/api/v1/song/parse/cue` 本次返回 `HTTP_ERROR`，不发布对应命令；音乐 `/zmusic/api/v2/song/info/cue` 已通过合成双轨 CUE 验证。
- 影视库列表使用 `start/limit`，起点为 1，不能套用其他应用的 `start=0/num`。自定义合集的创建和解散仅管理合集；不刮削库拒绝创建，返回 `N120039`，普通库的创建、收藏、取消收藏、解散及源文件保留已实测。
- 应用导入/扫描不套用文件任务完成语义；CLI 原样返回业务结果。验收脚本只轮询读取状态与列表，不重放写请求。此轮未修改网络配置或现有业务数据。
