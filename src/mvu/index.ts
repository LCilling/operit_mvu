/**
 * src/mvu/index.ts
 *
 * Operit MVU 移植核心公共入口（确定性核心、port 适配层与 ToolPkg 业务层）。
 *
 * 本层不依赖任何 Operit 宿主 API，只依赖：
 *   - core/：从 MagVarUpdate 移植的确定性核心（命令解析/执行、schema、initvar、事件、facade）
 *   - port/：环境解耦与安全修订（工具函数、结构化解析、输入预算、路径保护、错误目录、merge）
 *
 * ToolPkg 入口通过官方 Actor/Scope/Message/Prompt/Store 契约接入该核心。
 */

export * from './core/variable-def';
export * from './core/events';
export * from './core/schema';
export * from './core/command-parser';
export * from './core/command-executor';
export * from './core/initvar';
export * from './core/facade';
export * from './core/function-schema';

// port 层
export * from './port/util';
export * from './port/merge';
export * from './port/context';
export * from './port/security-guard';
export * from './port/error-catalog';
export * from './port/structured-parser';

// app 层（宿主契约适配 + 业务服务 + MVU 引擎接线）
export * from './app/model';
export * from './app/store';
export * from './app/service';
export * from './app/seed';
export * from './app/actor-source';
export * from './app/system-model';
export * from './app/state-prompt';
export * from './app/mvu-bridge';
export * from './app/index';
