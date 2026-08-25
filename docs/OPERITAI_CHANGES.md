# operit_mvu 相对于 OperitAI 源码的宿主改动

`operit_mvu` 的 Release 本身只有 ToolPkg；本页列出为了满足 Issue #998 和插件真机运行而在当前 OperitAI 工作树中加入的通用宿主能力。这里只记录与 `operit_mvu` 直接相关的改动，不把同一工作树中的其他功能开发计入插件依赖。

当 Operit 官方版本提供下列契约后，用户不再需要安装当前修改版 APK，只需导入 `operit_mvu-3.0.0.toolpkg`。

## 1. 聊天与角色上下文

新增 `ToolPkg.chatContext.snapshot({ chatId? })`，向 ToolPkg 返回当前或指定聊天的稳定身份：聊天 ID、角色卡 ID、角色组 ID、成员顺序、当前角色、显示名和头像 URI。缺失或歧义绑定会显式返回空身份，不按名称首项猜测。

主要文件：

- `plugins/toolpkg/ToolPkgChatContextBridge.kt`
- `core/tools/javascript/JsEngine.kt`
- `core/tools/javascript/JsToolPkgRegistration.kt`
- `examples/types/toolpkg.d.ts`

## 2. 权威的 `message_persisted` 事件

Room 新增/更新消息后直接返回 `PersistedMessageIdentity`，事件载荷新增 `messageId`、`orderIndex`、`variantId`、`variantIndex`、`actorCharacterCardId`、`characterGroupId`、头像和 `isComplete`。这让插件能对用户消息、流式 AI 完成消息、变体和后台会话做稳定幂等处理，不再依赖时间戳反查。

主要文件：

- `data/repository/ChatHistoryManager.kt`
- `services/core/ChatHistoryDelegate.kt`
- `plugins/toolpkg/ToolPkgChatMessageHookBridge.kt`
- `api/chat/enhance/ConversationService.kt`

## 3. 系统默认模型 API

新增 `ToolPkg.systemModel.probe()` 与 `ToolPkg.systemModel.complete(...)`。宿主租用 Operit 当前默认聊天模型执行一次无聊天副作用的 system/user 补全，结束后释放模型租约。结构化输出使用原生 `response_format: json_schema`，支持 `OPENAI`、`OPENAI_GENERIC` 和 `LMSTUDIO`，并把 `reasoning_effort` 固定为 `none`，避免 LM Studio 私有推理文本污染严格 JSON。

宿主模型请求先在 150 秒超时并取消，ToolPkg IPC 上限为 180 秒。插件页面只在宿主结束后接收结果，避免页面超时后仍有不可见状态提交。

主要文件：

- `plugins/toolpkg/ToolPkgSystemModelBridge.kt`
- `api/chat/EnhancedAIService.kt`
- `core/tools/javascript/JsEngine.kt`
- `core/tools/javascript/JsTimeoutConfig.kt`
- `core/tools/javascript/JsToolPkgRegistration.kt`

当前工作树还包含通用 `ToolPkg.localModels` 能力，但 `operit_mvu` 不调用它；插件只依赖 `ToolPkg.systemModel`。

## 4. Prompt Hook 上下文

普通聊天组合提示词时向 Hook 传递明确的 `functionType` 与 `promptFunctionType`。`operit_mvu` 只处理 `CHAT`，并在 Operit 已组合完成的完整系统提示词后追加当前可见状态，不影响摘要、记忆、标题或其他后台模型任务。

主要文件：

- `core/config/SystemPromptConfig.kt`
- `api/chat/enhance/ConversationService.kt`
- `plugins/toolpkg/ToolPkgChatMessageHookBridge.kt`

## 5. ToolPkg 页面与 Android 返回

UI route 注册增加 `topBar: "host" | "hidden"`，默认保留 Operit 原生宿主顶栏。`operit_mvu` 使用 `topBar: "host"` 和 `keepAlive: false`：宿主栏位于插件参考页头上方，离开路由时销毁 WebView，避免插件覆盖 Operit 主界面。

Compose DSL WebView 增加本地 HTML 文档开始桥接、仅在当前可见页面且 WebView 确实存在历史时消费 Android 返回；位于历史根时返回交给 Operit 路由。

主要文件：

- `core/tools/packTool/ToolPkgUiRouteTopBar.kt`
- `core/tools/packTool/ToolPkgMainRegistrationScriptParser.kt`
- `core/tools/packTool/PackageManager.kt`
- `core/tools/packTool/PackageManagerToolPkgFacade.kt`
- `ui/main/components/AppContent.kt`
- `ui/main/navigation/AppNavigationModels.kt`
- `ui/main/navigation/AppRouteCatalog.kt`
- `ui/main/screens/OperitScreens.kt`
- `ui/common/composedsl/ToolPkgComposeDslWebView.kt`

