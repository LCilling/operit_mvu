import assert from "node:assert/strict";
import test from "node:test";

import {
  activeContextFromHostSnapshot,
  actorsFromHostSnapshot,
  assertPersistedEventMatchesHost,
  automationSignalsForMessage,
  bootstrapContextsFromHostSnapshot,
  memberContextsFromHostSnapshot,
  persistedEventContext,
} from "../src/mvu/app/host-context";
import type { MessageFact } from "../src/mvu/app/model";

const CHARACTER_A: ToolPkg.ChatContextCharacterSnapshot = {
  characterCardId: "actor_a",
  name: "角色甲",
  avatarUri: "content://avatar/a",
};

const CHARACTER_B: ToolPkg.ChatContextCharacterSnapshot = {
  characterCardId: "actor_b",
  name: "角色乙",
  avatarUri: null,
};

const CHARACTER_C: ToolPkg.ChatContextCharacterSnapshot = {
  characterCardId: "actor_c",
  name: "非群成员",
  avatarUri: null,
};

function singleSnapshot(): ToolPkg.ChatContextSnapshot {
  return {
    chatId: "chat_single",
    activePrompt: { type: "character_card", id: "actor_a", name: "角色甲" },
    activeCharacter: CHARACTER_A,
    activeGroup: null,
    characters: [CHARACTER_A, CHARACTER_B],
    members: [{ ...CHARACTER_A, orderIndex: 0 }],
    currentCharacter: CHARACTER_A,
  };
}

function groupSnapshot(): ToolPkg.ChatContextSnapshot {
  return {
    chatId: "chat_group",
    activePrompt: { type: "character_group", id: "group_a", name: "测试群" },
    activeCharacter: null,
    activeGroup: { characterGroupId: "group_a", name: "测试群" },
    characters: [CHARACTER_A, CHARACTER_B, CHARACTER_C],
    members: [
      { ...CHARACTER_A, orderIndex: 0 },
      { ...CHARACTER_B, orderIndex: 1 },
    ],
    currentCharacter: null,
  };
}

function unresolvedSnapshot(): ToolPkg.ChatContextSnapshot {
  return {
    chatId: null,
    activePrompt: null,
    activeCharacter: null,
    activeGroup: null,
    characters: [],
    members: [],
    currentCharacter: null,
  };
}

function event(
  overrides: Partial<ToolPkg.ChatMessageEventPayload> = {}
): ToolPkg.ChatMessageEventPayload {
  return {
    chatId: "chat_single",
    messageId: "message_1",
    orderIndex: 1,
    variantId: null,
    variantIndex: 0,
    actorCharacterCardId: "actor_a",
    characterGroupId: null,
    actorName: "角色甲",
    actorAvatarUri: null,
    isComplete: true,
    timestamp: 10_000,
    sender: "user",
    roleName: "user",
    content: "普通消息",
    completedAt: 10_000,
    provider: "provider",
    modelName: "model",
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    sentAt: 10_000,
    outputDurationMs: 0,
    waitDurationMs: 0,
    displayMode: "classic",
    selectedVariantIndex: 0,
    isFavorite: false,
    ...overrides,
  };
}

function fact(id: string, content: string, occurredAt: number): MessageFact {
  return {
    messageId: id,
    variantId: null,
    content,
    chatId: "chat_single",
    actorId: "actor_a",
    groupId: null,
    role: "user",
    occurredAt,
    recentPositiveCount: null,
    userCareDetected: null,
    lastInteractionAt: null,
    messageCountInLast24Hours: null,
    specialDayDetected: null,
  };
}

test("single-character snapshot converts actors, active context, members, and bootstrap contexts", () => {
  const snapshot = singleSnapshot();
  assert.deepEqual(actorsFromHostSnapshot(snapshot), [
    { characterId: "actor_a", name: "角色甲", avatarUri: "content://avatar/a", enabled: true },
    { characterId: "actor_b", name: "角色乙", enabled: true },
  ]);
  assert.deepEqual(activeContextFromHostSnapshot(snapshot), {
    chatId: "chat_single",
    actorId: "actor_a",
    groupId: null,
    actorName: "角色甲",
  });
  assert.deepEqual(memberContextsFromHostSnapshot(snapshot), [{
    chatId: "chat_single",
    actorId: "actor_a",
    groupId: null,
    actorName: "角色甲",
  }]);
  assert.deepEqual(bootstrapContextsFromHostSnapshot(snapshot), [
    { chatId: "chat_single", actorId: "actor_a", groupId: null, actorName: "角色甲" },
    { chatId: "chat_single", actorId: "actor_b", groupId: null, actorName: "角色乙" },
  ]);
});

