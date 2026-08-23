let qaIdSequence = 100;

function nextQaId(prefix) {
  qaIdSequence += 1;
  return prefix + "_" + qaIdSequence;
}

function qaStages(names, minimum, maximum) {
  return names.map(function (name, index) {
    return {
      id: "stage_" + index,
      name: name,
      threshold: minimum + ((maximum - minimum) * index) / names.length,
      description: name + "阶段的行为与表达特征"
    };
  });
}

function qaField(id, name, description, icon, themeColor, options) {
  const minimum = options.minimum;
  const maximum = options.maximum;
  return {
    id: id,
    name: name,
    description: description,
    minimum: minimum,
    maximum: maximum,
    step: 1,
    initialValue: options.initialValue,
    icon: icon,
    themeColor: themeColor,
    enabled: options.enabled,
    scope: options.scope,
    modelVisibility: options.modelVisibility,
    ai: {
      enabled: options.aiEnabled,
      minConfidence: 0.7,
      maxDelta: 6,
      prompt: "根据消息中的明确互动事实判断" + name + "变化。"
    },
    stages: qaStages(options.stageNames, minimum, maximum),
    bindingIds: options.bindingIds.slice(),
    naturalChange: {
      enabled: true,
      unitMs: 86400000,
      amount: 0.5
    },
    perTurnChange: {
      enabled: false,
      intervalTurns: 3,
      amount: 1,
      countMode: "both"
    },
    order: options.order
  };
}

const qaActors = [
  {
    characterId: "char_ayane",
    name: "绫音",
    avatarUri: "./assets/avatars/ayane.png",
    enabled: true
  },
  {
    characterId: "char_erin",
    name: "艾琳",
    avatarUri: "./assets/avatars/ailin.png",
    enabled: true
  },
  {
    characterId: "char_noah",
    name: "诺亚",
    avatarUri: "./assets/avatars/noah.png",
    enabled: true
  }
];

