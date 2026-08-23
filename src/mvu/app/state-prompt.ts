/** Deterministic model projection for an explicit host scope context. */
import type { DataField, MvuDataset, StateScopeContext } from "./model";
import {
  deriveStage,
  fieldAppliesToContext,
  stateValueForField,
} from "./scope";

export function buildStateSectionBlock(
  dataset: MvuDataset,
  context: StateScopeContext,
  fields: readonly DataField[]
): string {
  const actorLabel = context.actorName.length > 0 ? context.actorName : "当前上下文";
  const lines: string[] = [
    `<WorldState actorId="${escapeXml(context.actorId ?? "")}" actor="${escapeXml(actorLabel)}">`,
    `[动态状态 · ${sanitizeLine(actorLabel)}]`,
  ];
  appendFieldLines(lines, dataset, context, fields);
  lines.push("</WorldState>");
  return lines.join("\n");
}

/**
 * Group-aware projection. Character-scoped fields are rendered once for each
 * explicit member identity; group/chat/global fields are rendered once from
 * the active context, so a group prompt cannot duplicate shared state.
 */
export function buildScopedStateSectionBlock(
  dataset: MvuDataset,
  context: StateScopeContext,
  memberContexts: readonly StateScopeContext[] = []
): string {
  const lines: string[] = [
    `<WorldState chatId="${escapeXml(context.chatId ?? "")}" groupId="${escapeXml(context.groupId ?? "")}">`,
  ];
  const sharedFields = dataset.fields.filter((field) =>
    field.scope !== "character" &&
    fieldAppliesToContext(field, context) &&
    field.modelVisibility !== "hidden"
  );
  if (sharedFields.length > 0) {
    lines.push("[共享动态状态]");
    appendFieldLines(lines, dataset, context, sharedFields);
  }

  const uniqueMembers = new Map<string, StateScopeContext>();
  if (context.actorId !== null) uniqueMembers.set(context.actorId, context);
  for (const member of memberContexts) {
    if (member.actorId !== null && !uniqueMembers.has(member.actorId)) {
      uniqueMembers.set(member.actorId, member);
    }
  }
  for (const member of uniqueMembers.values()) {
    const characterFields = dataset.fields.filter((field) =>
      field.scope === "character" &&
      fieldAppliesToContext(field, member) &&
      field.modelVisibility !== "hidden"
    );
    if (characterFields.length === 0) continue;
    const actorLabel = member.actorName.length > 0 ? member.actorName : member.actorId ?? "";
    lines.push(
      `<ActorState actorId="${escapeXml(member.actorId ?? "")}" actor="${escapeXml(actorLabel)}">`,
      `[角色动态状态 · ${sanitizeLine(actorLabel)}]`
    );
    appendFieldLines(lines, dataset, member, characterFields);
    lines.push("</ActorState>");
  }
  if (lines.length === 1) return "";
  lines.push("</WorldState>");
  return lines.join("\n");
}

export function visibleFieldsForContext(
  dataset: MvuDataset,
  context: StateScopeContext
): DataField[] {
  return dataset.fields.filter((field) =>
    fieldAppliesToContext(field, context) && field.modelVisibility !== "hidden"
  );
}

function appendFieldLines(
  lines: string[],
  dataset: MvuDataset,
  context: StateScopeContext,
  fields: readonly DataField[]
): void {
  for (const field of fields) {
    if (!fieldAppliesToContext(field, context) || field.modelVisibility === "hidden") continue;
    const value = stateValueForField(dataset, field, context);
    const stage = deriveStage(field, value);
    if (field.modelVisibility === "stage_only") {
      lines.push(`- ${sanitizeLine(field.name)}: 阶段「${sanitizeLine(stage.name)}」`);
      if (stage.description.length > 0) lines.push(`  ${sanitizeLine(stage.description)}`);
      continue;
    }
    lines.push(`- ${sanitizeLine(field.name)}: ${value}（阶段：${sanitizeLine(stage.name)}）`);
    if (field.description.length > 0) lines.push(`  ${sanitizeLine(field.description)}`);
    if (stage.description.length > 0) lines.push(`  阶段说明：${sanitizeLine(stage.description)}`);
  }
}

function sanitizeLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function escapeXml(value: string): string {
  return sanitizeLine(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
