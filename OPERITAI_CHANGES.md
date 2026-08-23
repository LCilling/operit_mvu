# 相对于 OperitAI 源码的宿主改动

`operit_mvu` 的 Release 本身只有 ToolPkg；本页列出为了满足 Issue #998 和插件真机运行而在当前 OperitAI 工作树中加入的通用宿主能力。这里只记录与 `operit_mvu` 直接相关的改动，不把同一工作树中的其他功能开发计入插件依赖。

当 Operit 官方版本提供下列契约后，用户不再需要安装当前修改版 APK，只需导入 `operit_mvu-0.2.0.toolpkg`。

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

## 8. 覆盖测试

宿主改动对应的定向测试包括：

- `ToolPkgChatContextBridgeTest`
- `ToolPkgChatMessageHookBridgeTest`
- `ToolPkgSystemModelBridgeTest`
- `JsToolPkgRegistrationTest`
- `JsTimeoutConfigTest`
- `ToolPkgMainRegistrationScriptParserTest`
- `ToolPkgAvatarUriAndroidTest`

完整接口形状和边界见 [docs/HOST_INTERFACE_REQUIREMENTS.md](docs/HOST_INTERFACE_REQUIREMENTS.md)。