let qaDataset = {
  formatVersion: 2,
  revision: 1,
  createdAt: Date.now() - 86400000,
  pendingBootstrapFieldIds: [],
  fields: [
    qaField("field_affinity", "亲密度", "与角色的情感关系状态", "favorite", "#FF4F88", {
      minimum: 0,
      maximum: 100,
      initialValue: 30,
      enabled: true,
      scope: "character",
      modelVisibility: "full",
      aiEnabled: true,
      stageNames: ["陌生", "熟悉", "亲密", "依赖"],
      bindingIds: ["char_ayane", "char_erin"],
      order: 0
    }),
    qaField("field_excite", "兴奋度", "当前即时情绪兴奋水平", "local_fire_department", "#FF8929", {
      minimum: 0,
      maximum: 100,
      initialValue: 30,
      enabled: true,
      scope: "character",
      modelVisibility: "stage_only",
      aiEnabled: true,
      stageNames: ["低落", "平稳", "高涨", "兴奋", "亢奋"],
      bindingIds: ["char_ayane", "char_noah"],
      order: 1
    }),
    qaField("field_fatigue", "疲劳", "当前精神与身体疲劳程度", "cloud", "#5B91FF", {
      minimum: 0,
      maximum: 100,
      initialValue: 20,
      enabled: true,
      scope: "character",
      modelVisibility: "full",
      aiEnabled: false,
      stageNames: ["轻松", "轻度", "中度", "重度", "耗竭"],
      bindingIds: ["char_ayane", "char_erin"],
      order: 2
    }),
    qaField("field_trust", "信任度", "角色愿意分享内心想法的信任程度", "auto_awesome", "#8459EF", {
      minimum: 0,
      maximum: 100,
      initialValue: 25,
      enabled: true,
      scope: "chat",
      modelVisibility: "full",
      aiEnabled: true,
      stageNames: ["戒备", "观察", "信赖", "坦诚"],
      bindingIds: ["qa_chat"],
      order: 3
    }),
    qaField("field_emotion", "情绪", "当前情绪倾向", "mood", "#23B878", {
      minimum: -100,
      maximum: 100,
      initialValue: 0,
      enabled: false,
      scope: "global",
      modelVisibility: "hidden",
      aiEnabled: false,
      stageNames: ["低落", "平静", "愉悦", "高涨"],
      bindingIds: [],
      order: 4
    })
  ],
  rules: [
    {
      id: "link_excite_affinity",
      sourceFieldId: "field_excite",
      operator: ">=",
      sourceThreshold: 70,
      targetFieldId: "field_affinity",
      effect: { kind: "multiplier", value: 1.25 },
      enabled: true
    }
  ],
  autoRules: [
    {
      id: "auto_user_care",
      name: "主动关心",
      description: "用户明确关心角色时提升信任与亲密。",
      enabled: true,
      condition: { kind: "userCare" },
      effects: [
        { fieldId: "field_affinity", delta: 2 },
        { fieldId: "field_trust", delta: 3 }
      ],
      cooldownMs: 21600000,
      order: 0
    }
  ],
  settings: {
    aiEnabled: true
  },
  stateValues: {
    "character:char_ayane": {
      field_affinity: 62,
      field_excite: 48,
      field_fatigue: 27
    },
    "chat:qa_chat": {
      field_trust: 63
    },
    global: {
      field_emotion: 12
    }
  },
  records: [
    {
      id: "rec_1",
      fieldId: "field_affinity",
      fieldName: "亲密度",
      scope: "character",
      scopeKey: "character:char_ayane",
      actorId: "char_ayane",
      actorName: "绫音",
      chatId: "qa_chat",
      groupId: null,
      before: 56,
      after: 62,
      delta: 6,
      requestedDelta: 6,
      effectiveRequestedDelta: 6,
      effectIds: [],
      ruleIds: ["auto_user_care"],
      stageBefore: "熟悉",
      stageAfter: "亲密",
      confidence: null,
      messageId: "qa_message_1",
      variantId: null,
      reason: "连续积极互动",
      source: "rule",
      occurredAt: Date.now() - 7200000
    },
    {
      id: "rec_2",
      fieldId: "field_excite",
      fieldName: "兴奋度",
      scope: "character",
      scopeKey: "character:char_ayane",
      actorId: "char_ayane",
      actorName: "绫音",
      chatId: "qa_chat",
      groupId: null,
      before: 45,
      after: 48,
      delta: 3,
      requestedDelta: 3,
      effectiveRequestedDelta: 3,
      effectIds: [],
      ruleIds: ["link_excite_affinity"],
      stageBefore: "高涨",
      stageAfter: "高涨",
      confidence: null,
      messageId: "qa_message_2",
      variantId: null,
      reason: "愉快话题影响",
      source: "rule",
      occurredAt: Date.now() - 10800000
    },
    {
      id: "rec_3",
      fieldId: "field_fatigue",
      fieldName: "疲劳",
      scope: "character",
      scopeKey: "character:char_ayane",
      actorId: "char_ayane",
      actorName: "绫音",
      chatId: "qa_chat",
      groupId: null,
      before: 29,
      after: 27,
      delta: -2,
      requestedDelta: -2,
      effectiveRequestedDelta: -2,
      effectIds: [],
      ruleIds: [],
      stageBefore: "轻度",
      stageAfter: "轻度",
      confidence: null,
      messageId: null,
      variantId: null,
      reason: "获得了短暂休息",
      source: "natural",
      occurredAt: Date.now() - 18000000
    },
    {
      id: "rec_4",
      fieldId: "field_trust",
      fieldName: "信任度",
      scope: "chat",
      scopeKey: "chat:qa_chat",
      actorId: "char_ayane",
      actorName: "绫音",
      chatId: "qa_chat",
      groupId: null,
      before: 62,
      after: 63,
      delta: 1,
      requestedDelta: 1,
      effectiveRequestedDelta: 1,
      effectIds: [],
      ruleIds: [],
      stageBefore: "信赖",
      stageAfter: "信赖",
      confidence: 0.82,
      messageId: "qa_message_4",
      variantId: null,
      reason: "对话中分享内心想法",
      source: "ai",
      occurredAt: Date.now() - 72000000
    }
  ],
  lastSettled: {},
  turnCounters: {},
  processedMessageIds: [],
  ruleLastTriggered: {},
  messageFacts: {},
  temporaryEffects: [
    {
      id: "effect_warm_dialogue",
      targetFieldId: "field_affinity",
      scope: "character",
      scopeKey: "character:char_ayane",
      mode: "multiplier",
      value: 1.2,
      enabled: true,
      expiresAt: Date.now() + 43200000,
      remainingTurns: null,
      reason: "重要约会后的情绪余温",
      source: "manual",
      createdAt: Date.now() - 3600000
    }
  ]
};

