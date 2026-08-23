# 第三方许可说明

本项目原创部分使用根目录 [MIT 许可证](../LICENSE)。下列第三方作品继续适用各自许可与版权声明。

本 ToolPkg 依赖以下第三方作品。涉及源码修改的条目见对应 patch 说明。

## MagVarUpdate（MVU 核心）

- 作者：MagicalAstrogy & StageDog
- 仓库：https://github.com/MagicalAstrogy/MagVarUpdate
- 版本：beta @ `0a730cd4a9b99689d1135a49b542c780b977c24c`
- 许可：MIT（完整文本见 `third_party/MagVarUpdate/LICENSE`）
- 用途：变量状态更新引擎（MvuData / schema / 命令执行 / 事件）。
- 移植修订：[MagVarUpdate_PATCHES.md](MagVarUpdate_PATCHES.md)、[MVU_PORT.md](MVU_PORT.md)。

## 移植中参考/替换的第三方能力

以下库的上游函数被移植为 Operit 自包含的 `src/mvu/port/*` 纯函数实现，**不随包分发**对应库本体，但保留其语义：

| 能力 | 来源 | Operit 位置 |
| --- | --- | --- |
| lodash（path/merge/equal 子集） | lodash | `port/util.ts` |
| klona（深拷贝） | klona | `port/util.ts` `klona` |
| YAML 解析子集 | js-yaml / yaml | `port/structured-parser.ts` |
| JSON5 解析子集 | json5 | `port/structured-parser.ts` |
| jsonrepair 语义 | jsonrepair | `port/structured-parser.ts` |
| mathjs 受限子集 | mathjs | `port/structured-parser.ts` `evaluateRestrictedMath` |

## 类型参考

- JS-Slash-Runner（仅参考 `Mvu` 类型与调用语义，不分发其代码）
  - https://github.com/N0VI028/JS-Slash-Runner
  - `main@e3b18604ed4eabfc1fe6b138c3c065407f8048d5`

## Material Symbols Rounded

- 作者：Google
- 仓库：https://github.com/google/material-design-icons
- 文件：`static/app_ui/assets/fonts/material-symbols-rounded.woff2`
- 许可：Apache License 2.0
- 用途：插件前端的标准操作与状态图标；构建时内联进 `app.html`，真机离线可用。

## MVU 角色视觉资产

- `character-state-theme.png`：项目内参考设计的原始银发角色背景。
- `avatars/*.png`：依据用户提供的角色栏参考图，通过 OpenAI 内置 ImageGen 生成，供本插件界面使用。

## 许可合规

MagVarUpdate 为 MIT，移植产物保留原版权声明（见 `third_party/MagVarUpdate/LICENSE`）。所有源码文件头部未删除原作者信息；对上游的偏离记录在 [MagVarUpdate_PATCHES.md](MagVarUpdate_PATCHES.md)，上游仓库与版本说明见 [MagVarUpdate_UPSTREAM.md](MagVarUpdate_UPSTREAM.md)。
