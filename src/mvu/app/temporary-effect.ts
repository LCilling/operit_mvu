/** Shared temporary-effect semantics used by validation, execution, and records. */
import type {
  DataTemporaryEffect,
  DataTemporaryEffectTarget,
  StateScopeContext,
  TemporaryEffectReasonTemplate,
} from "./model";

export const TEMPORARY_EFFECT_REASON_TEMPLATES: Readonly<
  Record<TemporaryEffectReasonTemplate, string>
> = {
  general: "临时状态影响",
  positive: "临时增益",
  negative: "临时减益",
  environment: "情境影响",
  relationship: "关系事件",
};

export function temporaryEffectTargetMatchesContext(
  target: DataTemporaryEffectTarget,
  context: StateScopeContext
): boolean {
  switch (target.scope) {
    case "global":
      return target.scopeKey === "global";
    case "character":
      return context.actorId !== null && target.scopeKey === `character:${context.actorId}`;
    case "group":
      return context.groupId !== null && target.scopeKey === `group:${context.groupId}`;
    case "chat":
      return context.chatId !== null && target.scopeKey === `chat:${context.chatId}`;
  }
}

export function temporaryEffectTargetsField(
  effect: DataTemporaryEffect,
  fieldId: string
): boolean {
  return effect.targets.some((target) => target.fieldId === fieldId);
}

export function resolveTemporaryEffectReason(effect: DataTemporaryEffect): string {
  if (effect.reasonMode === "custom") return effect.reason.trim();
  return TEMPORARY_EFFECT_REASON_TEMPLATES[effect.reasonTemplate];
}
