(function () {
  "use strict";

  const queryState = new URLSearchParams(window.location.search);
  const ROUTES = {
    status: { title: "动态状态", root: true, header: "menu", owner: "status", page: "status" },
    "field-detail": { title: "状态详情", root: false, header: "back", owner: "status", page: "fieldDetail" },
    records: { title: "变化记录", root: false, header: "back", owner: "status", page: "records" },
    config: { title: "配置", root: true, header: "menu", owner: "config", page: "config" },
    "config-fields": { title: "字段设置", root: false, header: "back", owner: "config", page: "fields" },
    "field-editor": { title: "编辑字段", root: false, header: "back", owner: "config", page: "fieldEditor" },
    "natural-settings": { title: "自然变化", root: false, header: "back", owner: "config", page: "naturalSettings" },
    "turn-settings": { title: "每轮变化", root: false, header: "back", owner: "config", page: "turnSettings" },
    "link-settings": { title: "状态联动", root: false, header: "back", owner: "config", page: "linkSettings" },
    rules: { title: "规则", root: true, header: "menu", owner: "rules", page: "rules" },
    "rule-library": { title: "规则设置", root: false, header: "back", owner: "rules", page: "ruleLibrary" },
    "rule-editor": { title: "编辑规则", root: false, header: "back", owner: "rules", page: "ruleEditor" },
    "condition-library": { title: "条件库", root: false, header: "back", owner: "rules", page: "conditionLibrary" },
    "condition-editor": { title: "编辑条件", root: false, header: "back", owner: "rules", page: "conditionEditor" },
    "effect-library": { title: "临时效果", root: false, header: "back", owner: "rules", page: "effectLibrary" },
    "effect-editor": { title: "编辑临时效果", root: false, header: "back", owner: "rules", page: "effectEditor" },
    advanced: { title: "高级", root: true, header: "menu", owner: "advanced", page: "advanced" },
  };
  const LIST_POLICIES = {
    "config-fields": { key: "fields", method: "queryFields", pageSize: 5, sort: { key: "order", direction: "asc" } },
    "rule-library": { key: "rules", method: "queryRules", pageSize: 5, sort: { key: "executionOrder", direction: "asc" } },
    "condition-library": { key: "conditions", method: "queryConditions", pageSize: 10, sort: { key: "name", direction: "asc" } },
    "effect-library": { key: "effectGroups", method: "queryEffectGroups", pageSize: 10, sort: { key: "name", direction: "asc" } },
    records: { key: "records", method: "queryRecords", pageSize: 10, sort: { key: "occurredAt", direction: "desc" } },
  };
  const PICKER_SEARCH_DEBOUNCE_MS = 180;
  const PICKER_RESULT_LIMIT = 60;
  const PICKER_ENTITIES = {
    fields: { method: "queryFields", label: "fields", idKey: "id", entityType: "field", cursor: true, filters: { mode: "picker" } },
    actors: { method: "queryActors", label: "actors", idKey: "characterId", entityType: "actor", cursor: true },
    groups: { method: "queryGroups", label: "groups", idKey: "characterGroupId", entityType: "group", cursor: true },
    rules: { method: "queryRules", label: "rules", idKey: "id", entityType: "rule", cursor: false },
    conditions: { method: "queryConditions", label: "conditions", idKey: "id", entityType: "condition", cursor: false },
    effectGroups: { method: "queryEffectGroups", label: "effectGroups", idKey: "id", entityType: "effectGroup", cursor: false },
  };

  const requestedRoute = queryState.get("route") || queryState.get("screen") || "status";
  const initialRoute = ROUTES[requestedRoute] ? requestedRoute : "status";
  const state = {
    route: initialRoute,
    snapshot: null,
    pages: {},
    directory: { actors: [], groups: [] },
    entities: new Map(),
    bindingLabels: new Map(),
    ruleLabels: new Map(),
    chartModels: new Map(),
    detailRecords: null,
    listViews: {
      fields: { page: 1, search: "", filters: {}, sort: LIST_POLICIES["config-fields"].sort },
      rules: { page: 1, search: "", filters: {}, sort: LIST_POLICIES["rule-library"].sort },
      conditions: { page: 1, search: "", filters: {}, sort: LIST_POLICIES["condition-library"].sort },
      effectGroups: { page: 1, search: "", filters: {}, sort: LIST_POLICIES["effect-library"].sort },
      records: { page: 1, search: "", filters: {}, sort: LIST_POLICIES.records.sort },
    },
    entityPicker: null,
    editorSelections: {},
    statusMode: "character",
    selectedFieldId: queryState.get("field") || "",
    selectedEntityId: "",
    effectReasonMode: "template",
    drawerOpen: false,
    busy: false,
    fatal: null,
    routeError: null,
    lastActorId: "",
    routeTrail: [initialRoute],
    demo: queryState.get("demo") === "1",
    demoPickerControls: {
      slowSearch: queryState.get("demoPickerSlowSearch") || "",
      slowMs: demoControlDelay("demoPickerSlowMs"),
      failSearch: queryState.get("demoPickerFailSearch") || "",
    },
  };

  const native = createNativeBridge();
  window.MvuUi = {
    state,
    native,
    components: {},
    pages: {},
    routes: ROUTES,
    navigate,
    goBack,
    render: null,
    transition,
    loadSnapshot,
    loadRouteData,
    loadDirectory,
    query,
    openEntityPicker,
    closeEntityPicker,
    searchEntityPicker,
    retryEntityPicker,
    fetchNextEntityPickerPage,
    toggleEntityPickerSelection,
    confirmEntityPicker,
    updateListView,
    getEntity,
    validateCompactSnapshot,
    validateQueryResponse,
    escapeHtml,
    formatNumber,
    formatTime,
    rootForRoute,
    showFatal,
  };

  function createNativeBridge() {
    const pending = new Map();
    let sequence = 0;
    window.__mvuResolve = function (callbackId, value) {
      const request = pending.get(callbackId);
      if (!request) return;
      window.clearTimeout(request.timer);
      pending.delete(callbackId);
      request.resolve(value);
    };
    window.__mvuReject = function (callbackId, message) {
      const request = pending.get(callbackId);
      if (!request) return;
      window.clearTimeout(request.timer);
      pending.delete(callbackId);
      request.reject(new Error(String(message || "MVU_NATIVE_CALL_REJECTED")));
    };
    return {
      call(method, params) {
        if (state.demo) return demoCall(method, params || {});
        if (!window.NativeMvu || typeof window.NativeMvu.call !== "function") {
          return Promise.reject(new Error("MVU_NATIVE_BRIDGE_UNAVAILABLE"));
        }
        sequence += 1;
        const callbackId = sequence;
        return new Promise(function (resolve, reject) {
          const timer = window.setTimeout(function () {
            pending.delete(callbackId);
            reject(new Error("MVU_NATIVE_CALL_TIMEOUT:" + method));
          }, method === "judgeState" ? 180000 : 20000);
          pending.set(callbackId, { resolve, reject, timer });
          try {
            window.NativeMvu.call(method, JSON.stringify(params || {}), callbackId);
          } catch (error) {
            window.clearTimeout(timer);
            pending.delete(callbackId);
            reject(error);
          }
        });
      },
    };
  }

  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function finiteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function nonNegativeInteger(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }

  function requireString(value, code, nullable) {
    if (nullable && value === null) return;
    if (typeof value !== "string") throw new Error(code);
  }

  function requireStringArray(value, code, allowEmpty) {
    if (!Array.isArray(value) || (!allowEmpty && value.length === 0) ||
        !value.every(function (entry) { return typeof entry === "string" && entry.length > 0; })) {
      throw new Error(code);
    }
  }

  function requireFinite(value, code) {
    if (!finiteNumber(value)) throw new Error(code);
  }

  function validateQueryResponse(value, label) {
    const code = "MVU_QUERY_RESPONSE_INVALID:" + label;
    if (!isRecord(value) || !Array.isArray(value.items)) throw new Error(code);
    if (!nonNegativeInteger(value.loadedCount) || value.loadedCount !== value.items.length) throw new Error(code);
    if (!nonNegativeInteger(value.totalCount) || value.totalCount < value.loadedCount) throw new Error(code);
    if (typeof value.hasMore !== "boolean") throw new Error(code);
    if (value.nextCursor !== null && typeof value.nextCursor !== "string") throw new Error(code);
    if (value.hasMore && value.loadedCount >= value.totalCount) throw new Error(code);
    const validator = queryItemValidator(label);
    if (validator) value.items.forEach(validator);
    return value;
  }

  function queryItemValidator(label) {
    const key = String(label || "").replace(/^query/, "").toLocaleLowerCase();
    if (key === "fields") return validateFieldEntity;
    if (key === "actors") return validateActor;
    if (key === "groups") return validateGroup;
    if (key === "rules") return validateRule;
    if (key === "conditions") return validateCondition;
    if (key === "effectgroups" || key === "effects") return validateEffectGroup;
    if (key === "records") return validateRecord;
    return null;
  }

  function requireBoolean(value, code) {
    if (typeof value !== "boolean") throw new Error(code);
  }

  function validateIdentity(item, idKey, code) {
    if (!isRecord(item)) throw new Error(code);
    requireString(item[idKey], code);
    requireString(item.name, code);
    if (item[idKey].length === 0) throw new Error(code);
  }

  function validateActor(actor) {
    validateIdentity(actor, "characterId", "MVU_ACTOR_INVALID");
    requireBoolean(actor.enabled, "MVU_ACTOR_INVALID");
    if (actor.avatarUri !== undefined && actor.avatarUri !== null) requireString(actor.avatarUri, "MVU_ACTOR_INVALID");
    if ("avatarUriUnavailable" in actor) requireBoolean(actor.avatarUriUnavailable, "MVU_ACTOR_INVALID");
    if ("truncated" in actor) requireBoolean(actor.truncated, "MVU_ACTOR_INVALID");
  }

  function validateGroup(group) {
    validateIdentity(group, "characterGroupId", "MVU_GROUP_INVALID");
    if (group.avatarUri !== undefined && group.avatarUri !== null) requireString(group.avatarUri, "MVU_GROUP_INVALID");
    if ("avatarUriUnavailable" in group) requireBoolean(group.avatarUriUnavailable, "MVU_GROUP_INVALID");
    if ("truncated" in group) requireBoolean(group.truncated, "MVU_GROUP_INVALID");
  }

  function validateFieldEntity(field) {
    if (isRecord(field.range)) return validateFieldSummary(field);
    validateIdentity(field, "id", "MVU_FIELD_INVALID");
    requireString(field.description, "MVU_FIELD_INVALID");
    if (!finiteNumber(field.minimum) || !finiteNumber(field.maximum) || field.minimum >= field.maximum ||
        !finiteNumber(field.step) || field.step <= 0 || !finiteNumber(field.initialValue) ||
        field.initialValue < field.minimum || field.initialValue > field.maximum ||
        !finiteNumber(field.order) || !Array.isArray(field.stages) || field.stages.length === 0) {
      throw new Error("MVU_FIELD_INVALID");
    }
    requireString(field.icon, "MVU_FIELD_INVALID");
    requireString(field.themeColor, "MVU_FIELD_INVALID");
    requireBoolean(field.enabled, "MVU_FIELD_INVALID");
    if (!["character", "group", "global", "chat"].includes(field.scope) ||
        !["full", "stage_only", "hidden"].includes(field.modelVisibility)) throw new Error("MVU_FIELD_INVALID");
    requireStringArray(field.bindingIds, "MVU_FIELD_INVALID", true);
    let previousThreshold = Number.NEGATIVE_INFINITY;
    field.stages.forEach(function (stage) {
      if (!isRecord(stage)) throw new Error("MVU_FIELD_STAGE_INVALID");
      requireString(stage.id, "MVU_FIELD_STAGE_INVALID");
      requireString(stage.name, "MVU_FIELD_STAGE_INVALID");
      requireString(stage.description, "MVU_FIELD_STAGE_INVALID");
      requireFinite(stage.threshold, "MVU_FIELD_STAGE_INVALID");
      if (stage.threshold <= previousThreshold || stage.threshold < field.minimum || stage.threshold > field.maximum) {
        throw new Error("MVU_FIELD_STAGE_INVALID");
      }
      previousThreshold = stage.threshold;
    });
    if (!isRecord(field.ai) || !isRecord(field.naturalChange) || !isRecord(field.perTurnChange)) {
      throw new Error("MVU_FIELD_INVALID");
    }
    requireBoolean(field.ai.enabled, "MVU_FIELD_INVALID");
    requireFinite(field.ai.minConfidence, "MVU_FIELD_INVALID");
    requireFinite(field.ai.maxDelta, "MVU_FIELD_INVALID");
    if (field.ai.minConfidence < 0 || field.ai.minConfidence > 1 || field.ai.maxDelta < 0) throw new Error("MVU_FIELD_INVALID");
    requireString(field.ai.prompt, "MVU_FIELD_INVALID");
    requireBoolean(field.naturalChange.enabled, "MVU_FIELD_INVALID");
    requireFinite(field.naturalChange.unitMs, "MVU_FIELD_INVALID");
    requireFinite(field.naturalChange.amount, "MVU_FIELD_INVALID");
    requireBoolean(field.perTurnChange.enabled, "MVU_FIELD_INVALID");
    requireFinite(field.perTurnChange.intervalTurns, "MVU_FIELD_INVALID");
    requireFinite(field.perTurnChange.amount, "MVU_FIELD_INVALID");
    if (!["user", "character", "both"].includes(field.perTurnChange.countMode)) throw new Error("MVU_FIELD_INVALID");
  }

  function validateRule(rule) {
    validateIdentity(rule, "id", "MVU_RULE_INVALID");
    requireString(rule.description, "MVU_RULE_INVALID");
    requireBoolean(rule.enabled, "MVU_RULE_INVALID");
    requireString(rule.conditionId, "MVU_RULE_INVALID");
    if ("actionCount" in rule) {
      if (!nonNegativeInteger(rule.actionCount) || !Number.isSafeInteger(rule.executionOrder)) throw new Error("MVU_RULE_INVALID");
      requireString(rule.updatedAt, "MVU_RULE_INVALID");
      requireBoolean(rule.truncated, "MVU_RULE_INVALID");
      return;
    }
    validateRuleActorSelector(rule.triggerActorSelector);
    if (!Array.isArray(rule.actions) || rule.actions.length === 0 || !finiteNumber(rule.cooldownHours) ||
        rule.cooldownHours < 0 || !Number.isSafeInteger(rule.executionOrder)) throw new Error("MVU_RULE_INVALID");
    requireString(rule.createdAt, "MVU_RULE_INVALID");
    requireString(rule.updatedAt, "MVU_RULE_INVALID");
    rule.actions.forEach(validateRuleAction);
  }

  function validateRuleActorSelector(selector) {
    if (!isRecord(selector)) throw new Error("MVU_RULE_ACTOR_SELECTOR_INVALID");
    if (selector.kind === "any" || selector.kind === "current_actor") return;
    if (selector.kind === "selected") return requireStringArray(selector.actorIds, "MVU_RULE_ACTOR_SELECTOR_INVALID", false);
    if (selector.kind === "group") return requireStringArray(selector.groupIds, "MVU_RULE_ACTOR_SELECTOR_INVALID", false);
    throw new Error("MVU_RULE_ACTOR_SELECTOR_INVALID");
  }

  function validateRuleTargetSelector(selector) {
    if (!isRecord(selector)) throw new Error("MVU_RULE_TARGET_SELECTOR_INVALID");
    if (selector.kind === "trigger_actor" || selector.kind === "all_bound") return;
    if (selector.kind === "selected") return requireStringArray(selector.actorIds, "MVU_RULE_TARGET_SELECTOR_INVALID", false);
    throw new Error("MVU_RULE_TARGET_SELECTOR_INVALID");
  }

  function validateRuleAction(action) {
    if (!isRecord(action)) throw new Error("MVU_RULE_ACTION_INVALID");
    if (action.kind === "activate_effect_group") {
      requireString(action.effectGroupId, "MVU_RULE_ACTION_INVALID");
      return;
    }
    if (action.kind !== "change_field") throw new Error("MVU_RULE_ACTION_INVALID");
    requireString(action.fieldId, "MVU_RULE_ACTION_INVALID");
    requireFinite(action.delta, "MVU_RULE_ACTION_INVALID");
    requireStringArray(action.effectGroupIds, "MVU_RULE_ACTION_INVALID", true);
    validateRuleTargetSelector(action.target);
  }

  function validateCondition(condition) {
    validateIdentity(condition, "id", "MVU_CONDITION_INVALID");
    requireString(condition.description, "MVU_CONDITION_INVALID");
    requireBoolean(condition.enabled, "MVU_CONDITION_INVALID");
    if ("rootKind" in condition) {
      if (!["and", "or", "not", "predicate"].includes(condition.rootKind)) throw new Error("MVU_CONDITION_INVALID");
      requireString(condition.updatedAt, "MVU_CONDITION_INVALID");
      requireBoolean(condition.truncated, "MVU_CONDITION_INVALID");
      return;
    }
    requireString(condition.createdAt, "MVU_CONDITION_INVALID");
    requireString(condition.updatedAt, "MVU_CONDITION_INVALID");
    validateConditionExpression(condition.expression, 0);
  }

  function validateConditionExpression(expression, depth) {
    if (!isRecord(expression) || depth > 12) throw new Error(depth > 12 ? "MVU_CONDITION_DEPTH_INVALID" : "MVU_CONDITION_EXPRESSION_INVALID");
    if (expression.kind === "predicate") return validateConditionPredicate(expression.predicate);
    if (expression.kind === "not") return validateConditionExpression(expression.child, depth + 1);
    if (expression.kind === "and" || expression.kind === "or") {
      if (!Array.isArray(expression.children) || expression.children.length === 0) throw new Error("MVU_CONDITION_EXPRESSION_INVALID");
      expression.children.forEach(function (child) { validateConditionExpression(child, depth + 1); });
      return;
    }
    throw new Error("MVU_CONDITION_EXPRESSION_INVALID");
  }

  function validateConditionPredicate(predicate) {
    if (!isRecord(predicate)) throw new Error("MVU_CONDITION_PREDICATE_INVALID");
    const kind = predicate.kind;
    if (kind === "user_care" || kind === "special_day") return;
    if (kind === "recent_positive") {
      requireFinite(predicate.count, "MVU_CONDITION_PREDICATE_INVALID");
      if (predicate.count < 0) throw new Error("MVU_CONDITION_PREDICATE_INVALID");
      return;
    }
    if (kind === "long_inactive") {
      requireFinite(predicate.hours, "MVU_CONDITION_PREDICATE_INVALID");
      if (predicate.hours < 0) throw new Error("MVU_CONDITION_PREDICATE_INVALID");
      return;
    }
    if (kind === "high_frequency") {
      requireFinite(predicate.messages, "MVU_CONDITION_PREDICATE_INVALID");
      if (predicate.windowHours !== undefined) requireFinite(predicate.windowHours, "MVU_CONDITION_PREDICATE_INVALID");
      if (predicate.bucketHours !== undefined) requireFinite(predicate.bucketHours, "MVU_CONDITION_PREDICATE_INVALID");
      if (predicate.messages < 0 || (predicate.windowHours !== undefined && predicate.windowHours < 0) ||
          (predicate.bucketHours !== undefined && predicate.bucketHours <= 0)) throw new Error("MVU_CONDITION_PREDICATE_INVALID");
      return;
    }
    if (kind === "field_comparison") {
      requireString(predicate.fieldId, "MVU_CONDITION_PREDICATE_INVALID");
      requireFinite(predicate.value, "MVU_CONDITION_PREDICATE_INVALID");
      if (![">=", "<=", ">", "<", "=="].includes(predicate.operator)) throw new Error("MVU_CONDITION_PREDICATE_INVALID");
      return;
    }
    if (kind === "message_count") {
      requireFinite(predicate.count, "MVU_CONDITION_PREDICATE_INVALID");
      requireFinite(predicate.windowHours, "MVU_CONDITION_PREDICATE_INVALID");
      if (predicate.count < 0 || predicate.windowHours < 0) throw new Error("MVU_CONDITION_PREDICATE_INVALID");
      if (predicate.sender !== undefined && !["user", "character"].includes(predicate.sender)) throw new Error("MVU_CONDITION_PREDICATE_INVALID");
      return;
    }
    if (kind === "keywords") {
      requireStringArray(predicate.includeAny, "MVU_CONDITION_PREDICATE_INVALID", true);
      requireStringArray(predicate.includeAll, "MVU_CONDITION_PREDICATE_INVALID", true);
      requireStringArray(predicate.exclude, "MVU_CONDITION_PREDICATE_INVALID", true);
      if (predicate.windowHours !== undefined) requireFinite(predicate.windowHours, "MVU_CONDITION_PREDICATE_INVALID");
      if (predicate.caseSensitive !== undefined) requireBoolean(predicate.caseSensitive, "MVU_CONDITION_PREDICATE_INVALID");
      return;
    }
    if (kind === "sender") {
      if (!Array.isArray(predicate.senders) || predicate.senders.length === 0 ||
          !predicate.senders.every(function (sender) { return sender === "user" || sender === "character"; })) {
        throw new Error("MVU_CONDITION_PREDICATE_INVALID");
      }
      return;
    }
    if (kind === "actor") return requireStringArray(predicate.actorIds, "MVU_CONDITION_PREDICATE_INVALID", false);
    if (kind === "group") return requireStringArray(predicate.groupIds, "MVU_CONDITION_PREDICATE_INVALID", false);
    if (kind === "concrete_date") return requireStringArray(predicate.dates, "MVU_CONDITION_PREDICATE_INVALID", false);
    if (kind === "repeating_date") {
      if (!Number.isInteger(predicate.month) || predicate.month < 1 || predicate.month > 12 ||
          !Number.isInteger(predicate.day) || predicate.day < 1 || predicate.day > 31) throw new Error("MVU_CONDITION_PREDICATE_INVALID");
      return;
    }
    if (kind === "ai_semantic") {
      requireString(predicate.id, "MVU_CONDITION_PREDICATE_INVALID");
      requireString(predicate.triggerType, "MVU_CONDITION_PREDICATE_INVALID");
      requireString(predicate.requirement, "MVU_CONDITION_PREDICATE_INVALID");
      requireFinite(predicate.minimumConfidence, "MVU_CONDITION_PREDICATE_INVALID");
      if (predicate.minimumConfidence < 0 || predicate.minimumConfidence > 1) throw new Error("MVU_CONDITION_PREDICATE_INVALID");
      return;
    }
    throw new Error("MVU_CONDITION_PREDICATE_INVALID");
  }

  function validateEffectGroup(effect) {
    validateIdentity(effect, "id", "MVU_EFFECT_GROUP_INVALID");
    requireString(effect.description, "MVU_EFFECT_GROUP_INVALID");
    requireBoolean(effect.enabled, "MVU_EFFECT_GROUP_INVALID");
    if ("fieldCount" in effect) {
      if (!nonNegativeInteger(effect.fieldCount)) throw new Error("MVU_EFFECT_GROUP_INVALID");
      requireString(effect.updatedAt, "MVU_EFFECT_GROUP_INVALID");
      requireBoolean(effect.truncated, "MVU_EFFECT_GROUP_INVALID");
      return;
    }
    if (!Array.isArray(effect.fieldEffects) || effect.fieldEffects.length === 0) throw new Error("MVU_EFFECT_GROUP_INVALID");
    requireString(effect.createdAt, "MVU_EFFECT_GROUP_INVALID");
    requireString(effect.updatedAt, "MVU_EFFECT_GROUP_INVALID");
    if (effect.defaultDuration !== undefined) validateEffectDuration(effect.defaultDuration);
    effect.fieldEffects.forEach(validateFieldEffect);
  }

  function validateEffectDuration(duration) {
    if (!isRecord(duration) || !(duration.expiresAt === null || typeof duration.expiresAt === "string") ||
        !(duration.remainingTurns === null || nonNegativeInteger(duration.remainingTurns))) {
      throw new Error("MVU_EFFECT_DURATION_INVALID");
    }
  }

  function validateEffectActorSelector(selector) {
    if (!isRecord(selector)) throw new Error("MVU_EFFECT_ACTOR_SELECTOR_INVALID");
    if (selector.kind === "all_bound" || selector.kind === "trigger_actor") return;
    if (selector.kind === "selected") return requireStringArray(selector.actorIds, "MVU_EFFECT_ACTOR_SELECTOR_INVALID", false);
    throw new Error("MVU_EFFECT_ACTOR_SELECTOR_INVALID");
  }

  function validateFieldEffect(fieldEffect) {
    if (!isRecord(fieldEffect) || !Array.isArray(fieldEffect.operations) || fieldEffect.operations.length === 0) {
      throw new Error("MVU_FIELD_EFFECT_INVALID");
    }
    requireString(fieldEffect.id, "MVU_FIELD_EFFECT_INVALID");
    requireString(fieldEffect.fieldId, "MVU_FIELD_EFFECT_INVALID");
    validateEffectActorSelector(fieldEffect.actorSelector);
    fieldEffect.operations.forEach(function (operation) {
      if (!isRecord(operation)) throw new Error("MVU_EFFECT_OPERATION_INVALID");
      requireFinite(operation.value, "MVU_EFFECT_OPERATION_INVALID");
      if (operation.kind === "immediate_delta") return;
      if (!["fixed_adjustment", "positive_multiplier", "negative_multiplier", "all_multiplier"].includes(operation.kind)) {
        throw new Error("MVU_EFFECT_OPERATION_INVALID");
      }
      requireStringArray(operation.sources, "MVU_EFFECT_OPERATION_INVALID", false);
      if (!operation.sources.every(function (source) { return ["manual", "natural", "per_turn", "rule", "ai"].includes(source); })) {
        throw new Error("MVU_EFFECT_OPERATION_INVALID");
      }
    });
  }

  function validateRecord(record) {
    if (!isRecord(record)) throw new Error("MVU_RECORD_INVALID");
    requireString(record.id, "MVU_RECORD_INVALID");
    requireString(record.fieldId, "MVU_RECORD_INVALID");
    requireString(record.fieldName, "MVU_RECORD_INVALID");
    if (record.actorId !== null) requireString(record.actorId, "MVU_RECORD_INVALID");
    requireString(record.actorName, "MVU_RECORD_INVALID");
    if (record.groupId !== null) requireString(record.groupId, "MVU_RECORD_INVALID");
    if (!finiteNumber(record.before) || !finiteNumber(record.after) || !finiteNumber(record.delta) ||
        !finiteNumber(record.occurredAt)) throw new Error("MVU_RECORD_INVALID");
    requireString(record.reason, "MVU_RECORD_INVALID");
    if (!["manual", "natural", "per_turn", "rule", "ai"].includes(record.source)) throw new Error("MVU_RECORD_INVALID");
    if ("truncated" in record) {
      requireBoolean(record.truncated, "MVU_RECORD_INVALID");
      return;
    }
    if (!["character", "group", "global", "chat"].includes(record.scope)) throw new Error("MVU_RECORD_INVALID");
    requireString(record.scopeKey, "MVU_RECORD_INVALID");
    if (record.chatId !== null) requireString(record.chatId, "MVU_RECORD_INVALID");
    requireFinite(record.requestedDelta, "MVU_RECORD_INVALID");
    requireFinite(record.effectiveRequestedDelta, "MVU_RECORD_INVALID");
    requireString(record.stageBefore, "MVU_RECORD_INVALID");
    requireString(record.stageAfter, "MVU_RECORD_INVALID");
    requireStringArray(record.ruleIds, "MVU_RECORD_INVALID", true);
    requireStringArray(record.effectIds, "MVU_RECORD_INVALID", true);
    if (record.confidence !== null) requireFinite(record.confidence, "MVU_RECORD_INVALID");
    if (record.messageId !== null) requireString(record.messageId, "MVU_RECORD_INVALID");
    if (record.variantId !== null) requireString(record.variantId, "MVU_RECORD_INVALID");
  }

  function validateFieldSummary(field) {
    if (!isRecord(field)) throw new Error("MVU_FIELD_SUMMARY_INVALID");
    requireString(field.id, "MVU_FIELD_SUMMARY_ID_INVALID");
    requireString(field.name, "MVU_FIELD_SUMMARY_NAME_INVALID");
    requireString(field.description, "MVU_FIELD_SUMMARY_INVALID");
    requireBoolean(field.enabled, "MVU_FIELD_SUMMARY_INVALID");
    if (!["character", "group", "global", "chat"].includes(field.scope) || !finiteNumber(field.order)) {
      throw new Error("MVU_FIELD_SUMMARY_INVALID");
    }
    if (!isRecord(field.range) || !finiteNumber(field.range.minimum) ||
        !finiteNumber(field.range.maximum) || field.range.minimum >= field.range.maximum ||
        !finiteNumber(field.range.step) || field.range.step <= 0) {
      throw new Error("MVU_FIELD_SUMMARY_RANGE_INVALID");
    }
    if (!isRecord(field.theme)) throw new Error("MVU_FIELD_SUMMARY_THEME_INVALID");
    requireString(field.theme.icon, "MVU_FIELD_SUMMARY_ICON_INVALID");
    requireString(field.theme.color, "MVU_FIELD_SUMMARY_COLOR_INVALID");
    if (field.current !== null) {
      if (!isRecord(field.current) || !finiteNumber(field.current.value) || !isRecord(field.current.stage)) {
        throw new Error("MVU_FIELD_CURRENT_PROJECTION_INVALID");
      }
      requireString(field.current.stage.id, "MVU_FIELD_STAGE_INVALID");
      requireString(field.current.stage.name, "MVU_FIELD_STAGE_INVALID");
      requireFinite(field.current.stage.threshold, "MVU_FIELD_STAGE_INVALID");
      requireString(field.current.scopeKey, "MVU_FIELD_CURRENT_PROJECTION_INVALID");
      requireString(field.current.actorId, "MVU_FIELD_CURRENT_PROJECTION_INVALID", true);
      requireString(field.current.groupId, "MVU_FIELD_CURRENT_PROJECTION_INVALID", true);
      requireString(field.current.chatId, "MVU_FIELD_CURRENT_PROJECTION_INVALID", true);
    }
    requireBoolean(field.truncated, "MVU_FIELD_SUMMARY_INVALID");
  }

  function validateCompactSnapshot(snapshot) {
    if (!isRecord(snapshot) || !nonNegativeInteger(snapshot.revision)) {
      throw new Error("MVU_PAGE_SNAPSHOT_INVALID");
    }
    if (!isRecord(snapshot.activeContext) || !isRecord(snapshot.counts) ||
        !isRecord(snapshot.selected) || !isRecord(snapshot.contextLabels) ||
        !isRecord(snapshot.pages) || !isRecord(snapshot.settings) ||
        !isRecord(snapshot.migrationStatus)) {
      throw new Error("MVU_PAGE_SNAPSHOT_SHAPE_INVALID");
    }
    requireString(snapshot.activeContext.chatId, "MVU_CONTEXT_CHAT_INVALID", true);
    requireString(snapshot.activeContext.actorId, "MVU_CONTEXT_ACTOR_INVALID", true);
    requireString(snapshot.activeContext.groupId, "MVU_CONTEXT_GROUP_INVALID", true);
    requireString(snapshot.activeContext.actorName, "MVU_CONTEXT_ACTOR_NAME_INVALID");
    requireBoolean(snapshot.activeContext.truncated, "MVU_CONTEXT_TRUNCATION_INVALID");
    requireString(snapshot.contextLabels.groupName, "MVU_CONTEXT_LABEL_INVALID", true);
    requireString(snapshot.contextLabels.chatName, "MVU_CONTEXT_LABEL_INVALID");
    requireBoolean(snapshot.contextLabels.truncated, "MVU_CONTEXT_LABEL_INVALID");
    requireBoolean(snapshot.settings.aiEnabled, "MVU_SETTINGS_INVALID");
    validateMigrationStatus(snapshot.migrationStatus);
    ["fields", "actors", "groups", "rules", "conditions", "effectGroups", "records"].forEach(function (key) {
      if (!nonNegativeInteger(snapshot.counts[key])) throw new Error("MVU_PAGE_COUNT_INVALID:" + key);
    });
    const pageKeys = ["fields", "rules", "conditions", "effectGroups", "records"];
    pageKeys.forEach(function (key) { validateQueryResponse(snapshot.pages[key], key); });
    if (snapshot.selected.actor !== null) validateActor(snapshot.selected.actor);
    if (snapshot.selected.group !== null) validateGroup(snapshot.selected.group);
    requireBoolean(snapshot.snapshotTruncated, "MVU_PAGE_SNAPSHOT_TRUNCATION_INVALID");
    pageKeys.forEach(function (key) {
      if (!nonNegativeInteger(snapshot.returnedCount[key])) throw new Error("MVU_PAGE_RETURNED_COUNT_INVALID:" + key);
    });
    return snapshot;
  }

  function validateMigrationStatus(status) {
    if (!isRecord(status)) throw new Error("MVU_MIGRATION_STATUS_INVALID");
    requireBoolean(status.truncated, "MVU_MIGRATION_STATUS_INVALID");
    if (status.mode === "v2_compat") {
      if (!isRecord(status.error)) throw new Error("MVU_MIGRATION_STATUS_INVALID");
      requireString(status.error.code, "MVU_MIGRATION_STATUS_INVALID");
      requireString(status.error.message, "MVU_MIGRATION_STATUS_INVALID");
      return;
    }
    if (status.mode !== "v3" || !["existing", "migrated", "initialized"].includes(status.source)) {
      throw new Error("MVU_MIGRATION_STATUS_INVALID");
    }
    ["cleanup", "indexing"].forEach(function (key) {
      if (status[key] === undefined) return;
      if (!isRecord(status[key]) || status[key].state !== "pending" || !isRecord(status[key].error)) {
        throw new Error("MVU_MIGRATION_STATUS_INVALID");
      }
      requireString(status[key].error.code, "MVU_MIGRATION_STATUS_INVALID");
      requireString(status[key].error.message, "MVU_MIGRATION_STATUS_INVALID");
    });
  }

  async function loadSnapshot(request) {
    const snapshot = validateCompactSnapshot(await native.call("snapshot", request || {}));
    const previousRevision = state.snapshot === null ? null : state.snapshot.revision;
    if (previousRevision !== null && previousRevision !== snapshot.revision) state.entities.clear();
    state.snapshot = snapshot;
    state.pages = {
      fields: snapshot.pages.fields,
      rules: snapshot.pages.rules,
      conditions: snapshot.pages.conditions,
      effectGroups: snapshot.pages.effectGroups,
      records: snapshot.pages.records,
    };
    if (snapshot.activeContext.actorId) state.lastActorId = snapshot.activeContext.actorId;
    if (!snapshot.activeContext.groupId) state.statusMode = "character";
    state.fatal = null;
    return snapshot;
  }

  async function query(method, request, label) {
    try {
      return validateQueryResponse(await native.call(method, request || {}), label || method);
    } catch (error) {
      const wrapped = new Error("页面数据有误，请重试");
      wrapped.cause = error;
      throw wrapped;
    }
  }

  async function openEntityPicker(config) {
    const options = config || {};
    const definition = PICKER_ENTITIES[options.entity];
    if (!definition) throw new Error("MVU_PICKER_ENTITY_INVALID");
    if (options.mode !== undefined && options.mode !== "single" && options.mode !== "multiple") {
      throw new Error("MVU_PICKER_MODE_INVALID");
    }
    const selectedIds = new Set(Array.isArray(options.selectedIds) ? options.selectedIds : []);
    const selectedItems = new Map();
    (Array.isArray(options.selectedItems) ? options.selectedItems : []).forEach(function (item) {
      const id = item && item[definition.idKey];
      if (typeof id === "string" && selectedIds.has(id)) selectedItems.set(id, item);
    });
    const opener = options.opener && typeof options.opener === "object"
      ? options.opener
      : document.activeElement || null;
    state.entityPicker = {
      entity: options.entity,
      definition,
      title: options.title || "选择项目",
      mode: options.mode === "multiple" ? "multiple" : "single",
      search: "",
      filters: { ...(definition.filters || {}), ...(options.filters || {}) },
      items: [],
      selectedIds,
      selectedItems,
      totalCount: 0,
      hasMore: false,
      nextCursor: null,
      nextPage: 2,
      loading: false,
      error: "",
      requestToken: 0,
      searchTimer: 0,
      opening: true,
      openingTimer: 0,
      onCommit: typeof options.onCommit === "function" ? options.onCommit : null,
      restoreFocus: opener,
      restoreFocusDescriptor: opener && opener.dataset
        ? { action: opener.dataset.action || "", pickerKey: opener.dataset.pickerKey || "" }
        : null,
    };
    renderIfReady();
    state.entityPicker.openingTimer = window.setTimeout(function () {
      if (state.entityPicker) state.entityPicker.opening = false;
    }, 220);
    await loadEntityPicker(true);
    return state.entityPicker;
  }

  function closeEntityPicker() {
    const picker = state.entityPicker;
    if (!picker) return;
    if (picker.searchTimer) window.clearTimeout(picker.searchTimer);
    if (picker.openingTimer) window.clearTimeout(picker.openingTimer);
    picker.requestToken += 1;
    const restoreFocus = picker.restoreFocus;
    const restoreFocusDescriptor = picker.restoreFocusDescriptor;
    state.entityPicker = null;
    renderIfReady();
    Promise.resolve().then(function () {
      let focusTarget = restoreFocus;
      if (restoreFocusDescriptor && typeof document.querySelectorAll === "function") {
        focusTarget = Array.from(document.querySelectorAll("[data-action]")).find(function (candidate) {
          return candidate.dataset.action === restoreFocusDescriptor.action &&
            (!restoreFocusDescriptor.pickerKey || candidate.dataset.pickerKey === restoreFocusDescriptor.pickerKey);
        }) || focusTarget;
      }
      if (focusTarget && typeof focusTarget.focus === "function") focusTarget.focus();
    });
  }

  function searchEntityPicker(value) {
    const picker = state.entityPicker;
    if (!picker) return;
    picker.search = String(value == null ? "" : value);
    picker.error = "";
    if (picker.searchTimer) window.clearTimeout(picker.searchTimer);
    picker.searchTimer = window.setTimeout(function () {
      picker.searchTimer = 0;
      void loadEntityPicker(true);
    }, PICKER_SEARCH_DEBOUNCE_MS);
  }

  function retryEntityPicker() {
    return loadEntityPicker(true);
  }

  function fetchNextEntityPickerPage() {
    const picker = state.entityPicker;
    if (!picker || picker.loading || !picker.hasMore) return Promise.resolve(false);
    return loadEntityPicker(false).then(function () { return true; });
  }

  async function loadEntityPicker(reset) {
    const picker = state.entityPicker;
    if (!picker) return null;
    const token = ++picker.requestToken;
    const request = { search: picker.search, filters: { ...picker.filters } };
    if (picker.definition.cursor) {
      if (!reset && picker.nextCursor) request.cursor = picker.nextCursor;
    } else {
      request.page = reset ? 1 : picker.nextPage;
    }
    picker.loading = true;
    picker.error = "";
    renderIfReady();
    try {
      const response = await query(picker.definition.method, request, picker.definition.label);
      if (state.entityPicker !== picker || token !== picker.requestToken) return null;
      response.items.forEach(function (item) {
        const id = item[picker.definition.idKey];
        if (picker.selectedIds.has(id)) picker.selectedItems.set(id, item);
      });
      picker.items = (reset ? response.items : picker.items.concat(response.items)).slice(-PICKER_RESULT_LIMIT);
      picker.totalCount = response.totalCount;
      picker.hasMore = response.hasMore;
      picker.nextCursor = response.nextCursor;
      picker.nextPage = reset ? 2 : picker.nextPage + 1;
      picker.error = "";
      return response;
    } catch (_error) {
      if (state.entityPicker !== picker || token !== picker.requestToken) return null;
      picker.error = "搜索失败，已保留所选项。请重试。";
      return null;
    } finally {
      if (state.entityPicker === picker && token === picker.requestToken) {
        picker.loading = false;
        renderIfReady();
      }
    }
  }

  function toggleEntityPickerSelection(id) {
    const picker = state.entityPicker;
    if (!picker || typeof id !== "string") return;
    const item = picker.items.find(function (candidate) { return candidate[picker.definition.idKey] === id; }) ||
      picker.selectedItems.get(id);
    if (picker.mode === "single") {
      if (item) picker.selectedItems.set(id, item);
      picker.selectedIds = new Set([id]);
      commitEntityPicker(picker);
      return;
    }
    if (picker.selectedIds.has(id)) {
      picker.selectedIds.delete(id);
      picker.selectedItems.delete(id);
    } else {
      picker.selectedIds.add(id);
      if (item) picker.selectedItems.set(id, item);
    }
    renderIfReady();
  }

  function confirmEntityPicker() {
    const picker = state.entityPicker;
    if (!picker || picker.mode !== "multiple") return;
    commitEntityPicker(picker);
  }

  function commitEntityPicker(picker) {
    const ids = Array.from(picker.selectedIds);
    const items = ids.map(function (id) { return picker.selectedItems.get(id); }).filter(Boolean);
    if (picker.onCommit) picker.onCommit(ids, items);
    closeEntityPicker();
  }

  function renderIfReady() {
    if (typeof window.MvuUi.render === "function") window.MvuUi.render();
  }

  async function updateListView(routeId, patch) {
    const policy = LIST_POLICIES[routeId];
    if (!policy) throw new Error("MVU_LIST_ROUTE_INVALID");
    const current = state.listViews[policy.key];
    const next = { ...current, ...(patch || {}) };
    if (patch && Object.prototype.hasOwnProperty.call(patch, "search") && !Object.prototype.hasOwnProperty.call(patch, "page")) {
      next.page = 1;
    }
    state.listViews[policy.key] = next;
    await loadManagementPage(routeId);
    return state.pages[policy.key];
  }

  async function loadManagementPage(routeId) {
    const policy = LIST_POLICIES[routeId];
    if (!policy) return null;
    const view = state.listViews[policy.key];
    const requestToken = (view.requestToken || 0) + 1;
    view.requestToken = requestToken;
    const request = { page: view.page };
    if (view.search) request.search = view.search;
    if (view.filters && Object.keys(view.filters).length) request.filters = view.filters;
    if (view.sort) request.sort = view.sort;
    const response = await query(policy.method, request, policy.key);
    if (state.listViews[policy.key] !== view || view.requestToken !== requestToken) return state.pages[policy.key];
    state.pages[policy.key] = response;
    if (policy.key === "fields") {
      response.items.forEach(function (field) { state.entities.set("field:" + field.id, field); });
      await hydrateFieldBindingLabels(response.items);
    }
    if (policy.key === "rules") await hydrateRuleLabels(response.items);
    return response;
  }

  async function hydrateFieldBindingLabels(fields) {
    await Promise.all(fields.map(async function (field) {
      if (field.scope === "global") {
        state.bindingLabels.set(field.id, "所有角色、群组和会话");
        return;
      }
      if (field.scope === "chat") {
        const currentChat = state.snapshot && state.snapshot.activeContext.chatId;
        state.bindingLabels.set(field.id, currentChat && field.bindingIds.includes(currentChat)
          ? state.snapshot.contextLabels.chatName
          : field.bindingIds.length + " 个会话");
        return;
      }
      const firstId = field.bindingIds[0];
      if (!firstId) {
        state.bindingLabels.set(field.id, "未绑定");
        return;
      }
      try {
        const entityType = field.scope === "character" ? "actor" : "group";
        const item = await getEntity(entityType, firstId);
        const suffix = field.bindingIds.length > 1 ? " 等 " + field.bindingIds.length + " 个" : "";
        state.bindingLabels.set(field.id, item.name + suffix);
      } catch (_error) {
        state.bindingLabels.set(field.id, field.bindingIds.length + (field.scope === "character" ? " 个角色" : " 个群组"));
      }
    }));
  }

  async function hydrateRuleLabels(rules) {
    await Promise.all(rules.map(async function (rule) {
      const selector = rule.triggerActorSelector;
      let actor = selector.kind === "any" ? "任意角色" : selector.kind === "current_actor" ? "当前消息角色" : "未绑定角色";
      try {
        if (selector.kind === "selected") {
          const item = await getEntity("actor", selector.actorIds[0]);
          actor = item.name + (selector.actorIds.length > 1 ? " 等 " + selector.actorIds.length + " 个角色" : "");
        } else if (selector.kind === "group") {
          const item = await getEntity("group", selector.groupIds[0]);
          actor = item.name + (selector.groupIds.length > 1 ? " 等 " + selector.groupIds.length + " 个群组" : "");
        }
      } catch (_error) {
        actor = selector.kind === "group" ? selector.groupIds.length + " 个群组" : selector.actorIds.length + " 个角色";
      }
      let condition = "条件待修复";
      try {
        condition = (await getEntity("condition", rule.conditionId)).name;
      } catch (_error) {
        condition = "条件待修复";
      }
      let actions = rule.actions.length + " 个结果";
      const first = rule.actions[0];
      try {
        if (first && first.kind === "change_field") {
          const field = await getEntity("field", first.fieldId);
          actions = field.name + " " + (first.delta >= 0 ? "+" : "") + formatNumber(first.delta) +
            (rule.actions.length > 1 ? " 等 " + rule.actions.length + " 个结果" : "");
        } else if (first && first.kind === "activate_effect_group") {
          const effect = await getEntity("effectGroup", first.effectGroupId);
          actions = "应用「" + effect.name + "」" + (rule.actions.length > 1 ? "等 " + rule.actions.length + " 个结果" : "");
        }
      } catch (_error) {
        actions = rule.actions.length + " 个结果（需修复引用）";
      }
      state.ruleLabels.set(rule.id, { actor, condition, actions });
    }));
  }

  async function getEntity(entityType, id) {
    if (typeof id !== "string" || id.length === 0) throw new Error("MVU_ENTITY_ID_MISSING");
    const key = entityType + ":" + id;
    if (state.entities.has(key)) return state.entities.get(key);
    const entity = await native.call("getEntityById", { entityType, id });
    const validators = {
      field: validateFieldEntity,
      actor: validateActor,
      group: validateGroup,
      rule: validateRule,
      condition: validateCondition,
      effectGroup: validateEffectGroup,
    };
    const validator = validators[entityType];
    if (!validator || !isRecord(entity)) throw new Error("MVU_ENTITY_RESPONSE_INVALID");
    validator(entity);
    const idKey = entityType === "actor" ? "characterId" : entityType === "group" ? "characterGroupId" : "id";
    if (entity[idKey] !== id) throw new Error("MVU_ENTITY_KIND_OR_ID_INVALID");
    state.entities.set(key, entity);
    return entity;
  }

  async function loadDirectory(groupId) {
    const results = await Promise.all([
      query("queryActors", groupId ? { filters: { groupId } } : {}, "actors"),
      query("queryGroups", {}, "groups"),
    ]);
    state.directory.actors = results[0].items;
    state.directory.groups = results[1].items;
  }

  async function loadRouteData(routeId) {
    const route = ROUTES[routeId];
    if (!route) throw new Error("MVU_ROUTE_UNKNOWN:" + routeId);
    state.routeError = null;
    try {
      if (LIST_POLICIES[routeId]) await loadManagementPage(routeId);
      if ((routeId === "status" || routeId === "field-detail") &&
          state.directory.actors.length === 0 && state.directory.groups.length === 0) {
        await loadDirectory(state.snapshot && state.snapshot.activeContext.groupId);
      }
      if (routeId === "field-detail") {
        if (!state.selectedFieldId) throw new Error("MVU_FIELD_SELECTION_MISSING");
        await getEntity("field", state.selectedFieldId);
        const summary = state.snapshot.pages.fields.items.find(function (field) {
          return field.id === state.selectedFieldId;
        });
        if (!summary || !summary.current) throw new Error("MVU_FIELD_CONTEXT_MISSING");
        state.detailRecords = await query("queryRecords", {
          page: 1,
          filters: { fieldId: state.selectedFieldId, scopeKey: summary.current.scopeKey },
        }, "records");
      }
      const entityRoutes = {
        "field-editor": "field",
        "rule-editor": "rule",
        "condition-editor": "condition",
        "effect-editor": "effectGroup",
      };
      if (entityRoutes[routeId] && state.selectedEntityId) {
        await getEntity(entityRoutes[routeId], state.selectedEntityId);
      }
    } catch (error) {
      state.routeError = {
        title: "页面数据有误",
        message: readableError(error),
        action: "重试",
      };
    }
  }

  function rootForRoute(routeId) {
    return (ROUTES[routeId] || ROUTES.status).owner;
  }

  async function navigate(routeId, options) {
    if (!ROUTES[routeId]) throw new Error("MVU_ROUTE_UNKNOWN:" + routeId);
    const opts = options || {};
    if (routeId === state.route && !opts.force) return;
    state.route = routeId;
    state.drawerOpen = false;
    if (opts.replace) state.routeTrail[state.routeTrail.length - 1] = routeId;
    else state.routeTrail.push(routeId);
    const url = new URL(window.location.href);
    url.searchParams.delete("screen");
    url.searchParams.set("route", routeId);
    if (state.selectedFieldId) url.searchParams.set("field", state.selectedFieldId);
    else url.searchParams.delete("field");
    window.history[opts.replace ? "replaceState" : "pushState"]({ mvu: true, route: routeId }, "", url);
    await loadRouteData(routeId);
    transition(function () { window.MvuUi.render({ resetScroll: true }); });
  }

  async function goBack() {
    const current = ROUTES[state.route] || ROUTES.status;
    let target = current.owner;
    if (state.routeTrail.length > 1) {
      state.routeTrail.pop();
      const previous = state.routeTrail.at(-1);
      if (previous && ROUTES[previous]) target = previous;
    }
    await navigate(target, { replace: true, force: true });
  }

  function transition(update) {
    if (typeof document.startViewTransition === "function" &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      document.startViewTransition(update);
    } else {
      update();
    }
  }

  function showFatal(error) {
    state.fatal = {
      title: "数据无法载入",
      message: readableError(error),
      action: "重新加载",
    };
    if (typeof window.MvuUi.render === "function") window.MvuUi.render();
  }

  function readableError(error) {
    const message = error instanceof Error ? error.message : String(error || "未知错误");
    if (message === "MVU_NATIVE_BRIDGE_UNAVAILABLE") return "未连接到 OperitAI。请返回宿主后重新打开插件。";
    if (/TIMEOUT/.test(message)) return "读取超时，请检查宿主状态后重试。";
    if (/INVALID|MISSING|SHAPE/.test(message)) return "收到的数据格式不完整，请重新载入。";
    return message.length > 120 ? message.slice(0, 120) + "…" : message;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function formatNumber(value) {
    if (!finiteNumber(value)) return "—";
    return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 }).format(value);
  }

  function formatTime(timestamp) {
    if (!finiteNumber(timestamp)) return "—";
    const date = new Date(timestamp);
    const today = new Date();
    const sameDay = date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
    return new Intl.DateTimeFormat("zh-CN", sameDay
      ? { hour: "2-digit", minute: "2-digit" }
      : { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  window.addEventListener("popstate", function () {
    const routeId = new URLSearchParams(window.location.search).get("route") || "status";
    state.route = ROUTES[routeId] ? routeId : "status";
    state.routeTrail = [state.route];
    state.drawerOpen = false;
    void loadRouteData(state.route).then(function () {
      window.MvuUi.render({ resetScroll: true });
    });
  });

  function demoCall(method, params) {
    const demo = demoDataset(params || {});
    if (method === "snapshot") return Promise.resolve(demo.snapshot);
    if (method === "queryActors") {
      const groupId = params && params.filters && params.filters.groupId;
      const picker = isDemoPickerRequest(method, params);
      const source = picker ? demo.pickerActors : (groupId ? (demo.groupMembers[groupId] || []) : demo.actors);
      return demoPickerResponse(demoQuery(source, params, 30, "characterId", true), params, picker);
    }
    if (method === "queryGroups") {
      const picker = isDemoPickerRequest(method, params);
      return demoPickerResponse(demoQuery(picker ? demo.pickerGroups : demo.groups, params, 30, "characterGroupId", true), params, picker);
    }
    if (method === "queryFields") {
      const picker = isDemoPickerRequest(method, params);
      return demoPickerResponse(demoQuery(picker ? demo.pickerFields : demo.fields, params, picker ? 30 : 5, "id", picker), params, picker);
    }
    if (method === "queryRules") {
      const picker = isDemoPickerRequest(method, params);
      return demoPickerResponse(demoQuery(picker ? demo.pickerRules : demo.ruleEntities, params, picker ? 10 : 5, "id", false), params, picker);
    }
    if (method === "queryConditions") {
      const picker = isDemoPickerRequest(method, params);
      return demoPickerResponse(demoQuery(picker ? demo.pickerConditions : demo.conditionEntities, params, 10, "id", false), params, picker);
    }
    if (method === "queryEffectGroups") {
      const picker = isDemoPickerRequest(method, params);
      return demoPickerResponse(demoQuery(picker ? demo.pickerEffects : demo.effectEntities, params, 10, "id", false), params, picker);
    }
    if (method === "queryRecords") return Promise.resolve(demoQuery(demo.records, params, 10, "id", false));
    if (method === "getEntityById") {
      const sources = { field: demo.fields, actor: demo.actors, group: demo.groups,
        rule: demo.ruleEntities, condition: demo.conditionEntities, effectGroup: demo.effectEntities };
      const idKey = params.entityType === "actor" ? "characterId" :
        params.entityType === "group" ? "characterGroupId" : "id";
      return Promise.resolve((sources[params.entityType] || []).find(function (item) {
        return item[idKey] === params.id;
      }));
    }
    if (method === "exportDataset") return Promise.resolve({ formatVersion: 3, demo: true });
    return Promise.resolve(null);
  }

  function isDemoPickerRequest(method, params) {
    if (method === "queryFields" && params && params.filters && params.filters.mode === "picker") return true;
    return Boolean(state.entityPicker && state.entityPicker.definition.method === method);
  }

  function demoPickerResponse(response, params, picker) {
    if (!picker) return Promise.resolve(response);
    const search = params && typeof params.search === "string" ? params.search : "";
    if (state.demoPickerControls.failSearch && search === state.demoPickerControls.failSearch) {
      return Promise.reject(new Error("demo picker failure"));
    }
    const delay = state.demoPickerControls.slowSearch && search === state.demoPickerControls.slowSearch
      ? state.demoPickerControls.slowMs
      : 0;
    if (!delay) return Promise.resolve(response);
    return new Promise(function (resolve) {
      window.setTimeout(function () { resolve(response); }, delay);
    });
  }

  function demoControlDelay(key) {
    const value = Number(queryState.get(key) || 0);
    return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 2000) : 0;
  }

  function page(items) {
    return { items, loadedCount: items.length, totalCount: items.length, hasMore: false, nextCursor: null };
  }

  function demoQuery(source, request, pageSize, idKey, cursorMode) {
    const params = request || {};
    const filters = params.filters || {};
    const normalizedSearch = normalizeDemoSearch(params.search || "");
    let items = source.filter(function (item) {
      if (normalizedSearch && !normalizeDemoSearch([item[idKey], item.name, item.description].filter(Boolean).join(" ")).includes(normalizedSearch)) {
        return false;
      }
      if (typeof filters.enabled === "boolean" && item.enabled !== filters.enabled) return false;
      if (typeof filters.scope === "string" && item.scope !== filters.scope) return false;
      if (typeof filters.bindingId === "string" && (!Array.isArray(item.bindingIds) || !item.bindingIds.includes(filters.bindingId))) return false;
      if (typeof filters.conditionId === "string" && item.conditionId !== filters.conditionId) return false;
      if (typeof filters.fieldId === "string" && item.fieldId !== filters.fieldId &&
          (!Array.isArray(item.fieldEffects) || !item.fieldEffects.some(function (effect) { return effect.fieldId === filters.fieldId; }))) return false;
      return true;
    });
    const sort = params.sort;
    if (sort) {
      items = items.slice().sort(function (left, right) {
        const leftValue = left[sort.key];
        const rightValue = right[sort.key];
        const comparison = typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue - rightValue
          : String(leftValue).localeCompare(String(rightValue), "zh-CN");
        if (comparison !== 0) return sort.direction === "desc" ? -comparison : comparison;
        return String(left[idKey]).localeCompare(String(right[idKey]), "en");
      });
    }
    const cursorOffset = cursorMode && typeof params.cursor === "string" ? Number(params.cursor.replace(/^demo:/, "")) : 0;
    const offset = cursorMode ? (Number.isSafeInteger(cursorOffset) ? cursorOffset : 0) : ((params.page || 1) - 1) * pageSize;
    const result = items.slice(offset, offset + pageSize);
    const hasMore = offset + result.length < items.length;
    return {
      items: result,
      loadedCount: result.length,
      totalCount: items.length,
      hasMore,
      nextCursor: cursorMode && hasMore ? "demo:" + (offset + result.length) : null,
    };
  }

  function normalizeDemoSearch(value) {
    return String(value).normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");
  }

  function demoDataset(request) {
    const now = Date.now();
    const stages = [
      { id: "stranger", name: "陌生", threshold: 0, description: "仍在观察彼此的边界。" },
      { id: "warm", name: "熟悉", threshold: 7, description: "互动开始自然。" },
      { id: "close", name: "亲密", threshold: 42, description: "愿意分享重要感受。" },
      { id: "bond", name: "依赖", threshold: 91, description: "关系成为稳定支点。" },
    ];
    const field = {
      id: "affinity", name: "亲密度", description: "与角色的情感关系", minimum: 0, maximum: 100,
      step: 1, initialValue: 35, icon: "favorite", themeColor: "#ff4f88", enabled: true,
      scope: "character", modelVisibility: "full", bindingIds: ["operit", "bob"], stages,
      ai: { enabled: true, minConfidence: 0.7, maxDelta: 8, prompt: "" },
      naturalChange: { enabled: false, unitMs: 86400000, amount: 0 },
      perTurnChange: { enabled: false, intervalTurns: 1, amount: 0, countMode: "both" }, order: 0,
    };
    const actors = [
      { characterId: "operit", name: "Operit", avatarUri: null, enabled: true },
      { characterId: "bob", name: "MVU_QA_Bob", avatarUri: null, enabled: true },
    ];
    const groups = [
      { characterGroupId: "group-a", name: "MVU_QA_Group", avatarUri: null },
      { characterGroupId: "group-b", name: "夜航小组", avatarUri: null },
    ];
    const groupMembers = {
      "group-a": actors,
      "group-b": [actors[1]],
    };
    const requestedGroup = groups.find(function (group) { return group.characterGroupId === request.groupId; }) || groups[0];
    const requestedActor = actors.find(function (actor) { return actor.characterId === request.actorId; }) || null;
    const isGroupProjection = typeof request.groupId === "string" && !request.actorId;
    const activeActor = isGroupProjection ? null : (requestedActor || actors[0]);
    const value = isGroupProjection
      ? (requestedGroup.characterGroupId === "group-b" ? 86 : 72)
      : (activeActor.characterId === "bob" ? 31 : 48);
    const stage = stages.slice().reverse().find(function (candidate) { return value >= candidate.threshold; }) || stages[0];
    const fieldSummary = {
      id: field.id, name: field.name, description: field.description, enabled: true,
      scope: isGroupProjection ? "group" : "character", order: 0,
      range: { minimum: 0, maximum: 100, step: 1 }, theme: { icon: "favorite", color: "#ff4f88" },
      current: {
        value, stage: { id: stage.id, name: stage.name, threshold: stage.threshold },
        scopeKey: isGroupProjection ? "group:" + requestedGroup.characterGroupId : "character:" + activeActor.characterId,
        actorId: activeActor ? activeActor.characterId : null,
        groupId: requestedGroup.characterGroupId,
        chatId: "chat-a",
      },
      truncated: false,
    };
    const records = [0, 1, 2, 3].map(function (index) {
      return { id: "record-" + index, fieldId: "affinity", fieldName: "亲密度", actorId: "operit",
        actorName: "Operit", groupId: "group-a", before: 47 - index, after: 48 - index, delta: 1,
        reason: index === 0 ? "一次真诚的回应" : "自然互动", source: "rule", occurredAt: now - index * 3600000,
        truncated: false };
    });
    const rules = [{ id: "rule-1", name: "关心回应", description: "角色收到明确关心时触发", enabled: true,
      conditionId: "condition-1", actionCount: 1, executionOrder: 1, updatedAt: new Date(now).toISOString(), truncated: false }];
    const conditions = [{ id: "condition-1", name: "主动关心", description: "识别明确的照顾与关心", enabled: true,
      rootKind: "predicate", updatedAt: new Date(now).toISOString(), truncated: false }];
    const effects = [{ id: "effect-1", name: "安心陪伴", description: "短期提高正向变化", enabled: true,
      fieldCount: 1, updatedAt: new Date(now).toISOString(), truncated: false }];
    const timestamp = new Date(now).toISOString();
    const conditionEntities = [{ id: "condition-1", name: "主动关心", description: "识别明确的照顾与关心", enabled: true,
      expression: { kind: "predicate", predicate: { kind: "user_care" } }, createdAt: timestamp, updatedAt: timestamp }];
    const effectEntities = [{ id: "effect-1", name: "安心陪伴", description: "短期提高正向变化", enabled: true,
      fieldEffects: [{ id: "field_effect_1", fieldId: "affinity", actorSelector: { kind: "trigger_actor" },
        operations: [{ kind: "positive_multiplier", value: 1.1, sources: ["rule"] }] }],
      createdAt: timestamp, updatedAt: timestamp }];
    const ruleEntities = [{ id: "rule-1", name: "关心回应", description: "角色收到明确关心时触发", enabled: true,
      triggerActorSelector: { kind: "current_actor" }, conditionId: "condition-1",
      actions: [{ kind: "change_field", fieldId: "affinity", target: { kind: "trigger_actor" }, delta: 4, effectGroupIds: ["effect-1"] }],
      cooldownHours: 0, executionOrder: 1, createdAt: timestamp, updatedAt: timestamp }];
    const demoFields = Array.from({ length: 12 }, function (_value, index) {
      const ordinal = String(index + 1).padStart(2, "0");
      return {
        ...field,
        id: "demo-field-" + ordinal,
        name: "演示字段 " + ordinal,
        description: "用于验证服务端搜索与分页",
        bindingIds: [index % 2 === 0 ? "operit" : "bob"],
        stages: stages.map(function (item) { return { ...item, id: item.id + "-" + ordinal }; }),
        order: index + 1,
      };
    });
    const demoConditionEntities = Array.from({ length: 23 }, function (_value, index) {
      const ordinal = String(index + 1).padStart(2, "0");
      return { id: "demo-condition-" + ordinal, name: "演示条件 " + ordinal, description: "服务端条件查询", enabled: true,
        expression: { kind: "predicate", predicate: { kind: "user_care" } }, createdAt: timestamp, updatedAt: timestamp };
    });
    const demoRuleEntities = Array.from({ length: 12 }, function (_value, index) {
      const ordinal = String(index + 1).padStart(2, "0");
      return { id: "demo-rule-" + ordinal, name: "演示规则 " + ordinal, description: "服务端规则查询", enabled: index % 3 !== 0,
        triggerActorSelector: index % 2 === 0 ? { kind: "current_actor" } : { kind: "selected", actorIds: ["bob"] },
        conditionId: "demo-condition-" + ordinal,
        actions: [{ kind: "change_field", fieldId: "demo-field-" + ordinal, target: { kind: "trigger_actor" }, delta: index + 1, effectGroupIds: [] }],
        cooldownHours: 0, executionOrder: index + 1, createdAt: timestamp, updatedAt: timestamp };
    });
    const demoEffectEntities = Array.from({ length: 23 }, function (_value, index) {
      const ordinal = String(index + 1).padStart(2, "0");
      return { id: "demo-effect-" + ordinal, name: "演示效果 " + ordinal, description: "服务端效果查询", enabled: true,
        fieldEffects: [{ id: "demo-field-effect-" + ordinal, fieldId: "demo-field-" + String(index % 12 + 1).padStart(2, "0"),
          actorSelector: { kind: "all_bound" }, operations: [{ kind: "immediate_delta", value: 1 }] }],
        createdAt: timestamp, updatedAt: timestamp };
    });
    const demoRecords = Array.from({ length: 20 }, function (_value, index) {
      return { id: "demo-record-" + index, fieldId: "demo-field-01", fieldName: "演示字段 01", actorId: "operit",
        actorName: "Operit", groupId: "group-a", before: index, after: index + 1, delta: 1,
        reason: "分页验证记录", source: "manual", occurredAt: now - (index + 4) * 3600000, truncated: false };
    });
    const allFields = [field].concat(demoFields);
    const allRuleEntities = ruleEntities.concat(demoRuleEntities);
    const allConditionEntities = conditionEntities.concat(demoConditionEntities);
    const allEffectEntities = effectEntities.concat(demoEffectEntities);
    const allRecords = records.concat(demoRecords);
    const pickerFields = Array.from({ length: 96 }, function (_value, index) {
      const ordinal = String(index + 1).padStart(3, "0");
      return {
        ...field,
        id: "picker-field-" + ordinal,
        name: "游标字段 " + ordinal,
        description: "浏览器高基数字段选择数据",
        stages: stages.map(function (item) { return { ...item, id: item.id + "-picker-" + ordinal }; }),
        order: index,
      };
    });
    const pickerActors = Array.from({ length: 96 }, function (_value, index) {
      const ordinal = String(index + 1).padStart(3, "0");
      return { characterId: "picker-actor-" + ordinal, name: "游标角色 " + ordinal, avatarUri: null, enabled: true };
    });
    const pickerGroups = Array.from({ length: 96 }, function (_value, index) {
      const ordinal = String(index + 1).padStart(3, "0");
      return { characterGroupId: "picker-group-" + ordinal, name: "游标群组 " + ordinal, avatarUri: null };
    });
    const pickerConditions = Array.from({ length: 96 }, function (_value, index) {
      const ordinal = String(index + 1).padStart(3, "0");
      return { ...conditionEntities[0], id: "picker-condition-" + ordinal, name: "游标条件 " + ordinal };
    });
    const pickerEffects = Array.from({ length: 96 }, function (_value, index) {
      const ordinal = String(index + 1).padStart(3, "0");
      return { ...effectEntities[0], id: "picker-effect-" + ordinal, name: "游标效果 " + ordinal,
        fieldEffects: effectEntities[0].fieldEffects.map(function (item) { return { ...item, id: item.id + "-picker-" + ordinal }; }) };
    });
    const pickerRules = Array.from({ length: 96 }, function (_value, index) {
      const ordinal = String(index + 1).padStart(3, "0");
      return { ...ruleEntities[0], id: "picker-rule-" + ordinal, name: "游标规则 " + ordinal, executionOrder: index };
    });
    const pages = { fields: page([fieldSummary]), rules: page(rules), conditions: page(conditions), effectGroups: page(effects), records: page(records) };
    return {
      fields: allFields, actors, groups, groupMembers, records: allRecords, rules, conditions, effects,
      ruleEntities: allRuleEntities, conditionEntities: allConditionEntities, effectEntities: allEffectEntities,
      pickerFields, pickerActors, pickerGroups, pickerRules, pickerConditions, pickerEffects,
      snapshot: {
        revision: 7, snapshotTruncated: false,
        activeContext: { chatId: "chat-a", actorId: activeActor ? activeActor.characterId : null,
          groupId: requestedGroup.characterGroupId, actorName: activeActor ? activeActor.name : requestedGroup.name, truncated: false },
        settings: { aiEnabled: true }, migrationStatus: { mode: "v3", source: "existing", truncated: false },
        counts: { fields: allFields.length, actors: 2, groups: 2, rules: allRuleEntities.length,
          conditions: allConditionEntities.length, effectGroups: allEffectEntities.length, records: allRecords.length },
        selected: { actor: activeActor ? { characterId: activeActor.characterId, name: activeActor.name,
            avatarUri: null, avatarUriUnavailable: false, enabled: true, truncated: false } : null,
          group: { characterGroupId: requestedGroup.characterGroupId, name: requestedGroup.name,
            avatarUri: null, avatarUriUnavailable: false, truncated: false } },
        contextLabels: { groupName: requestedGroup.name,
          chatName: (activeActor ? activeActor.name : requestedGroup.name) + " 的会话", truncated: false },
        returnedCount: { fields: 1, rules: 1, conditions: 1, effectGroups: 1, records: 4 }, pages,
      },
    };
  }
}());
