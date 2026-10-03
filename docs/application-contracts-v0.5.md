# v0.5 应用工作流与接口依据

协议版本为 Web `2.3.2026082801`，验证环境身份已从公开记录移除。本版本增加 38 个操作，统一由 CLI、Node SDK 和 MCP 调用。源代码中的固定路径、严格 schema 和写入确认保持一致；没有开放任意 URL 或修改现有 Agent 权限。

## 新增操作

下表操作名省略域前缀。完整方法、路径、参数默认值见 [operations.json](operations.json)，命令参数见 [commands.md](commands.md)。

| 域 | 数量 | 新操作 |
| --- | ---: | --- |
| `notes` | 3 | `category-list`、`move`、`label` |
| `photos` | 8 | `by-path`、`photo-albums`、`favorites`、`favorite`、`album-remove`、`directory-add`、`directory-remove`、`directory-scan` |
| `music` | 15 | `song`、`lyrics`、`cue`、`lyrics-update`、`favorite-add`、`favorite-remove`、`favorite-songs`、`favorite-albums`、`favorite-artists`、`favorite-playlists`、`tasks`、`directories`、`library-add`、`library-remove`、`library-rescan` |
| `audiobooks` | 7 | `directory-add`、`directory-remove`、`chapter-remove`、`rescan`、`import-status`、`external-status`、`chapter-position` |
| `video` | 5 | `collections`、`collection-create`、`collection-dismiss`、`favorite-add`、`favorite-remove` |

原有 `notes.list` 额外支持 `label_id=0..5` 和 `sortby=1..6`，省略时保持原有请求。排序对应修改时间降/升序、创建时间降/升序、标题降/升序。

## 常用流程

### 记事本

```sh
zspace notes category-list --start 0 --num 100 --json
zspace notes move --ids '[12,13]' --classify-id 7 --yes
zspace notes label --id 12 --label-id 0 --yes
zspace notes list --classify-id 7 --label-id 0 --sortby 6 --json
zspace notes label --id 12 --label-id 0 --action 2 --yes
zspace notes move --ids '[12,13]' --classify-id 0 --yes
```

`classify_id=0` 明确移出分类；颜色 0 是红色，不可当成空值过滤。`notes.info` 中对应返回字段为 `label_id` 字符串，取消后为空字符串。实机使用普通记事本 `location=2`，没有解锁或验证保险箱。

### 相册

```sh
zspace photos directory-add --paths '["/sata1/my/data/照片"]' --yes
zspace photos directories --json
zspace photos directory-scan --dir-ids '[17]' --yes
zspace photos by-path --paths '["/sata1/my/data/照片/示例.jpg"]' --json
zspace photos favorite --feed-id 21 --liked 1 --yes
zspace photos favorites --start 0 --num 100 --json
zspace photos photo-albums --feed-id 21 --json
zspace photos album-remove --album-id 31 --feed-ids '[21]' --yes
```

目录添加使用厂商 `add/no_flush`；先列出目录取得 ID，再扫描并回读照片。CLI 接受 ID 数组，成员移除和目录删除/扫描在请求中使用逗号串；照片路径仍用 `paths[]`。普通相册成员移除固定带厂商 `confirm=1`，与 CLI `--yes`/MCP `confirm:true` 是不同层次的确认。此命令不适用于 AI 相册的专用成员排除逻辑。

`album-remove`、`directory-remove` 不调用源文件删除接口；合成 JPEG 实机测试确认源文件仍存在。取消收藏用 `liked=0`。

### 音乐与有声读物

```sh
zspace music library-add --file-path '["/sata1/my/data/音乐"]' --yes
zspace music tasks --json
zspace music songs --page 1 --page-size 50 --json
zspace music song --song-id 123 --json
zspace music lyrics-update --song-id 123 --song-lyrics '[00:00.00]示例歌词' --yes
zspace music lyrics --song-id 123 --json
zspace music cue --song-id 123 --json
zspace music favorite-add --favorite-type artist --favorite-content '["歌手名称"]' --yes
zspace music favorite-artists --page 1 --page-size 50 --json
zspace audiobooks directory-add --playlist-id 5 --dirs '["/sata1/my/data/有声书"]' --yes
zspace audiobooks import-status --playlist-id 5 --json
zspace audiobooks chapters --playlist-id 5 --json
zspace audiobooks chapter-position --playlist-id 5 --track-id 71 --order asc --json
```

