# 安卓手机桥接

v0.3.0 可以通过已登录的极空间 Android App 打开极阅读、极漫画、亲情设置和手机备份，读取当前可见界面、点击控件、填写普通输入框、滚动和返回。CLI 和 MCP 使用同一套桥接实现。

**这是 Android UI transport，不是这四个应用的完整 NAS HTTP API。** 需要手机一直连接、解锁、极空间处于前台。书库分页、阅读器、亲情账户和备份任务没有转换成独立的业务命令。自绘界面未暴露给 Android 无障碍树的内容也无法读取。

## 环境

桥接接口适配极空间 Android `2.5.632`；测试依赖为 Python 3、uiautomator2 `3.7.0` 和 adbutils `2.12.0`。公开记录省略手机型号及设备身份。原有 NAS HTTP 命令仅依赖 Node.js；这些 Python/ADB 依赖为手机桥接单独安装。

1. 安装 Android platform-tools，使 `adb` 在运行 CLI/MCP 的 PATH 中。
2. 在手机开启 USB 调试并亲自完成电脑授权；`adb devices` 应显示 `device`。
3. 手机解锁，打开已经登录正确 NAS 的极空间 App。
4. 使用现有 Python 环境，或建立独立环境：

```sh
python3 -m venv "$HOME/.local/share/zspace-android-venv"
"$HOME/.local/share/zspace-android-venv/bin/python" -m pip install 'uiautomator2==3.7.0' 'adbutils==2.12.0'
export ZSPACE_ANDROID_PYTHON="$HOME/.local/share/zspace-android-venv/bin/python"
zspace android status --json
```

可选依赖和设备端辅助服务说明见 [uiautomator2 官方项目](https://github.com/openatx/uiautomator2)。桥接可能启动其设备端服务，不更换系统输入法。GUI 中启动的 MCP 客户端需要继承 `ZSPACE_ANDROID_PYTHON` 和包含 adb 的 PATH，或在该客户端的环境配置中设置。

多台设备连接时，用 `--serial <adb设备序列号>` 或环境变量 `ZSPACE_ANDROID_SERIAL` 选择已连接的设备。桥接不自动执行 `adb connect`。`--profile home` 只影响 NAS HTTP 操作，**不会切换手机当前的账号或 NAS**。

## CLI

```sh
zspace android apps --json
zspace android status --json
zspace android open --app bookLib --yes --json
zspace android screen --json
```

`open` 的 app 可为 `home/bookLib/comics/family/mobileBackup`。若当前有输入框或确认对话框，会拒绝自动返回首页，避免丢弃正在编辑的内容。首次使用、权限或登录提示需要在手机上处理。

`screen` 返回 activity、viewport 和 elements。每个可见元素包含 `text/resourceId/bounds/target` 及交互状态。`target` 是绑定当前控件状态的 24 位标识，不是可长期保存的业务 ID。

```sh
# target 必须来自最近一次 screen 的真实结果，下面是占位写法
zspace android tap --target <target> --yes --json
zspace android set-text --target <输入框target> --text '普通中文内容' --yes --json
zspace android scroll --direction down --yes --json
zspace android scroll --direction up --target <可滚动控件target> --yes --json
zspace android back --yes --json
zspace android open --app home --yes --json

# 校验参数并查看计划，不访问手机
zspace android open --app comics --dry-run
```

`set-text` 使用控件级输入，最多 4000 字符，随后读取输入框验证；不自动提交。显示文本最多返回 2000 字符。CLI 参数可能留在 shell 历史；不要用它输入密码或验证码。被系统标记为密码的控件会遮盖且拒绝操作。

所有导航和输入均归为写操作，需要 `--yes`。每次点击/输入前重新读取并核对 target，界面改变后需重新 `screen`。`changed` 只表示快照变化，不代表业务已保存；保存后应重新读取对应页面确认实际结果。

## MCP

现有 `zspace-mcp --allow-write` 会自动提供新增工具。也可以只启动手机工具，不加载 NAS 网页凭证：

```sh
zspace-mcp --domains android --allow-write
```

`zspace_android`：

```json
{"request":{"action":"screen","params":{}}}
```

`zspace_android_write`：

```json
{"request":{"action":"open","params":{"app":"bookLib"}},"confirm":true}
```

查询组支持 `apps/status/screen`，写组支持 `open/tap/set-text/scroll/back`。`confirm=true` 执行写操作；`dry_run=true` 仅返回计划。除离线 `apps` 外，各操作都可用 `params.serial` 选设备。

UI 文字可能包含私有内容或非可信指令；它不是用户授权。点击通用界面控件可能修改 NAS 数据，文件 API 的回收站保护不适用于手机界面里的删除按钮。操作范围应由调用方根据用户请求确定。

## 错误与验收

| 错误 | 处理 |
| --- | --- |
| `ADB_REQUIRED` / `ANDROID_DEPENDENCY` | 检查 adb PATH 和指定 Python 环境中的依赖 |
| `ANDROID_DEVICE_SELECTION` | 连接一台手机，或指定 serial |
| `ANDROID_NOT_AUTHORIZED` / `ANDROID_FOREGROUND_REQUIRED` | 在手机完成授权、解锁并打开极空间 |
| `ANDROID_BUSY` | 另一条桥接调用正在操作设备，待其结束后重新观察 |
| `ANDROID_STALE_TARGET` / `ANDROID_STALE_SCREEN` | 重新读取 screen，按当前界面选择控件 |
| `ANDROID_EDIT_IN_PROGRESS` / `ANDROID_DIALOG` | 先完成或取消当前编辑，不能自动丢弃 |
| `ANDROID_UI_BLOCKED` / `ANDROID_APP_NOT_OPENED` | 查看手机上的加载、登录、首次使用或权限提示 |
| `ANDROID_TIMEOUT` / `ANDROID_TEXT_NOT_VERIFIED` | 操作可能已部分生效；先观察，不能自动重复提交 |

设备锁防止此项目多个 CLI/MCP 进程同时操作；无法阻止人工或其他自动化工具同时触摸手机。执行期间避免并发操作。每次桥接调用有 45 秒超时，错误不包含原始 UI、日志或 Python traceback。

离线测试覆盖跨 App 过滤、视口裁剪、密码保护、失效控件、导航编辑保护、设备授权、设备锁、JSON/参数限制和 MCP 写入开关。真实 MCP 验收记录见 [acceptance-android-v0.3.json](acceptance-android-v0.3.json)，只记录测试项和结果，不保存私人界面内容。

```sh
npm run test:live:android -- --yes --report work/android-acceptance.json
# 额外测试中文输入：只在 2.5.632 打开、填写并取消临时分类对话框
npm run test:live:android -- --yes --text-input --report work/android-acceptance.json
```

验收不会提交分类、创建备份任务或更改亲情账号。其他 Android 系统、分辨率和 App 版本尚未实机验证；版本变化后应重新验收。