const qaSnapshot = {
  revision: 1,
  actors: qaActors,
  selectableActorIds: qaActors.filter(function (actor) {
    return actor.enabled;
  }).map(function (actor) {
    return actor.characterId;
  }),
  activeContext: {
    chatId: "qa_chat",
    actorId: "char_ayane",
    groupId: null,
    actorName: "绫音"
  },
  fields: [],
  rules: [],
  autoRules: [],
  temporaryEffects: [],
  records: [],
  settings: { aiEnabled: true }
};

function qaScopeKey(scope, context) {
  if (scope === "global") return "global";
  if (scope === "character") {
    if (context.actorId === null) throw new Error("QA_CHARACTER_CONTEXT_REQUIRED");
    return "character:" + context.actorId;
  }
  if (scope === "group") {
    if (context.groupId === null) throw new Error("QA_GROUP_CONTEXT_REQUIRED");
    return "group:" + context.groupId;
  }
  if (scope === "chat") {
    if (context.chatId === null) throw new Error("QA_CHAT_CONTEXT_REQUIRED");
    return "chat:" + context.chatId;
  }
  throw new Error("QA_SCOPE_INVALID:" + scope);
}

function qaFieldBound(field, context) {
  if (field.scope === "character") {
    return context.actorId !== null && field.bindingIds.includes(context.actorId);
  }
  if (field.scope === "group") return context.groupId !== null && field.bindingIds.includes(context.groupId);
  if (field.scope === "chat") return context.chatId !== null && field.bindingIds.includes(context.chatId);
  return field.scope === "global";
}

function qaStageFor(field, value) {
  const stages = field.stages.slice().sort(function (a, b) {
    return a.threshold - b.threshold;
  }).filter(function (stage) {
    return stage.threshold <= value;
  });
  return stages.length > 0 ? stages[stages.length - 1] : null;
}

function refreshQaSnapshot() {
  qaSnapshot.revision = qaDataset.revision;
  qaSnapshot.rules = qaDataset.rules;
  qaSnapshot.autoRules = qaDataset.autoRules;
  qaSnapshot.temporaryEffects = qaDataset.temporaryEffects;
  qaSnapshot.records = qaDataset.records;
  qaSnapshot.settings = qaDataset.settings;
  qaSnapshot.fields = qaDataset.fields.map(function (field) {
    const bound = qaFieldBound(field, qaSnapshot.activeContext);
    if (!bound) {
      return {
        definition: field,
        bound: false,
        scopeKey: null,
        currentValue: null,
        currentStage: null
      };
    }
    const scopeKey = qaScopeKey(field.scope, qaSnapshot.activeContext);
    const state = qaDataset.stateValues[scopeKey];
    const value = state && typeof state[field.id] === "number"
      ? state[field.id]
      : field.initialValue;
    return {
      definition: field,
      bound: true,
      scopeKey: scopeKey,
      currentValue: value,
      currentStage: qaStageFor(field, value)
    };
  });
}

function bumpRevision() {
  qaDataset.revision += 1;
  refreshQaSnapshot();
}

function qaActorName(context) {
  return context.actorName;
}