音乐支持曲目、专辑、歌手、歌单四类收藏。歌手用名称，其他类型用各自 ID；数组不能为空。歌词可传空字符串用于清空。`music.cue` 适用于包含 CUE 分轨的曲目，实机验收使用一个静音 FLAC 和双轨 CUE。

`library-rescan` 要求明确来源路径，不能省略为全库重扫。`library-remove` 移除音乐库来源引用，保留源文件。有声书 `directory-remove`、`chapter-remove` 同样只从书库移除；删除书库、移除引用均已确认不会删除本次生成的音频文件。章节定位保留厂商拼写 `sort_filed=title`。

应用写响应可能只表示已受理。导入音乐后查 `music.tasks` 的 `file_add_status`；重扫查 `file_refresh_status`。有声书导入查 `import-status` 的 `add_status`，重扫查 `scan-status` 的 `refresh_status`；本次版本 0 表示任务不再运行，还需读回业务条目确认结果。CLI 不把这些字段包装成文件任务的 `completed` 标记，也不在写失败后自动重试。

### 影视

```sh
zspace video libraries --json
zspace video collections --classification-id 8 --start 1 --limit 20 --json
zspace video collection-create --classification-id 8 --title '我的合集' --yes
zspace video favorite-add --classification-id 8 --collection-id 41 --yes
zspace video collection --classification-id 8 --collection-id 41 --json
zspace video favorite-remove --classification-id 8 --collection-id 41 --yes
zspace video collection-dismiss --classification-id 8 --collection-id 41 --yes
```

`collections` 从 1 开始分页，使用 `limit`，以发行年份降序返回库内条目。创建/解散功能针对自定义合集；创建需要普通影视库，不刮削库会返回 `N120039`，CLI 保留此业务错误码。创建暂不上传封面；解散合集保留源文件。

## 实机验证与范围

[验收报告](acceptance-app-workflows-v0.5.json) 记录五组成功流程、38 个新操作的调用和 14 项清理结果。验收通过真实 MCP stdio 子进程执行，只创建 UUID 命名的笔记、分类、相册、歌单、书库、影视库/合集和生成的媒体。音乐四类收藏全部经过添加、列表回读、取消和再次回读。所有测试资源及来源引用均已清理，生成文件移入回收站，并额外回查目录及应用列表确认没有活动测试对象。

新增操作的发现及 dry-run 结果带 `validation`：依据、Web 协议版本和脱敏报告路径。`liveVerified=true` 只表示报告中的指定案例通过，不代表所有账户、参数组合或其他固件可用；公开资料不再列出测试设备型号。历史操作未统一追加这一字段，已有验收记录继续有效。

- 笔记测试普通空间及颜色 0；其他颜色和保险箱没有逐项实机验证。
- 相册测试普通相册和合成 JPEG，未验证 AI 相册或全部媒体格式。
- 有声书仅测试内置盘来源；`external-status` 成功返回不代表验证了外置设备断连恢复。前端遗留的有声书 CUE 解析端点本次返回 `HTTP_ERROR`，未作为命令发布。
- 影视合集为空的自定义合集，库来源包含合成 MP4；没有下载商业媒体或编辑已有影片元数据。
- 无法从某次列表读取推断整个 NAS 所有分页；测试对象查找限定已生成的唯一名称或来源路径。

123 项离线测试使用本机 HTTP 服务和合成凭证，新增操作逐一验证方法、路径、表单/查询编码；实际 CLI 与 MCP 子进程覆盖参数解析、写入确认、dry-run 无请求和 Agent 授权撤销。离线断言独立保存预期请求，不从运行时注册表生成预期参数。

## 重跑