## 6. 头像 URI

宿主把私有头像文件规范化为 FileProvider `content://` URI，并仅向插件 WebView 开放受控读取。新建角色卡或角色组时，头像会等待宿主生成稳定 UUID 后再写入对应偏好，避免空 ID 导致头像丢失。

主要文件：

- `plugins/toolpkg/ToolPkgChatContextBridge.kt`
- `plugins/toolpkg/ToolPkgChatMessageHookBridge.kt`
- `ui/features/settings/components/CharacterCardDialog.kt`
- `ui/features/settings/screens/ModelPromptsSettingsScreen.kt`
- `ui/common/composedsl/ToolPkgComposeDslWebView.kt`

## 7. 外部 ToolPkg 同 ID 更新

包管理器允许外部 ToolPkg 用同一 `toolpkg_id` 原子替换旧外部包，成功后重建运行时、恢复 IPC 注册并重放可重放的应用生命周期事件。导入结果增加明确的 `success` 字段，界面不再解析提示文本判断成功与否。内置包仍不能被外部包覆盖。

主要文件：

- `core/tools/packTool/PackageManager.kt`
- `core/tools/javascript/JsComposeDslBridge.kt`
- `ui/features/packages/market/ArtifactLocalInstallSupport.kt`
- `ui/features/packages/screens/PackageManagerScreen.kt`

## 8. Android 本地文件原子替换

新增 `Tools.Files.replaceAtomically(source, destination): Promise<FileOperationData>`，供 ToolPkg 安全提交账本、配置和备份恢复结果。调用方先把完整内容写入目标文件同目录的临时普通文件，再由宿主执行一次带 `ATOMIC_MOVE + REPLACE_EXISTING` 的文件系统移动；成功后目标文件只会呈现旧版本或完整的新版本，不暴露半写入状态。

该接口具有以下强制边界：

- `source` 必须是 Android 本地普通文件，`source` 与 `destination` 必须位于同一已存在目录；目标文件可以尚不存在。
- 仅支持 Android 本地文件系统；Linux 环境、SAF/`content://`、跨目录目标和不支持原子移动的文件系统必须明确失败。
- 宿主不得在原子移动不可用时降级为普通移动、复制后删除或“先删后写”。失败时原目标文件保持不变，调用方收到失败的 `FileOperationData` 或异常，并负责保留或清理临时文件。
- 成功结果使用 `FileOperationData.successful === true`，`operation` 为 `"atomic_replace"`；失败不得伪装为成功。
- 接口不接受 `environment` 参数，避免调用方误以为 Linux 或 SAF 也具有相同原子保证。

TypeScript 契约：

```ts
namespace Tools.Files {
  function replaceAtomically(
    source: string,
    destination: string,
  ): Promise<FileOperationData>;
}
```

主要文件：

- `core/tools/javascript/JsTools.kt`
- `core/tools/defaultTool/standard/StandardFileSystemTools.kt`
- `examples/types/files.d.ts`
- `docs/doc-src/package-dev/files.md`

## 附录 A：`readPart` 的结构化截断契约

现有官方 `Tools.Files.readPart(path, startLine?, endLine?, environment?)` 在 Android、SAF 和 Linux 实现中，单次正文最多返回 32,000 个字符。若请求行范围的原始正文超过上限，宿主先截取前 32,000 个字符、再添加行号，并在独立末行追加固定标记：

```text
... (file content truncated) ...
```

该标记是机器可判定的兼容契约，不得翻译、改变空白或混入普通正文行。`FilePartContentData.startLine`、`endLine` 和 `totalLines` 继续描述请求及文件行范围，不能代替截断标记；当前返回结构尚无独立的 `truncated` 布尔字段。

`operit_mvu` 的正常记录查询以最多 32 行调用 `readPart`。发现上述标记时，插件会放弃该次不完整结果，并对当前行区间做有界二分，再次调用同一官方接口；32 行的初始区间最多拆分 5 层。插件不会回退到整文件读取，也不会解析部分 JSON。单条持久化记录最多允许 32,000 个 UTF-16 代码单元：新写入会在提交前校验，既有超长单行会明确报错。未来若宿主为 `FilePartContentData` 增加结构化 `truncated: boolean`，应保留本标记至少一个兼容周期。

主要文件：

- `core/tools/ToolExecutionLimits.kt`
- `core/tools/defaultTool/standard/StandardFileSystemTools.kt`
- `core/tools/defaultTool/standard/SafFileSystemTools.kt`
- `core/tools/defaultTool/standard/LinuxFileSystemTools.kt`
- `core/tools/defaultTool/debugger/DebuggerFileSystemTools.kt`
- `examples/types/results.d.ts`

完整接口形状和边界见 [HOST_INTERFACE_REQUIREMENTS.md](HOST_INTERFACE_REQUIREMENTS.md)。
