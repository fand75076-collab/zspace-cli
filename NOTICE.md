# 来源说明

本项目是独立实现，未复制下列项目的代码，也未捆绑极空间前端、Android APK 或 NAS 应用包代码。接口路径、字段与行为主要根据用户授权的 NAS 网页客户端以及真实请求进行验证。

初期研究参考：

- [Timandes/fnos-cli](https://github.com/Timandes/fnos-cli)：飞牛 CLI 的命令组织、JSON 输出与测试范围参考。
- [coracoo/zspace_skill 的 API 研究](https://github.com/coracoo/zspace_skill/blob/master/docs/API.md)：极空间协议线索；其中部分行为与本次固件不同，未直接作为兼容性承诺。
- [skyzhao1223/zspace-cli](https://github.com/skyzhao1223/zspace-cli)：已有极空间社区 CLI，说明了原生客户端会话的另一种接入方法。本项目使用显式导入的网页会话，不读取原生客户端数据库。
- [官方 MCP TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/)：MCP 服务端、stdio transport 与客户端验收；相关 npm 依赖保留上游许可证。

- [uiautomator2](https://github.com/openatx/uiautomator2)：可选安卓 UI 依赖，通过设备的可见界面读取和控件操作；需在用户的 Python 环境单独安装。

研究时取得的前端资源、APK、厂商应用包、界面快照、原始响应、Cookie 与账号信息仅留在本机工作区，不属于分发包或 Git 仓库。本项目使用 `UNLICENSED`，不代表任何上游项目的许可证发生变化。极空间及相关名称归其权利人所有，本项目未获其官方背书。