```sh
npm ci --ignore-scripts
npm run check
npm test
mkdir -p work
# 本机需 ffmpeg、有效 NAS 配置及对该目录的授权
npm run test:live:workflows -- --profile home --parent /sata1/my/data --yes --report work/workflows.json
# 可限定一个或多个应用
npm run test:live:workflows -- --profile home --parent /sata1/my/data --domains notes,video --yes --report work/subset.json
```

脚本在 finally 中清理已记录的创建结果；网络中断、进程被终止或创建响应丢失可能需要按报告 `runId` 人工核对遗留对象，不能直接重放失败的写入。本机原始报告包含环境信息和唯一测试标识，可能属于私人数据；应保存到忽略的工作目录，分享前进行脱敏。仓库内的公开报告已移除这些字段，只保留版本、操作名和结果。

## 厂商客户端来源

接口来自授权网页客户端的研究快照，已检查请求封装和 UI 调用位置，并在相同 Web 版本上执行验收。以下摘要用于识别研究快照；厂商压缩代码、原始响应和凭证不随仓库分发。

| 客户端文件 | 核对内容 | SHA-256 |
| --- | --- | --- |
| `chunks/62114.62140d86.js` | 笔记分类、移动、标签、筛选 | `a257a0920b885770e1598120f4721dbaa4917415a9bac7f02ee0681812cb59af` |
| `frontends/photoAlbum.js` | 照片按路径查询、目录、收藏和相册端点 | `ee218b701b808bb8d4986af8b6ef4a7e5e56c99a682b5e40c388046fb17f6f3b` |
| `chunks/19369.791e7de7.js` | 普通相册成员移除的 CSV 与 confirm | `b72b0b43e6c0f1b236b613c0ffccb82c7a05a68f0016adb9d336b4f93c17ab34` |
| `chunks/79614.1e19db92.js` | 收藏照片分页与 liked=1 | `83697aa7d377529c7b8fd051d98f9c980f848dbcb7a29a07a3a9e57ffb9417c0` |
| `chunks/79451.12034063.js` | 照片目录添加 paths[] | `03ae3bfe112ee11c6aeab14d751da2cc05c00b6fd4e057b4d65bafe51694531b` |
| `chunks/81595.34913453.js` | 照片目录移除和扫描 dir_ids | `b0bc3e8aa7a2a85bd2c3411abd3b86faa7af118464cd2cae9268d77c85356ee6` |
| `chunks/53914.d64301c5.js` | 影视请求封装 | `4ed538f7cf03102f91ecbb58f3cccb46b9caf8bacb7d783d457cd35e4befa480` |
| `chunks/14318.9b9586db.js` | 影视收藏、创建和解散合集参数 | `488965457cfa14a76a047f4f7614d79f639d3afdd35ff8b6054a291adf357f75` |
| `chunks/32779.f5626b76.js` | 影视列表 start/limit 与默认筛选 | `5464af5035d3ed716e6bf5e58241a7663d0cf243ca6a1b2784bfc2041af72ce1` |
| `chunks/18185.0e3ef937.js` | 音乐请求封装 | `8fa5358ecf9c774c6e26d988e0ac877fcaccf1242efab5015c858eb7071f2296` |
| `chunks/93822.67ab859c.js` | 四类收藏、歌词、导入调用 | `b830b832259870f0c7b3cf51e06a361672bc65301ca10a028498be9d6f528908` |
| `chunks/14773.51ea7752.js` | 音乐来源列表、移除、刷新 | `bd6fef24a218b89eaddd295ca653183a46db0b61054ec6314e1e1fac8e89e3ea` |
| `chunks/71934.f298d744.js` | 有声书 API 与章节移除 | `aa08e775773224a9e48bacfd040a0e21daedae78b116e16b2746e2280630955b` |
| `chunks/88006.14e1589d.js` | 有声书目录添加、扫描、章节排序 | `1828ed39bef0720f555fb343228893653e20d215a9b1c69a60afd3cc892b4953` |
| `chunks/86057.304b8acd.js` | 有声书目录移除 | `2ab3b7cfd113b35b57c02d067ee92ecc2f6bd627f6b3a09aeab34fe438f8b991` |
