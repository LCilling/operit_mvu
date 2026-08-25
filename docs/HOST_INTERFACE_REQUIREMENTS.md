# MVU 插件宿主接口契约

本文记录 Issue #998 在当前 Operit 宿主中实现的 ToolPkg 契约。它不是未来接口提案，也不是 MVU 自建的宿主替身。

角色卡、角色组、聊天绑定、数据库消息身份和系统默认模型都属于 Operit 私有事实，必须由新版宿主提供。用户首次安装一次包含这些接口的 Operit 版本后，当前 MVU 只通过单一外部 `operit_mvu-3.0.0.toolpkg` 安装；后续更新也只替换这一外部 ToolPkg，不需要辅助 APK、第二个接口包或独立前端目录。MVU 不随宿主 APK 内置。

## 接口总览

| 宿主能力 | 当前接口 | MVU 用途 |
| --- | --- | --- |
| 聊天与角色上下文 | `ToolPkg.chatContext.snapshot({ chatId? \| groupId? })` | 字段绑定、作用域、群组目录、成员和头像 |
| 已持久化消息事件 | `message_persisted` | 每轮变化、规则、记录和消息幂等 |
| 系统默认模型 | `ToolPkg.systemModel.probe/complete` | 无聊天副作用的 AI 状态候选 |
| Prompt 组合 | `registerSystemPromptComposeHook` | 仅向普通聊天追加当前状态投影 |
| 插件私有存储 | `ToolPkg.getConfigDir(pluginId)` | v3 数据集、分段记录与 revision 事务 |
| 原子文件提交 | `Tools.Files.replaceAtomically(source, destination)` | 配置、记录和恢复结果的不可分割替换 |
| main 与 UI 通信 | `ToolPkg.ipc` | 页面查询与类型化命令 |

MVU 的 AI 路径只使用 `ToolPkg.systemModel`。`ToolPkg.localModels` 是另一个通用平台 API，不是 Issue #998 的系统默认模型实现，也不是 MVU 的依赖。

## `ToolPkg.chatContext.snapshot`

```ts
type ChatContextPromptType = "character_card" | "character_group";

interface ChatContextCharacterSnapshot {
  characterCardId: string;
  name: string;
  avatarUri: string | null;
}

interface ChatContextMemberSnapshot extends ChatContextCharacterSnapshot {
  orderIndex: number;
}

interface ChatContextGroupSnapshot {
  characterGroupId: string;
  name: string;
  avatarUri: string | null;
}

interface ChatContextSnapshot {
  chatId: string | null;
  activePrompt: {
    type: ChatContextPromptType;
    id: string;
    name: string;
  } | null;
  activeCharacter: ChatContextCharacterSnapshot | null;
  activeGroup: ChatContextGroupSnapshot | null;
  characters: ChatContextCharacterSnapshot[];
  groups: ChatContextGroupSnapshot[];
  members: ChatContextMemberSnapshot[];
  currentCharacter: ChatContextCharacterSnapshot | null;
}

interface ChatContextApi {
  snapshot(request?: { chatId?: string; groupId?: string }): Promise<ChatContextSnapshot>;
}
```

调用规则：

- `snapshot()` 使用当前 Operit 会话和当前 `activePrompt` 的稳定 ID。
- `snapshot({ chatId })` 读取指定聊天的持久化绑定，适用于后台消息和打开非当前聊天的数据。
- `snapshot({ groupId })` 只读解析指定角色群组及其成员，不切换宿主当前提示词；非当前群组返回 `chatId: null`。
- `chatId` 与 `groupId` 互斥。参数显式 `null`、数组、非对象、空白 ID 或两个 ID 同时出现都会拒绝。
- 指定聊天绑定角色组时使用持久化 `characterGroupId`。
- 指定单聊在旧持久化字段只有角色卡名称时，只有全局角色卡名称唯一匹配才返回稳定 `characterCardId`。
- 缺失或歧义绑定不会猜测角色。快照保留请求的 `chatId` 和全局 `characters`，将 `activePrompt`、角色和组上下文设为 `null`，并由宿主记录警告。
- 角色组没有宿主权威的持久化当前发言者，因此 `currentCharacter` 为 `null`，不得选成员第一项。

