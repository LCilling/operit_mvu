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

  const requestedRoute = queryState.get("route") || queryState.get("screen") || "status";
  const initialRoute = ROUTES[requestedRoute] ? requestedRoute : "status";
  const state = {
    route: initialRoute,
    snapshot: null,
    pages: {},
    directory: { actors: [], groups: [] },
    entities: new Map(),
    chartModels: new Map(),
    detailRecords: null,
    statusMode: "character",
    selectedFieldId: queryState.get("field") || "",
    selectedEntityId: "",
    drawerOpen: false,
    busy: false,
    fatal: null,
    routeError: null,
    lastActorId: "",
    routeTrail: [initialRoute],
    demo: queryState.get("demo") === "1",
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
  }

  function validateActor(actor) {
    validateIdentity(actor, "characterId", "MVU_ACTOR_INVALID");
    requireBoolean(actor.enabled, "MVU_ACTOR_INVALID");
    if (actor.avatarUri !== undefined && actor.avatarUri !== null) requireString(actor.avatarUri, "MVU_ACTOR_INVALID");
  }

  function validateGroup(group) {
    validateIdentity(group, "characterGroupId", "MVU_GROUP_INVALID");
    if (group.avatarUri !== undefined && group.avatarUri !== null) requireString(group.avatarUri, "MVU_GROUP_INVALID");
  }

  function validateFieldEntity(field) {
    if (isRecord(field.range)) return validateFieldSummary(field);
    validateIdentity(field, "id", "MVU_FIELD_INVALID");
    if (!finiteNumber(field.minimum) || !finiteNumber(field.maximum) || field.minimum >= field.maximum ||
        !finiteNumber(field.step) || field.step <= 0 || !Array.isArray(field.stages)) throw new Error("MVU_FIELD_INVALID");
  }

  function validateRule(rule) {
    validateIdentity(rule, "id", "MVU_RULE_INVALID");
    requireBoolean(rule.enabled, "MVU_RULE_INVALID");
    requireString(rule.conditionId, "MVU_RULE_INVALID");
    if ("actionCount" in rule) {
      if (!nonNegativeInteger(rule.actionCount) || !Number.isSafeInteger(rule.executionOrder)) throw new Error("MVU_RULE_INVALID");
    } else if (!Array.isArray(rule.actions)) throw new Error("MVU_RULE_INVALID");
  }

  function validateCondition(condition) {
    validateIdentity(condition, "id", "MVU_CONDITION_INVALID");
    requireBoolean(condition.enabled, "MVU_CONDITION_INVALID");
    if ("rootKind" in condition) {
      if (!["all", "any", "not", "predicate"].includes(condition.rootKind)) throw new Error("MVU_CONDITION_INVALID");
    } else if (!isRecord(condition.expression)) throw new Error("MVU_CONDITION_INVALID");
  }

  function validateEffectGroup(effect) {
    validateIdentity(effect, "id", "MVU_EFFECT_GROUP_INVALID");
    requireBoolean(effect.enabled, "MVU_EFFECT_GROUP_INVALID");
    if ("fieldCount" in effect) {
      if (!nonNegativeInteger(effect.fieldCount)) throw new Error("MVU_EFFECT_GROUP_INVALID");
    } else if (!Array.isArray(effect.fieldEffects)) throw new Error("MVU_EFFECT_GROUP_INVALID");
  }

  function validateRecord(record) {
    if (!isRecord(record)) throw new Error("MVU_RECORD_INVALID");
    requireString(record.id, "MVU_RECORD_INVALID");
    requireString(record.fieldId, "MVU_RECORD_INVALID");
    if (record.actorId !== null) requireString(record.actorId, "MVU_RECORD_INVALID");
    if (record.groupId !== null) requireString(record.groupId, "MVU_RECORD_INVALID");
    if (!finiteNumber(record.before) || !finiteNumber(record.after) || !finiteNumber(record.delta) ||
        !finiteNumber(record.occurredAt)) throw new Error("MVU_RECORD_INVALID");
    requireString(record.reason, "MVU_RECORD_INVALID");
  }

  function validateFieldSummary(field) {
    if (!isRecord(field)) throw new Error("MVU_FIELD_SUMMARY_INVALID");
    requireString(field.id, "MVU_FIELD_SUMMARY_ID_INVALID");
    requireString(field.name, "MVU_FIELD_SUMMARY_NAME_INVALID");
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
      requireString(field.current.stage.name, "MVU_FIELD_STAGE_INVALID");
    }
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
    requireString(snapshot.contextLabels.chatName, "MVU_CONTEXT_LABEL_INVALID");
    ["fields", "actors", "groups", "rules", "conditions", "effectGroups", "records"].forEach(function (key) {
      if (!nonNegativeInteger(snapshot.counts[key])) throw new Error("MVU_PAGE_COUNT_INVALID:" + key);
    });
    const pageKeys = ["fields", "rules", "conditions", "effectGroups", "records"];
    pageKeys.forEach(function (key) { validateQueryResponse(snapshot.pages[key], key); });
    if (snapshot.selected.actor !== null) validateActor(snapshot.selected.actor);
    if (snapshot.selected.group !== null) validateGroup(snapshot.selected.group);
    requireBoolean(snapshot.snapshotTruncated, "MVU_PAGE_SNAPSHOT_TRUNCATION_INVALID");
    Object.keys(snapshot.returnedCount).forEach(function (key) {
      if (!nonNegativeInteger(snapshot.returnedCount[key])) throw new Error("MVU_PAGE_RETURNED_COUNT_INVALID:" + key);
    });
    return snapshot;
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

  async function getEntity(entityType, id) {
    if (typeof id !== "string" || id.length === 0) throw new Error("MVU_ENTITY_ID_MISSING");
    const key = entityType + ":" + id;
    if (state.entities.has(key)) return state.entities.get(key);
    const entity = await native.call("getEntityById", { entityType, id });
    if (!isRecord(entity)) throw new Error("MVU_ENTITY_RESPONSE_INVALID");
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
      if (routeId === "config-fields") {
        state.pages.fields = await query("queryFields", { page: 1 }, "fields");
        state.pages.fields.items.forEach(function (field) {
          state.entities.set("field:" + field.id, field);
        });
      }
      if ((routeId === "status" || routeId === "field-detail") &&
          state.directory.actors.length === 0 && state.directory.groups.length === 0) {
        await loadDirectory();
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
    const demo = demoDataset();
    if (method === "snapshot") return Promise.resolve(demo.snapshot);
    if (method === "queryActors") return Promise.resolve(page(demo.actors));
    if (method === "queryGroups") return Promise.resolve(page(demo.groups));
    if (method === "queryFields") return Promise.resolve(page(demo.fields.slice(0, 5)));
    if (method === "queryRules") return Promise.resolve(page(demo.rules));
    if (method === "queryConditions") return Promise.resolve(page(demo.conditions));
    if (method === "queryEffectGroups") return Promise.resolve(page(demo.effects));
    if (method === "queryRecords") return Promise.resolve(page(demo.records));
    if (method === "getEntityById") {
      const sources = { field: demo.fields, actor: demo.actors, group: demo.groups,
        rule: demo.rules, condition: demo.conditions, effectGroup: demo.effects };
      const idKey = params.entityType === "actor" ? "characterId" :
        params.entityType === "group" ? "characterGroupId" : "id";
      return Promise.resolve((sources[params.entityType] || []).find(function (item) {
        return item[idKey] === params.id;
      }));
    }
    if (method === "exportDataset") return Promise.resolve({ formatVersion: 3, demo: true });
    return Promise.resolve(null);
  }

  function page(items) {
    return { items, loadedCount: items.length, totalCount: items.length, hasMore: false, nextCursor: null };
  }

  function demoDataset() {
    const now = Date.now();
    const stages = [
      { id: "stranger", name: "陌生", threshold: 0, description: "仍在观察彼此的边界。" },
      { id: "warm", name: "熟悉", threshold: 20, description: "互动开始自然。" },
      { id: "close", name: "亲密", threshold: 50, description: "愿意分享重要感受。" },
      { id: "bond", name: "依赖", threshold: 80, description: "关系成为稳定支点。" },
    ];
    const field = {
      id: "affinity", name: "亲密度", description: "与角色的情感关系", minimum: 0, maximum: 100,
      step: 1, initialValue: 35, icon: "favorite", themeColor: "#ff4f88", enabled: true,
      scope: "character", modelVisibility: "full", bindingIds: ["operit"], stages,
      ai: { enabled: true, minConfidence: 0.7, maxDelta: 8, prompt: "" },
      naturalChange: { enabled: false, unitMs: 86400000, amount: 0 },
      perTurnChange: { enabled: false, intervalTurns: 1, amount: 0, countMode: "both" }, order: 0,
    };
    const fieldSummary = {
      id: field.id, name: field.name, description: field.description, enabled: true, scope: "character", order: 0,
      range: { minimum: 0, maximum: 100, step: 1 }, theme: { icon: "favorite", color: "#ff4f88" },
      current: { value: 48, stage: { id: "warm", name: "熟悉", threshold: 20 }, scopeKey: "character:operit", actorId: "operit", groupId: "group-a", chatId: "chat-a" },
      truncated: false,
    };
    const actors = [
      { characterId: "operit", name: "Operit", avatarUri: null, enabled: true },
      { characterId: "bob", name: "MVU_QA_Bob", avatarUri: null, enabled: true },
    ];
    const groups = [
      { characterGroupId: "group-a", name: "MVU_QA_Group", avatarUri: null },
      { characterGroupId: "group-b", name: "夜航小组", avatarUri: null },
    ];
    const records = [0, 1, 2, 3].map(function (index) {
      return { id: "record-" + index, fieldId: "affinity", fieldName: "亲密度", actorId: "operit",
        actorName: "Operit", groupId: "group-a", before: 47 - index, after: 48 - index, delta: 1,
        reason: index === 0 ? "一次真诚的回应" : "自然互动", source: "rule", occurredAt: now - index * 3600000,
        truncated: false };
    });
    const rules = [{ id: "rule-1", name: "关心回应", description: "角色收到明确关心时触发", enabled: true,
      conditionId: "condition-1", actionCount: 1, executionOrder: 1, updatedAt: new Date(now).toISOString(), truncated: false }];
    const conditions = [{ id: "condition-1", name: "主动关心", description: "识别明确的照顾与关心", enabled: true,
      rootKind: "and", updatedAt: new Date(now).toISOString(), truncated: false }];
    const effects = [{ id: "effect-1", name: "安心陪伴", description: "短期提高正向变化", enabled: true,
      fieldCount: 1, updatedAt: new Date(now).toISOString(), truncated: false }];
    const pages = { fields: page([fieldSummary]), rules: page(rules), conditions: page(conditions), effectGroups: page(effects), records: page(records) };
    return {
      fields: [field], actors, groups, records, rules, conditions, effects,
      snapshot: {
        revision: 7, snapshotTruncated: false,
        activeContext: { chatId: "chat-a", actorId: "operit", groupId: "group-a", actorName: "Operit", truncated: false },
        settings: { aiEnabled: true }, migrationStatus: { mode: "v3", source: "existing", truncated: false },
        counts: { fields: 1, actors: 2, groups: 2, rules: 1, conditions: 1, effectGroups: 1, records: 4 },
        selected: { actor: { characterId: "operit", name: "Operit", avatarUri: null, avatarUriUnavailable: false, enabled: true, truncated: false },
          group: { characterGroupId: "group-a", name: "MVU_QA_Group", avatarUri: null, avatarUriUnavailable: false, truncated: false } },
        contextLabels: { groupName: "MVU_QA_Group", chatName: "Operit 的会话", truncated: false },
        returnedCount: { fields: 1, rules: 1, conditions: 1, effectGroups: 1, records: 4 }, pages,
      },
    };
  }
}());