test("group snapshot keeps shared group identity while projecting every explicit member", () => {
  const snapshot = groupSnapshot();
  assert.deepEqual(activeContextFromHostSnapshot(snapshot), {
    chatId: "chat_group",
    actorId: null,
    groupId: "group_a",
    actorName: "测试群",
  });
  assert.deepEqual(memberContextsFromHostSnapshot(snapshot), [
    { chatId: "chat_group", actorId: "actor_a", groupId: "group_a", actorName: "角色甲" },
    { chatId: "chat_group", actorId: "actor_b", groupId: "group_a", actorName: "角色乙" },
  ]);
  assert.deepEqual(activeContextFromHostSnapshot(snapshot, "actor_b"), {
    chatId: "chat_group",
    actorId: "actor_b",
    groupId: "group_a",
    actorName: "角色乙",
  });
  assert.throws(
    () => activeContextFromHostSnapshot(snapshot, "actor_c"),
    /MVU_HOST_SELECTED_ACTOR_NOT_IN_ACTIVE_CONTEXT:actor_c/
  );
  assert.deepEqual(bootstrapContextsFromHostSnapshot(snapshot), [
    { chatId: "chat_group", actorId: "actor_a", groupId: "group_a", actorName: "角色甲" },
    { chatId: "chat_group", actorId: "actor_b", groupId: "group_a", actorName: "角色乙" },
    { chatId: "chat_group", actorId: "actor_c", groupId: "group_a", actorName: "非群成员" },
  ]);
});

test("unresolved snapshot produces an explicit null context and one inert bootstrap context", () => {
  const snapshot = unresolvedSnapshot();
  const unresolved = { chatId: null, actorId: null, groupId: null, actorName: "" };
  assert.deepEqual(actorsFromHostSnapshot(snapshot), []);
  assert.deepEqual(activeContextFromHostSnapshot(snapshot), unresolved);
  assert.deepEqual(memberContextsFromHostSnapshot(snapshot), []);
  assert.deepEqual(bootstrapContextsFromHostSnapshot(snapshot), [unresolved]);
});

test("persisted event context uses authoritative ids and rejects identity mismatches", () => {
  const single = singleSnapshot();
  const matchingSingle = event();
  assert.deepEqual(persistedEventContext(matchingSingle), {
    chatId: "chat_single",
    actorId: "actor_a",
    groupId: null,
    actorName: "角色甲",
  });
  assert.doesNotThrow(() => assertPersistedEventMatchesHost(matchingSingle, single));
  assert.throws(() => assertPersistedEventMatchesHost(
    event({ chatId: "another_chat" }),
    single
  ), /MVU_HOST_CHAT_CONTEXT_MISMATCH/);
  assert.throws(() => assertPersistedEventMatchesHost(
    event({ actorCharacterCardId: "actor_b", actorName: "角色乙" }),
    single
  ), /MVU_HOST_ACTOR_CONTEXT_MISMATCH/);

  const group = groupSnapshot();
  const matchingGroup = event({
    chatId: "chat_group",
    actorCharacterCardId: "actor_b",
    actorName: "角色乙",
    characterGroupId: "group_a",
  });
  assert.doesNotThrow(() => assertPersistedEventMatchesHost(matchingGroup, group));
  assert.throws(() => assertPersistedEventMatchesHost(
    { ...matchingGroup, characterGroupId: null },
    group
  ), /MVU_HOST_GROUP_CONTEXT_MISMATCH/);
  assert.throws(() => assertPersistedEventMatchesHost(
    { ...matchingGroup, actorCharacterCardId: "actor_c", actorName: "非群成员" },
    group
  ), /MVU_HOST_ACTOR_CONTEXT_MISMATCH/);
  assert.throws(() => assertPersistedEventMatchesHost(
    event({ actorCharacterCardId: "actor_a" }),
    unresolvedSnapshot()
  ), /MVU_HOST_(CHAT|ACTOR)_CONTEXT_MISMATCH/);
});

test("automation signals derive positivity, user care, inactivity, 24h count, and special days", () => {
  const now = 10 * 86_400_000;
  const recentFacts = [
    fact("positive_recent", "谢谢你的支持", now - 2 * 3_600_000),
    fact("neutral_recent", "普通内容", now - 30 * 60_000),
    fact("positive_old", "love", now - 25 * 3_600_000),
  ];
  const signals = automationSignalsForMessage(recentFacts, event({
    timestamp: now,
    content: "生日快乐，你还好吗，我喜欢和你聊天",
    sender: "user",
  }));
  assert.deepEqual(signals, {
    recentPositiveCount: 3,
    userCareDetected: true,
    lastInteractionAt: now - 30 * 60_000,
    messageCountInLast24Hours: 3,
    specialDayDetected: true,
  });

  const inactiveAt = now - 48 * 3_600_000;
  const inactive = automationSignalsForMessage(
    [fact("old", "普通内容", inactiveAt)],
    event({ timestamp: now, content: "还好吗", sender: "assistant" })
  );
  assert.equal(inactive.lastInteractionAt, inactiveAt);
  assert.equal(inactive.userCareDetected, false);
  assert.equal(inactive.messageCountInLast24Hours, 1);

  assert.throws(() => automationSignalsForMessage([], event({ timestamp: Number.NaN })),
    /MVU_HOST_MESSAGE_TIME_INVALID/);
});
