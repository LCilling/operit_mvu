# operit_mvu

`operit_mvu` 是面向 [OperitAI](https://github.com/AAswordman/Operit) 的动态角色状态 ToolPkg，也是 [Issue #998](https://github.com/AAswordman/Operit/issues/998) 的完整插件实现。它把页面、MVU v2 状态引擎、作用域字段、规则、变化记录、AI 判断和私有存储封装在单一 `operit_mvu-0.2.0.toolpkg` 中。

插件标识为 `com.lcilling.operit_mvu`。当前 v0.2.0 是首次公开发布，直接使用严格的 `formatVersion: 2` 数据契约，不包含演示角色、演示消息或旧格式迁移代码。

## 功能

- 按角色、角色组、全局或当前聊天管理数值状态
- 字段阶段、自然变化、每轮变化和状态联动
- 基于明确消息事实的自动规则和多效果执行
- 按时间、轮次或持续生效的临时效果
- 使用 Operit 当前系统模型执行严格 JSON Schema 状态判断
- 按角色、字段和来源筛选变化记录，并查看趋势详情
- 群聊成员切换、真实角色名称与 `content://` 头像
- 全页面自定义背景、固定底部导航和 Operit 原生宿主顶栏
- 严格 v2 JSON 数据集导入、导出和私有 revision 事务

## 安装与 APK 依赖

Release 只发布一个 ToolPkg，不发布插件 APK：

1. 下载 [Releases](https://github.com/LCilling/operit_mvu/releases) 中的 `operit_mvu-0.2.0.toolpkg`。
2. 把文件复制到手机可访问的位置。
3. 在 Operit 的“包管理”中选择“导入”，只选择该 ToolPkg。
4. 启用“动态状态”，然后从 Operit 主侧边栏的插件区域打开。

插件依赖以下 Operit 宿主能力：

- `ToolPkg.chatContext.snapshot({ chatId? })`
- 带权威消息身份和角色上下文的 `message_persisted`
- `ToolPkg.systemModel.probe()` 与 `ToolPkg.systemModel.complete(...)`
- 保留 Operit 完整系统提示词的普通聊天 Prompt Hook
- ToolPkg main/UI IPC、宿主顶栏和受控 `content://` 资源读取

如果手机中的 Operit 官方版本已经实现这些接口，只安装 ToolPkg 即可，不需要安装修改版 APK。旧版 Operit 缺少这些接口时，需要先安装一次包含宿主接口实现的 Operit 版本；之后更新插件只替换 ToolPkg。插件本身不打入 APK，也不需要辅助 APK、第二个接口包、前端目录或额外脚本。

插件页面不绘制专用退出按钮。离开页面使用 Android 返回手势、系统返回键或 Operit 自身导航。Operit 原生宿主顶栏始终位于插件 WebView 上方；WebView 内继续保留参考页面自己的背景、三横线、标题和功能按钮。

宿主侧的具体改动见 [OPERITAI_CHANGES.md](OPERITAI_CHANGES.md)，接口契约见 [docs/HOST_INTERFACE_REQUIREMENTS.md](docs/HOST_INTERFACE_REQUIREMENTS.md)。

## 数据与安全

数据集保存在 ToolPkg 私有配置目录中的 `operit_mvu.dataset.v2.json`。导出文件写入 `/sdcard/Download/Operit/exports/`，导入时会严格校验 `formatVersion: 2`、字段、规则、作用域和引用完整性。

消息幂等键由宿主持久化结果中的 `chatId`、`messageId` 和 `variantId` 组成。角色卡、角色组、当前聊天、头像和系统模型均以宿主返回的权威事实为准；插件不会猜测歧义身份。

AI 判断使用宿主原生严格 JSON Schema。返回文本还会经过整段 `JSON.parse`、目标字段授权、置信度和单次幅度校验，校验完成后才允许提交状态事务。

## 源码结构

```text
src/main.ts                 ToolPkg 注册、宿主事件与状态同步
src/mvu/core/               MagVarUpdate 兼容核心
src/mvu/port/               Operit 安全移植层
src/mvu/app/                v2 状态、事务、规则、记录与 AI 应用层
src/shared/ipc.ts           main runtime 与页面的类型化 IPC
src/ui/web_container/       Compose DSL WebView 容器
static/app_ui/              15 页移动端界面与 QA harness
tests/                      核心、应用、自动化、安全与宿主上下文测试
scripts/                    UI 审计、Web 构建与 ToolPkg 打包
third_party/                上游版本、补丁边界与许可证
```

上游移植范围见 [MVU_PORT.md](MVU_PORT.md)，应用数据契约见 [MVU_API.md](MVU_API.md)。

## 构建与测试

独立仓库克隆后直接在仓库根目录执行；如果源码位于 OperitAI 单仓中，先执行 `cd examples/operit_mvu`：

```bash
pnpm install
pnpm run check
pnpm run pack
```

打包结果位于 `release/operit_mvu-0.2.0.toolpkg`。UI 审计锁定 15 个页面、声明动作、20 个原生调用、角色切换、返回栈、常驻底栏、44px 触控面积和趋势图语义；当前后端测试集包含 78 项测试。仓库内的 `types/` 是编译本插件所需的 Operit ToolPkg 类型契约快照，因此独立克隆后不依赖 OperitAI 源码树即可构建。

## 许可证

仓库主体使用 AGPL-3.0 许可证。移植代码和图标等第三方内容按各自上游许可证分发，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 与 `third_party/`。
