# MagVarUpdate 移植说明

本文说明 SillyTavern MagVarUpdate 核心如何进入 Operit 的独立 MVU ToolPkg，以及上游兼容层与当前 v2 动态状态应用之间的边界。对应 [Operit Issue #998](https://github.com/AAswordman/Operit/issues/998)。

## 当前边界

移植分为三层：

| 层 | 目录 | 职责 |
| --- | --- | --- |
| 上游兼容核心 | `src/mvu/core` | MagVarUpdate schema、命令解析、命令执行和事件语义 |
| Operit 安全移植层 | `src/mvu/port` | 结构化解析、受限数学、路径与预算保护、宿主无关能力接口 |
| MVU v2 应用层 | `src/mvu/app` | 字段、作用域、事务、规则、记录、持久化消息和 AI 判断 |

页面与 ToolPkg main runtime 只面向 v2 应用层。上游 `MvuData`、旧 facade 和事件仍可用于命令兼容测试，但不是页面 IPC、宿主接口或磁盘格式。

MVU 尚未发布，因此没有 v1 迁移和双格式读取。新数据集不包含假角色、假聊天、假消息或假变化记录，也没有恢复演示数据的运行时命令。

当前交付物是单一外部 `operit_mvu-0.2.0.toolpkg`。静态 WebView 页面、编译后的 main runtime、v2 引擎、文档和上游许可都在同一包中；MVU 不打入 APK，也没有子包、辅助 APK、第二个接口包或独立前端目录，页面不提供插件专用退出按钮。

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | `https://github.com/MagicalAstrogy/MagVarUpdate` |
| 分支与 commit | `beta`，`0a730cd4a9b99689d1135a49b542c780b977c24c` |
| 许可 | MIT，见 `third_party/MagVarUpdate/LICENSE` |
| 类型参考 | JS-Slash-Runner `main@e3b18604ed4eabfc1fe6b138c3c065407f8048d5` |

上游版本信息保存在 [MagVarUpdate_UPSTREAM.md](MagVarUpdate_UPSTREAM.md)。修改上游兼容核心时应同时核对 [MagVarUpdate_PATCHES.md](MagVarUpdate_PATCHES.md) 和 `third_party/MagVarUpdate/LICENSE`，构建流程不应临时访问网络。

## 源码映射

| 上游 | Operit 位置 | 说明 |
| --- | --- | --- |
| `src/variable_def.ts` | `src/mvu/core/variable-def.ts` | 类型、事件、`MvuData` 与命令信息 |
| `src/function/schema.ts` | `src/mvu/core/schema.ts` | schema 生成、查询、协调与元数据清理 |
| `src/function/update_variables.ts` | `src/mvu/core/command-parser.ts`、`command-executor.ts` | 命令提取、路径修复和 set、insert、delete、add 执行 |
| `src/function/initvar/variable_init.ts` | `src/mvu/core/initvar.ts` | 纯初始化函数和 `InitSourceAdapter` |
| `src/function/global/index.ts` | `src/mvu/core/facade.ts` | 上游 facade 语义，仅供兼容层使用 |
| `src/function/function_call.ts` | `src/mvu/core/function-schema.ts` | 受限命令 schema |
| `src/util.ts` | `src/mvu/core/command-parser.ts` | JSON Patch 识别 |
| `util/common.ts` | `src/mvu/port/structured-parser.ts`、`merge.ts` | 结构化解析与确定性合并 |
| lodash 与 klona 子集 | `src/mvu/port/util.ts` | 确定性纯函数实现 |
| mathjs 行为子集 | `src/mvu/port/structured-parser.ts` | 白名单数学求值 |

## Operit 应用化改造

`src/mvu/app/service.ts` 将兼容层产生的变化收敛到一个事务服务。当前应用化改造包括：

- v2 `MvuDataset` 和 revision compare-and-swap 文件事务
- 由 `pendingBootstrapFieldIds` 明确驱动的默认模板一次性身份绑定，不以空绑定推断初始化状态
- `chatId`、`actorId`、`groupId` 与 `actorName` 组成的完整状态上下文
- 角色、角色组、全局和聊天四种字段作用域
- 自然变化、每轮变化、联动规则、自动规则和临时效果
- 基于 `chatId + messageId + variantId` 的持久化消息幂等
- 只接受严格 JSON 和完整业务校验的系统模型候选
- 只在普通 `CHAT` 请求中追加且不覆盖宿主完整提示词的状态投影

宿主事实由当前 Operit 已实现的 `ToolPkg.chatContext`、`message_persisted` 与 `ToolPkg.systemModel` 提供。MVU 不自行构造角色身份，不以 `ToolPkg.localModels` 模拟系统默认模型，也不要求安装第二个接口包。系统模型请求使用宿主原生严格 JSON Schema，禁用本次推理内容通道，并由宿主在 150 秒内完成或取消；页面的 AI IPC 最多等待 180 秒。

## 安全修订

[MagVarUpdate_PATCHES.md](MagVarUpdate_PATCHES.md) 记录移植 patch，主要包括：

- 将宿主依赖收口为 `MvuPortContext`
- 删除 `new Function`
- 拒绝危险键、保留字段、过深路径和过长路径
- 限制文本、命令数、值大小与嵌套深度
- 以白名单求值器替代任意数学执行
- 将初始化数据来源抽象为 `InitSourceAdapter`
- 使用稳定错误码目录

## 验证

```bash
pnpm exec tsc -p examples/operit_mvu/tsconfig.json
pnpm exec tsc -p examples/operit_mvu/tsconfig.test.json
node --test examples/operit_mvu/dist-test/tests/*.test.js
node examples/operit_mvu/scripts/build-web.mjs
node examples/operit_mvu/scripts/pack.mjs
```

核心命令与安全测试位于 `tests/mvu-command-parser.test.ts` 和 `tests/mvu-executor.test.ts`。v2 事务、作用域、规则、消息幂等与 AI 校验测试位于 `tests/mvu-app.test.ts`、`tests/mvu-automation.test.ts` 和 `tests/mvu-system-model.test.ts`。

Android 真机视觉回归和最终 `.toolpkg` 安装验收不属于上游移植单元测试，必须在最终宿主与最终包组合上另行完成。当前尚未完成的项目包括最终包导入、重启持久化、全部按钮、群聊与后台消息、`content://` 头像和参考图视觉对比；这些项目在取得证据前不得记为通过。

## 与上游不同的确定行为

- 事件字符串以锁定的 MagVarUpdate 源码为准。
- JSON Patch `move` 不执行并返回 `MVU_MOVE_UNSUPPORTED`。
- 兼容层的 `parseMessage` 返回克隆后的 `MvuData`，变化由 `stat_data` diff 表达。
- `display_data` 与 `delta_data` 只保留为兼容输出，不是 v2 当前值或记录的权威来源。
- 宏只解析 Operit 明确定义的变量。
- 所有持久化状态变化最终都经过 `MvuService`，兼容核心不能直接写文件。
