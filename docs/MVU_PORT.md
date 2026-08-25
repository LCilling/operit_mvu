# MagVarUpdate 移植说明

本文说明 SillyTavern MagVarUpdate 核心如何进入 Operit 的独立 MVU ToolPkg，以及上游兼容层与 3.0.0 应用层之间的边界。对应 [Operit Issue #998](https://github.com/AAswordman/Operit/issues/998)。

## 分层边界

| 层 | 目录 | 职责 |
| --- | --- | --- |
| 上游兼容核心 | `src/mvu/core` | MagVarUpdate schema、命令解析、命令执行和事件语义 |
| Operit 安全移植层 | `src/mvu/port` | 结构化解析、受限数学、路径与预算保护、宿主无关能力接口 |
| MVU v3 应用层 | `src/mvu/app` | 作用域字段、条件、规则、效果、迁移、事务、查询、记录和 AI 判断 |

页面与 ToolPkg main runtime 只面向 v3 应用层。上游 `MvuData`、旧 facade 和事件保留用于命令兼容测试，但不是页面 IPC、宿主接口或 v3 磁盘格式。

3.0.0 交付物是单一外部 `operit_mvu-3.0.0.toolpkg`。WebView 页面、main runtime、v3 应用层、文档和上游许可都位于同一个包；MVU 不打入 APK，也没有子包、辅助 APK、第二接口包或独立前端目录。

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | `https://github.com/MagicalAstrogy/MagVarUpdate` |
| 分支与 commit | `beta`，`0a730cd4a9b99689d1135a49b542c780b977c24c` |
| 许可 | MIT，见 `third_party/MagVarUpdate/LICENSE` |
| 类型参考 | JS-Slash-Runner `main@e3b18604ed4eabfc1fe6b138c3c065407f8048d5` |

上游版本信息保存在 [MagVarUpdate_UPSTREAM.md](MagVarUpdate_UPSTREAM.md)。修改兼容核心时应同时核对 [MagVarUpdate_PATCHES.md](MagVarUpdate_PATCHES.md) 和上游许可证；构建不临时访问网络。

## 源码映射

| 上游 | Operit 位置 | 说明 |
| --- | --- | --- |
| `src/variable_def.ts` | `src/mvu/core/variable-def.ts` | 类型、事件、`MvuData` 与命令信息 |
| `src/function/schema.ts` | `src/mvu/core/schema.ts` | schema 生成、查询、协调与元数据清理 |
| `src/function/update_variables.ts` | `src/mvu/core/command-parser.ts`、`command-executor.ts` | 命令提取、路径修复和 set、insert、delete、add |
| `src/function/initvar/variable_init.ts` | `src/mvu/core/initvar.ts` | 纯初始化函数和 `InitSourceAdapter` |
| `src/function/global/index.ts` | `src/mvu/core/facade.ts` | 上游 facade 语义，仅供兼容层使用 |
| `src/function/function_call.ts` | `src/mvu/core/function-schema.ts` | 受限命令 schema |
| `util/common.ts` | `src/mvu/port/structured-parser.ts`、`merge.ts` | 结构化解析与确定性合并 |
| lodash/klona/mathjs 行为子集 | `src/mvu/port` | 确定性纯函数和白名单数学求值 |

## v3 应用化改造

`src/mvu/app/service.ts` 将兼容层变化收敛到一个事务服务，v3 在其上增加：

- 权威 `MvuDatasetV3`，以 revision compare-and-swap、同目录临时文件和 `Tools.Files.replaceAtomically` 提交；
- v2 只读迁移源、可重试兼容模式和不覆盖旧文件的迁移日志；
- 角色、群组、全局和聊天四种字段作用域，以及明确的一次性默认绑定元数据；
- 独立条件库、14 类谓词、递归布尔表达式和 AI 语义谓词；
- 触发角色选择器、条件引用和结果动作分离的规则定义；
- 可命名效果组、字段优先目标、动态触发角色、多操作、原因快照与时长实例；
- 以 `chatId + messageId + variantId` 组成的消息幂等键；
- 主配置与最多 500 条一段的 JSONL 记录清单，按字段/作用键建立有界查询索引；
- 字段模板与完整备份两套独立、带预览和 revision 校验的导入导出协议；
- 最多 40 个最终字段投影的模型预算，规则直接引用优先并输出有界诊断。

所有查询都由 main runtime 执行分页、搜索、过滤和稳定排序。字段/规则每页 5 条，条件/效果组每页 10 条；角色、群组、字段等大集合使用带游标的搜索选择器，UI 不持有无界完整数组。

## Operit 宿主边界

生产插件只能使用 Operit 官方 ToolPkg API，以及 [OPERITAI_CHANGES.md](OPERITAI_CHANGES.md) 明确登记的扩展。当前扩展包括权威聊天上下文、持久化消息身份、系统默认模型、Prompt Hook 上下文、宿主顶栏与 Android 返回、头像 URI、同 ID 更新和 Android 本地原子替换。

MVU 不调用 `ToolPkg.localModels`，也不要求插件调用未登记的 `prepareDispatch`、`dispatchToken` 或 `maxOutputChars`。宿主模型入口保持 `complete({ systemPrompt, userPrompt, jsonSchema? })`；150 秒内完成或取消，页面 AI IPC 最多等待 180 秒。

`scripts/audit-host-api-compat.mjs` 使用 TypeScript AST 扫描源码、类型和构建产物。超出“官方公开接口 + 文档扩展 #1–#8”的依赖会阻断构建和发布。

## 安全修订

[MagVarUpdate_PATCHES.md](MagVarUpdate_PATCHES.md) 记录移植 patch，主要包括：

- 将宿主依赖收口为 `MvuPortContext`；
- 删除 `new Function`，以白名单求值器替代任意数学执行；
- 拒绝危险键、保留字段、过深/过长路径和过大值；
- 限制文本、命令、数组、嵌套、查询页、模型字段和备份体积；
- 将初始化来源抽象为 `InitSourceAdapter`；
- 使用稳定错误码、严格键集合和失败不提交语义。

## 发布检查

```bash
pnpm run check
pnpm run pack
node scripts/audit-v3-package.mjs
```

最终归档必须只有一个根 `app.html`，并排除测试、QA、内部报告、`artifacts/`、依赖与 Git 元数据。发布前还必须通过多宽度/130% 字体视觉检查和修改版 OperitAI APK 的 MuMu 真机验收。

## 与上游不同的确定行为

- 事件字符串以锁定的 MagVarUpdate 源码为准。
- JSON Patch `move` 不执行并返回 `MVU_MOVE_UNSUPPORTED`。
- 兼容层的 `parseMessage` 返回克隆后的 `MvuData`，变化由 `stat_data` diff 表达。
- `display_data` 与 `delta_data` 只保留为兼容输出，不是 v3 当前值或记录的权威来源。
- 宏只解析 Operit 明确定义的变量。
- 所有持久化变化最终都经过 `MvuService` 与 v3 事务存储；兼容核心不能直接写文件。