function qaSetValue(params, source) {
  const field = qaDataset.fields.find(function (item) {
    return item.id === params.fieldId;
  });
  if (!field) throw new Error("QA_FIELD_NOT_FOUND:" + params.fieldId);
  const scopeKey = qaScopeKey(field.scope, params.scopeContext);
  if (!qaDataset.stateValues[scopeKey]) {
    qaDataset.stateValues[scopeKey] = {};
  }
  const state = qaDataset.stateValues[scopeKey];
  const before = typeof state[field.id] === "number" ? state[field.id] : field.initialValue;
  const after = Math.max(field.minimum, Math.min(field.maximum, params.value));
  state[field.id] = after;
  qaDataset.records.push({
    id: nextQaId("record"),
    fieldId: field.id,
    fieldName: field.name,
    scope: field.scope,
    scopeKey: scopeKey,
    actorId: params.scopeContext.actorId,
    actorName: qaActorName(params.scopeContext),
    chatId: params.scopeContext.chatId,
    groupId: params.scopeContext.groupId,
    before: before,
    after: after,
    delta: after - before,
    requestedDelta: after - before,
    effectiveRequestedDelta: after - before,
    effectIds: [],
    ruleIds: [],
    stageBefore: qaStageFor(field, before).name,
    stageAfter: qaStageFor(field, after).name,
    confidence: source === "ai" ? 0.88 : null,
    messageId: null,
    variantId: null,
    reason: params.reason,
    source: source,
    occurredAt: Date.now()
  });
  bumpRevision();
}

function cloneQaValue(value) {
  return JSON.parse(JSON.stringify(value));
}

refreshQaSnapshot();

