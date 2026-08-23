/** Pure conversion from Operit ToolPkg host facts to MVU application facts. */
import type {
  DataActor,
  MessageAutomationSignals,
  MessageFact,
  StateScopeContext,
} from "./model";

const POSITIVE_INTERACTION = /谢谢|感谢|喜欢|爱你|开心|真好|温柔|支持|陪伴|信任|抱抱|thank|love|glad|happy|kind|support|trust/i;
const USER_CARE = /还好吗|没事吧|辛苦了|注意休息|照顾好|担心你|关心你|需要我|能帮你|how are you|take care|worried about you|help you/i;
const SPECIAL_DAY = /生日|纪念日|周年|节日|情人节|新年|圣诞|特别的日子|birthday|anniversary|festival|valentine|new year|christmas/i;
const DAY_MS = 86_400_000;

export function actorsFromHostSnapshot(
  snapshot: ToolPkg.ChatContextSnapshot
): DataActor[] {
  return snapshot.characters.map((character) => {
    const actor: DataActor = {
      characterId: character.characterCardId,
      name: character.name,
      enabled: true,
    };
    if (character.avatarUri !== null) actor.avatarUri = character.avatarUri;
    return actor;
  });
}

export function activeContextFromHostSnapshot(
  snapshot: ToolPkg.ChatContextSnapshot,
  selectedActorId?: string
): StateScopeContext {
  if (selectedActorId !== undefined) {
    // A group has no authoritative current speaker, so UI role selection derives an explicit
    // member context without mutating Operit's chat binding. Directory-only actors are rejected
    // because projecting them into this group would expose or modify the wrong scoped state.
    const selectedMember = snapshot.members.find((member) =>
      member.characterCardId === selectedActorId
    );
    if (selectedMember === undefined) {
      throw new Error(`MVU_HOST_SELECTED_ACTOR_NOT_IN_ACTIVE_CONTEXT:${selectedActorId}`);
    }
    return {
      chatId: snapshot.chatId,
      actorId: selectedMember.characterCardId,
      groupId: snapshot.activeGroup === null
        ? null
        : snapshot.activeGroup.characterGroupId,
      actorName: selectedMember.name,
    };
  }
  if (snapshot.activeCharacter !== null) {
    return {
      chatId: snapshot.chatId,
      actorId: snapshot.activeCharacter.characterCardId,
      groupId: null,
      actorName: snapshot.activeCharacter.name,
    };
  }
  if (snapshot.activeGroup !== null) {
    return {
      chatId: snapshot.chatId,
      actorId: null,
      groupId: snapshot.activeGroup.characterGroupId,
      actorName: snapshot.activeGroup.name,
    };
  }
  return {
    chatId: snapshot.chatId,
    actorId: null,
    groupId: null,
    actorName: "",
  };
}

export function memberContextsFromHostSnapshot(
  snapshot: ToolPkg.ChatContextSnapshot
): StateScopeContext[] {
  const groupId = snapshot.activeGroup === null
    ? null
    : snapshot.activeGroup.characterGroupId;
  return snapshot.members.map((member) => ({
    chatId: snapshot.chatId,
    actorId: member.characterCardId,
    groupId,
    actorName: member.name,
  }));
}

/**
 * Seed templates bind once to the explicit host directory. MvuService refuses
 * to extend a field whose user-managed binding list is already non-empty.
 */
export function bootstrapContextsFromHostSnapshot(
  snapshot: ToolPkg.ChatContextSnapshot
): StateScopeContext[] {
  const active = activeContextFromHostSnapshot(snapshot);
  const contexts: StateScopeContext[] = snapshot.characters.map((character) => ({
    chatId: snapshot.chatId,
    actorId: character.characterCardId,
    groupId: active.groupId,
    actorName: character.name,
  }));
  if (contexts.length === 0) contexts.push(active);
  return contexts;
}

export function persistedEventContext(
  payload: ToolPkg.ChatMessageEventPayload
): StateScopeContext {
  return {
    chatId: payload.chatId,
    actorId: payload.actorCharacterCardId,
    groupId: payload.characterGroupId,
    actorName: payload.actorName,
  };
}

export function assertPersistedEventMatchesHost(
  payload: ToolPkg.ChatMessageEventPayload,
  snapshot: ToolPkg.ChatContextSnapshot
): void {
  if (snapshot.chatId !== payload.chatId) {
    throw new Error("MVU_HOST_CHAT_CONTEXT_MISMATCH");
  }
  if (snapshot.activeGroup !== null) {
    if (payload.characterGroupId !== snapshot.activeGroup.characterGroupId) {
      throw new Error("MVU_HOST_GROUP_CONTEXT_MISMATCH");
    }
    // The global character directory is broader than this group's membership;
    // accepting a directory-only actor would settle state in the wrong group.
    if (payload.actorCharacterCardId !== null &&
      !snapshot.members.some((member) =>
        member.characterCardId === payload.actorCharacterCardId
      )) {
      throw new Error("MVU_HOST_ACTOR_CONTEXT_MISMATCH");
    }
    return;
  }
  if (payload.characterGroupId !== null) {
    throw new Error("MVU_HOST_GROUP_CONTEXT_MISMATCH");
  }
  if (snapshot.activeCharacter !== null) {
    if (payload.actorCharacterCardId !== snapshot.activeCharacter.characterCardId) {
      throw new Error("MVU_HOST_ACTOR_CONTEXT_MISMATCH");
    }
    return;
  }
  if (payload.actorCharacterCardId !== null) {
    throw new Error("MVU_HOST_ACTOR_CONTEXT_MISMATCH");
  }
}

export function automationSignalsForMessage(
  recentFacts: readonly MessageFact[],
  payload: ToolPkg.ChatMessageEventPayload
): MessageAutomationSignals {
  const occurredAt = payload.timestamp;
  if (!Number.isFinite(occurredAt)) throw new Error("MVU_HOST_MESSAGE_TIME_INVALID");
  const recentPositiveCount = recentFacts.reduce(
    (count, fact) => count + (POSITIVE_INTERACTION.test(fact.content) ? 1 : 0),
    POSITIVE_INTERACTION.test(payload.content) ? 1 : 0
  );
  let lastInteractionAt: number | null = null;
  for (const fact of recentFacts) {
    if (fact.occurredAt <= occurredAt &&
      (lastInteractionAt === null || fact.occurredAt > lastInteractionAt)) {
      lastInteractionAt = fact.occurredAt;
    }
  }
  const windowStart = occurredAt - DAY_MS;
  const messageCountInLast24Hours = 1 + recentFacts.filter((fact) =>
    fact.occurredAt >= windowStart && fact.occurredAt <= occurredAt
  ).length;
  return {
    recentPositiveCount,
    userCareDetected: payload.sender === "user" && USER_CARE.test(payload.content),
    lastInteractionAt,
    messageCountInLast24Hours,
    specialDayDetected: SPECIAL_DAY.test(payload.content),
  };
}