角色与群组 `avatarUri` 分别来自 `UserPreferencesManager.getAiAvatarForCharacterCardFlow(id)` 和 `getAiAvatarForCharacterGroupFlow(id)`。宿主契约会透传真实 URI；MVU WebView 只开放 Android `content://` 读取能力，通用文件 URL 跨域访问仍关闭。最终头像显示必须使用宿主返回的 URI，不能在插件中改用假头像身份。

## `message_persisted`

`message_persisted` 的身份字段直接来自本次 Room 写入或更新的返回值：

```ts
interface ChatMessageEventPayload {
  chatId: string;
  messageId: string;
  orderIndex: number;
  variantId: string | null;
  variantIndex: number;
  actorCharacterCardId: string | null;
  characterGroupId: string | null;
  actorName: string;
  actorAvatarUri: string | null;
  isComplete: boolean;
  timestamp: number;
  sender: string;
  roleName: string;
  content: string;
  completedAt: number;
}
```

身份规则：

- `messageId` 是 Room 行 ID 的十进制字符串，避免 JavaScript 丢失 64 位整数精度。
- `orderIndex`、`variantId` 和 `variantIndex` 是本次持久化结果的权威值。原始变体的 `variantId` 为 `null`。
- 宿主不再按 `timestamp` 查询消息 ID。`timestamp` 只表示消息时间。
- 用户消息写入后即为完整；AI 消息只有 `completedAt > 0` 时 `isComplete` 才为 `true`。MVU 只结算完整事件。
- MVU 幂等键必须包含 `chatId`、`messageId` 和 `variantId`，不能只使用时间戳、顺序或角色 ID。

角色解析规则：

- 当前单聊使用当前 `activePrompt` 的稳定角色卡 ID。
- 当前群聊和后台群聊使用 `characterGroupId`，AI 消息再以 `roleName` 在该组成员中唯一匹配角色卡。
- 群聊用户消息保留 `characterGroupId`，但 `actorCharacterCardId` 与 `actorAvatarUri` 为 `null`。
- 后台单聊只有持久化角色卡名称在全局唯一匹配时才返回角色卡 ID。
- 没有匹配或存在歧义时明确返回 `null` 并记录警告，不按首项归属。
- 角色上下文读取发生真实异常时，事件不会带着错误身份派发，异常由宿主记录。

## `ToolPkg.systemModel`

```ts
interface SystemModelProbeResult {
  available: boolean;
  provider?: string;
  model?: string;
  reason?: string;
}

interface SystemModelApi {
  probe(): Promise<SystemModelProbeResult>;
  complete(request: {
    systemPrompt: string;
    userPrompt: string;
    jsonSchema?: {
      name: string;
      schema: Record<string, JsonValue>;
    };
  }): Promise<{
    text: string;
    providerModel: string;
  }>;
}
```

`probe()` 检查 Operit 当前默认聊天模型是否可用。`complete()` 租用同一默认聊天模型，执行只包含 system 和 user 两个 turn 的单轮非流式补全，并在结束后释放租约。宿主将单次补全限制为 150 秒；超时会取消本次请求并返回错误。MVU 页面为 AI `judgeState` IPC 保留 180 秒等待时间，确保宿主先结束请求，避免页面已超时后仍在后台生成并形成不可见提交。

MVU 为判断结果提供 `jsonSchema`。宿主校验 schema 名称、对象根类型和大小后，以 `response_format.type = json_schema`、`strict = true` 发送，并强制本次请求使用 `reasoning_effort = none`。后者阻止 LM Studio 将私有推理内容作为 `<think>` 前缀合并进公开文本，不对响应做标签剥离或 JSON 截取。当前结构化输出只允许已验证的 `OPENAI`、`OPENAI_GENERIC` 与 `LMSTUDIO` provider；其他 provider 返回 `TOOLPKG_SYSTEM_MODEL_STRUCTURED_OUTPUT_UNSUPPORTED`。

