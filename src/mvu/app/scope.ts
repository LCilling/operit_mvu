import type {
  DataField,
  DataStage,
  StateScope,
  StateScopeContext,
} from "./model";

function requireScopeId(value: string | null, errorCode: string): string {
  if (value === null || value.length === 0) throw new Error(errorCode);
  return value;
}

/** Resolve the only storage key allowed for a field in the supplied host context. */
export function scopeKey(scope: StateScope, context: StateScopeContext): string {
  switch (scope) {
    case "character":
      return `character:${requireScopeId(context.actorId, "MVU_SCOPE_ACTOR_REQUIRED")}`;
    case "group":
      return `group:${requireScopeId(context.groupId, "MVU_SCOPE_GROUP_REQUIRED")}`;
    case "chat":
      return `chat:${requireScopeId(context.chatId, "MVU_SCOPE_CHAT_REQUIRED")}`;
    case "global":
      return "global";
  }
}

export function bindingIdForScope(
  scope: Exclude<StateScope, "global">,
  context: StateScopeContext
): string | null {
  switch (scope) {
    case "character":
      return context.actorId;
    case "group":
      return context.groupId;
    case "chat":
      return context.chatId;
  }
}

/** Global fields are universal; other scopes require an explicit stable-ID binding. */
export function fieldAppliesToContext(field: DataField, context: StateScopeContext): boolean {
  if (!field.enabled) return false;
  if (field.scope === "global") return true;
  const bindingId = bindingIdForScope(field.scope, context);
  return bindingId !== null && field.bindingIds.includes(bindingId);
}

/** Cooldowns and message facts use the complete event identity, never a display name. */
export function automationScopeKey(context: StateScopeContext): string {
  const chat = context.chatId === null ? "-" : encodeURIComponent(context.chatId);
  const actor = context.actorId === null ? "-" : encodeURIComponent(context.actorId);
  const group = context.groupId === null ? "-" : encodeURIComponent(context.groupId);
  return `event:chat=${chat};actor=${actor};group=${group}`;
}

export function deriveStage(field: DataField, value: number): DataStage {
  let active = field.stages[0];
  for (const stage of field.stages) {
    if (value >= stage.threshold) active = stage;
  }
  return active;
}

export function stateValueForField(
  dataset: { stateValues: Record<string, Record<string, number>> },
  field: DataField,
  context: StateScopeContext
): number {
  const key = scopeKey(field.scope, context);
  return dataset.stateValues[key]?.[field.id] ?? field.initialValue;
}
