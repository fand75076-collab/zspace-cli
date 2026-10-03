# 命令目录

共 318 条命令。由 `npm run docs` 生成。别名不重复计数。

使用 `zspace <命令> --help` 查看参数。新增操作也可用 `--params '{"字段":"值"}'` 或 `--param 字段=值`；数组与对象使用 JSON。操作字段 `config` 的命名选项是 `--spec`，避免与全局凭证文件 `--config` 冲突。

`zspace api describe <domain.action>` 输出准确的输入 schema。原有文件命令继续使用位置参数。工具数量、应用覆盖程度与验收次数是不同指标；见 [覆盖表](coverage.md) 和 [MCP 文档](mcp.md)。

| 命令 | 用途 | 行为 | 参数 |
| --- | --- | --- | --- |
| `status` | 设备概况：CPU、内存、容量 | 查询/本机 |  |
| `auth import` | 导入已登录浏览器会话并验证 | 查询/本机 | --file <session.json> \| --stdin [--name home] |
| `auth status` | 验证当前会话 | 查询/本机 |  |
| `auth logout` | 清除本机选中配置，保留网页登录 | 写入，需 --yes | [--yes] |
| `auth source` | 绑定或解绑同一 NAS 的私密会话轮换文件 | 写入，需 --yes | --file <private-session.json> \| --clear --yes |
| `auth refresh` | 验证当前会话并载入轮换文件中的新会话 | 查询/本机 |  |
| `auth session` | 查看会话模式和恢复步骤，不显示凭证 | 查询/本机 |  |
| `agent create` | 创建固定 NAS、明确操作和目录范围的 Agent 配置 | 写入，需 --yes | <name> [--read system.status,apps.coverage] [--write notes.create] --yes |
| `agent list` | 列出 Agent 配置与撤销状态 | 查询/本机 |  |
| `agent update` | 由所有者调整权限；新增操作需要重启 MCP 连接 | 写入，需 --yes | <name> [--read OPERATIONS] [--write OPERATIONS] --yes |
| `agent show` | 查看 Agent 的完整权限，不显示凭证 | 查询/本机 | <name> |
| `agent revoke` | 撤销 Agent 后续调用权限 | 写入，需 --yes | <name> --yes |
| `agent config` | 生成不含凭证的 MCP 客户端配置 | 查询/本机 | <name> [--format json\|codex] |
| `agent call` | 在 Agent 权限内执行同一注册表操作 | 依操作；写入需 --yes | <name> <operation> [--params JSON] [--yes\|--dry-run] |
| `agent doctor` | 检查 Agent 权限、会话和 MCP 启动配置 | 查询/本机 | <name> |
| `profile list` | 列出配置，不显示凭证 | 查询/本机 |  |
| `profile use` | 切换默认配置 | 查询/本机 | <name> |
| `config path` | 显示本机配置路径 | 查询/本机 |  |
| `doctor` | 检查认证和核心接口 | 查询/本机 |  |
| `files roots` | 列出当前账号可访问的个人空间根目录 | 查询/本机 |  |
| `files ls` | 列目录，支持完整分页 | 查询/本机 | <path> [--all] [--limit 100] |
| `files stat` | 文件或目录元数据 | 查询/本机 | <path> |
| `files mkdir` | 创建目录（父目录必须已存在） | 写入，需 --yes | <path> --yes |
| `files rename` | 改名，不覆盖已有文件 | 写入，需 --yes | <path> <new-name> --yes |
| `files copy` | 复制文件/目录到目标目录 | 写入，需 --yes | <source...> --to <directory> --yes |
| `files move` | 移动文件/目录到目标目录 | 写入，需 --yes | <source...> --to <directory> --yes |
| `files trash` | 移入回收站；回收站策略未知时拒绝 | 写入，需 --yes | <path...> --yes |
| `files task` | 查询文件任务，可等待完成 | 查询/本机 | <id> [--wait] |
| `files recycle` | 列出个人回收站 | 查询/本机 | [--start 0] [--limit 100] |
| `files upload` | 流式上传一个文件，拒绝重名 | 写入，需 --yes | <local-file> <remote-file> --yes |
| `files download` | 流式下载，原子保存，返回 SHA-256 | 写入，需 --yes | <remote-file> <local-file> --yes |
| `api list` | 列出操作 schema、写入属性和接口 | 查询/本机 |  |
| `api call` | 调用注册表中的只读操作 | 查询/本机 | <operation> [--params JSON] [--param key=value] |
| `commands` | 命令目录，可供脚本和 AI 发现 | 查询/本机 | [--json] |
| `completion` | 输出 shell 补全脚本 | 查询/本机 | <bash\|zsh> |
| `api describe` | 查看操作的参数 schema、方法和写入属性 | 查询/本机 | <operation> |
| `mcp serve` | 启动 stdio MCP 服务 | 查询/本机 | [--agent NAME] [--allow-write] [--domains files,notes,music] |
| `system polling` | 系统运行状态和固件版本 | 查询/本机 |  |
| `system recent` | CPU、内存、网络和温度 | 查询/本机 |  |
| `system versions` | 系统组件版本 | 查询/本机 |  |
| `system usage` | 磁盘空间用量 | 查询/本机 |  |
| `system services` | 服务资源用量 | 查询/本机 |  |
| `system processes` | 进程资源用量 | 查询/本机 |  |
| `system network` | 网络接口 | 查询/本机 |  |
| `storage pools` | 存储池和磁盘 | 查询/本机 |  |
| `storage hardware` | 硬盘槽位 | 查询/本机 |  |
| `storage status` | 存储实时状态 | 查询/本机 |  |
| `storage capabilities` | 存储能力 | 查询/本机 |  |
| `apps list` | 应用目录和安装状态 | 查询/本机 |  |
| `files tasks` | 异步文件任务 | 查询/本机 |  |
| `files categories` | 文件类型统计 | 查询/本机 |  |
| `files recycle-config` | 回收站保留周期 | 查询/本机 |  |
| `system status` | 设备概况 | 查询/本机 | [--params JSON] [--param key=value] |
| `files list` | 列出文件，可按页或遍历所有页 | 查询/本机 | [--params JSON] [--param key=value] |
| `files info` | 文件元数据 | 查询/本机 | [--params JSON] [--param key=value] |
| `files recent` | 最近文件 | 查询/本机 | [--params JSON] [--param key=value] |
| `files download-tasks` | 文件传输列表 | 查询/本机 | [--params JSON] [--param key=value] |
| `notes list` | 笔记列表 | 查询/本机 | [--params JSON] [--param key=value] |
| `notes info` | 读取笔记正文 | 查询/本机 | [--params JSON] [--param key=value] |
| `notes search` | 搜索笔记 | 查询/本机 | [--params JSON] [--param key=value] |
| `notes categories` | 笔记分类树 | 查询/本机 | [--params JSON] [--param key=value] |
| `notes config` | 记事本配置 | 查询/本机 | [--params JSON] [--param key=value] |
| `notes usage` | 笔记空间占用 | 查询/本机 | [--params JSON] [--param key=value] |
| `notes history` | 笔记修订历史 | 查询/本机 | [--params JSON] [--param key=value] |
| `notes history-info` | 笔记修订内容 | 查询/本机 | [--params JSON] [--param key=value] |
| `notes create` | 新建笔记 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `notes update` | 更新笔记 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `notes delete` | 删除指定笔记 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `notes category-create` | 创建笔记分类 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `notes category-rename` | 重命名笔记分类 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `notes category-delete` | 删除笔记分类 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `notes pin` | 置顶笔记；cancel=1 取消置顶 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `notes category-list` | 分页读取笔记分类 | 查询/本机 | [--params JSON] [--param key=value] |
| `notes move` | 批量移动笔记到分类；classify_id=0 移出分类 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `notes label` | 设置或取消笔记颜色标签；action=1 设置、2 取消 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `photos albums` | 相册列表 | 查询/本机 | [--params JSON] [--param key=value] |
| `photos home` | 相册首页 | 查询/本机 | [--params JSON] [--param key=value] |
| `photos directories` | 已索引的照片目录 | 查询/本机 | [--params JSON] [--param key=value] |
| `photos album` | 相册详情 | 查询/本机 | [--params JSON] [--param key=value] |
| `photos items` | 相册照片列表 | 查询/本机 | [--params JSON] [--param key=value] |
| `photos timeline` | 照片时间线 | 查询/本机 | [--params JSON] [--param key=value] |
| `photos config` | 相册配置 | 查询/本机 | [--params JSON] [--param key=value] |
| `photos scan` | 相册索引进度 | 查询/本机 | [--params JSON] [--param key=value] |
| `photos ai-status` | 照片 AI 状态 | 查询/本机 | [--params JSON] [--param key=value] |
| `photos ai-tasks` | 照片 AI 任务 | 查询/本机 | [--params JSON] [--param key=value] |
| `photos ai-events` | 照片 AI 事件 | 查询/本机 | [--params JSON] [--param key=value] |
| `photos shares` | 相册分享列表 | 查询/本机 | [--params JSON] [--param key=value] |
| `photos database` | 相册数据库占用 | 查询/本机 | [--params JSON] [--param key=value] |
| `photos album-create` | 新建相册 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `photos album-rename` | 修改相册名称 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `photos album-delete` | 删除相册 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `photos album-add` | 添加已有照片到相册 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `photos by-path` | 按 NAS 文件路径读取已索引照片 | 查询/本机 | [--params JSON] [--param key=value] |
| `photos photo-albums` | 查看照片所属相册 | 查询/本机 | [--params JSON] [--param key=value] |
| `photos favorites` | 分页读取收藏照片 | 查询/本机 | [--params JSON] [--param key=value] |
| `photos favorite` | 收藏照片或取消收藏；liked=1 收藏、0 取消 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `photos album-remove` | 从普通相册移除照片；不调用源文件删除接口 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `photos directory-add` | 添加照片索引目录；使用 directory-scan 扫描新目录 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `photos directory-remove` | 移除照片索引目录引用；保留源文件 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `photos directory-scan` | 扫描指定照片索引目录；随后查询 photos.scan | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `video libraries` | 影视库列表 | 查询/本机 | [--params JSON] [--param key=value] |
| `video directories` | 影视库目录 | 查询/本机 | [--params JSON] [--param key=value] |
| `video latest` | 最新入库影视 | 查询/本机 | [--params JSON] [--param key=value] |
| `video suggested` | 推荐影视 | 查询/本机 | [--params JSON] [--param key=value] |
| `video recent` | 最近播放 | 查询/本机 | [--params JSON] [--param key=value] |
| `video playlists` | 播放列表 | 查询/本机 | [--params JSON] [--param key=value] |
| `video favorites` | 影视收藏 | 查询/本机 | [--params JSON] [--param key=value] |
| `video filters` | 影视筛选条件 | 查询/本机 | [--params JSON] [--param key=value] |
| `video collection` | 影视条目详情 | 查询/本机 | [--params JSON] [--param key=value] |
| `video shares` | 影视分享列表 | 查询/本机 | [--params JSON] [--param key=value] |
| `video config` | 影视设置 | 查询/本机 | [--params JSON] [--param key=value] |
| `video scan-schedule` | 媒体扫描计划 | 查询/本机 | [--params JSON] [--param key=value] |
| `video library-create` | 添加影视库 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `video library-rename` | 重命名影视库 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `video library-delete` | 移除影视库 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `video rescan` | 重新扫描指定影视库 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `video seen` | 标记影视已看 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `video unseen` | 取消影视已看标记 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `video favorite-add` | 收藏指定影视条目 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `video favorite-remove` | 取消指定影视条目收藏 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `video collections` | 分页读取指定影视库条目；start 从 1 开始 | 查询/本机 | [--params JSON] [--param key=value] |
| `video collection-create` | 在普通影视库创建自定义合集；不刮削库不支持 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `video collection-dismiss` | 解散自定义影视合集，保留源文件 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `music songs` | 音乐库曲目 | 查询/本机 | [--params JSON] [--param key=value] |
| `music overview` | 音乐库概况 | 查询/本机 | [--params JSON] [--param key=value] |
| `music latest` | 最新音乐 | 查询/本机 | [--params JSON] [--param key=value] |
| `music playlists` | 歌单列表 | 查询/本机 | [--params JSON] [--param key=value] |
| `music playlist` | 歌单详情 | 查询/本机 | [--params JSON] [--param key=value] |
| `music playlist-songs` | 歌单曲目 | 查询/本机 | [--params JSON] [--param key=value] |
| `music artists` | 歌手列表 | 查询/本机 | [--params JSON] [--param key=value] |
| `music albums` | 音乐专辑 | 查询/本机 | [--params JSON] [--param key=value] |
| `music album` | 专辑详情 | 查询/本机 | [--params JSON] [--param key=value] |
| `music genres` | 曲风列表 | 查询/本机 | [--params JSON] [--param key=value] |
| `music favorites` | 音乐收藏 | 查询/本机 | [--params JSON] [--param key=value] |
| `music recent` | 最近播放的音乐 | 查询/本机 | [--params JSON] [--param key=value] |
| `music status` | 音乐服务状态 | 查询/本机 | [--params JSON] [--param key=value] |
| `music config` | 音乐设置 | 查询/本机 | [--params JSON] [--param key=value] |
| `music playlist-create` | 创建歌单 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `music playlist-update` | 更新歌单 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `music playlist-delete` | 删除歌单 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `music playlist-add` | 添加曲目到歌单 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `music playlist-remove` | 从歌单移除曲目 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `music song` | 曲目详情与标签 | 查询/本机 | [--params JSON] [--param key=value] |
| `music lyrics` | 读取曲目歌词 | 查询/本机 | [--params JSON] [--param key=value] |
| `music cue` | 读取曲目 CUE 分轨信息 | 查询/本机 | [--params JSON] [--param key=value] |
| `music lyrics-update` | 更新指定曲目的歌词 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `music favorite-add` | 收藏曲目、专辑、歌手或歌单 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `music favorite-remove` | 取消曲目、专辑、歌手或歌单收藏 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `music favorite-songs` | 分页读取收藏曲目 | 查询/本机 | [--params JSON] [--param key=value] |
| `music favorite-albums` | 分页读取收藏专辑 | 查询/本机 | [--params JSON] [--param key=value] |
| `music favorite-artists` | 分页读取收藏歌手 | 查询/本机 | [--params JSON] [--param key=value] |
| `music favorite-playlists` | 分页读取收藏歌单 | 查询/本机 | [--params JSON] [--param key=value] |
| `music tasks` | 音乐库后台任务状态 | 查询/本机 | [--params JSON] [--param key=value] |
| `music directories` | 音乐库的来源文件与目录 | 查询/本机 | [--params JSON] [--param key=value] |
| `music library-add` | 添加来源文件或目录到音乐库；随后查询 music.tasks | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `music library-remove` | 从音乐库移除来源路径引用；保留源文件 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `music library-rescan` | 重新扫描指定音乐来源路径；随后查询 music.tasks | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `audiobooks libraries` | 有声读物书库 | 查询/本机 | [--params JSON] [--param key=value] |
| `audiobooks library` | 有声书库详情 | 查询/本机 | [--params JSON] [--param key=value] |
| `audiobooks chapters` | 有声书章节 | 查询/本机 | [--params JSON] [--param key=value] |
| `audiobooks recent` | 最近收听 | 查询/本机 | [--params JSON] [--param key=value] |
| `audiobooks scan-status` | 有声书扫描状态 | 查询/本机 | [--params JSON] [--param key=value] |
| `audiobooks library-create` | 创建有声书库 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `audiobooks library-rename` | 重命名有声书库 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `audiobooks library-delete` | 删除有声书库 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `audiobooks directory-add` | 添加 NAS 目录到有声书库；随后查询 import-status | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `audiobooks directory-remove` | 从有声书库移除目录引用 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `audiobooks chapter-remove` | 从有声书库移除指定章节 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `audiobooks rescan` | 重新扫描指定有声书库；随后查询 scan-status | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `audiobooks import-status` | 有声书目录导入进度 | 查询/本机 | [--params JSON] [--param key=value] |
| `audiobooks external-status` | 有声书库外部存储可用状态 | 查询/本机 | [--params JSON] [--param key=value] |
| `audiobooks chapter-position` | 查询章节在书库排序中的位置 | 查询/本机 | [--params JSON] [--param key=value] |
| `downloads list` | 下载任务 | 查询/本机 | [--params JSON] [--param key=value] |
| `downloads settings` | 下载设置 | 查询/本机 | [--params JSON] [--param key=value] |
| `downloads protocols` | 支持的下载协议 | 查询/本机 | [--params JSON] [--param key=value] |
| `downloads directories` | 下载保存目录 | 查询/本机 | [--params JSON] [--param key=value] |
| `downloads engine` | 下载引擎状态 | 查询/本机 | [--params JSON] [--param key=value] |
| `downloads details` | 下载队列和任务统计 | 查询/本机 | [--params JSON] [--param key=value] |
| `downloads share-list` | 分享下载任务 | 查询/本机 | [--params JSON] [--param key=value] |
| `downloads add` | 添加 HTTP、FTP 或 magnet 下载链接 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `downloads start` | 继续下载任务 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `downloads stop` | 暂停下载任务 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `downloads remove` | 移除下载任务（默认保留文件） | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `docker containers` | 所有容器 | 查询/本机 | [--params JSON] [--param key=value] |
| `docker inspect` | 容器详情 | 查询/本机 | [--params JSON] [--param key=value] |
| `docker stats` | 容器资源使用 | 查询/本机 | [--params JSON] [--param key=value] |
| `docker logs` | 容器日志 | 查询/本机 | [--params JSON] [--param key=value] |
| `docker top` | 容器内进程 | 查询/本机 | [--params JSON] [--param key=value] |
| `docker images` | 本地镜像 | 查询/本机 | [--params JSON] [--param key=value] |
| `docker image` | 镜像详情 | 查询/本机 | [--params JSON] [--param key=value] |
| `docker networks` | Docker 网络 | 查询/本机 | [--params JSON] [--param key=value] |
| `docker network` | Docker 网络详情 | 查询/本机 | [--params JSON] [--param key=value] |
| `docker status` | Docker 服务状态 | 查询/本机 | [--params JSON] [--param key=value] |
| `docker info` | Docker 系统信息 | 查询/本机 | [--params JSON] [--param key=value] |
| `docker storage` | Docker 数据目录 | 查询/本机 | [--params JSON] [--param key=value] |
| `docker pull-tasks` | 镜像拉取任务 | 查询/本机 | [--params JSON] [--param key=value] |
| `docker action` | 启动、停止、重启或暂停指定容器 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `docker create` | 创建容器；config 为 Docker 容器 JSON 配置，不自动启动 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `docker update` | 更新容器配置 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `docker remove` | 删除指定容器 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `docker pull` | 拉取指定镜像 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `docker image-remove` | 删除指定镜像 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `docker network-create` | 创建 Docker 网络 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `docker network-remove` | 删除 Docker 网络 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `compose list` | Compose 项目 | 查询/本机 | [--params JSON] [--param key=value] |
| `compose containers` | 项目容器 | 查询/本机 | [--params JSON] [--param key=value] |
| `compose file` | 读取 Compose 配置（凭证会被隐藏） | 查询/本机 | [--params JSON] [--param key=value] |
| `compose tasks` | Compose 任务 | 查询/本机 | [--params JSON] [--param key=value] |
| `compose logs` | 项目日志 | 查询/本机 | [--params JSON] [--param key=value] |
| `compose start` | Compose start | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `compose stop` | Compose stop | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `compose restart` | Compose restart | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `compose create` | 保存 Compose 项目；默认不启动 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `vm list` | 虚拟机列表 | 查询/本机 | [--params JSON] [--param key=value] |
| `vm host` | 虚拟机宿主机状态 | 查询/本机 | [--params JSON] [--param key=value] |
| `vm service` | 虚拟机服务状态 | 查询/本机 | [--params JSON] [--param key=value] |
| `vm inspect` | 虚拟机详情 | 查询/本机 | [--params JSON] [--param key=value] |
| `vm disks` | 虚拟机磁盘 | 查询/本机 | [--params JSON] [--param key=value] |
| `vm snapshots` | 虚拟机快照 | 查询/本机 | [--params JSON] [--param key=value] |
| `vm network` | 虚拟机网络配置 | 查询/本机 | [--params JSON] [--param key=value] |
| `vm pci` | PCI 设备 | 查询/本机 | [--params JSON] [--param key=value] |
| `vm schedules` | 虚拟机定时计划 | 查询/本机 | [--params JSON] [--param key=value] |
| `vm action` | 虚拟机电源控制 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `antivirus status` | 病毒查杀状态 | 查询/本机 | [--params JSON] [--param key=value] |
| `antivirus database` | 病毒库版本 | 查询/本机 | [--params JSON] [--param key=value] |
| `antivirus whitelist` | 查杀白名单 | 查询/本机 | [--params JSON] [--param key=value] |
| `antivirus quarantine` | 隔离区概况 | 查询/本机 | [--params JSON] [--param key=value] |
| `antivirus usage` | 查杀空间占用 | 查询/本机 | [--params JSON] [--param key=value] |
| `antivirus schedule` | 自动查杀计划 | 查询/本机 | [--params JSON] [--param key=value] |
| `antivirus update` | 更新病毒库 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `camera list` | 摄像头列表 | 查询/本机 | [--params JSON] [--param key=value] |
| `camera config` | 摄像头设置 | 查询/本机 | [--params JSON] [--param key=value] |
| `camera storage` | 监控存储配置 | 查询/本机 | [--params JSON] [--param key=value] |
| `ddns list` | DDNS 记录 | 查询/本机 | [--params JSON] [--param key=value] |
| `wechat directory` | 微信快存保存目录 | 查询/本机 | [--params JSON] [--param key=value] |
| `wechat config` | 微信快存设置 | 查询/本机 | [--params JSON] [--param key=value] |
| `wechat accounts` | 微信快存绑定列表 | 查询/本机 | [--params JSON] [--param key=value] |
| `wechat messages` | 已快存的微信消息 | 查询/本机 | [--params JSON] [--param key=value] |
| `ai models` | NAS 本地 AI 模型 | 查询/本机 | [--params JSON] [--param key=value] |
| `ai status` | 本地 AI 推理服务状态 | 查询/本机 | [--params JSON] [--param key=value] |
| `ai downloads` | 本地模型下载进度 | 查询/本机 | [--params JSON] [--param key=value] |
| `ai disks` | AI 模型存储目录 | 查询/本机 | [--params JSON] [--param key=value] |
| `images engine` | 影像处理引擎 | 查询/本机 | [--params JSON] [--param key=value] |
| `images downloads` | 影像处理引擎下载状态 | 查询/本机 | [--params JSON] [--param key=value] |
| `backup tasks` | 备份中心任务 | 查询/本机 | [--params JSON] [--param key=value] |
| `backup info` | 备份任务详情 | 查询/本机 | [--params JSON] [--param key=value] |
| `backup failures` | 备份失败记录 | 查询/本机 | [--params JSON] [--param key=value] |
| `backup usb-tasks` | 即插即备任务 | 查询/本机 | [--params JSON] [--param key=value] |
| `backup usb-config` | 即插即备设置 | 查询/本机 | [--params JSON] [--param key=value] |
| `backup start` | 立即运行指定备份任务 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `sync status` | 文档同步状态 | 查询/本机 | [--params JSON] [--param key=value] |
| `office status` | 文档编辑服务状态 | 查询/本机 | [--params JSON] [--param key=value] |
| `office config` | Office 配置 | 查询/本机 | [--params JSON] [--param key=value] |
| `office fonts` | Office 字体 | 查询/本机 | [--params JSON] [--param key=value] |
| `vault status` | 保险箱状态 | 查询/本机 | [--params JSON] [--param key=value] |
| `vault download-status` | 保险箱传输状态 | 查询/本机 | [--params JSON] [--param key=value] |
| `vault lock` | 锁定保险箱 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `collections list` | 文件收集任务 | 查询/本机 | [--params JSON] [--param key=value] |
| `collections info` | 文件收集任务详情 | 查询/本机 | [--params JSON] [--param key=value] |
| `collections files` | 已收集文件 | 查询/本机 | [--params JSON] [--param key=value] |
| `search files` | 按关键词搜索文件 | 查询/本机 | [--params JSON] [--param key=value] |
| `search documents` | 文档全文搜索 | 查询/本机 | [--params JSON] [--param key=value] |
| `search config` | 搜索索引设置 | 查询/本机 | [--params JSON] [--param key=value] |
| `search exclusions` | 搜索排除目录 | 查询/本机 | [--params JSON] [--param key=value] |
| `search index-status` | 搜索索引状态 | 查询/本机 | [--params JSON] [--param key=value] |
| `classes courses` | 极课堂课程 | 查询/本机 | [--params JSON] [--param key=value] |
| `classes course` | 课程详情 | 查询/本机 | [--params JSON] [--param key=value] |
| `classes resources` | 课程资源 | 查询/本机 | [--params JSON] [--param key=value] |
| `classes recent` | 指定课程最近学习 | 查询/本机 | [--params JSON] [--param key=value] |
| `recovery disks` | 恢复助手可用磁盘 | 查询/本机 | [--params JSON] [--param key=value] |
| `sharing links` | 外链分享记录 | 查询/本机 | [--params JSON] [--param key=value] |
| `sharing statistics` | 分享统计 | 查询/本机 | [--params JSON] [--param key=value] |
| `sharing internal` | 内部分享 | 查询/本机 | [--params JSON] [--param key=value] |
| `sharing received` | 分享给我的文件 | 查询/本机 | [--params JSON] [--param key=value] |
| `sharing sent` | 我的内部分享 | 查询/本机 | [--params JSON] [--param key=value] |
| `team groups` | 团队分组 | 查询/本机 | [--params JSON] [--param key=value] |
| `team permissions` | 团队空间权限 | 查询/本机 | [--params JSON] [--param key=value] |
| `team quota` | 团队配额 | 查询/本机 | [--params JSON] [--param key=value] |
| `users list` | NAS 账号列表 | 查询/本机 | [--params JSON] [--param key=value] |
| `security firewall` | 防火墙服务 | 查询/本机 | [--params JSON] [--param key=value] |
| `security access` | IP 访问控制列表 | 查询/本机 | [--params JSON] [--param key=value] |
| `settings load` | 系统配置（凭证字段隐藏） | 查询/本机 | [--params JSON] [--param key=value] |
| `settings ssh` | SSH 服务状态 | 查询/本机 | [--params JSON] [--param key=value] |
| `storage external` | 外接存储设备 | 查询/本机 | [--params JSON] [--param key=value] |
| `storage smart` | 磁盘 SMART 报告 | 查询/本机 | [--params JSON] [--param key=value] |
| `storage snapshots` | 存储快照 | 查询/本机 | [--params JSON] [--param key=value] |
| `storage migration` | 硬盘搬家状态 | 查询/本机 | [--params JSON] [--param key=value] |
| `services samba` | samba 服务状态 | 查询/本机 | [--params JSON] [--param key=value] |
| `services webdav` | webdav 服务状态 | 查询/本机 | [--params JSON] [--param key=value] |
| `services ftp` | ftp 服务状态 | 查询/本机 | [--params JSON] [--param key=value] |
| `services dlna` | dlna 服务状态 | 查询/本机 | [--params JSON] [--param key=value] |
| `services tm` | Time Machine 状态 | 查询/本机 | [--params JSON] [--param key=value] |
| `ftp-backup status` | FTP 备份连接状态 | 查询/本机 | [--params JSON] [--param key=value] |
| `ftp-backup tasks` | FTP 备份任务 | 查询/本机 | [--params JSON] [--param key=value] |
| `hdmi status` | HDMI 登录状态 | 查询/本机 | [--params JSON] [--param key=value] |
| `hdmi fonts` | HDMI 字体 | 查询/本机 | [--params JSON] [--param key=value] |
| `remote support` | 远程协助状态 | 查询/本机 | [--params JSON] [--param key=value] |
| `thunder status` | 迅雷绑定状态（不输出第三方登录 URL） | 查询/本机 | [--params JSON] [--param key=value] |
| `hsk status` | 花生壳嵌入服务状态（不输出设备密钥） | 查询/本机 | [--params JSON] [--param key=value] |
| `apps inventory` | 合并原生应用与 Docker 应用的安装清单 | 查询/本机 | [--params JSON] [--param key=value] |
| `apps info` | 指定应用的安装状态与能力 | 查询/本机 | [--params JSON] [--param key=value] |
| `apps coverage` | 每个已安装应用的 CLI/MCP 覆盖情况 | 查询/本机 | [--params JSON] [--param key=value] |
| `apps tasks` | 应用安装更新任务 | 查询/本机 | [--params JSON] [--param key=value] |
| `apps docker-tasks` | Docker 应用安装更新任务 | 查询/本机 | [--params JSON] [--param key=value] |
| `apps action` | 启动、停止或重启支持启停的应用 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `apps install` | 安装或升级原生应用；mp 为应用存储挂载点 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `apps uninstall` | 卸载允许移除的应用，默认保留数据 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `cloud status` | 网盘授权状态 | 查询/本机 | [--params JSON] [--param key=value] |
| `cloud tasks` | 网盘传输任务 | 查询/本机 | [--params JSON] [--param key=value] |
| `cloud syncs` | 网盘同步计划 | 查询/本机 | [--params JSON] [--param key=value] |
| `android apps` | 可通过手机桥接打开的应用入口 | 查询/本机 | [--params JSON] [--param key=value] |
| `android status` | 检查已连接的手机、极空间版本和前台状态 | 查询/本机 | [--params JSON] [--param key=value] |
| `android screen` | 读取极空间当前可见控件；隐藏密码和其他 App | 查询/本机 | [--params JSON] [--param key=value] |
| `android open` | 通过已登录手机打开指定应用；仅导航，不配置 NAS | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `android tap` | 点击当前界面的指定控件；可能修改手机或 NAS 数据 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `android set-text` | 向指定编辑框填入文本；不自动提交 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `android scroll` | 滚动极空间当前界面 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
| `android back` | 返回极空间上一级界面，拒绝从首页退出 | 写入，需 --yes | [--params JSON] [--param key=value] --yes |