宿主不给此次请求工具，不创建或修改聊天、消息与变体，也不运行世界书、记忆、摘要、标题或工具调用。插件只能获得返回文本和 provider/model 显示信息，不能获得密钥、端点或模型配置。

`complete()` 返回文本，`jsonSchema` 只约束语法形状，不替插件完成业务授权。MVU 必须严格 `JSON.parse` 并校验完整结果；带 Markdown 包裹、额外说明、未知键、重复字段、未授权字段或越界值的输出不能提交状态事务。

`chatContext` 和 `systemModel` 都是运行期异步 API，不能在 `registerToolPkg()` 执行期间调用。

## `Tools.Files.replaceAtomically`

```ts
interface FileOperationData {
  env: "android" | "linux";
  operation: string;
  path: string;
  successful: boolean;
  details: string;
}

namespace Tools.Files {
  function replaceAtomically(
    source: string,
    destination: string,
  ): Promise<FileOperationData>;
}
```

MVU 先通过既有 `Tools.Files.write` 把完整提交写入正式文件同目录的临时普通文件，再调用 `replaceAtomically`。宿主必须使用 Android 本地文件系统的一次 `ATOMIC_MOVE + REPLACE_EXISTING` 完成替换，并满足以下契约：

- 源文件和目标文件必须位于同一已存在目录，源必须是普通文件；目标可以不存在。
- 仅 Android 本地路径可用。Linux、SAF/`content://`、跨目录和文件系统不支持原子移动时必须失败。
- 不得回退到普通 move、copy/delete 或先删除目标。失败时旧目标保持不变，源临时文件是否保留由调用方检查和清理。
- 成功返回 `successful: true` 且 `operation: "atomic_replace"`；失败返回不成功结果或拒绝 Promise，不能仅靠 `details` 文本判断成败。
- 该方法故意没有 `environment` 参数，避免把 Android 本地原子语义错误推广到其他存储后端。

MVU 不得用普通 `move`、覆盖写或删除后重建代替该接口提交权威数据；宿主没有此接口时，插件应明确报告宿主版本不兼容，不能静默降低数据安全保证。

## Prompt 组合

MVU 使用 `registerSystemPromptComposeHook`，但只接受 `promptFunctionType === "CHAT"` 的请求。返回的新 `systemPrompt` 必须包含事件中 Operit 已组合好的完整 `systemPrompt`，再追加 MVU 当前可见状态段。

插件不能用仅含 MVU 状态的字符串替换宿主提示词，也不能向摘要、记忆、标题、后台系统任务或其他非 `CHAT` 请求注入状态。

## 安装与验收边界

下列宿主实现已进入代码与 JVM 单元测试范围：

- 指定聊天或当前聊天的上下文解析
- nullable `activePrompt` 与歧义不猜测规则
- 角色卡和组成员头像 URI 透传
- Room 写入结果直接形成消息身份
- 消息事件角色解析和完整消息门控
- 系统默认模型 probe 与无聊天副作用补全
- JavaScript bridge 参数校验和 TypeScript 声明

当前最终组合已完成：

- Android 真机验证 `content://` 头像在 MVU UI 中的读取与显示
- Android 真机验证后台消息、群聊、编辑和变体事件
- 最终 `.toolpkg` 的导入、同 ID 更新、重启持久化、完整按钮矩阵和视觉回归

正式用户链路仍是先更新一次满足上述契约的 Operit，再只导入单一外部 `operit_mvu-3.0.0.toolpkg`。MVU 页面不提供专用退出按钮，离开插件统一使用 Android 返回手势、系统返回键或 Operit 自身导航。