window.NativeMvu = {
  call: function (method, encodedParams, callbackId) {
    window.setTimeout(function () {
      try {
        const params = JSON.parse(encodedParams);
        let result = null;

        if (method === "snapshot") {
          if (Object.prototype.hasOwnProperty.call(params, "actorId")) {
            const selectedActor = qaActors.find(function (actor) {
              return actor.enabled && actor.characterId === params.actorId;
            });
            if (!selectedActor) throw new Error("QA_SELECTED_ACTOR_NOT_AVAILABLE");
            qaSnapshot.activeContext.actorId = selectedActor.characterId;
            qaSnapshot.activeContext.actorName = selectedActor.name;
          }
          refreshQaSnapshot();
          result = cloneQaValue(qaSnapshot);
        } else if (method === "setStateValue") {
          qaSetValue(params, "manual");
        } else if (method === "addField") {
          const field = Object.assign({}, cloneQaValue(params.field), {
            id: nextQaId("field"),
            order: qaDataset.fields.length
          });
          qaDataset.fields.push(field);
          bumpRevision();
          result = cloneQaValue(field);
        } else if (method === "updateField") {
          const field = qaDataset.fields.find(function (item) {
            return item.id === params.id;
          });
          if (!field) throw new Error("QA_FIELD_NOT_FOUND:" + params.id);
          Object.assign(field, cloneQaValue(params.patch));
          bumpRevision();
        } else if (method === "deleteField") {
          qaDataset.fields = qaDataset.fields.filter(function (item) {
            return item.id !== params.id;
          });
          qaDataset.rules = qaDataset.rules.filter(function (rule) {
            return rule.sourceFieldId !== params.id && rule.targetFieldId !== params.id;
          });
          qaDataset.autoRules.forEach(function (rule) {
            rule.effects = rule.effects.filter(function (effect) {
              return effect.fieldId !== params.id;
            });
          });
          qaDataset.temporaryEffects = qaDataset.temporaryEffects.filter(function (effect) {
            return effect.targetFieldId !== params.id;
          });
          bumpRevision();
        } else if (method === "settleNatural") {
          qaSnapshot.fields.filter(function (projection) {
            return projection.bound && projection.definition.naturalChange.enabled;
          }).forEach(function (projection) {
            const field = projection.definition;
            qaSetValue({
              scopeContext: params.scopeContext,
              fieldId: field.id,
              value: projection.currentValue + field.naturalChange.amount,
              reason: "自然时间结算"
            }, "natural");
          });
        } else if (method === "addLinkRule") {
          const rule = Object.assign({ id: nextQaId("link") }, cloneQaValue(params.rule));
          qaDataset.rules.push(rule);
          bumpRevision();
          result = cloneQaValue(rule);
        } else if (method === "updateLinkRule") {
          const rule = qaDataset.rules.find(function (item) { return item.id === params.id; });
          if (!rule) throw new Error("QA_LINK_RULE_NOT_FOUND:" + params.id);
          Object.assign(rule, cloneQaValue(params.patch));
          bumpRevision();
        } else if (method === "deleteLinkRule") {
          qaDataset.rules = qaDataset.rules.filter(function (item) {
            return item.id !== params.id;
          });
          bumpRevision();
        } else if (method === "addAutoRule") {
          const rule = Object.assign({ id: nextQaId("auto") }, cloneQaValue(params.rule));
          qaDataset.autoRules.push(rule);
          bumpRevision();
          result = cloneQaValue(rule);
        } else if (method === "updateAutoRule") {
          const rule = qaDataset.autoRules.find(function (item) { return item.id === params.id; });
          if (!rule) throw new Error("QA_AUTO_RULE_NOT_FOUND:" + params.id);
          Object.assign(rule, cloneQaValue(params.patch));
          bumpRevision();
        } else if (method === "deleteAutoRule") {
          qaDataset.autoRules = qaDataset.autoRules.filter(function (item) {
            return item.id !== params.id;
          });
          bumpRevision();
        } else if (method === "addTemporaryEffect") {
          const effect = Object.assign({ id: nextQaId("effect") }, cloneQaValue(params.effect));
          qaDataset.temporaryEffects.push(effect);
          bumpRevision();
          result = cloneQaValue(effect);
        } else if (method === "updateTemporaryEffect") {
          const effect = qaDataset.temporaryEffects.find(function (item) {
            return item.id === params.id;
          });
          if (!effect) throw new Error("QA_EFFECT_NOT_FOUND:" + params.id);
          Object.assign(effect, cloneQaValue(params.patch));
          bumpRevision();
        } else if (method === "deleteTemporaryEffect") {
          qaDataset.temporaryEffects = qaDataset.temporaryEffects.filter(function (item) {
            return item.id !== params.id;
          });
          bumpRevision();
        } else if (method === "updateSettings") {
          Object.assign(qaDataset.settings, cloneQaValue(params.patch));
          bumpRevision();
        } else if (method === "probeModel") {
          result = {
            available: true,
            provider: "QA Provider",
            model: "QA State Judge"
          };
        } else if (method === "judgeState") {
          const projection = qaSnapshot.fields.find(function (item) {
            return item.bound && item.definition.ai.enabled;
          });
          const changes = projection
            ? [{
                fieldId: projection.definition.id,
                delta: 2,
                reason: "QA 消息包含明确的积极互动",
                confidence: 0.88
              }]
            : [];
          if (params.commit && projection) {
            qaSetValue({
              scopeContext: params.scopeContext,
              fieldId: projection.definition.id,
              value: projection.currentValue + 2,
              reason: changes[0].reason
            }, "ai");
          }
          result = {
            available: true,
            applied: Boolean(params.commit && projection),
            changes: changes,
            raw: JSON.stringify({ message: params.message, changes: changes })
          };
        } else if (method === "exportDataset") {
          result = {
            fileName: "operit_mvu-qa-dataset.json",
            savedPath: "/sdcard/Download/Operit/exports/operit_mvu-qa-dataset.json"
          };
        } else if (method === "importDataset") {
          const imported = JSON.parse(params.json);
          if (!imported || imported.formatVersion !== 2) {
            throw new Error("QA_IMPORT_FORMAT_VERSION_REQUIRED:2");
          }
          qaDataset = cloneQaValue(imported);
          refreshQaSnapshot();
        } else {
          throw new Error("QA_METHOD_UNKNOWN:" + method);
        }

        window.__mvuResolve(callbackId, result);
      } catch (error) {
        console.error("MVU QA bridge call failed", error);
        window.__mvuReject(callbackId, error.message);
      }
    }, 120);
  }
};
