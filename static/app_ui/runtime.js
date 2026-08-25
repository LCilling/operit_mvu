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
  const PICKER_ROW_HEIGHT = 56;
  const PICKER_WINDOW_OVERSCAN = 4;
  const PICKER_WINDOW_MAX_ROWS = 24;
  const PICKER_RETAINED_PAGE_LIMIT = 128;
  const QUERY_RESPONSE_POLICIES = {
    fields: { method: "queryFields", pageSize: 5, pickerPageSize: 30, maxTotal: Number.MAX_SAFE_INTEGER },
    actors: { method: "queryActors", pageSize: 30, cursor: true, maxTotal: Number.MAX_SAFE_INTEGER },
    groups: { method: "queryGroups", pageSize: 30, cursor: true, maxTotal: Number.MAX_SAFE_INTEGER },
    rules: { method: "queryRules", pageSize: 5, maxTotal: Number.MAX_SAFE_INTEGER },
    conditions: { method: "queryConditions", pageSize: 10, maxTotal: Number.MAX_SAFE_INTEGER },
    effectgroups: { method: "queryEffectGroups", pageSize: 10, maxTotal: Number.MAX_SAFE_INTEGER },
    effects: { method: "queryEffectGroups", pageSize: 10, maxTotal: Number.MAX_SAFE_INTEGER },
    records: { method: "queryRecords", pageSize: 10, maxTotal: Number.MAX_SAFE_INTEGER },
  };
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
    directory: { actors: [], groups: [], actorTotal: 0, groupTotal: 0 },
    entities: new Map(),
    bindingLabels: new Map(),
    ruleLabels: new Map(),
    conditionMeta: new Map(),
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
    fieldEditorDraft: null,
    fieldTemplateFlow: null,
    fieldTemplateImportOpener: null,
    conditionEditorDraft: null,
    ruleEditorDraft: null,
    effectEditorDraft: null,
    conditionDeleteDialog: null,
    conditionListRecovery: null,
    managementDeleteDialog: null,
    managementRecoveries: { rules: null, effectGroups: null },
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
      oversizeSearch: queryState.get("demoPickerOversizeSearch") || "",
      badCursorSearch: queryState.get("demoPickerBadCursorSearch") || "",
    },
    demoCursorSequence: 0,
    demoCursors: new Map(),
    demoStore: {
      revision: 7,
      fields: null,
      conditions: null,
      rules: null,
      effectGroups: null,
      fieldSequence: 0,
      conditionSequence: 0,
      ruleSequence: 0,
      effectSequence: 0,
      aiSequence: 0,
      stateValues: {},
    },
    demoLastRequests: {},
    demoLastFieldTemplateJson: "",
    demoNextFailureMethod: "",
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
    onSnapshotRevisionChanged: null,
    transition,
    loadSnapshot,
    loadRouteData,
    loadDirectory,
    query,
    openEntityPicker,
    closeEntityPicker,
    searchEntityPicker,
    updateEntityPickerFilter,
    updateEntityPickerViewport,
    retryEntityPicker,
    fetchNextEntityPickerPage,
    toggleEntityPickerSelection,
    confirmEntityPicker,
    updateListView,
    getEntity,
    ensureFieldEditorDraft,
    resetFieldEditorDraft,
    resetRuleEditorDraft,
    resetEffectEditorDraft,
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
        try {
          validateNativeMutationRequest(method, params || {});
        } catch (error) {
          return Promise.reject(error);
        }
        if (state.demo) return Promise.resolve().then(function () { return demoCall(method, params || {}); });
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

  function requireBoundedConditionStrings(value, code, allowEmpty) {
    requireStringArray(value, code, allowEmpty);
    if (value.length > 100 || value.some(function (entry) { return entry.length > 256; })) throw new Error(code);
  }

  function repeatingMonthMaximum(month) {
    return [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] || 0;
  }

  function validConcreteConditionDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const maximum = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] || 0;
    return day >= 1 && day <= maximum;
  }

  function requireFinite(value, code) {
    if (!finiteNumber(value)) throw new Error(code);
  }

  function validateNativeMutationRequest(method, params) {
    if (["createCondition", "updateCondition", "copyCondition", "toggleCondition", "deleteCondition"].includes(method)) {
      validateConditionMutationRequest(method, params);
    }
    if (method === "createEffectGroup" && isRecord(params.effectGroup)) {
      validateEffectReasonConfig(params.effectGroup.defaultReason, 512);
    }
    if (method === "updateEffectGroup" && isRecord(params.patch) && params.patch.defaultReason !== undefined) {
      validateEffectReasonConfig(params.patch.defaultReason, 512);
    }
  }

  function assertRuntimeKeys(value, required, optional, code) {
    if (!isRecord(value)) throw new Error(code);
    const allowed = new Set(required.concat(optional || []));
    if (required.some(function (key) { return !Object.prototype.hasOwnProperty.call(value, key); }) ||
        Object.keys(value).some(function (key) { return !allowed.has(key); })) throw new Error(code);
  }

  function validateConditionMutationRequest(method, params) {
    const code = "MVU_CONDITION_MUTATION_REQUEST_INVALID";
    if (method === "createCondition") {
      assertRuntimeKeys(params, ["expectedRevision", "condition"], [], code);
      validateConditionMutationInput(params.condition, false);
    } else if (method === "updateCondition") {
      assertRuntimeKeys(params, ["id", "expectedRevision", "patch"], [], code);
      requireString(params.id, code);
      validateConditionMutationInput(params.patch, true);
    } else if (method === "toggleCondition") {
      assertRuntimeKeys(params, ["id", "enabled", "expectedRevision"], [], code);
      requireString(params.id, code); requireBoolean(params.enabled, code);
    } else {
      assertRuntimeKeys(params, ["id", "expectedRevision"], [], code);
      requireString(params.id, code);
    }
    if (!nonNegativeInteger(params.expectedRevision)) throw new Error(code);
  }

  function validateConditionMutationInput(input, patch) {
    const code = "MVU_CONDITION_INPUT_INVALID";
    assertRuntimeKeys(input, patch ? [] : ["name", "description", "enabled", "expression"],
      patch ? ["name", "description", "enabled", "expression"] : [], code);
    if (Object.prototype.hasOwnProperty.call(input, "name")) {
      requireString(input.name, code);
      if (!input.name.trim() || input.name.length > 256) throw new Error(code);
    }
    if (Object.prototype.hasOwnProperty.call(input, "description")) {
      requireString(input.description, code);
      if (input.description.length > 4096) throw new Error(code);
    }
    if (Object.prototype.hasOwnProperty.call(input, "enabled")) requireBoolean(input.enabled, code);
    if (Object.prototype.hasOwnProperty.call(input, "expression")) validateExactConditionExpression(input.expression, 0, { nodes: 0 });
  }

  function validateExactConditionExpression(expression, depth, tracker) {
    const code = "MVU_CONDITION_EXPRESSION_INVALID";
    if (depth > 12 || ++tracker.nodes > 100 || !isRecord(expression)) throw new Error(code);
    if (expression.kind === "and" || expression.kind === "or") {
      assertRuntimeKeys(expression, ["kind", "children"], [], code);
      if (!Array.isArray(expression.children) || expression.children.length === 0 || expression.children.length > 100) throw new Error(code);
      expression.children.forEach(function (child) { validateExactConditionExpression(child, depth + 1, tracker); });
      return;
    }
    if (expression.kind === "not") {
      assertRuntimeKeys(expression, ["kind", "child"], [], code);
      validateExactConditionExpression(expression.child, depth + 1, tracker);
      return;
    }
    if (expression.kind !== "predicate") throw new Error(code);
    assertRuntimeKeys(expression, ["kind", "predicate"], [], code);
    validateExactConditionPredicate(expression.predicate);
  }

  function validateExactConditionPredicate(predicate) {
    const code = "MVU_CONDITION_PREDICATE_INVALID";
    if (!isRecord(predicate) || typeof predicate.kind !== "string") throw new Error(code);
    const required = {
      recent_positive: ["kind", "count"], long_inactive: ["kind", "hours"], user_care: ["kind"], special_day: ["kind"],
      high_frequency: ["kind", "messages"], field_comparison: ["kind", "fieldId", "operator", "value"],
      message_count: ["kind", "count", "windowHours"], keywords: ["kind", "includeAny", "includeAll", "exclude"],
      sender: ["kind", "senders"], actor: ["kind", "actorIds"], group: ["kind", "groupIds"],
      concrete_date: ["kind", "dates"], repeating_date: ["kind", "month", "day"],
      ai_semantic: ["kind", "id", "triggerType", "requirement", "minimumConfidence"],
    }[predicate.kind];
    if (!required) throw new Error(code);
    const optional = predicate.kind === "high_frequency" ? ["windowHours", "bucketHours"]
      : predicate.kind === "message_count" ? ["sender"]
        : predicate.kind === "keywords" ? ["windowHours", "caseSensitive"] : [];
    assertRuntimeKeys(predicate, required, optional, code);
    validateConditionPredicate(predicate);
  }

  function validateQueryResponse(value, methodOrLabel, request, cursorState) {
    const policy = queryResponsePolicy(methodOrLabel, request || {});
    const code = "MVU_QUERY_RESPONSE_INVALID:" + methodOrLabel;
    if (!isRecord(value) || !Array.isArray(value.items)) throw new Error(code);
    if (!nonNegativeInteger(value.loadedCount) || value.loadedCount !== value.items.length) throw new Error(code);
    if (value.loadedCount > policy.pageSize) throw new Error(code);
    if (!nonNegativeInteger(value.totalCount) || value.totalCount < value.loadedCount || value.totalCount > policy.maxTotal) throw new Error(code);
    if (typeof value.hasMore !== "boolean") throw new Error(code);
    if (value.nextCursor !== null && (typeof value.nextCursor !== "string" || value.nextCursor.length === 0 || value.nextCursor.length > 96)) {
      throw new Error(code);
    }
    if (policy.cursor) {
      if (value.hasMore !== (value.nextCursor !== null) || (value.hasMore && value.loadedCount === 0)) throw new Error(code);
      if (value.nextCursor !== null && (value.nextCursor === request?.cursor || cursorState?.seenCursors?.has(value.nextCursor))) {
        throw new Error(code);
      }
      if (cursorState?.expectedTotal !== undefined && value.totalCount !== cursorState.expectedTotal) throw new Error(code);
      const priorLoaded = nonNegativeInteger(cursorState?.loadedCount) ? cursorState.loadedCount : 0;
      const cumulativeLoaded = priorLoaded + value.loadedCount;
      if (cumulativeLoaded > value.totalCount ||
          (value.hasMore && cumulativeLoaded >= value.totalCount) ||
          (!value.hasMore && cumulativeLoaded !== value.totalCount)) throw new Error(code);
    } else {
      if (value.nextCursor !== null) throw new Error(code);
      const pageNumber = Number.isSafeInteger(request?.page) && request.page > 0 ? request.page : 1;
      const offset = (pageNumber - 1) * policy.pageSize;
      if (value.loadedCount > Math.max(0, value.totalCount - offset)) throw new Error(code);
      if (value.hasMore !== (offset + value.loadedCount < value.totalCount)) throw new Error(code);
    }
    const validator = queryItemValidator(policy.key);
    if (validator) value.items.forEach(validator);
    return value;
  }

  function queryResponsePolicy(methodOrLabel, request) {
    const raw = String(methodOrLabel || "").replace(/^query/i, "").toLocaleLowerCase();
    const policy = QUERY_RESPONSE_POLICIES[raw];
    if (!policy) throw new Error("MVU_QUERY_RESPONSE_METHOD_INVALID:" + methodOrLabel);
    const cursor = policy.cursor === true || (raw === "fields" &&
      (request.cursor !== undefined || request.filters?.mode === "picker"));
    return {
      ...policy,
      key: raw,
      cursor,
      pageSize: cursor && policy.pickerPageSize ? policy.pickerPageSize : policy.pageSize,
    };
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
    requireString(field.bindingDisplay, "MVU_FIELD_PROJECTION_INVALID");
    requireString(field.scopeKey, "MVU_FIELD_PROJECTION_INVALID", true);
    if (field.currentValue !== null) requireFinite(field.currentValue, "MVU_FIELD_PROJECTION_INVALID");
    if ((field.currentValue === null) !== (field.scopeKey === null) ||
        (field.currentValue === null) !== (field.currentStage === null)) throw new Error("MVU_FIELD_PROJECTION_INVALID");
    if (field.currentStage !== null) {
      if (!isRecord(field.currentStage)) throw new Error("MVU_FIELD_PROJECTION_INVALID");
      requireString(field.currentStage.id, "MVU_FIELD_PROJECTION_INVALID");
      requireString(field.currentStage.name, "MVU_FIELD_PROJECTION_INVALID");
      requireString(field.currentStage.description, "MVU_FIELD_PROJECTION_INVALID");
      requireFinite(field.currentStage.threshold, "MVU_FIELD_PROJECTION_INVALID");
    }
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
      if (!predicate.fieldId || predicate.fieldId.length > 256 || ![">=", "<=", ">", "<", "=="].includes(predicate.operator)) throw new Error("MVU_CONDITION_PREDICATE_INVALID");
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
      requireBoundedConditionStrings(predicate.includeAny, "MVU_CONDITION_PREDICATE_INVALID", true);
      requireBoundedConditionStrings(predicate.includeAll, "MVU_CONDITION_PREDICATE_INVALID", true);
      requireBoundedConditionStrings(predicate.exclude, "MVU_CONDITION_PREDICATE_INVALID", true);
      if (predicate.windowHours !== undefined) requireFinite(predicate.windowHours, "MVU_CONDITION_PREDICATE_INVALID");
      if (predicate.caseSensitive !== undefined) requireBoolean(predicate.caseSensitive, "MVU_CONDITION_PREDICATE_INVALID");
      if (predicate.includeAny.length + predicate.includeAll.length + predicate.exclude.length > 100 ||
          predicate.windowHours !== undefined && predicate.windowHours < 0) throw new Error("MVU_CONDITION_PREDICATE_INVALID");
      return;
    }
    if (kind === "sender") {
      if (!Array.isArray(predicate.senders) || predicate.senders.length === 0 ||
          !predicate.senders.every(function (sender) { return sender === "user" || sender === "character"; })) {
        throw new Error("MVU_CONDITION_PREDICATE_INVALID");
      }
      return;
    }
    if (kind === "actor") return requireBoundedConditionStrings(predicate.actorIds, "MVU_CONDITION_PREDICATE_INVALID", false);
    if (kind === "group") return requireBoundedConditionStrings(predicate.groupIds, "MVU_CONDITION_PREDICATE_INVALID", false);
    if (kind === "concrete_date") {
      requireBoundedConditionStrings(predicate.dates, "MVU_CONDITION_PREDICATE_INVALID", false);
      if (predicate.dates.some(function (date) { return !validConcreteConditionDate(date); })) throw new Error("MVU_CONDITION_PREDICATE_INVALID");
      return;
    }
    if (kind === "repeating_date") {
      if (!Number.isInteger(predicate.month) || predicate.month < 1 || predicate.month > 12 ||
          !Number.isInteger(predicate.day) || predicate.day < 1 || predicate.day > repeatingMonthMaximum(predicate.month)) throw new Error("MVU_CONDITION_PREDICATE_INVALID");
      return;
    }
    if (kind === "ai_semantic") {
      requireString(predicate.id, "MVU_CONDITION_PREDICATE_INVALID");
      requireString(predicate.triggerType, "MVU_CONDITION_PREDICATE_INVALID");
      requireString(predicate.requirement, "MVU_CONDITION_PREDICATE_INVALID");
      requireFinite(predicate.minimumConfidence, "MVU_CONDITION_PREDICATE_INVALID");
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(predicate.id) || predicate.id.length > 256 || !predicate.triggerType.trim() ||
          predicate.triggerType.length > 256 || !predicate.requirement.trim() || predicate.requirement.length > 4096 ||
          predicate.minimumConfidence < 0 || predicate.minimumConfidence > 1) throw new Error("MVU_CONDITION_PREDICATE_INVALID");
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
    validateEffectReasonConfig(effect.defaultReason, 16384);
    if (effect.defaultDuration !== undefined) validateEffectDuration(effect.defaultDuration);
    effect.fieldEffects.forEach(validateFieldEffect);
  }

  function validateEffectReasonConfig(reason, maximumLength) {
    const code = "MVU_EFFECT_REASON_CONFIG_INVALID";
    const textLimit = Number.isSafeInteger(maximumLength) ? maximumLength : 16384;
    if (!isRecord(reason)) throw new Error(code);
    const keys = Object.keys(reason).sort();
    if (keys.length !== 3 || keys[0] !== "mode" || keys[1] !== "template" || keys[2] !== "text") throw new Error(code);
    if (!["template", "custom"].includes(reason.mode) ||
        !["general", "rule", "natural", "per_turn", "ai", "manual"].includes(reason.template) ||
        typeof reason.text !== "string" || reason.text.length > textLimit ||
        (reason.mode === "custom" && reason.text.trim().length === 0)) {
      throw new Error(code);
    }
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
    const previousContext = state.snapshot === null ? "" : contextIdentity(state.snapshot.activeContext);
    const nextContext = contextIdentity(snapshot.activeContext);
    if (previousRevision !== null && previousRevision !== snapshot.revision) state.entities.clear();
    else if (previousContext && previousContext !== nextContext) {
      Array.from(state.entities.keys()).forEach(function (key) {
        if (key.startsWith("field:")) state.entities.delete(key);
      });
    }
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
    if (previousRevision !== null && previousRevision !== snapshot.revision &&
        typeof window.MvuUi.onSnapshotRevisionChanged === "function") {
      window.MvuUi.onSnapshotRevisionChanged(previousRevision, snapshot.revision);
    }
    return snapshot;
  }

  function contextIdentity(context) {
    return [context?.chatId || "", context?.actorId || "", context?.groupId || ""].join("\u0000");
  }

  function resetFieldEditorDraft() {
    state.fieldEditorDraft = null;
    delete state.editorSelections["field-scope-character"];
    delete state.editorSelections["field-scope-group"];
  }

  function resetRuleEditorDraft() {
    state.ruleEditorDraft = null;
    Object.keys(state.editorSelections).forEach(function (key) {
      if (key.startsWith("rule-")) delete state.editorSelections[key];
    });
  }

  function resetEffectEditorDraft() {
    state.effectEditorDraft = null;
    Object.keys(state.editorSelections).forEach(function (key) {
      if (key.startsWith("effect-")) delete state.editorSelections[key];
    });
  }

  function ensureFieldEditorDraft(field) {
    const identity = field && field.id ? field.id : "__new__";
    if (state.fieldEditorDraft && state.fieldEditorDraft.identity === identity) return state.fieldEditorDraft;
    const snapshot = state.snapshot;
    const currentChatId = snapshot && snapshot.activeContext.chatId;
    const source = field || {
      name: "",
      description: "",
      minimum: 0,
      maximum: 100,
      step: 1,
      initialValue: 0,
      icon: "favorite",
      themeColor: "#7058d8",
      enabled: true,
      scope: "character",
      modelVisibility: "full",
      ai: { enabled: false, minConfidence: 0.7, maxDelta: 8, prompt: "" },
      stages: [{ id: "stage-1", name: "初始", description: "", threshold: 0 }],
      bindingIds: snapshot && snapshot.activeContext.actorId ? [snapshot.activeContext.actorId] : [],
      bindingDisplay: snapshot && snapshot.activeContext.actorName ? snapshot.activeContext.actorName : "未绑定",
      naturalChange: { enabled: false, unitMs: 86400000, amount: 0 },
      perTurnChange: { enabled: false, intervalTurns: 1, amount: 0, countMode: "both" },
      order: 0,
    };
    const draft = JSON.parse(JSON.stringify(source));
    draft.identity = identity;
    draft.bindingIds = Array.isArray(draft.bindingIds) ? draft.bindingIds.slice() : [];
    draft.stages = Array.isArray(draft.stages) && draft.stages.length
      ? draft.stages.map(function (stage, index) { return { ...stage, id: stage.id || "stage-" + (index + 1) }; })
      : [{ id: "stage-1", name: "初始", description: "", threshold: Number(draft.minimum) || 0 }];
    draft.chatAutoBind = draft.scope === "chat" && Boolean(currentChatId && draft.bindingIds.includes(currentChatId));
    draft.chatBindingSearch = "";
    draft.chatBindingPage = 1;
    draft.chatBindingsOpen = false;
    draft.manualChatBindingId = "";
    state.fieldEditorDraft = draft;
    return draft;
  }

  async function query(method, request, label, validationState) {
    try {
      return validateQueryResponse(await native.call(method, request || {}), method, request || {}, validationState);
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
    const pickerFilters = { ...(definition.filters || {}), ...(options.filters || {}) };
    state.entityPicker = {
      entity: options.entity,
      definition,
      title: options.title || "选择项目",
      mode: options.mode === "multiple" ? "multiple" : "single",
      maxSelection: Number.isSafeInteger(options.maxSelection) && options.maxSelection > 0 ? options.maxSelection : null,
      search: "",
      filters: pickerFilters,
      lockedFilterKeys: new Set(Array.isArray(options.lockedFilterKeys) ? options.lockedFilterKeys : []),
      items: [],
      orderIds: [],
      itemById: new Map(),
      selectedIds,
      selectedItems,
      totalCount: 0,
      allTotalCount: pickerAllTotalCount(options.entity, pickerFilters),
      hasMore: false,
      nextCursor: null,
      nextPage: 2,
      loading: false,
      error: "",
      errorRetryable: true,
      requestToken: 0,
      seenCursors: new Set(),
      autoFetchBlocked: false,
      retainedPageLimit: PICKER_RETAINED_PAGE_LIMIT,
      retainedPageCount: 0,
      expectedTotal: undefined,
      virtualWindow: {
        scrollTop: 0,
        viewportHeight: 336,
        rowHeight: PICKER_ROW_HEIGHT,
        start: 0,
        end: 0,
      },
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

  function pickerAllTotalCount(entity, filters) {
    if (entity === "actors" && filters?.groupId && nonNegativeInteger(state.directory.actorTotal)) {
      return state.directory.actorTotal;
    }
    const counts = state.snapshot && state.snapshot.counts;
    const key = entity === "effectGroups" ? "effectGroups" : entity;
    return counts && nonNegativeInteger(counts[key]) ? counts[key] : 0;
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
      focusEntityPickerOpener(restoreFocus, restoreFocusDescriptor);
    });
  }

  function focusEntityPickerOpener(restoreFocus, restoreFocusDescriptor) {
    let focusTarget = restoreFocus;
    if (restoreFocusDescriptor && typeof document.querySelectorAll === "function") {
      focusTarget = Array.from(document.querySelectorAll("[data-action]")).find(function (candidate) {
        return candidate.dataset.action === restoreFocusDescriptor.action &&
          (!restoreFocusDescriptor.pickerKey || candidate.dataset.pickerKey === restoreFocusDescriptor.pickerKey);
      }) || focusTarget;
    }
    if (focusTarget && typeof focusTarget.focus === "function") focusTarget.focus();
  }

  function searchEntityPicker(value) {
    const picker = state.entityPicker;
    if (!picker) return;
    picker.search = String(value == null ? "" : value);
    picker.error = "";
    picker.errorRetryable = true;
    picker.autoFetchBlocked = false;
    if (picker.searchTimer) window.clearTimeout(picker.searchTimer);
    picker.searchTimer = window.setTimeout(function () {
      picker.searchTimer = 0;
      void loadEntityPicker(true);
    }, PICKER_SEARCH_DEBOUNCE_MS);
  }

  function updateEntityPickerFilter(key, rawValue, valueType) {
    const picker = state.entityPicker;
    if (!picker) return Promise.resolve(null);
    if (picker.lockedFilterKeys?.has(key)) return Promise.reject(new Error("MVU_PICKER_FILTER_LOCKED"));
    const allowed = {
      fields: new Set(["scope", "type", "enabled"]),
      actors: new Set(["enabled", "groupId"]),
      groups: new Set(["actorId"]),
    }[picker.entity];
    if (!allowed || !allowed.has(key)) return Promise.reject(new Error("MVU_PICKER_FILTER_INVALID"));
    const nextFilters = { ...picker.filters };
    if (rawValue === "") delete nextFilters[key];
    else nextFilters[key] = valueType === "boolean" ? rawValue === "true" : String(rawValue);
    picker.filters = nextFilters;
    picker.error = "";
    picker.errorRetryable = true;
    picker.autoFetchBlocked = false;
    return loadEntityPicker(true);
  }

  function updateEntityPickerViewport(scrollTop, clientHeight) {
    const picker = state.entityPicker;
    if (!picker) return false;
    const previousStart = picker.virtualWindow.start;
    const previousEnd = picker.virtualWindow.end;
    picker.virtualWindow.scrollTop = finiteNumber(scrollTop) ? Math.max(0, scrollTop) : 0;
    if (finiteNumber(clientHeight) && clientHeight > 0) picker.virtualWindow.viewportHeight = clientHeight;
    computePickerVirtualWindow(picker);
    return previousStart !== picker.virtualWindow.start || previousEnd !== picker.virtualWindow.end;
  }

  function pickerVisibleIds(picker) {
    return picker.orderIds.filter(function (id) { return !picker.selectedIds.has(id); });
  }

  function computePickerVirtualWindow(picker) {
    const windowState = picker.virtualWindow;
    const itemCount = pickerVisibleIds(picker).length;
    const firstVisible = Math.floor(windowState.scrollTop / windowState.rowHeight);
    const viewportRows = Math.max(1, Math.ceil(windowState.viewportHeight / windowState.rowHeight));
    const start = Math.max(0, Math.min(itemCount, firstVisible - PICKER_WINDOW_OVERSCAN));
    const desiredRows = Math.min(PICKER_WINDOW_MAX_ROWS, viewportRows + PICKER_WINDOW_OVERSCAN * 2);
    windowState.start = start;
    windowState.end = Math.min(itemCount, start + desiredRows);
  }

  function retryEntityPicker() {
    if (state.entityPicker) state.entityPicker.autoFetchBlocked = false;
    return loadEntityPicker(true);
  }

  function fetchNextEntityPickerPage() {
    const picker = state.entityPicker;
    if (!picker || picker.loading || !picker.hasMore || picker.autoFetchBlocked) return Promise.resolve(false);
    if (picker.retainedPageCount >= picker.retainedPageLimit) {
      picker.error = "结果过多，已暂停继续读取。请缩小搜索范围。";
      picker.errorRetryable = false;
      picker.autoFetchBlocked = true;
      renderIfReady();
      return Promise.resolve(false);
    }
    return loadEntityPicker(false).then(function () { return true; });
  }

  async function loadEntityPicker(reset) {
    const picker = state.entityPicker;
    if (!picker) return null;
    const token = ++picker.requestToken;
    if (reset) {
      picker.seenCursors.clear();
      picker.expectedTotal = undefined;
    }
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
      const response = await query(picker.definition.method, request, picker.definition.label, {
        seenCursors: picker.seenCursors,
        expectedTotal: picker.expectedTotal,
        loadedCount: reset ? 0 : picker.orderIds.length,
      });
      if (state.entityPicker !== picker || token !== picker.requestToken) return null;
      if (reset) {
        picker.orderIds = [];
        picker.itemById.clear();
      }
      let insertedCount = 0;
      response.items.forEach(function (item) {
        const id = item[picker.definition.idKey];
        if (!picker.itemById.has(id)) {
          picker.orderIds.push(id);
          insertedCount += 1;
        }
        picker.itemById.set(id, item);
        if (picker.selectedIds.has(id)) picker.selectedItems.set(id, item);
      });
      if (!reset && response.hasMore && insertedCount === 0) throw new Error("MVU_QUERY_CURSOR_NO_PROGRESS");
      picker.items = picker.orderIds.map(function (id) { return picker.itemById.get(id); });
      picker.totalCount = response.totalCount;
      picker.expectedTotal = response.totalCount;
      picker.hasMore = response.hasMore;
      picker.nextCursor = response.nextCursor;
      if (response.nextCursor !== null) picker.seenCursors.add(response.nextCursor);
      picker.nextPage = reset ? 2 : picker.nextPage + 1;
      picker.retainedPageCount = reset ? 1 : picker.retainedPageCount + 1;
      picker.error = "";
      picker.errorRetryable = true;
      picker.autoFetchBlocked = false;
      computePickerVirtualWindow(picker);
      return response;
    } catch (_error) {
      if (state.entityPicker !== picker || token !== picker.requestToken) return null;
      picker.error = "搜索失败，已保留所选项。请重试。";
      picker.errorRetryable = true;
      picker.autoFetchBlocked = true;
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
    const item = picker.itemById.get(id) || picker.selectedItems.get(id);
    if (picker.mode === "single") {
      if (item) picker.selectedItems.set(id, item);
      picker.selectedIds = new Set([id]);
      commitEntityPicker(picker);
      return;
    }
    if (picker.selectedIds.has(id)) {
      picker.selectedIds.delete(id);
      picker.selectedItems.delete(id);
      if (picker.selectionLimitReached) {
        picker.selectionLimitReached = false;
        picker.error = "";
        picker.errorRetryable = true;
      }
    } else {
      if (picker.maxSelection !== null && picker.selectedIds.size >= picker.maxSelection) {
        picker.selectionLimitReached = true;
        picker.error = "最多选择 " + picker.maxSelection + " 项；请先取消一个已选项再继续。";
        picker.errorRetryable = false;
        renderIfReady();
        return;
      }
      picker.selectedIds.add(id);
      if (item) picker.selectedItems.set(id, item);
    }
    computePickerVirtualWindow(picker);
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
    let completion;
    try {
      if (picker.onCommit) completion = picker.onCommit(ids, items);
    } finally {
      closeEntityPicker();
    }
    if (completion && typeof completion.then === "function") {
      Promise.resolve(completion).then(function () {
        focusEntityPickerOpener(picker.restoreFocus, picker.restoreFocusDescriptor);
      }, function () {
        focusEntityPickerOpener(picker.restoreFocus, picker.restoreFocusDescriptor);
      });
    }
  }

  function renderIfReady() {
    if (typeof window.MvuUi.patchEntityPicker === "function") window.MvuUi.patchEntityPicker();
    else if (typeof window.MvuUi.render === "function") window.MvuUi.render();
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
      response.items.forEach(function (field) { state.bindingLabels.set(field.id, field.bindingDisplay); });
    }
    if (policy.key === "rules") await hydrateRuleLabels(response.items);
    if (policy.key === "conditions" && typeof window.MvuUi.hydrateConditionRows === "function") {
      await window.MvuUi.hydrateConditionRows(response.items);
    }
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
    state.directory.actorTotal = results[0].totalCount;
    state.directory.groupTotal = results[1].totalCount;
  }

  async function loadRouteData(routeId) {
    const route = ROUTES[routeId];
    if (!route) throw new Error("MVU_ROUTE_UNKNOWN:" + routeId);
    state.routeError = null;
    try {
      if (LIST_POLICIES[routeId]) await loadManagementPage(routeId);
      if (routeId === "status" &&
          state.directory.actors.length === 0 && state.directory.groups.length === 0) {
        await loadDirectory(state.snapshot && state.snapshot.activeContext.groupId);
      }
      if (routeId === "field-detail") {
        if (!state.selectedFieldId) throw new Error("MVU_FIELD_SELECTION_MISSING");
        const field = await getEntity("field", state.selectedFieldId);
        if (field.currentValue === null || field.scopeKey === null) throw new Error("MVU_FIELD_CONTEXT_MISSING");
        state.detailRecords = await query("queryRecords", {
          page: 1,
          filters: { fieldId: state.selectedFieldId, scopeKey: field.scopeKey },
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
      if (routeId === "condition-editor" && typeof window.MvuUi.prepareConditionEditor === "function") {
        const condition = state.selectedEntityId ? state.entities.get("condition:" + state.selectedEntityId) : null;
        await window.MvuUi.prepareConditionEditor(condition || null);
      }
      if (routeId === "rule-editor" && typeof window.MvuUi.prepareRuleEditor === "function") {
        const rule = state.selectedEntityId ? state.entities.get("rule:" + state.selectedEntityId) : null;
        await window.MvuUi.prepareRuleEditor(rule || null);
      }
      if (routeId === "effect-editor" && typeof window.MvuUi.prepareEffectEditor === "function") {
        const effect = state.selectedEntityId ? state.entities.get("effectGroup:" + state.selectedEntityId) : null;
        await window.MvuUi.prepareEffectEditor(effect || null);
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
      const viewTransition = document.startViewTransition(update);
      return viewTransition && viewTransition.updateCallbackDone && typeof viewTransition.updateCallbackDone.then === "function"
        ? Promise.resolve(viewTransition.updateCallbackDone)
        : Promise.resolve();
    } else {
      update();
      return Promise.resolve();
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
    state.demoLastRequests[method] = JSON.parse(JSON.stringify(params || {}));
    if (state.demoNextFailureMethod === method) {
      state.demoNextFailureMethod = "";
      return Promise.reject(new Error("demo host failure: " + method));
    }
    const demo = demoDataset(params || {});
    if (method === "snapshot") return Promise.resolve(demo.snapshot);
    if (method === "addField") {
      const next = { ...JSON.parse(JSON.stringify(params.field)), id: "demo-created-" + (++state.demoStore.fieldSequence), order: state.demoStore.fields.length };
      state.demoStore.fields.push(next);
      state.demoStore.revision += 1;
      return Promise.resolve(JSON.parse(JSON.stringify(next)));
    }
    if (method === "updateField") {
      const index = state.demoStore.fields.findIndex(function (field) { return field.id === params.id; });
      if (index < 0) return Promise.reject(new Error("MVU_FIELD_NOT_FOUND:" + params.id));
      state.demoStore.fields[index] = { ...state.demoStore.fields[index], ...JSON.parse(JSON.stringify(params.patch || {})), id: params.id };
      state.demoStore.revision += 1;
      return Promise.resolve(null);
    }
    if (method === "queryActors") {
      const groupId = params && params.filters && params.filters.groupId;
      const picker = isDemoPickerRequest(method, params);
      const source = groupId ? (demo.groupMembers[groupId] || []) : (picker ? demo.pickerActors : demo.actors);
      return demoPickerResponse(demoQuery(source, params, 30, "characterId", true, "actors"), params, picker, source);
    }
    if (method === "queryGroups") {
      const picker = isDemoPickerRequest(method, params);
      const actorId = params && params.filters && params.filters.actorId;
      const source = picker
        ? (actorId ? demo.pickerGroups.filter(function (_group, index) {
            return actorId === "bob" ? index % 2 === 1 : index % 2 === 0;
          }) : demo.pickerGroups)
        : demo.groups;
      return demoPickerResponse(demoQuery(source, params, 30, "characterGroupId", true, "groups"), params, picker, source);
    }
    if (method === "queryFields") {
      const picker = isDemoPickerRequest(method, params);
      const source = picker ? demo.pickerFields : demo.fields;
      return demoPickerResponse(demoQuery(source, params, picker ? 30 : 5, "id", picker, "fields"), params, picker, source);
    }
    if (method === "queryRules") {
      const picker = isDemoPickerRequest(method, params);
      const source = picker ? demo.pickerRules : demo.ruleEntities;
      return demoPickerResponse(demoQuery(source, params, picker ? 10 : 5, "id", false), params, picker, source);
    }
    if (method === "queryConditions") {
      const picker = isDemoPickerRequest(method, params);
      const source = picker ? demo.pickerConditions : demo.conditionEntities;
      return demoPickerResponse(demoQuery(source, params, 10, "id", false), params, picker, source);
    }
    if (method === "queryEffectGroups") {
      const picker = isDemoPickerRequest(method, params);
      const source = picker ? demo.pickerEffects : demo.effectEntities;
      return demoPickerResponse(demoQuery(source, params, 10, "id", false), params, picker, source);
    }
    if (method === "queryRecords") return Promise.resolve(demoQuery(demo.records, params, 10, "id", false));
    if (method === "getEntityById") {
      const sources = { field: demo.fields, actor: demo.actors.concat(demo.pickerActors), group: demo.groups.concat(demo.pickerGroups),
        rule: demo.ruleEntities, condition: demo.conditionEntities, effectGroup: demo.effectEntities };
      const idKey = params.entityType === "actor" ? "characterId" :
        params.entityType === "group" ? "characterGroupId" : "id";
      return Promise.resolve((sources[params.entityType] || []).find(function (item) {
        return item[idKey] === params.id;
      }));
    }
    if (method === "getConditionReferences") {
      const condition = demo.conditionEntities.find(function (item) { return item.id === params.id; });
      if (!condition) return Promise.reject(new Error("MVU_CONDITION_NOT_FOUND:" + params.id));
      const references = demo.ruleEntities.filter(function (rule) { return rule.conditionId === params.id; }).map(function (rule) {
        return { entityType: "rule", id: rule.id, name: rule.name, relation: "referenced_by" };
      }).sort(function (left, right) { return left.name.localeCompare(right.name) || left.id.localeCompare(right.id); });
      return Promise.resolve(demoQuery(references, { page: params.page || 1 }, 10, "id", false));
    }
    if (["createCondition", "updateCondition", "copyCondition", "toggleCondition", "deleteCondition"].includes(method)) {
      return Promise.resolve(demoMutateCondition(method, params, demo));
    }
    if (["createRule", "updateRule", "copyRule", "toggleRule", "deleteRule"].includes(method)) {
      return Promise.resolve(demoMutateRule(method, params, demo));
    }
    if (["createEffectGroup", "updateEffectGroup", "copyEffectGroup", "toggleEffectGroup", "deleteEffectGroup"].includes(method)) {
      return Promise.resolve(demoMutateEffectGroup(method, params, demo));
    }
    if (method === "getRuleReferences") return Promise.resolve([]);
    if (method === "getEffectGroupReferences") {
      const references = demo.ruleEntities.filter(function (rule) {
        return rule.actions.some(function (action) {
          return action.kind === "activate_effect_group" ? action.effectGroupId === params.id : action.effectGroupIds.includes(params.id);
        });
      }).map(function (rule) { return { entityType: "rule", id: rule.id, name: rule.name, relation: "referenced_by" }; });
      return Promise.resolve(demoQuery(references, { page: params.page || 1 }, 10, "id", false));
    }
    if (method === "exportFieldTemplate") return Promise.resolve(demoExportFieldTemplate(demo, params));
    if (method === "previewFieldTemplateImport") return Promise.resolve(demoPreviewFieldTemplate(demo, params.json));
    if (method === "importFieldTemplate") return Promise.resolve(demoImportFieldTemplate(demo, params));
    if (method === "exportDataset") return Promise.resolve({ formatVersion: 3, demo: true });
    return Promise.resolve(null);
  }

  function demoMutateCondition(method, params, demo) {
    if (!Number.isSafeInteger(params.expectedRevision) || params.expectedRevision !== state.demoStore.revision) {
      throw new Error("MVU_STALE_REVISION:" + params.expectedRevision + ":" + state.demoStore.revision);
    }
    const draft = JSON.parse(JSON.stringify(state.demoStore.conditions));
    const now = new Date().toISOString();
    let entity = null;
    if (method === "createCondition") {
      const occupied = new Set(draft.map(function (condition) { return condition.id; }));
      let id;
      do {
        state.demoStore.conditionSequence += 1;
        id = "condition_demo_created_" + state.demoStore.conditionSequence;
      } while (occupied.has(id));
      entity = { ...JSON.parse(JSON.stringify(params.condition)), id, createdAt: now, updatedAt: now };
      validateCondition(entity);
      demoValidateConditionReferences(entity.expression, demo);
      draft.push(entity);
    } else {
      const index = draft.findIndex(function (condition) { return condition.id === params.id; });
      if (index < 0) throw new Error("MVU_CONDITION_NOT_FOUND:" + params.id);
      if (method === "updateCondition") {
        entity = { ...draft[index], ...JSON.parse(JSON.stringify(params.patch || {})), id: params.id, updatedAt: now };
        validateCondition(entity);
        demoValidateConditionReferences(entity.expression, demo);
        draft[index] = entity;
      } else if (method === "toggleCondition") {
        entity = { ...draft[index], enabled: params.enabled, updatedAt: now };
        validateCondition(entity);
        draft[index] = entity;
      } else if (method === "copyCondition") {
        const occupied = new Set(draft.map(function (condition) { return condition.id; }));
        let id;
        do {
          state.demoStore.conditionSequence += 1;
          id = "condition_demo_copy_" + state.demoStore.conditionSequence;
        } while (occupied.has(id));
        entity = { ...JSON.parse(JSON.stringify(draft[index])), id, name: draft[index].name + " 副本", createdAt: now, updatedAt: now };
        entity.expression = demoCopyConditionExpression(entity.expression);
        validateCondition(entity);
        draft.push(entity);
      } else if (method === "deleteCondition") {
        if (state.demoStore.rules.some(function (rule) { return rule.conditionId === params.id; })) {
          throw new Error("MVU_CONDITION_REFERENCED");
        }
        draft.splice(index, 1);
      }
    }
    state.demoStore.conditions = draft;
    state.demoStore.revision += 1;
    if (method === "deleteCondition") return { revision: state.demoStore.revision };
    return { revision: state.demoStore.revision, entity: JSON.parse(JSON.stringify(entity)) };
  }

  function requireDemoRevision(params) {
    if (!Number.isSafeInteger(params.expectedRevision) || params.expectedRevision !== state.demoStore.revision) {
      throw new Error("MVU_STALE_REVISION:" + params.expectedRevision + ":" + state.demoStore.revision);
    }
  }

  function nextDemoEntityId(prefix, sequenceKey, occupied) {
    let id;
    do {
      state.demoStore[sequenceKey] += 1;
      id = prefix + state.demoStore[sequenceKey];
    } while (occupied.has(id));
    return id;
  }

  function demoMutateRule(method, params, demo) {
    requireDemoRevision(params);
    const draft = JSON.parse(JSON.stringify(state.demoStore.rules));
    const now = new Date().toISOString();
    let entity = null;
    if (method === "createRule") {
      const id = nextDemoEntityId("rule_demo_created_", "ruleSequence", new Set(draft.map(function (rule) { return rule.id; })));
      entity = { ...JSON.parse(JSON.stringify(params.rule)), id, createdAt: now, updatedAt: now };
      validateRule(entity);
      demoValidateRuleReferences(entity, demo);
      draft.push(entity);
    } else {
      const index = draft.findIndex(function (rule) { return rule.id === params.id; });
      if (index < 0) throw new Error("MVU_RULE_NOT_FOUND:" + params.id);
      if (method === "updateRule") {
        entity = { ...draft[index], ...JSON.parse(JSON.stringify(params.patch || {})), id: params.id, updatedAt: now };
        validateRule(entity);
        demoValidateRuleReferences(entity, demo);
        draft[index] = entity;
      } else if (method === "toggleRule") {
        entity = { ...draft[index], enabled: params.enabled, updatedAt: now };
        validateRule(entity);
        draft[index] = entity;
      } else if (method === "copyRule") {
        const id = nextDemoEntityId("rule_demo_copy_", "ruleSequence", new Set(draft.map(function (rule) { return rule.id; })));
        entity = { ...JSON.parse(JSON.stringify(draft[index])), id, name: draft[index].name + " 副本", createdAt: now, updatedAt: now };
        validateRule(entity);
        draft.push(entity);
      } else if (method === "deleteRule") {
        draft.splice(index, 1);
      }
    }
    state.demoStore.rules = draft;
    state.demoStore.revision += 1;
    if (method === "deleteRule") return { revision: state.demoStore.revision };
    return { revision: state.demoStore.revision, entity: JSON.parse(JSON.stringify(entity)) };
  }

  function demoValidateRuleReferences(rule, demo) {
    const conditions = new Set(demo.conditionEntities.concat(demo.pickerConditions).map(function (item) { return item.id; }));
    const fields = new Set(demo.fields.concat(demo.pickerFields).map(function (item) { return item.id; }));
    const actors = new Set(demo.actors.concat(demo.pickerActors).map(function (item) { return item.characterId; }));
    const groups = new Set(demo.groups.concat(demo.pickerGroups).map(function (item) { return item.characterGroupId; }));
    const effects = new Set(demo.effectEntities.concat(demo.pickerEffects).map(function (item) { return item.id; }));
    if (!conditions.has(rule.conditionId)) throw new Error("MVU_RULE_CONDITION_NOT_FOUND:" + rule.conditionId);
    if (rule.triggerActorSelector.kind === "selected" && rule.triggerActorSelector.actorIds.some(function (id) { return !actors.has(id); })) {
      throw new Error("MVU_RULE_ACTOR_NOT_FOUND");
    }
    if (rule.triggerActorSelector.kind === "group" && rule.triggerActorSelector.groupIds.some(function (id) { return !groups.has(id); })) {
      throw new Error("MVU_RULE_GROUP_NOT_FOUND");
    }
    rule.actions.forEach(function (action) {
      if (action.kind === "activate_effect_group") {
        if (!effects.has(action.effectGroupId)) throw new Error("MVU_RULE_EFFECT_GROUP_NOT_FOUND:" + action.effectGroupId);
        return;
      }
      if (!fields.has(action.fieldId)) throw new Error("MVU_RULE_FIELD_NOT_FOUND:" + action.fieldId);
      if (action.target.kind === "selected" && action.target.actorIds.some(function (id) { return !actors.has(id); })) {
        throw new Error("MVU_RULE_TARGET_ACTOR_NOT_FOUND");
      }
      if (action.effectGroupIds.some(function (id) { return !effects.has(id); })) throw new Error("MVU_RULE_EFFECT_GROUP_NOT_FOUND");
    });
  }

  function demoMutateEffectGroup(method, params, demo) {
    requireDemoRevision(params);
    const draft = JSON.parse(JSON.stringify(state.demoStore.effectGroups));
    const now = new Date().toISOString();
    let entity = null;
    if (method === "createEffectGroup") {
      const id = nextDemoEntityId("effect_demo_created_", "effectSequence", new Set(draft.map(function (effect) { return effect.id; })));
      entity = { ...JSON.parse(JSON.stringify(params.effectGroup)), id, createdAt: now, updatedAt: now };
      validateEffectGroup(entity);
      demoValidateEffectReferences(entity, demo);
      draft.push(entity);
    } else {
      const index = draft.findIndex(function (effect) { return effect.id === params.id; });
      if (index < 0) throw new Error("MVU_EFFECT_GROUP_NOT_FOUND:" + params.id);
      if (method === "updateEffectGroup") {
        entity = { ...draft[index], ...JSON.parse(JSON.stringify(params.patch || {})), id: params.id, updatedAt: now };
        validateEffectGroup(entity);
        demoValidateEffectReferences(entity, demo);
        draft[index] = entity;
      } else if (method === "toggleEffectGroup") {
        entity = { ...draft[index], enabled: params.enabled, updatedAt: now };
        validateEffectGroup(entity);
        draft[index] = entity;
      } else if (method === "copyEffectGroup") {
        const id = nextDemoEntityId("effect_demo_copy_", "effectSequence", new Set(draft.map(function (effect) { return effect.id; })));
        entity = { ...JSON.parse(JSON.stringify(draft[index])), id, name: draft[index].name + " 副本", createdAt: now, updatedAt: now };
        entity.fieldEffects.forEach(function (fieldEffect, indexValue) { fieldEffect.id = id + "_field_" + (indexValue + 1); });
        validateEffectGroup(entity);
        draft.push(entity);
      } else if (method === "deleteEffectGroup") {
        const referenced = state.demoStore.rules.some(function (rule) {
          return rule.actions.some(function (action) {
            return action.kind === "activate_effect_group" ? action.effectGroupId === params.id : action.effectGroupIds.includes(params.id);
          });
        });
        if (referenced) throw new Error("MVU_EFFECT_GROUP_REFERENCED");
        draft.splice(index, 1);
      }
    }
    state.demoStore.effectGroups = draft;
    state.demoStore.revision += 1;
    if (method === "deleteEffectGroup") return { revision: state.demoStore.revision };
    return { revision: state.demoStore.revision, entity: JSON.parse(JSON.stringify(entity)) };
  }

  function demoValidateEffectReferences(effect, demo) {
    const fields = new Map(demo.fields.concat(demo.pickerFields).map(function (item) { return [item.id, item]; }));
    const actors = new Set(demo.actors.concat(demo.pickerActors).map(function (item) { return item.characterId; }));
    const seen = new Set();
    effect.fieldEffects.forEach(function (fieldEffect) {
      const field = fields.get(fieldEffect.fieldId);
      if (!field) throw new Error("MVU_EFFECT_FIELD_NOT_FOUND:" + fieldEffect.fieldId);
      if (seen.has(fieldEffect.fieldId)) throw new Error("MVU_EFFECT_FIELD_DUPLICATE:" + fieldEffect.fieldId);
      seen.add(fieldEffect.fieldId);
      if (field.scope !== "character" && fieldEffect.actorSelector.kind !== "all_bound") throw new Error("MVU_EFFECT_ACTOR_SCOPE_INVALID");
      if (fieldEffect.actorSelector.kind === "selected" && fieldEffect.actorSelector.actorIds.some(function (id) { return !actors.has(id); })) {
        throw new Error("MVU_EFFECT_ACTOR_NOT_FOUND");
      }
    });
  }

  function demoCopyConditionExpression(expression) {
    const result = JSON.parse(JSON.stringify(expression));
    (function visit(node) {
      if (node.kind === "predicate" && node.predicate.kind === "ai_semantic") {
        state.demoStore.aiSequence += 1;
        node.predicate.id = "ai_demo_copy_" + state.demoStore.aiSequence;
      } else if (node.kind === "not") visit(node.child);
      else if (node.kind === "and" || node.kind === "or") node.children.forEach(visit);
    }(result));
    return result;
  }

  function demoValidateConditionReferences(expression, demo) {
    const fields = new Set(demo.fields.concat(demo.pickerFields).map(function (field) { return field.id; }));
    const actors = new Set(demo.actors.concat(demo.pickerActors).map(function (actor) { return actor.characterId; }));
    const groups = new Set(demo.groups.concat(demo.pickerGroups).map(function (group) { return group.characterGroupId; }));
    const aiIds = new Set();
    (function visit(node) {
      if (node.kind === "and" || node.kind === "or") return node.children.forEach(visit);
      if (node.kind === "not") return visit(node.child);
      const predicate = node.predicate;
      if (predicate.kind === "field_comparison" && !fields.has(predicate.fieldId)) throw new Error("MVU_CONDITION_FIELD_NOT_FOUND:" + predicate.fieldId);
      if (predicate.kind === "actor" && predicate.actorIds.some(function (id) { return !actors.has(id); })) throw new Error("MVU_CONDITION_ACTOR_NOT_FOUND");
      if (predicate.kind === "group" && predicate.groupIds.some(function (id) { return !groups.has(id); })) throw new Error("MVU_CONDITION_GROUP_NOT_FOUND");
      if (predicate.kind === "ai_semantic") {
        if (aiIds.has(predicate.id)) throw new Error("MVU_V3_CONDITION_AI_ID_DUPLICATE");
        aiIds.add(predicate.id);
      }
    }(expression));
  }

  function demoExportFieldTemplate(demo, request) {
    const candidates = demo.fields.concat(demo.pickerFields);
    const fields = request.fieldIds.map(function (fieldId) {
      const field = candidates.find(function (candidate) { return candidate.id === fieldId; });
      if (!field) throw new Error("MVU_FIELD_TEMPLATE_FIELD_NOT_FOUND:" + fieldId);
      const matrix = request.targetSelections.find(function (selection) { return selection.fieldId === fieldId; });
      const directory = field.scope === "group"
        ? demo.groups.concat(demo.pickerGroups).map(function (item) { return { id: item.characterGroupId, name: item.name }; })
        : demo.actors.concat(demo.pickerActors).map(function (item) { return { id: item.characterId, name: item.name }; });
      const sourceTargets = field.scope === "character" || field.scope === "group"
        ? (matrix ? matrix.targets : []).filter(function (target) { return target.enabled; }).map(function (target) {
            if (!field.bindingIds.includes(target.targetId)) throw new Error("MVU_FIELD_TEMPLATE_TARGET_NOT_BOUND:" + target.targetId);
            const local = directory.find(function (entry) { return entry.id === target.targetId; });
            const sourceTarget = {
              kind: field.scope === "group" ? "group" : "actor",
              sourceId: target.targetId,
              name: local ? local.name : target.targetId,
              enabled: true,
            };
            if (target.includeValue) sourceTarget.value = field.currentValue === null ? field.initialValue : field.currentValue;
            return sourceTarget;
          })
        : [];
      return {
        sourceFieldId: field.id,
        definition: demoPortableFieldDefinition(field),
        sourceTargets,
        omittedDependencies: {
          items: field.id === "affinity"
            ? [{ kind: "rule", sourceId: "rule-1", readableName: "关心回应" }]
            : [],
          totalCount: field.id === "affinity" ? 1 : 0,
          truncated: false,
        },
      };
    });
    const document = {
      format: "operit-mvu-field-template",
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      checksum: { algorithm: "fnv1a32", value: "demo0001" },
      fields,
    };
    state.demoLastFieldTemplateJson = JSON.stringify(document);
    const fileName = "operit-mvu-field-template-demo-20260825-120000Z.json";
    return {
      fileName,
      savedPath: "/storage/emulated/0/Download/Operit/MVU/" + fileName,
      summary: {
        fieldCount: fields.length,
        targetCount: fields.reduce(function (sum, field) { return sum + field.sourceTargets.length; }, 0),
        valueCount: fields.reduce(function (sum, field) { return sum + field.sourceTargets.filter(function (target) { return target.value !== undefined; }).length; }, 0),
      },
    };
  }

  function demoPortableFieldDefinition(field) {
    return {
      name: field.name,
      description: field.description,
      minimum: field.minimum,
      maximum: field.maximum,
      step: field.step,
      initialValue: field.initialValue,
      icon: field.icon,
      themeColor: field.themeColor,
      enabled: field.enabled,
      scope: field.scope,
      modelVisibility: field.modelVisibility,
      ai: JSON.parse(JSON.stringify(field.ai)),
      stages: JSON.parse(JSON.stringify(field.stages)),
      naturalChange: JSON.parse(JSON.stringify(field.naturalChange)),
      perTurnChange: JSON.parse(JSON.stringify(field.perTurnChange)),
      order: field.order,
    };
  }

  function demoPreviewFieldTemplate(demo, json) {
    let document;
    try {
      document = JSON.parse(json);
    } catch (_error) {
      throw new Error("MVU_FIELD_TEMPLATE_JSON_INVALID");
    }
    if (!document || document.format !== "operit-mvu-field-template" || document.schemaVersion !== 1 || !Array.isArray(document.fields)) {
      throw new Error("MVU_FIELD_TEMPLATE_FORMAT_INVALID");
    }
    const localFields = demo.fields.concat(demo.pickerFields);
    const actorDirectory = demo.actors.concat(demo.pickerActors);
    const groupDirectory = demo.groups.concat(demo.pickerGroups);
    const occupied = new Set(localFields.map(function (field) { return field.id; }));
    const fields = document.fields.map(function (entry) {
      const existing = localFields.find(function (field) { return field.id === entry.sourceFieldId; });
      return {
        sourceFieldId: entry.sourceFieldId,
        name: entry.definition.name,
        scope: entry.definition.scope,
        conflict: existing ? "id" : "none",
        proposedCopyId: demoCopyId(entry.sourceFieldId, occupied),
        updateCompatibility: existing
          ? { available: existing.scope === entry.definition.scope, localScope: existing.scope, reason: existing.scope === entry.definition.scope ? null : "scope_mismatch" }
          : { available: false, localScope: null, reason: "no_local_field" },
        config: {
          stages: entry.definition.stages.length,
          naturalChange: entry.definition.naturalChange.enabled,
          perTurnChange: entry.definition.perTurnChange.enabled,
          ai: entry.definition.ai.enabled,
          appearance: Boolean(entry.definition.icon && entry.definition.themeColor),
        },
      };
    });
    const mappingNeeds = document.fields.filter(function (entry) {
      return entry.definition.scope === "character" || entry.definition.scope === "group";
    }).map(function (entry) {
      const directory = entry.definition.scope === "group" ? groupDirectory : actorDirectory;
      return {
        fieldId: entry.sourceFieldId,
        scope: entry.definition.scope,
        requiresLocalTargets: entry.sourceTargets.length === 0,
        templateValueAvailable: entry.sourceTargets.some(function (target) { return target.value !== undefined; }),
        sourceTargets: entry.sourceTargets.map(function (target) {
          const exact = directory.find(function (candidate) {
            return (candidate.characterId || candidate.characterGroupId) === target.sourceId;
          });
          const result = {
            kind: target.kind,
            sourceId: target.sourceId,
            name: target.name,
            hasValue: target.value !== undefined,
            requiresSearch: !exact,
          };
          if (exact) result.suggestedTarget = {
            targetId: exact.characterId || exact.characterGroupId,
            name: exact.name,
            reason: "stable_id",
          };
          if (target.value !== undefined) {
            const adjusted = demoNormalizeTemplateValue(entry.definition, target.value);
            if (adjusted !== target.value) result.valueAdjustment = {
              from: target.value,
              to: adjusted,
              reason: target.value < entry.definition.minimum || target.value > entry.definition.maximum ? "clamp" : "step",
            };
          }
          return result;
        }),
      };
    });
    return {
      valid: true,
      revision: state.demoStore.revision,
      format: document.format,
      schemaVersion: document.schemaVersion,
      fields,
      mappingNeeds,
      omittedDependencies: document.fields.map(function (entry) { return { fieldId: entry.sourceFieldId, ...entry.omittedDependencies }; }),
      invalidReferences: [],
    };
  }

  function demoImportFieldTemplate(demo, request) {
    if (request.expectedRevision !== state.demoStore.revision) throw new Error("MVU_STALE_REVISION");
    const document = JSON.parse(request.json);
    if (!document || document.format !== "operit-mvu-field-template" || document.schemaVersion !== 1 || !Array.isArray(document.fields)) {
      throw new Error("MVU_FIELD_TEMPLATE_FORMAT_INVALID");
    }
    if (!request.decisions || !Array.isArray(request.decisions.fields) || request.decisions.fields.length !== document.fields.length) {
      throw new Error("MVU_FIELD_TEMPLATE_DECISIONS_INVALID");
    }
    const decisionById = new Map(request.decisions.fields.map(function (decision) { return [decision.sourceFieldId, decision]; }));
    if (decisionById.size !== document.fields.length || document.fields.some(function (entry) { return !decisionById.has(entry.sourceFieldId); })) {
      throw new Error("MVU_FIELD_TEMPLATE_DECISIONS_INVALID");
    }
    const summary = { created: [], updated: [], replaced: [], skippedTargets: 0, valueWrites: 0 };
    const draftFields = JSON.parse(JSON.stringify(state.demoStore.fields));
    const draftValues = JSON.parse(JSON.stringify(state.demoStore.stateValues || {}));
    const virtualFields = demo.pickerFields || [];
    const occupied = new Set(draftFields.concat(virtualFields).map(function (field) { return field.id; }));
    const actorIds = new Set(demo.actors.concat(demo.pickerActors).map(function (actor) { return actor.characterId; }));
    const groupIds = new Set(demo.groups.concat(demo.pickerGroups).map(function (group) { return group.characterGroupId; }));
    document.fields.forEach(function (entry) {
      const decision = decisionById.get(entry.sourceFieldId);
      const strategy = decision.strategy || "create_copy";
      if (!["create_copy", "update", "replace"].includes(strategy)) throw new Error("MVU_FIELD_TEMPLATE_STRATEGY_INVALID");
      const existingIndex = draftFields.findIndex(function (field) { return field.id === entry.sourceFieldId; });
      const virtualExisting = virtualFields.find(function (field) { return field.id === entry.sourceFieldId; });
      const local = existingIndex >= 0 ? draftFields[existingIndex] : virtualExisting || null;
      if ((strategy === "update" || strategy === "replace") && !local) throw new Error("MVU_FIELD_TEMPLATE_CONFLICT_REQUIRED");
      if (strategy === "update") {
        if (decision.unboundTargets !== undefined || (decision.mappings || []).length > 0) {
          throw new Error("MVU_FIELD_TEMPLATE_MAPPING_SCOPE_INVALID");
        }
        if (local.scope !== entry.definition.scope) throw new Error("MVU_FIELD_TEMPLATE_UPDATE_SCOPE_MISMATCH");
        const updated = { ...JSON.parse(JSON.stringify(entry.definition)), id: local.id, bindingIds: local.bindingIds.slice(), order: local.order };
        if (existingIndex >= 0) draftFields[existingIndex] = updated;
        else draftFields.push(updated);
        summary.updated.push(updated.id);
        return;
      }
      const id = strategy === "create_copy" ? demoCopyId(entry.sourceFieldId, occupied) : entry.sourceFieldId;
      const resolved = demoResolveTemplateTargets(entry, decision, actorIds, groupIds, summary);
      const bindingIds = entry.definition.scope === "chat"
        ? [demo.snapshot.activeContext.chatId].filter(Boolean)
        : entry.definition.scope === "global" ? [] : resolved.bindingIds;
      const next = {
        ...JSON.parse(JSON.stringify(entry.definition)),
        id,
        bindingIds,
        order: local ? local.order : draftFields.length,
      };
      if (strategy === "replace") {
        if (existingIndex >= 0) draftFields[existingIndex] = next;
        else draftFields.push(next);
        Object.keys(draftValues).forEach(function (scopeKey) { delete draftValues[scopeKey][id]; });
        summary.replaced.push(id);
      } else {
        draftFields.push(next);
        summary.created.push(id);
      }
      resolved.writes.forEach(function (write) {
        const scopeKey = entry.definition.scope + ":" + write.targetId;
        const existingValue = ((state.demoStore.stateValues || {})[scopeKey] || {})[entry.sourceFieldId];
        const value = write.valuePolicy === "template_value"
          ? demoNormalizeTemplateValue(next, write.templateValue)
          : write.valuePolicy === "keep_existing" && existingValue !== undefined ? existingValue : next.initialValue;
        draftValues[scopeKey] = draftValues[scopeKey] || {};
        draftValues[scopeKey][id] = value;
        summary.valueWrites += 1;
      });
      occupied.add(id);
    });
    state.demoStore.fields = draftFields;
    state.demoStore.stateValues = draftValues;
    state.demoStore.revision += 1;
    return { revision: state.demoStore.revision, summary };
  }

  function demoResolveTemplateTargets(entry, decision, actorIds, groupIds, summary) {
    const scope = entry.definition.scope;
    if (scope !== "character" && scope !== "group") {
      if (decision.unboundTargets !== undefined || (decision.mappings || []).length > 0) {
        throw new Error("MVU_FIELD_TEMPLATE_MAPPING_SCOPE_INVALID");
      }
      return { bindingIds: [], writes: [] };
    }
    const validIds = scope === "group" ? groupIds : actorIds;
    const sourceTargets = entry.sourceTargets || [];
    let targetGroups;
    if (sourceTargets.length === 0) {
      if ((decision.mappings || []).length > 0 || !Array.isArray(decision.unboundTargets) || decision.unboundTargets.length === 0) {
        throw new Error("MVU_FIELD_TEMPLATE_UNBOUND_TARGETS_REQUIRED");
      }
      targetGroups = [{ source: null, targets: decision.unboundTargets }];
    } else {
      if (decision.unboundTargets !== undefined || !Array.isArray(decision.mappings) || decision.mappings.length !== sourceTargets.length) {
        throw new Error("MVU_FIELD_TEMPLATE_MAPPING_MISSING");
      }
      const mappingBySource = new Map(decision.mappings.map(function (mapping) { return [mapping.sourceTargetId, mapping]; }));
      if (mappingBySource.size !== sourceTargets.length || sourceTargets.some(function (source) { return !mappingBySource.has(source.sourceId); })) {
        throw new Error("MVU_FIELD_TEMPLATE_MAPPING_MISSING");
      }
      targetGroups = sourceTargets.map(function (source) {
        return { source, targets: mappingBySource.get(source.sourceId).targets };
      });
    }
    const seen = new Set();
    const bindingIds = [];
    const writes = [];
    targetGroups.forEach(function (group) {
      if (!Array.isArray(group.targets)) throw new Error("MVU_FIELD_TEMPLATE_MAPPING_INVALID");
      group.targets.forEach(function (target) {
        if (!target || typeof target.targetId !== "string" || seen.has(target.targetId)) {
          throw new Error("MVU_FIELD_TEMPLATE_MAPPING_DUPLICATE");
        }
        seen.add(target.targetId);
        if (!validIds.has(target.targetId)) throw new Error("MVU_FIELD_TEMPLATE_MAPPING_TARGET_INVALID:" + target.targetId);
        if (!["template_value", "keep_existing", "field_initial"].includes(target.valuePolicy)) {
          throw new Error("MVU_FIELD_TEMPLATE_VALUE_POLICY_INVALID");
        }
        if (!group.source && target.valuePolicy === "template_value") throw new Error("MVU_FIELD_TEMPLATE_UNBOUND_TEMPLATE_VALUE_INVALID");
        if (group.source && target.valuePolicy === "template_value" && group.source.value === undefined) {
          throw new Error("MVU_FIELD_TEMPLATE_VALUE_MISSING");
        }
        if (!target.enabled) {
          summary.skippedTargets += 1;
          return;
        }
        bindingIds.push(target.targetId);
        writes.push({ ...target, templateValue: group.source ? group.source.value : undefined });
      });
    });
    return { bindingIds, writes };
  }

  function demoCopyId(sourceId, occupied) {
    let candidate = sourceId + "_copy";
    let suffix = 2;
    while (occupied.has(candidate)) candidate = sourceId + "_copy_" + suffix++;
    return candidate;
  }

  function demoNormalizeTemplateValue(field, value) {
    const clamped = Math.min(field.maximum, Math.max(field.minimum, value));
    return Math.min(field.maximum, Math.max(field.minimum,
      Number((field.minimum + Math.round((clamped - field.minimum) / field.step) * field.step).toPrecision(15))));
  }

  function isDemoPickerRequest(method, params) {
    if (method === "queryFields" && params && params.filters && params.filters.mode === "picker") return true;
    return Boolean(state.entityPicker && state.entityPicker.definition.method === method);
  }

  function demoPickerResponse(response, params, picker, source) {
    if (!picker) return Promise.resolve(response);
    const search = params && typeof params.search === "string" ? params.search : "";
    if (state.demoPickerControls.failSearch && search === state.demoPickerControls.failSearch) {
      return Promise.reject(new Error("demo picker failure"));
    }
    if (state.demoPickerControls.oversizeSearch && search === state.demoPickerControls.oversizeSearch) {
      const items = source.slice(0, 31);
      return Promise.resolve({ items, loadedCount: items.length, totalCount: Math.max(31, source.length), hasMore: true,
        nextCursor: "demo_fault_oversize" });
    }
    if (state.demoPickerControls.badCursorSearch && search === state.demoPickerControls.badCursorSearch) {
      const items = source.slice(0, Math.min(30, source.length));
      return Promise.resolve({ items, loadedCount: items.length, totalCount: source.length, hasMore: true,
        nextCursor: "demo_bad_cursor" });
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

  function demoQuery(source, request, pageSize, idKey, cursorMode, cursorEntity) {
    const params = request || {};
    const filters = params.filters || {};
    const normalizedSearch = normalizeDemoSearch(params.search || "");
    let items = source.filter(function (item) {
      if (normalizedSearch && !normalizeDemoSearch([item[idKey], item.name, item.description].filter(Boolean).join(" ")).includes(normalizedSearch)) {
        return false;
      }
      if (typeof filters.enabled === "boolean" && item.enabled !== filters.enabled) return false;
      if (typeof filters.scope === "string" && item.scope !== filters.scope) return false;
      if (typeof filters.type === "string" && item.modelVisibility !== filters.type) return false;
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
    const cursorFingerprint = demoCursorFingerprint(params);
    let cursorOffset = 0;
    if (cursorMode && typeof params.cursor === "string") {
      const cursor = state.demoCursors.get(params.cursor);
      state.demoCursors.delete(params.cursor);
      if (!cursor || cursor.entity !== cursorEntity || cursor.fingerprint !== cursorFingerprint) {
        throw new Error("demo cursor invalid");
      }
      cursorOffset = cursor.offset;
    }
    const offset = cursorMode ? cursorOffset : ((params.page || 1) - 1) * pageSize;
    const result = items.slice(offset, offset + pageSize);
    const hasMore = offset + result.length < items.length;
    return {
      items: result,
      loadedCount: result.length,
      totalCount: items.length,
      hasMore,
      nextCursor: cursorMode && hasMore ? issueDemoCursor(cursorEntity, cursorFingerprint, offset + result.length) : null,
    };
  }

  function demoCursorFingerprint(request) {
    const filters = Object.entries(request.filters || {}).sort(function (left, right) {
      return left[0].localeCompare(right[0], "en");
    });
    return JSON.stringify({ search: normalizeDemoSearch(request.search || ""), filters, sort: request.sort || null });
  }

  function issueDemoCursor(entity, fingerprint, offset) {
    state.demoCursorSequence += 1;
    const token = "demo_c1_" + state.demoCursorSequence.toString(36).padStart(4, "0");
    state.demoCursors.set(token, { entity, fingerprint, offset });
    while (state.demoCursors.size > 64) state.demoCursors.delete(state.demoCursors.keys().next().value);
    return token;
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
    const pickerActors = Array.from({ length: 96 }, function (_value, index) {
      const ordinal = String(index + 1).padStart(3, "0");
      return { characterId: "picker-actor-" + ordinal, name: "游标角色 " + ordinal, avatarUri: null, enabled: true };
    });
    const pickerGroups = Array.from({ length: 96 }, function (_value, index) {
      const ordinal = String(index + 1).padStart(3, "0");
      return { characterGroupId: "picker-group-" + ordinal, name: "游标群组 " + ordinal, avatarUri: null };
    });
    const groupMembers = {
      "group-a": actors.concat(pickerActors.filter(function (_actor, index) { return index % 2 === 0; })),
      "group-b": [actors[1]].concat(pickerActors.filter(function (_actor, index) { return index % 2 === 1; })),
    };
    const requestedGroup = groups.concat(pickerGroups).find(function (group) { return group.characterGroupId === request.groupId; }) || groups[0];
    const requestedActorCandidate = actors.concat(pickerActors).find(function (actor) { return actor.characterId === request.actorId; }) || null;
    const requestedMembers = groupMembers[requestedGroup.characterGroupId] || [];
    const requestedActor = requestedActorCandidate && request.groupId &&
        !requestedMembers.some(function (actor) { return actor.characterId === requestedActorCandidate.characterId; })
      ? null
      : requestedActorCandidate;
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
      defaultReason: { mode: "template", template: "general", text: "" },
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
        defaultReason: { mode: "template", template: "general", text: "" },
        createdAt: timestamp, updatedAt: timestamp };
    });
    const demoRecords = Array.from({ length: 20 }, function (_value, index) {
      return { id: "demo-record-" + index, fieldId: "demo-field-01", fieldName: "演示字段 01", actorId: "operit",
        actorName: "Operit", groupId: "group-a", before: index, after: index + 1, delta: 1,
        reason: "分页验证记录", source: "manual", occurredAt: now - (index + 4) * 3600000, truncated: false };
    });
    function projectFieldForDemo(candidate) {
      const applies = candidate.scope === "global" || candidate.scope === "chat" ||
        (candidate.scope === "character" && activeActor && candidate.bindingIds.includes(activeActor.characterId)) ||
        (candidate.scope === "group" && candidate.bindingIds.includes(requestedGroup.characterGroupId));
      const currentValue = applies ? Math.max(candidate.minimum, Math.min(candidate.maximum, value + candidate.order % 7)) : null;
      const currentStage = currentValue === null ? null : candidate.stages.slice().reverse().find(function (item) {
        return currentValue >= item.threshold;
      }) || candidate.stages[0];
      const bindingNames = candidate.scope === "character"
        ? candidate.bindingIds.map(function (id) { return actors.find(function (actor) { return actor.characterId === id; })?.name || id; })
        : candidate.scope === "group"
          ? candidate.bindingIds.map(function (id) { return groups.find(function (group) { return group.characterGroupId === id; })?.name || id; })
          : [];
      return {
        ...candidate,
        currentValue,
        currentStage,
        bindingDisplay: candidate.scope === "global" ? "所有角色、群组和会话"
          : candidate.scope === "chat" ? "当前会话"
            : bindingNames.length ? bindingNames.join("、") : "未绑定",
        scopeKey: currentValue === null ? null
          : candidate.scope === "character" ? "character:" + activeActor.characterId
            : candidate.scope === "group" ? "group:" + requestedGroup.characterGroupId
              : candidate.scope === "chat" ? "chat:chat-a" : "global",
      };
    }
    const sharedGroupField = {
      ...field, id: "shared-group-value", name: "共享群组值", description: "按群组共享的演示字段",
      scope: "group", bindingIds: ["group-a", "group-b"], order: 90,
      stages: stages.map(function (item) { return { ...item, id: item.id + "-shared-group" }; }),
    };
    const globalField = {
      ...field, id: "global-shared-value", name: "全局共享值", description: "所有上下文读取同一值",
      scope: "global", bindingIds: [], order: 91,
      stages: stages.map(function (item) { return { ...item, id: item.id + "-global" }; }),
    };
    const initialFields = [field].concat(demoFields);
    if (!state.demoStore.fields) state.demoStore.fields = JSON.parse(JSON.stringify(initialFields));
    const allFields = state.demoStore.fields.map(projectFieldForDemo);
    if (!state.demoStore.rules) state.demoStore.rules = JSON.parse(JSON.stringify(ruleEntities.concat(demoRuleEntities)));
    if (!state.demoStore.conditions) state.demoStore.conditions = JSON.parse(JSON.stringify(conditionEntities.concat(demoConditionEntities)));
    if (!state.demoStore.effectGroups) state.demoStore.effectGroups = JSON.parse(JSON.stringify(effectEntities.concat(demoEffectEntities)));
    const allRuleEntities = state.demoStore.rules.map(function (rule) { return JSON.parse(JSON.stringify(rule)); });
    const allConditionEntities = state.demoStore.conditions.map(function (condition) { return JSON.parse(JSON.stringify(condition)); });
    const allEffectEntities = state.demoStore.effectGroups.map(function (effect) { return JSON.parse(JSON.stringify(effect)); });
    const allRecords = records.concat(demoRecords);
    const pickerFields = [sharedGroupField, globalField].concat(Array.from({ length: 96 }, function (_value, index) {
      const ordinal = String(index + 1).padStart(3, "0");
      return {
        ...field,
        id: "picker-field-" + ordinal,
        name: "游标字段 " + ordinal,
        description: "浏览器高基数字段选择数据",
        bindingIds: ["picker-actor-001", "picker-actor-002"],
        stages: stages.map(function (item) { return { ...item, id: item.id + "-picker-" + ordinal }; }),
        order: index,
      };
    })).map(projectFieldForDemo);
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
        revision: state.demoStore.revision, snapshotTruncated: false,
        activeContext: { chatId: "chat-a", actorId: activeActor ? activeActor.characterId : null,
          groupId: requestedGroup.characterGroupId, actorName: activeActor ? activeActor.name : requestedGroup.name, truncated: false },
        settings: { aiEnabled: true }, migrationStatus: { mode: "v3", source: "existing", truncated: false },
        counts: { fields: allFields.length, actors: pickerActors.length, groups: pickerGroups.length, rules: allRuleEntities.length,
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
