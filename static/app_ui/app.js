const BACKGROUND_STORAGE_KEY = "operit_mvu.customBackground";
const BACKGROUND_MAX_EDGE = 1600;
const NATIVE_TIMEOUT_MS = 20000;
const NATIVE_MODEL_TIMEOUT_MS = 180000;
const MAX_LINK_CHAIN_DEPTH = 8;
const EMBEDDED_REFERENCE_WIDTH = 393;

const ICON_OPTIONS = [
  { value: "favorite", label: "爱心" },
  { value: "local_fire_department", label: "火焰" },
  { value: "cloud", label: "云朵" },
  { value: "shield", label: "护盾" },
  { value: "auto_awesome", label: "闪光" },
  { value: "mood", label: "心情" },
  { value: "bolt", label: "能量" },
  { value: "spa", label: "成长" },
  { value: "psychology", label: "心理" },
  { value: "star", label: "星标" }
];

const THEME_OPTIONS = [
  { value: "#7058D8", label: "紫罗兰" },
  { value: "#5B91FF", label: "晴空蓝" },
  { value: "#23B878", label: "薄荷绿" },
  { value: "#FF8929", label: "暖橙" },
  { value: "#FF4F88", label: "樱粉" },
  { value: "#D45FE2", label: "兰紫" }
];

const SCOPE_LABELS = {
  character: "角色（独立）",
  group: "群组（共享）",
  global: "全局",
  chat: "当前聊天"
};

const MODEL_VISIBILITY_LABELS = {
  full: "完整状态",
  stage_only: "仅阶段",
  hidden: "不注入模型"
};

const SOURCE_LABELS = {
  manual: "手动调整",
  natural: "自然结算",
  per_turn: "每轮变化",
  rule: "规则触发",
  ai: "AI 判断"
};

const CONDITION_LABELS = {
  recentPositive: "近期积极互动",
  longInactive: "长时间未交流",
  userCare: "用户主动关心",
  specialDay: "特别的日子",
  highFreq: "高频互动",
  stateThreshold: "状态阈值"
};

const SCREEN_META = {
  home: { label: "动态状态", caption: "当前上下文的角色状态" },
  detail: { label: "状态详情", caption: "数值、阶段、趋势与最近变化" },
  fields: { label: "字段设置", caption: "字段搜索、启用状态与绑定范围" },
  edit: { label: "编辑字段", caption: "数值字段、作用域、角色与初始值" },
  stages: { label: "阶段设置", caption: "阶段名称、说明与阈值" },
  change: { label: "变化设置", caption: "自然变化、每轮变化与状态联动" },
  linkRule: { label: "联动规则", caption: "来源条件与目标效果" },
  effects: { label: "临时效果", caption: "当前数据集的临时倍率与增量" },
  effect: { label: "编辑临时效果", caption: "作用字段、范围、时效与启停" },
  ai: { label: "AI 自动更新", caption: "模型能力、判断参数与实际执行" },
  advanced: { label: "高级选项", caption: "模型可见性、主题、图标与数据" },
  rules: { label: "规则设置", caption: "自动规则列表" },
  rule: { label: "编辑规则", caption: "条件、多个效果与冷却限制" },
  records: { label: "记录", caption: "按角色、状态与来源筛选" },
  recordDetail: { label: "变化详情", caption: "真实时间、角色、来源与趋势" }
};

const SCREEN_IDS = new Set(Object.keys(SCREEN_META));
const urlState = new URLSearchParams(window.location.search);
const requestedScreen = urlState.get("screen");

if (urlState.get("capture") === "1") {
  document.body.classList.add("capture");
}

const appState = {
  screen: requestedScreen && SCREEN_IDS.has(requestedScreen) ? requestedScreen : "home",
  fieldTab: "active",
  changeTab: "natural",
  chartRange: "30",
  selectedFieldId: "",
  selectedRecordId: "",
  editingFieldId: "",
  editingAutoRuleId: "",
  editingLinkRuleId: "",
  editingEffectId: "",
  fieldDraft: null,
  autoRuleDraft: null,
  linkRuleDraft: null,
  effectDraft: null,
  effectDurationMode: "none",
  effectDurationHours: 24,
  settingsDraft: null,
  manualValue: Number.NaN,
  manualOriginalValue: null,
  fieldRangeDrafts: {},
  fieldSearch: "",
  recordFilters: {
    actorId: "all",
    fieldId: "all",
    source: "all"
  },
  judgeMessage: "",
  modelProbe: null,
  judgeResult: null,
  drawer: false,
  sheet: "",
  busyAction: "",
  snapshot: null
};

const appRoot = document.getElementById("appRoot");
const screenNav = document.getElementById("screenNav");
const screenCaption = document.getElementById("screenCaption");
const toast = document.getElementById("toast");
const backgroundPicker = document.getElementById("backgroundPicker");
const datasetImportPicker = document.getElementById("datasetImportPicker");

let toastTimer = 0;
let callbackSequence = 0;
const pendingCalls = new Map();

function requireViewportShell(selector) {
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error("MVU_VIEWPORT_SHELL_MISSING:" + selector);
  }
  return element;
}

function syncEmbeddedReferenceViewport() {
  if (!document.body.classList.contains("embedded") || document.body.classList.contains("capture")) return;
  if (window.innerWidth <= 0 || window.innerHeight <= 0) throw new Error("MVU_VIEWPORT_SIZE_INVALID");

  const scale = window.innerWidth / EMBEDDED_REFERENCE_WIDTH;
  const referenceHeight = window.innerHeight / scale;
  const showcase = requireViewportShell(".showcase");
  const deviceStage = requireViewportShell(".device-stage");
  const phoneShell = requireViewportShell(".phone-shell");
  const phoneScreen = requireViewportShell(".phone-screen");

  Object.assign(showcase.style, {
    width: EMBEDDED_REFERENCE_WIDTH + "px",
    height: referenceHeight + "px",
    minHeight: referenceHeight + "px",
    position: "absolute",
    inset: "0 auto auto 0",
    transform: "scale(" + scale + ")",
    transformOrigin: "top left"
  });

  [deviceStage, phoneShell, phoneScreen].forEach(function (element) {
    Object.assign(element.style, {
      width: EMBEDDED_REFERENCE_WIDTH + "px",
      height: referenceHeight + "px",
      minHeight: referenceHeight + "px"
    });
  });
}

syncEmbeddedReferenceViewport();
window.addEventListener("resize", syncEmbeddedReferenceViewport);

window.__mvuResolve = function (callbackId, result) {
  const pending = pendingCalls.get(callbackId);
  if (!pending) return;
  window.clearTimeout(pending.timeoutId);
  pendingCalls.delete(callbackId);
  pending.resolve(result);
};

window.__mvuReject = function (callbackId, message) {
  const pending = pendingCalls.get(callbackId);
  if (!pending) return;
  window.clearTimeout(pending.timeoutId);
  pendingCalls.delete(callbackId);
  pending.reject(new Error(message));
};

function callNative(method, params) {
  const requestParams = params === undefined ? {} : params;
  if (!window.NativeMvu || typeof window.NativeMvu.call !== "function") {
    return Promise.reject(new Error("MVU_NATIVE_BRIDGE_UNAVAILABLE"));
  }

  callbackSequence += 1;
  const callbackId = callbackSequence;
  const timeoutMs = method === "judgeState" ? NATIVE_MODEL_TIMEOUT_MS : NATIVE_TIMEOUT_MS;
  return new Promise(function (resolve, reject) {
    const timeoutId = window.setTimeout(function () {
      pendingCalls.delete(callbackId);
      const timeoutError = new Error("MVU_NATIVE_CALL_TIMEOUT:" + method);
      console.error("MVU native call timed out", timeoutError);
      reject(timeoutError);
    }, timeoutMs);

    pendingCalls.set(callbackId, { resolve: resolve, reject: reject, timeoutId: timeoutId });
    try {
      window.NativeMvu.call(method, JSON.stringify(requestParams), callbackId);
    } catch (error) {
      console.error("MVU native bridge invocation failed", error);
      window.clearTimeout(timeoutId);
      pendingCalls.delete(callbackId);
      reject(error);
    }
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function mi(name, className, label) {
  const iconClass = className ? " " + escapeHtml(className) : "";
  const aria = label
    ? ' role="img" aria-label="' + escapeHtml(label) + '"'
    : ' aria-hidden="true"';
  return '<span class="material-symbols-rounded' + iconClass + '"' + aria + ">" +
    escapeHtml(name) + "</span>";
}

function normalizeIconName(icon) {
  if (typeof icon !== "string" || icon.trim().length === 0) {
    throw new Error("MVU_FIELD_ICON_INVALID");
  }
  return icon
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replaceAll("-", "_")
    .toLowerCase();
}

function requireThemeColor(field) {
  if (typeof field.themeColor !== "string" || !/^#[0-9a-f]{6}$/i.test(field.themeColor)) {
    throw new Error("MVU_FIELD_THEME_COLOR_INVALID:" + field.id);
  }
  return field.themeColor.toUpperCase();
}

function softThemeColor(color) {
  return "color-mix(in srgb, " + color + " 14%, white)";
}

function numberText(value) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
}

function signedNumber(value) {
  if (!Number.isFinite(value)) return "—";
  return (value > 0 ? "+" : "") + numberText(value);
}

function numberAttribute(value) {
  return Number.isFinite(value) ? escapeHtml(value) : "";
}

function formatDateTime(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function formatClock(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function relativeTime(timestamp) {
  const elapsed = Date.now() - timestamp;
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "时间无效";
  if (elapsed < 0) return formatDateTime(timestamp);
  if (elapsed < 60000) return Math.max(1, Math.floor(elapsed / 1000)) + " 秒前";
  if (elapsed < 3600000) return Math.max(1, Math.floor(elapsed / 60000)) + " 分钟前";
  if (elapsed < 86400000) return Math.max(1, Math.floor(elapsed / 3600000)) + " 小时前";
  if (elapsed < 604800000) return Math.max(1, Math.floor(elapsed / 86400000)) + " 天前";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(new Date(timestamp));
}

function dateKey(timestamp) {
  const date = new Date(timestamp);
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" +
    String(date.getDate()).padStart(2, "0");
}

function dateGroupLabel(timestamp) {
  const today = new Date();
  const target = new Date(timestamp);
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const targetStart = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  const dayDistance = Math.round((todayStart - targetStart) / 86400000);
  if (dayDistance === 0) return "今天";
  if (dayDistance === 1) return "昨天";
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(target);
}

function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") throw new Error("MVU_SNAPSHOT_INVALID");
  if (!Array.isArray(snapshot.fields)) throw new Error("MVU_SNAPSHOT_FIELD_PROJECTIONS_INVALID");
  if (!Array.isArray(snapshot.records)) throw new Error("MVU_SNAPSHOT_RECORDS_INVALID");
  if (!Array.isArray(snapshot.rules)) throw new Error("MVU_SNAPSHOT_LINK_RULES_INVALID");
  if (!Array.isArray(snapshot.autoRules)) throw new Error("MVU_SNAPSHOT_AUTO_RULES_INVALID");
  if (!Array.isArray(snapshot.temporaryEffects)) throw new Error("MVU_SNAPSHOT_TEMPORARY_EFFECTS_INVALID");
  if (!snapshot.settings || typeof snapshot.settings.aiEnabled !== "boolean") {
    throw new Error("MVU_SNAPSHOT_SETTINGS_INVALID");
  }
  if (!Array.isArray(snapshot.actors)) throw new Error("MVU_SNAPSHOT_ACTORS_INVALID");
  if (!Array.isArray(snapshot.selectableActorIds) ||
      snapshot.selectableActorIds.some(function (actorId) {
        return typeof actorId !== "string" || actorId.length === 0;
      })) {
    throw new Error("MVU_SNAPSHOT_SELECTABLE_ACTORS_INVALID");
  }
  const context = snapshot.activeContext;
  if (!context || typeof context !== "object") throw new Error("MVU_ACTIVE_CONTEXT_INVALID");
  if (context.chatId !== null && typeof context.chatId !== "string") throw new Error("MVU_CONTEXT_CHAT_INVALID");
  if (context.actorId !== null && typeof context.actorId !== "string") throw new Error("MVU_CONTEXT_ACTOR_INVALID");
  if (context.groupId !== null && typeof context.groupId !== "string") throw new Error("MVU_CONTEXT_GROUP_INVALID");
  if (typeof context.actorName !== "string") throw new Error("MVU_CONTEXT_ACTOR_NAME_INVALID");
}

function sortedFields() {
  return appState.snapshot.fields.map(function (projection) {
    return projection.definition;
  }).sort(function (a, b) {
    return a.order - b.order || a.name.localeCompare(b.name, "zh-CN");
  });
}

function fieldById(fieldId) {
  const projection = fieldProjectionById(fieldId);
  return projection ? projection.definition : null;
}

function fieldProjectionById(fieldId) {
  return appState.snapshot.fields.find(function (projection) {
    return projection.definition && projection.definition.id === fieldId;
  }) || null;
}

function temporaryEffects() {
  return appState.snapshot.temporaryEffects;
}

function requireField(fieldId) {
  const field = fieldById(fieldId);
  if (!field) throw new Error("MVU_FIELD_NOT_FOUND:" + fieldId);
  return field;
}

function activeActor() {
  const actorId = appState.snapshot.activeContext.actorId;
  if (actorId === null) return null;
  return appState.snapshot.actors.find(function (actor) {
    return actor.characterId === actorId;
  }) || null;
}

function actorAvatarMarkup(actor, className, decorative) {
  const label = decorative ? "" : escapeHtml(actor.name) + "头像";
  if (typeof actor.avatarUri === "string" && actor.avatarUri.trim().length > 0) {
    return '<img class="' + escapeHtml(className) + '" src="' + escapeHtml(actor.avatarUri) +
      '" alt="' + label + '">';
  }
  const initial = actor.name.trim().slice(0, 1) || "·";
  return '<span class="' + escapeHtml(className) + ' actor-avatar-placeholder" aria-label="' +
    escapeHtml(actor.name) + '头像">' + escapeHtml(initial) + "</span>";
}

function contextAvatarMarkup(className) {
  const actor = activeActor();
  if (actor) return actorAvatarMarkup(actor, className, false);
  const name = appState.snapshot.activeContext.actorName;
  const initial = name.trim().slice(0, 1) || "·";
  return '<span class="' + escapeHtml(className) + ' actor-avatar-placeholder" aria-label="' +
    escapeHtml(name) + '头像">' + escapeHtml(initial) + "</span>";
}

function projectedValue(field) {
  const projection = fieldProjectionById(field.id);
  if (!projection || !projection.bound) return null;
  return typeof projection.currentValue === "number" && Number.isFinite(projection.currentValue)
    ? projection.currentValue
    : null;
}

function projectedStage(field) {
  const projection = fieldProjectionById(field.id);
  if (!projection || !projection.bound) return null;
  const stage = projection.currentStage;
  if (!stage || typeof stage !== "object") return null;
  if (typeof stage.id !== "string" || typeof stage.name !== "string" ||
      typeof stage.threshold !== "number" || typeof stage.description !== "string") {
    throw new Error("MVU_FIELD_CURRENT_STAGE_INVALID:" + field.id);
  }
  return stage;
}

function fieldRangeDraft(field) {
  let draft = appState.fieldRangeDrafts[field.id];
  if (!draft) {
    draft = { minimum: field.minimum, maximum: field.maximum };
    appState.fieldRangeDrafts[field.id] = draft;
  }
  return draft;
}

function mapRangePosition(value, field, draft) {
  if (value === field.minimum) return draft.minimum;
  if (value === field.maximum) return draft.maximum;
  return draft.minimum + ((value - field.minimum) / (field.maximum - field.minimum)) *
    (draft.maximum - draft.minimum);
}

function validateFieldRangeDraft(field, draft) {
  const changed = draft.minimum !== field.minimum || draft.maximum !== field.maximum;
  if (!Number.isFinite(draft.minimum) || !Number.isFinite(draft.maximum)) {
    return { changed: changed, error: "请输入有效的上下限数值", previewValue: null };
  }
  if (draft.minimum >= draft.maximum) {
    return { changed: changed, error: "下限必须小于上限", previewValue: null };
  }
  const previousSpan = field.maximum - field.minimum;
  const nextSpan = draft.maximum - draft.minimum;
  const scale = nextSpan / previousSpan;
  if (!Number.isFinite(previousSpan) || previousSpan <= 0 ||
      !Number.isFinite(nextSpan) || nextSpan <= 0 ||
      !Number.isFinite(scale) || scale <= 0 ||
      !Number.isFinite(field.step * scale) || field.step * scale <= 0) {
    return { changed: changed, error: "范围跨度超出可换算精度", previewValue: null };
  }
  let previousThreshold = Number.NEGATIVE_INFINITY;
  for (const stage of field.stages) {
    const threshold = mapRangePosition(stage.threshold, field, draft);
    if (!Number.isFinite(threshold) || threshold <= previousThreshold) {
      return { changed: changed, error: "范围过窄，无法保留现有阶段间隔", previewValue: null };
    }
    previousThreshold = threshold;
  }
  const currentValue = projectedValue(field);
  const sourceValue = currentValue === null ? field.initialValue : currentValue;
  const previewValue = mapRangePosition(sourceValue, field, draft);
  if (!Number.isFinite(previewValue)) {
    return { changed: changed, error: "当前值换算后超出数值范围", previewValue: null };
  }
  return { changed: changed, error: "", previewValue: previewValue };
}

function rangePreviewPosition(field, draft, previewValue) {
  if (!Number.isFinite(previewValue)) return 0;
  return Math.max(0, Math.min(100,
    ((previewValue - draft.minimum) / (draft.maximum - draft.minimum)) * 100
  ));
}

function scopeContext() {
  const context = appState.snapshot.activeContext;
  return {
    chatId: context.chatId,
    actorId: context.actorId,
    groupId: context.groupId,
    actorName: context.actorName
  };
}

function recordsForField(fieldId) {
  const projection = fieldProjectionById(fieldId);
  if (!projection || projection.scopeKey === null) return [];
  return appState.snapshot.records
    .filter(function (record) {
      return record.fieldId === fieldId && record.scopeKey === projection.scopeKey;
    })
    .sort(function (a, b) {
      return b.occurredAt - a.occurredAt;
    });
}

function selectedField() {
  return appState.selectedFieldId ? fieldById(appState.selectedFieldId) : null;
}

function selectField(fieldId) {
  const field = requireField(fieldId);
  appState.selectedFieldId = field.id;
  const value = projectedValue(field);
  appState.manualOriginalValue = value;
  appState.manualValue = value === null ? field.initialValue : value;
  return field;
}

function cloneField(field) {
  return cloneJson(field);
}

function prepareFieldDraft(fieldId) {
  const field = requireField(fieldId);
  appState.selectedFieldId = field.id;
  appState.editingFieldId = field.id;
  appState.fieldDraft = cloneField(field);
  return appState.fieldDraft;
}

function defaultFieldDraft() {
  const actorId = appState.snapshot.activeContext.actorId;
  return {
    name: "新状态",
    description: "",
    minimum: 0,
    maximum: 100,
    step: 1,
    initialValue: 30,
    icon: "favorite",
    themeColor: "#7058D8",
    enabled: true,
    scope: "character",
    modelVisibility: "full",
    ai: {
      enabled: false,
      minConfidence: 0.7,
      maxDelta: 6,
      prompt: ""
    },
    stages: [
      { id: "stage_initial", name: "初始", threshold: 0, description: "" },
      { id: "stage_growing", name: "发展", threshold: 50, description: "" }
    ],
    bindingIds: actorId === null ? [] : [actorId],
    naturalChange: {
      enabled: false,
      unitMs: 86400000,
      amount: 0
    },
    perTurnChange: {
      enabled: false,
      intervalTurns: 1,
      amount: 0,
      countMode: "both"
    }
  };
}

function requireFieldDraft() {
  if (!appState.fieldDraft) throw new Error("MVU_FIELD_DRAFT_MISSING");
  return appState.fieldDraft;
}

function topBar(title, options) {
  const config = options || {};
  let left = '<span class="icon-button" aria-hidden="true"></span>';
  if (config.backScreen) {
    left = '<button type="button" class="icon-button" data-action="go-back" data-back-screen="' +
      escapeHtml(config.backScreen) + '" aria-label="返回">' + mi("arrow_back") + "</button>";
  } else if (config.menu) {
    left = '<button type="button" class="icon-button menu-button" data-action="open-drawer" aria-label="打开菜单">' +
      mi("menu") + "</button>";
  }

  let right = '<span class="icon-button" aria-hidden="true"></span>';
  if (config.rightAction && config.rightText) {
    const dangerClass = config.danger ? " danger-text" : "";
    right = '<button type="button" class="icon-button action-text' + dangerClass + '" data-action="' +
      escapeHtml(config.rightAction) + '">' + escapeHtml(config.rightText) + "</button>";
  } else if (config.rightAction && config.rightIcon) {
    right = '<button type="button" class="icon-button" data-action="' + escapeHtml(config.rightAction) +
      '" aria-label="' + escapeHtml(config.rightLabel) + '">' + mi(config.rightIcon) + "</button>";
  }

  return '<header class="top-app-bar' + (config.rightText ? " has-wide-action" : "") + '">' +
    left + "<h2>" + escapeHtml(title) + "</h2>" + right + "</header>";
}

function bottomNav(active) {
  const items = [
    { id: "home", icon: "favorite", label: "状态" },
    { id: "fields", icon: "settings", label: "设置" },
    { id: "records", icon: "article", label: "记录" }
  ];
  return '<nav class="bottom-nav" aria-label="插件主导航">' + items.map(function (item) {
    const current = active === item.id;
    return '<button type="button" class="' + (current ? "active" : "") + '" data-screen="' +
      item.id + '"' + (current ? ' aria-current="page"' : "") + '>' +
      mi(item.icon) + "<span>" + item.label + "</span></button>";
  }).join("") + "</nav>";
}

function activeBottomNav() {
  if (appState.screen === "home" || appState.screen === "detail") return "home";
  if (appState.screen === "records" || appState.screen === "recordDetail") return "records";
  return "fields";
}

function actionButton(config, primary) {
  const classes = "button " + (primary ? "primary" : (config.kind || "secondary"));
  const disabled = config.disabled ? " disabled" : "";
  return '<button class="' + classes + '" data-action="' + escapeHtml(config.action) + '"' +
    disabled + ">" + (config.icon ? mi(config.icon) : "") + escapeHtml(config.label) + "</button>";
}

function bottomAction(primary, secondary) {
  return '<div class="bottom-action ' + (secondary ? "" : "single") + '">' +
    (secondary ? actionButton(secondary, false) : "") +
    actionButton(primary, true) + "</div>";
}

function page(content, options) {
  const scrollClass = "screen-scroll with-nav" + (options.action ? " with-action" : "");
  return '<section class="app-screen ' + escapeHtml(options.className || "dense-page") + '">' +
    topBar(options.title, options.top || {}) +
    '<div class="' + scrollClass + '">' + content + "</div>" +
    bottomNav(activeBottomNav()) +
    (options.action ? bottomAction(options.action.primary, options.action.secondary) : "") +
    renderOverlay() + "</section>";
}

function stateIcon(field, large) {
  const tone = requireThemeColor(field);
  const soft = softThemeColor(tone);
  return '<span class="state-icon ' + (large ? "large" : "") + '" style="--tone:' + tone +
    ";--tone-soft:" + soft + '">' + mi(normalizeIconName(field.icon)) + "</span>";
}

function sectionTitle(title, trailing) {
  return '<div class="section-title"><h3>' + escapeHtml(title) + "</h3>" +
    (trailing || "") + "</div>";
}

function segmentedTabs(items, active, attribute) {
  return '<div class="segmented-tabs" role="tablist" style="--tabs:' + items.length + '">' +
    items.map(function (item) {
    const selected = item.id === active;
    return '<button type="button" role="tab" aria-selected="' + selected + '" class="' +
      (selected ? "active" : "") + '" ' + attribute + '="' + escapeHtml(item.id) + '">' +
      escapeHtml(item.label) + "</button>";
  }).join("") + "</div>";
}

function toggleSwitch(attribute, value, enabled, label, disabled) {
  const disabledAttribute = disabled ? ' disabled aria-disabled="true"' : "";
  return '<button type="button" class="switch ' + (enabled ? "on" : "") + '" ' + attribute + '="' +
    escapeHtml(value) + '" role="switch" aria-checked="' + enabled + '" aria-label="' +
    escapeHtml(label) + '"' + disabledAttribute + '></button>';
}

function emptyState(icon, title, message, action) {
  return '<div class="empty-state">' + mi(icon, "empty-avatar") + "<h3>" + escapeHtml(title) +
    "</h3><p>" + escapeHtml(message) + "</p>" +
    (action ? '<button class="button primary" data-action="' + escapeHtml(action.action) + '">' +
      (action.icon ? mi(action.icon) : "") + escapeHtml(action.label) + "</button>" : "") + "</div>";
}

function fieldProgress(field, value) {
  const span = field.maximum - field.minimum;
  if (!Number.isFinite(value) || span <= 0) return 0;
  return Math.max(0, Math.min(100, ((value - field.minimum) / span) * 100));
}

function fieldStateCard(field) {
  const value = projectedValue(field);
  if (value === null) throw new Error("MVU_PROJECTED_VALUE_MISSING:" + field.id);
  const stage = projectedStage(field);
  const records = recordsForField(field.id);
  const recent = records[0] || null;
  const tone = requireThemeColor(field);
  const soft = softThemeColor(tone);
  const meta = recent
    ? "最近变化：" + signedNumber(recent.delta) + " · " + recent.reason
    : "暂无变化记录";
  const time = recent ? relativeTime(recent.occurredAt) : "尚未记录";
  return '<button class="state-card" data-field-id="' + escapeHtml(field.id) +
    '" style="--tone:' + tone + ";--tone-soft:" + soft + '">' +
    '<span class="mini-icon">' + mi(normalizeIconName(field.icon)) + "</span>" +
    '<span class="card-title">' + escapeHtml(field.name) + "</span>" +
    '<span class="card-value"><strong>' + numberText(value) + "</strong><span>/ " +
    numberText(field.maximum) + "</span><em>" + escapeHtml(stage ? stage.name : "未设阶段") + "</em></span>" +
    '<span class="meter"><span style="--value:' + fieldProgress(field, value) + '%"></span></span>' +
    '<span class="card-meta">' + escapeHtml(meta) + "</span>" +
    '<span class="card-time">' + escapeHtml(time) + "</span>" +
    '<span class="chevron">' + mi("chevron_right") + "</span></button>";
}

function temporaryEffectValue(effect) {
  return effect.mode === "multiplier"
    ? "变化倍率 ×" + numberText(effect.value)
    : "变化增量 " + signedNumber(effect.value);
}

function temporaryEffectDuration(effect) {
  if (effect.expiresAt !== null) {
    if (effect.expiresAt <= Date.now()) return "已到期";
    return "到期：" + formatDateTime(effect.expiresAt);
  }
  if (effect.remainingTurns !== null) {
    return "剩余 " + numberText(effect.remainingTurns) + " 轮";
  }
  return "持续生效";
}

function temporaryEffectIsCurrent(effect) {
  if (!effect.enabled) return false;
  if (effect.expiresAt !== null && effect.expiresAt <= Date.now()) return false;
  if (effect.remainingTurns !== null && effect.remainingTurns <= 0) return false;
  const projection = fieldProjectionById(effect.targetFieldId);
  return Boolean(projection && projection.bound && projection.scopeKey !== null &&
    projection.scopeKey === effect.scopeKey &&
    projection.definition.scope === effect.scope);
}

function homeTemporaryEffectCard(effect) {
  const field = fieldById(effect.targetFieldId);
  if (!field) {
    return '<button class="buff-row" data-effect-id="' + escapeHtml(effect.id) + '">' +
      mi("error") + '<span><strong>无效字段引用</strong><span>' +
      escapeHtml(effect.reason) + '</span></span><span class="micro">' +
      escapeHtml(temporaryEffectDuration(effect)) + " " + mi("chevron_right") + "</span></button>";
  }
  return '<button class="buff-row" data-effect-id="' + escapeHtml(effect.id) +
    '" style="--tone:' + requireThemeColor(field) + '">' +
    mi(normalizeIconName(field.icon)) + '<span><strong>' + escapeHtml(field.name) +
    ' <span class="status-pill">临时效果</span></strong><span>' +
    escapeHtml(effect.reason) + " · " + escapeHtml(temporaryEffectValue(effect)) +
    '</span></span><span class="micro">' + escapeHtml(temporaryEffectDuration(effect)) +
    " " + mi("chevron_right") + "</span></button>";
}

function renderHome() {
  const context = appState.snapshot.activeContext;
  const selectableActorIds = new Set(appState.snapshot.selectableActorIds);
  const actors = appState.snapshot.actors.filter(function (actor) {
    return actor.enabled && selectableActorIds.has(actor.characterId);
  });
  const projectedFields = sortedFields().filter(function (field) {
    return field.enabled && projectedValue(field) !== null;
  });
  const activeScopeKeys = new Set(appState.snapshot.fields
    .filter(function (projection) {
      return projection.bound && projection.scopeKey !== null;
    })
    .map(function (projection) {
      return projection.scopeKey;
    }));
  const latestRecord = appState.snapshot.records.filter(function (record) {
    return activeScopeKeys.has(record.scopeKey);
  }).sort(function (a, b) {
    return b.occurredAt - a.occurredAt;
  })[0] || null;

  const roleStrip = '<div class="role-strip selectable-role-strip" role="group" aria-label="切换角色">' +
    actors.map(function (actor) {
      const active = context.actorId === actor.characterId;
      return '<button type="button" class="role-chip ' + (active ? "active" : "") +
        '" data-select-actor="' + escapeHtml(actor.characterId) +
        '" aria-pressed="' + active + '" aria-label="切换到' + escapeHtml(actor.name) + '">' +
        actorAvatarMarkup(actor, "role-chip-avatar", true) + "<span>" + escapeHtml(actor.name) +
        "</span></button>";
    }).join("") + "</div>";

  const banner = '<article class="character-banner">' +
    contextAvatarMarkup("character-avatar") +
    '<div class="character-copy"><h3>' + escapeHtml(context.actorName) +
    (context.actorId !== null ? " " + mi("verified", "verified", "当前角色") : "") +
    '</h3><p class="summary">' + projectedFields.length + " 个可用状态</p><p class=\"feeling\">" +
    escapeHtml(latestRecord ? latestRecord.reason : "等待首次状态变化。") + "</p></div></article>";

  const cards = projectedFields.length > 0
    ? '<div class="state-stack">' + projectedFields.map(fieldStateCard).join("") + "</div>"
    : emptyState("favorite", "当前没有可显示状态", "请创建字段并为当前上下文启用它。", {
        action: "new-field",
        icon: "add",
        label: "新增状态"
      });

  const activeEffects = temporaryEffects().filter(temporaryEffectIsCurrent);
  const effects = activeEffects.length > 0
    ? sectionTitle("临时效果", '<button data-screen="effects">管理</button>') +
      '<div class="temporary-effect-stack">' +
      activeEffects.map(homeTemporaryEffectCard).join("") + "</div>"
    : "";

  const actions = '<div class="dual-actions home-actions">' +
    (projectedFields.length > 0
      ? '<button class="button secondary" data-action="open-ai-for-selected">' +
        mi("magic_button") + "AI 自动更新</button>"
      : "") +
    '<button class="button primary" data-action="new-field">' + mi("add") + "新增状态</button></div>";

  return page(roleStrip + banner + cards + effects + actions, {
    title: "动态状态",
    top: {
      menu: true,
      rightAction: "show-help",
      rightIcon: "help",
      rightLabel: "帮助"
    },
    className: "clean-page"
  });
}

function trendRecords(fieldId, scopeKey, days) {
  const cutoff = Date.now() - days * 86400000;
  return appState.snapshot.records
    .filter(function (record) {
      return record.fieldId === fieldId &&
        record.scopeKey === scopeKey &&
        record.occurredAt >= cutoff;
    })
    .sort(function (a, b) {
      return a.occurredAt - b.occurredAt;
    });
}

function trendPoints(fieldId, scopeKey, days) {
  const records = trendRecords(fieldId, scopeKey, days);
  if (records.length === 0) return [];
  const points = [{ value: records[0].before, timestamp: records[0].occurredAt - 1 }];
  records.forEach(function (record) {
    points.push({ value: record.after, timestamp: record.occurredAt });
  });
  return points;
}

function renderTrend(field, scopeKey, days, label) {
  const points = trendPoints(field.id, scopeKey, days);
  if (points.length < 2) {
    return '<div class="chart-empty">' + mi("show_chart") +
      "<span>该时间范围内还没有趋势数据</span></div>";
  }
  const values = points.map(function (point) { return point.value; }).join(",");
  const timestamps = points.map(function (point) { return point.timestamp; }).join(",");
  return '<canvas class="trend-canvas" role="img" data-chart="dynamic" data-values="' + escapeHtml(values) +
    '" data-timestamps="' + escapeHtml(timestamps) + '" data-minimum="' +
    escapeHtml(field.minimum) + '" data-maximum="' + escapeHtml(field.maximum) +
    '" data-color="' + requireThemeColor(field) + '" aria-label="' + escapeHtml(label) + '"></canvas>';
}

function renderStageAxis(field, stage) {
  if (field.stages.length === 0) {
    return '<div class="stage-empty">尚未配置阶段</div>';
  }
  const ordered = field.stages.slice().sort(function (a, b) {
    return a.threshold - b.threshold;
  });
  const span = field.maximum - field.minimum;
  return '<div class="stage-axis-labels">' + ordered.map(function (item) {
    return '<span class="' + (stage && item.id === stage.id ? "active" : "") + '">' +
      escapeHtml(item.name) + "</span>";
  }).join("") + '</div><div class="stage-axis"><span></span>' +
    ordered.map(function (item) {
      const position = span > 0
        ? Math.max(0, Math.min(100, ((item.threshold - field.minimum) / span) * 100))
        : 0;
      return '<i class="' + (stage && item.id === stage.id ? "active" : "") +
        '" style="left:' + position + '%"></i>';
    }).join("") + '</div><div class="stage-axis-values"><span>' +
    numberText(field.minimum) + "</span>" + ordered.slice(1).map(function (item) {
      return "<span>" + numberText(item.threshold) + "</span>";
    }).join("") + "<span>" + numberText(field.maximum) + "</span></div>";
}

function recentChangeRow(record) {
  const positive = record.delta >= 0;
  return '<button class="change-row" data-record-id="' + escapeHtml(record.id) +
    '" style="--tone:' + (positive ? "var(--mint-ink)" : "var(--red-ink)") + '">' +
    '<span class="delta">' + signedNumber(record.delta) + "</span><strong>" +
    escapeHtml(record.reason) + '</strong><span class="meta">' +
    escapeHtml(relativeTime(record.occurredAt)) + "</span></button>";
}

function renderDetail() {
  const field = selectedField();
  if (!field) {
    return page(emptyState("favorite", "字段不存在", "请选择一个仍然存在的字段。", {
      action: "new-field",
      icon: "add",
      label: "新增字段"
    }), {
      title: "状态详情",
      top: { backScreen: "home" },
      className: "clean-page"
    });
  }

  const projection = fieldProjectionById(field.id);
  if (!projection || !projection.bound || projection.scopeKey === null ||
      projection.currentValue === null) {
    return page(emptyState("link_off", "当前上下文未绑定", "请编辑字段并绑定当前角色、群组或聊天。", {
      action: "edit-selected-field",
      icon: "edit",
      label: "编辑字段"
    }), {
      title: field.name,
      top: { backScreen: "home" },
      className: "clean-page"
    });
  }

  const value = projectedValue(field);
  const stage = projectedStage(field);
  const records = recordsForField(field.id).slice(0, 3);
  const latest = records[0] || null;
  const tone = requireThemeColor(field);
  const manualChanged = Number.isFinite(appState.manualValue) &&
    (appState.manualOriginalValue === null || appState.manualValue !== appState.manualOriginalValue);

  const hero = '<article class="detail-hero reference-detail-hero">' +
    '<div class="detail-title-row">' + stateIcon(field, false) +
    '<div class="copy"><h3>' + escapeHtml(field.name) + '</h3><p class="micro">' +
    escapeHtml(SCOPE_LABELS[field.scope]) + '</p></div><span class="status-pill">' +
    escapeHtml(stage ? stage.name : "未初始化") + "</span></div>" +
    '<div class="hero-number"><div class="value"><strong>' +
    (value === null ? "—" : numberText(value)) + "</strong><span>/ " +
    numberText(field.maximum) + '</span></div><div class="stage"><strong>' +
    escapeHtml(stage ? stage.name : "未初始化") + "</strong><span>当前阶段</span></div></div>" +
    '<div class="meter" style="--tone:' + tone + '"><span style="--value:' +
    fieldProgress(field, value) + '%"></span></div><div class="metric-note"><span>' +
    escapeHtml(latest ? signedNumber(latest.delta) + " · " + latest.reason : "暂无变化记录") +
    "</span><span>" + escapeHtml(latest ? relativeTime(latest.occurredAt) : "尚未记录") +
    "</span></div></article>";

  const manual = sectionTitle("手动调整", '<span class="muted">步进 ' +
    escapeHtml(numberText(field.step)) + "</span>") +
    '<article class="manual-value-card"><div><strong>目标数值</strong><span>范围 ' +
    numberText(field.minimum) + " – " + numberText(field.maximum) +
    '</span></div><div class="manual-stepper value-input-stepper">' +
    '<button data-action="step-manual" data-step-direction="-1" aria-label="减少">' +
    mi("remove") + '</button><input data-manual-value type="number" inputmode="decimal" min="' +
    escapeHtml(field.minimum) + '" max="' + escapeHtml(field.maximum) + '" step="' +
    escapeHtml(field.step) + '" value="' + numberAttribute(appState.manualValue) +
    '" aria-label="目标数值"><button data-action="step-manual" data-step-direction="1" aria-label="增加">' +
    mi("add") + "</button></div></article>";

  const stageCard = '<article class="stage-axis-card"><div class="section-title"><h3>阶段</h3>' +
    '<button data-action="edit-stages">编辑阶段</button></div>' +
    renderStageAxis(field, stage) + "</article>";

  const chart = '<article class="chart-card"><div class="chart-head"><strong>趋势</strong>' +
    '<div class="chart-range">' + ["7", "30", "90"].map(function (range) {
      return '<button class="' + (appState.chartRange === range ? "active" : "") +
        '" data-chart-range="' + range + '" aria-pressed="' +
        (appState.chartRange === range) + '">' + range + "天</button>";
    }).join("") + "</div></div>" +
    renderTrend(field, projection.scopeKey, Number(appState.chartRange), field.name + "趋势图") +
    "</article>";

  const changes = '<div class="detail-bottom-grid"><article class="change-list compact-change-list">' +
    sectionTitle("最近变化") +
    (records.length > 0
      ? records.map(recentChangeRow).join("")
      : '<p class="inline-empty">暂无变化记录</p>') +
    '</article><article class="reason-card state-description">' +
    sectionTitle("状态说明") + "<p>" + escapeHtml(field.description) + "</p>" +
    (stage && stage.description.trim().length > 0
      ? '<p class="stage-description-note"><strong>' + escapeHtml(stage.name) +
        "：</strong>" + escapeHtml(stage.description) + "</p>"
      : "") + "</article></div>";

  return page(hero + manual + stageCard + chart + changes, {
    title: field.name,
    top: {
      backScreen: "home",
      rightAction: "edit-selected-field",
      rightText: "编辑"
    },
    className: "clean-page",
    action: {
      primary: {
        action: "save-manual",
        label: "保存数值",
        disabled: !manualChanged
      }
    }
  });
}

function fieldMatchesSearch(field) {
  const query = appState.fieldSearch.trim().toLocaleLowerCase("zh-CN");
  if (query.length === 0) return true;
  return (field.name + " " + field.description).toLocaleLowerCase("zh-CN").includes(query);
}

function fieldCard(field) {
  const rangeDraft = fieldRangeDraft(field);
  const rangeValidation = validateFieldRangeDraft(field, rangeDraft);
  const previewPosition = rangePreviewPosition(field, rangeDraft, rangeValidation.previewValue);
  const scopeLabel = SCOPE_LABELS[field.scope];
  if (!scopeLabel) throw new Error("MVU_FIELD_SCOPE_INVALID:" + field.id);
  const boundText = field.scope === "character"
    ? field.bindingIds.length + " 个角色"
    : scopeLabel;
  const message = rangeValidation.error ||
    (rangeValidation.changed
      ? "保存后同步换算当前值、阶段与关联规则"
      : "可直接修改上下限，无需进入二级页面");
  return '<article class="field-card field-range-card" data-range-card="' + escapeHtml(field.id) +
    '" data-search-haystack="' + escapeHtml((field.name + " " + field.description).toLocaleLowerCase("zh-CN")) +
    '" style="--tone:' + requireThemeColor(field) + ";--tone-soft:" +
    softThemeColor(requireThemeColor(field)) + ';--range-position:' + previewPosition + '%">' +
    '<header class="field-range-header">' + stateIcon(field, true) +
    '<span class="field-range-identity"><strong>' + escapeHtml(field.name) +
    '</strong><span class="description">' + escapeHtml(field.description || "未填写描述") +
    '</span><span class="meta field-meta"><span>' + escapeHtml(field.stages.length + " 个阶段") +
    '</span><span>' + escapeHtml(boundText) + '</span><span class="' +
    (field.enabled ? "range-status-good" : "range-status-warn") + '">' +
    (field.enabled ? "已启用" : "已停用") + '</span></span></span>' +
    '<button type="button" class="field-detail-button" data-edit-field="' + escapeHtml(field.id) +
    '" aria-label="打开' + escapeHtml(field.name) + '的详细设置">' + mi("tune") +
    '<span>详细</span></button></header>' +
    '<div class="field-range-visual" aria-label="' + escapeHtml(field.name) + '范围预览">' +
    '<div class="field-range-track"><span></span><i></i></div>' +
    '<div class="field-range-scale"><output data-range-lower-output>' +
    (Number.isFinite(rangeDraft.minimum) ? numberText(rangeDraft.minimum) : "—") +
    '</output><output class="field-range-current" data-range-current-output>' +
    (rangeValidation.previewValue === null ? "当前 —" : "换算后 " + numberText(rangeValidation.previewValue)) +
    '</output><output data-range-upper-output>' +
    (Number.isFinite(rangeDraft.maximum) ? numberText(rangeDraft.maximum) : "—") + "</output></div></div>" +
    '<div class="field-range-inputs"><label><span>下限</span><input class="number-input ' +
    (rangeValidation.error ? "invalid" : "") + '" type="number" inputmode="decimal" data-range-number="minimum" ' +
    'data-range-field-id="' + escapeHtml(field.id) + '" value="' + numberAttribute(rangeDraft.minimum) +
    '" aria-invalid="' + Boolean(rangeValidation.error) + '"></label><span class="range-separator" aria-hidden="true">—</span>' +
    '<label><span>上限</span><input class="number-input ' + (rangeValidation.error ? "invalid" : "") +
    '" type="number" inputmode="decimal" data-range-number="maximum" data-range-field-id="' +
    escapeHtml(field.id) + '" value="' + numberAttribute(rangeDraft.maximum) + '" aria-invalid="' +
    Boolean(rangeValidation.error) + '"></label></div>' +
    '<footer class="field-range-footer"><p class="field-range-message ' +
    (rangeValidation.error ? "error" : rangeValidation.changed ? "changed" : "") +
    '" data-range-message aria-live="polite">' + escapeHtml(message) + '</p>' +
    '<button type="button" class="field-range-save" data-action="save-field-range" data-field-range-id="' +
    escapeHtml(field.id) + '"' +
    (!rangeValidation.changed || rangeValidation.error ? " disabled" : "") + ">" +
    mi("sync_alt") + "保存范围</button></footer></article>";
}

function renderFields() {
  const tabs = segmentedTabs([
    { id: "active", label: "活跃字段" },
    { id: "all", label: "全部字段" }
  ], appState.fieldTab, "data-field-tab");
  const sourceFields = sortedFields().filter(function (field) {
    return appState.fieldTab === "all" || field.enabled;
  });
  const search = '<label class="search-box all-field-search">' + mi("search") +
    '<input data-field-search type="search" value="' + escapeHtml(appState.fieldSearch) +
    '" placeholder="搜索字段名称或描述" aria-label="搜索字段"></label>';
  let list;
  if (sourceFields.length === 0) {
    list = emptyState("data_object", "还没有字段", "创建第一个数值字段后即可开始记录状态。", {
      action: "new-field",
      icon: "add",
      label: "新建字段"
    });
  } else {
    list = '<div class="field-list">' + sourceFields.map(function (field) {
      return '<div class="searchable-field-card"' +
        (fieldMatchesSearch(field) ? "" : " hidden") + ">" + fieldCard(field) + "</div>";
    }).join("") + '</div><div class="field-search-empty"' +
      (sourceFields.some(fieldMatchesSearch) ? " hidden" : "") + ">" +
      emptyState("search_off", "没有匹配字段", "换一个名称或描述关键词继续搜索。", null) +
      "</div>";
  }
  return page(tabs + search + list, {
    title: "MVU 状态/字段设置",
    top: {
      menu: true,
      rightAction: "new-field",
      rightText: "+ 新建字段"
    }
  });
}

function iconPicker(draft) {
  const selectedIcon = normalizeIconName(draft.icon);
  return '<div class="icon-choice-grid" role="group" aria-label="字段图标">' +
    ICON_OPTIONS.map(function (option) {
      return '<button class="icon-choice ' + (selectedIcon === option.value ? "active" : "") +
        '" data-field-icon="' + option.value + '" aria-pressed="' +
        (selectedIcon === option.value) + '" aria-label="' + escapeHtml(option.label) + '">' +
        mi(option.value) + "<span>" + escapeHtml(option.label) + "</span></button>";
    }).join("") + "</div>";
}

function themePicker(draft) {
  return '<div class="theme-choice-grid" role="group" aria-label="字段主题色">' +
    THEME_OPTIONS.map(function (option) {
      return '<button class="theme-choice ' +
        (draft.themeColor.toUpperCase() === option.value ? "active" : "") +
        '" data-field-theme="' + option.value + '" aria-pressed="' +
        (draft.themeColor.toUpperCase() === option.value) + '" aria-label="' + escapeHtml(option.label) +
        '"><i style="background:' + option.value + '"></i><span>' +
        escapeHtml(option.label) + "</span></button>";
    }).join("") + "</div>";
}

function scopePicker(draft) {
  return '<div class="option-grid two-by-two" role="group" aria-label="字段作用域">' +
    Object.keys(SCOPE_LABELS).map(function (scope) {
      return '<button class="option-chip ' + (draft.scope === scope ? "active" : "") +
        '" data-field-scope="' + scope + '" aria-pressed="' + (draft.scope === scope) + '">' +
        escapeHtml(SCOPE_LABELS[scope]) + "</button>";
    }).join("") + "</div>";
}

function actorBindingPicker(draft) {
  const actors = appState.snapshot.actors.filter(function (actor) {
    return actor.enabled;
  });
  if (actors.length === 0) {
    return '<p class="inline-empty">当前没有可绑定角色</p>';
  }
  return '<div class="actor-bind-grid" role="group" aria-label="绑定角色">' +
    actors.map(function (actor) {
      const selected = draft.bindingIds.includes(actor.characterId);
      return '<button class="actor-bind-chip ' + (selected ? "active" : "") +
        '" data-bind-actor="' + escapeHtml(actor.characterId) + '" aria-pressed="' + selected + '">' +
        actorAvatarMarkup(actor, "actor-bind-avatar", true) +
        "<span>" + escapeHtml(actor.name) + "</span>" + mi(selected ? "check_circle" : "circle") +
        "</button>";
    }).join("") + "</div>";
}

function currentBindingIdForScope(scope) {
  const context = appState.snapshot.activeContext;
  if (scope === "character") return context.actorId;
  if (scope === "group") return context.groupId;
  if (scope === "chat") return context.chatId;
  if (scope === "global") return null;
  throw new Error("MVU_FIELD_SCOPE_INVALID:" + scope);
}

function nonCharacterBindingSummary(draft) {
  if (draft.scope === "global") {
    return '<p class="form-hint">全局字段不需要绑定 ID。</p>';
  }
  const bindingId = currentBindingIdForScope(draft.scope);
  if (bindingId === null) {
    return '<p class="form-hint">当前上下文没有可用的' +
      escapeHtml(draft.scope === "group" ? "群组" : "聊天") + "标识。</p>";
  }
  const bound = draft.bindingIds.includes(bindingId);
  const scopeName = draft.scope === "group" ? "当前群组" : "当前聊天";
  return '<div class="setting-group compact-settings"><div class="setting-row"><span><strong>绑定' +
    escapeHtml(scopeName) + '</strong><span class="description">' + escapeHtml(bindingId) +
    '</span></span>' + toggleSwitch("data-context-binding", bindingId, bound, "绑定" + scopeName) +
    "</div></div>";
}

function renderEdit() {
  const draft = requireFieldDraft();
  const title = appState.editingFieldId ? "编辑字段" : "新建字段";
  const rangeConfiguration = appState.editingFieldId
    ? '<div class="range-managed-inline">' + mi("straighten") +
      '<span><strong>' + numberText(draft.minimum) + " — " + numberText(draft.maximum) +
      '</strong><small>上下限已移至字段设置一级页，可在字段卡内直接修改。</small></span></div>'
    : '<label class="field-label">数值范围</label><div class="number-row">' +
      '<label>下限<input class="number-input" data-field-number="minimum" type="number" value="' +
      numberAttribute(draft.minimum) + '"></label><label>上限<input class="number-input" data-field-number="maximum" type="number" value="' +
      numberAttribute(draft.maximum) + '"></label></div>';
  const persistedConfigurationLinks = appState.editingFieldId
    ? '<button class="setting-row" data-action="open-change-settings"><span>' + mi("schedule") +
      '<strong>自然与每轮变化</strong><span class="description">配置自动增减和状态联动</span></span><span class="value">' +
      mi("chevron_right") + "</span></button>" +
      '<button class="setting-row" data-action="open-ai-settings"><span>' + mi("magic_button") +
      '<strong>AI 自动更新</strong><span class="description">置信度、幅度与判断提示</span></span><span class="value">' +
      mi("chevron_right") + "</span></button>" +
      '<button class="setting-row" data-action="open-advanced-settings"><span>' + mi("tune") +
      '<strong>高级选项</strong><span class="description">模型可见性与数据管理</span></span><span class="value">' +
      mi("chevron_right") + "</span></button>"
    : '<p class="form-hint editor-save-hint">保存字段后可继续配置自动变化、AI 与高级选项。</p>';
  const content = '<div class="editor-identity" style="--tone:' +
    escapeHtml(draft.themeColor) + ";--tone-soft:" + softThemeColor(draft.themeColor) + '">' +
    '<span class="state-icon large" style="--tone:' + escapeHtml(draft.themeColor) +
    ";--tone-soft:" + softThemeColor(draft.themeColor) + '">' +
    mi(normalizeIconName(draft.icon)) + '</span><span><strong>' +
    escapeHtml(draft.name || "未命名字段") + '</strong><span>数值型动态字段</span></span></div>' +
    '<section class="form-section"><h3>基础信息</h3>' +
    '<label class="field-label" for="fieldName">字段名称 *</label>' +
    '<input class="text-input" id="fieldName" data-field-input="name" maxlength="80" value="' +
    escapeHtml(draft.name) + '">' +
    '<label class="field-label" for="fieldDescription">描述</label>' +
    '<textarea class="textarea-input" id="fieldDescription" data-field-input="description" maxlength="500">' +
    escapeHtml(draft.description) + "</textarea>" +
    '<label class="field-label">字段类型</label><div class="static-type-row">' +
    mi("123") + "<span><strong>数值型</strong><small>插件仅创建可计算的数值字段</small></span></div>" +
    rangeConfiguration +
    '<div class="number-row"><label>初始值<input class="number-input" data-field-number="initialValue" type="number" value="' +
    numberAttribute(draft.initialValue) + '"></label><label>步进<input class="number-input" data-field-number="step" type="number" min="0.000001" value="' +
    numberAttribute(draft.step) + '"></label></div>' +
    '<div class="setting-group compact-settings"><div class="setting-row"><span><strong>启用字段</strong>' +
    '<span class="description">停用后不参与状态更新</span></span>' +
    toggleSwitch("data-field-toggle", "enabled", draft.enabled, "启用字段") +
    "</div></div></section>" +
    '<section class="form-section"><h3>作用域</h3>' + scopePicker(draft) +
    (draft.scope === "character"
      ? '<label class="field-label">绑定角色</label>' + actorBindingPicker(draft)
      : nonCharacterBindingSummary(draft)) +
    "</section>" +
    '<section class="form-section"><h3>图标</h3>' + iconPicker(draft) +
    '<h3 class="subsection-heading">主题色</h3>' + themePicker(draft) + "</section>" +
    '<section class="form-section"><h3>详细配置</h3><div class="config-link-list">' +
    '<button class="setting-row" data-action="edit-stages"><span>' + mi("format_list_numbered") +
    '<strong>阶段设置</strong><span class="description">' + draft.stages.length +
    ' 个阶段</span></span><span class="value">' + mi("chevron_right") + "</span></button>" +
    persistedConfigurationLinks + "</div></section>";

  return page(content, {
    title: title,
    top: { backScreen: "fields" },
    action: {
      secondary: { action: "cancel-field-edit", label: "取消" },
      primary: { action: "save-field", label: "保存字段" }
    }
  });
}

function stagePosition(field, threshold) {
  const span = field.maximum - field.minimum;
  if (span <= 0) return 0;
  return Math.max(0, Math.min(100, ((threshold - field.minimum) / span) * 100));
}

function renderStages() {
  const draft = requireFieldDraft();
  const ordered = draft.stages.slice().sort(function (a, b) {
    return a.threshold - b.threshold;
  });
  const preview = '<article class="stage-preview"><p class="muted stage-tip">阈值表示阶段生效的数值下界</p>' +
    '<div class="range-shell"><div class="range-track"></div>' +
    ordered.map(function (stage) {
      return '<span class="range-mark" style="left:' + stagePosition(draft, stage.threshold) +
        '%"><i></i><output>' + numberText(stage.threshold) + "</output></span>";
    }).join("") + '</div><div class="range-labels">' + ordered.map(function (stage) {
      return "<span>" + escapeHtml(stage.name) + "</span>";
    }).join("") + "</div></article>";

  const rows = draft.stages.map(function (stage, index) {
    return '<article class="stage-editor-row"><span class="stage-index">' + (index + 1) +
      '</span><div class="stage-editor-fields"><label>名称<input class="text-input" data-stage-id="' +
      escapeHtml(stage.id) + '" data-stage-property="name" maxlength="60" value="' +
      escapeHtml(stage.name) + '"></label><label>阈值<input class="number-input" type="number" data-stage-id="' +
      escapeHtml(stage.id) + '" data-stage-property="threshold" value="' +
      numberAttribute(stage.threshold) + '"></label><label class="stage-description-field">阶段说明' +
      '<textarea class="textarea-input" data-stage-id="' + escapeHtml(stage.id) +
      '" data-stage-property="description" maxlength="300">' +
      escapeHtml(stage.description) + "</textarea></label></div>" +
      (draft.stages.length > 1
        ? '<button class="delete-stage" data-action="delete-stage" data-stage-id="' +
          escapeHtml(stage.id) + '" aria-label="删除' + escapeHtml(stage.name) + '">' + mi("delete") + "</button>"
        : "") + "</article>";
  }).join("");

  const content = preview +
    sectionTitle("阶段列表", '<button class="button secondary compact-button" data-action="balance-stages">' +
      mi("balance") + "均匀分布</button>") +
    '<div class="stage-editor-list">' + rows +
    '<button class="button secondary add-stage-button" data-action="add-stage">' +
    mi("add") + "添加阶段</button></div>";

  return page(content, {
    title: "阶段设置",
    top: { backScreen: "edit" },
    action: {
      primary: { action: "save-stages", label: "保存阶段" }
    }
  });
}

function changeTabs() {
  return segmentedTabs([
    { id: "natural", label: "自然变化" },
    { id: "turn", label: "每轮变化" },
    { id: "links", label: "状态联动" }
  ], appState.changeTab, "data-change-tab");
}

function naturalChangeContent(draft) {
  const unitHours = draft.naturalChange.unitMs / 3600000;
  return '<div class="selected-field-banner">' +
    '<span class="state-icon" style="--tone:' + escapeHtml(draft.themeColor) +
    ";--tone-soft:" + softThemeColor(draft.themeColor) + '">' +
    mi(normalizeIconName(draft.icon)) + "</span><span><strong>" +
    escapeHtml(draft.name) + '</strong><small>当前编辑字段</small></span></div>' +
    '<div class="setting-group"><div class="setting-row"><span><strong>启用自然变化</strong>' +
    '<span class="description">按真实经过时间结算</span></span>' +
    toggleSwitch("data-natural-toggle", "enabled", draft.naturalChange.enabled, "启用自然变化") +
    "</div></div>" +
    sectionTitle("变化参数", '<span class="muted">支持正数和负数</span>') +
    '<div class="form-section inline-form-section"><div class="number-row">' +
    '<label>每次变化<input class="number-input" type="number" data-natural-number="amount" value="' +
    numberAttribute(draft.naturalChange.amount) + '"></label><label>间隔（小时）' +
    '<input class="number-input" type="number" min="0.000278" data-natural-unit-hours value="' +
    numberAttribute(unitHours) + '"></label></div></div>' +
    '<div class="info-panel">' + mi("schedule") +
    '<div><strong>结算说明</strong><p>点击立即结算时，后端会按当前上下文和真实时间计算应生效的变化。</p></div></div>';
}

function turnChangeContent(draft) {
  const modes = [
    { id: "both", label: "双方完成一轮" },
    { id: "user", label: "仅用户消息" },
    { id: "character", label: "仅角色消息" }
  ];
  return '<div class="selected-field-banner">' +
    '<span class="state-icon" style="--tone:' + escapeHtml(draft.themeColor) +
    ";--tone-soft:" + softThemeColor(draft.themeColor) + '">' +
    mi(normalizeIconName(draft.icon)) + "</span><span><strong>" +
    escapeHtml(draft.name) + '</strong><small>当前编辑字段</small></span></div>' +
    '<div class="setting-group"><div class="setting-row"><span><strong>启用每轮变化</strong>' +
    '<span class="description">满足消息轮次后应用变化</span></span>' +
    toggleSwitch("data-turn-toggle", "enabled", draft.perTurnChange.enabled, "启用每轮变化") +
    "</div></div>" +
    sectionTitle("变化参数", '<span class="muted">由后端按消息轮次执行</span>') +
    '<div class="form-section inline-form-section"><div class="number-row">' +
    '<label>间隔轮次<input class="number-input" type="number" min="1" step="1" data-turn-number="intervalTurns" value="' +
    numberAttribute(draft.perTurnChange.intervalTurns) + '"></label><label>每次变化' +
    '<input class="number-input" type="number" data-turn-number="amount" value="' +
    numberAttribute(draft.perTurnChange.amount) + '"></label></div>' +
    '<label class="field-label">计数方式</label><div class="option-grid three">' +
    modes.map(function (mode) {
      const selected = draft.perTurnChange.countMode === mode.id;
      return '<button class="option-chip ' +
        (selected ? "active" : "") + '" data-turn-count-mode="' + mode.id +
        '" aria-pressed="' + selected + '">' + escapeHtml(mode.label) + "</button>";
    }).join("") + "</div></div>";
}

function linkFieldLabel(fieldId) {
  const field = fieldById(fieldId);
  return field ? field.name : "无效字段引用（" + fieldId + "）";
}

function linkRuleEffectLabel(rule) {
  if (rule.effect.kind === "multiplier") return "变化倍率 ×" + numberText(rule.effect.value);
  return "变化增量 " + signedNumber(rule.effect.value);
}

function linkRuleCard(rule) {
  const source = fieldById(rule.sourceFieldId);
  const target = fieldById(rule.targetFieldId);
  const tone = source ? requireThemeColor(source) : "#7058D8";
  return '<button class="rule-card link-rule-card clickable-rule-card" data-link-rule-id="' +
    escapeHtml(rule.id) + '" style="--tone:' + tone + '">' +
    '<div class="rule-head"><strong>' + mi(source ? normalizeIconName(source.icon) : "error") +
    " " + escapeHtml(linkFieldLabel(rule.sourceFieldId)) + " " + mi("arrow_forward") +
    " " + mi(target ? normalizeIconName(target.icon) : "error") + " " +
    escapeHtml(linkFieldLabel(rule.targetFieldId)) + '</strong><span class="status-pill ' +
    (rule.enabled ? "good" : "warn") + '">' + (rule.enabled ? "已启用" : "已停用") +
    "</span></div><p class=\"rule-condition\">当来源状态 " + escapeHtml(rule.operator) + " " +
    numberText(rule.sourceThreshold) + '</p><p class="rule-effect">效果 <span class="tag">' +
    escapeHtml(linkRuleEffectLabel(rule)) + "</span></p></button>";
}

function linkContent() {
  const rules = appState.snapshot.rules;
  const fields = sortedFields();
  const list = rules.length > 0
    ? '<div class="rule-list">' + rules.map(linkRuleCard).join("") + "</div>"
    : emptyState("account_tree", "还没有状态联动", "新增联动后，来源字段满足条件时会影响目标字段。", null);
  const addAction = fields.length >= 2
    ? '<button class="button primary wide-gradient-button" data-action="new-link-rule">' +
      mi("add") + "添加联动</button>"
    : '<div class="info-panel">' + mi("info") +
      "<div><strong>需要至少两个字段</strong><p>创建第二个字段后即可配置状态联动。</p></div></div>";
  return '<p class="muted links-intro">联动规则由后端按顺序计算，来源字段与目标字段不能相同。</p>' +
    list + addAction;
}

function renderChange() {
  let body;
  let title;
  let action = null;
  if (appState.changeTab === "natural") {
    const draft = requireFieldDraft();
    body = naturalChangeContent(draft);
    title = "自然变化";
    action = {
      secondary: { action: "settle-natural", label: "立即结算" },
      primary: { action: "save-natural", label: "保存自然变化" }
    };
  } else if (appState.changeTab === "turn") {
    const draft = requireFieldDraft();
    body = turnChangeContent(draft);
    title = "每轮变化";
    action = {
      primary: { action: "save-turn", label: "保存每轮变化" }
    };
  } else {
    body = linkContent();
    title = "状态联动";
  }
  return page(changeTabs() + body, {
    title: title,
    top: { backScreen: "edit" },
    action: action
  });
}

function fieldSelectOptions(selectedId) {
  return sortedFields().map(function (field) {
    return '<option value="' + escapeHtml(field.id) + '"' +
      (field.id === selectedId ? " selected" : "") + ">" +
      escapeHtml(field.name) + "</option>";
  }).join("");
}

function effectFieldSelectOptions(selectedId) {
  return sortedFields().filter(function (field) {
    if (field.id === selectedId) return true;
    const projection = fieldProjectionById(field.id);
    return Boolean(projection && projection.bound && projection.scopeKey !== null);
  }).map(function (field) {
    return '<option value="' + escapeHtml(field.id) + '"' +
      (field.id === selectedId ? " selected" : "") + ">" +
      escapeHtml(field.name) + "</option>";
  }).join("");
}

function defaultLinkRuleDraft() {
  const fields = sortedFields();
  if (fields.length < 2) throw new Error("MVU_LINK_RULE_FIELDS_REQUIRED");
  return {
    sourceFieldId: fields[0].id,
    operator: ">=",
    sourceThreshold: fields[0].minimum,
    targetFieldId: fields[1].id,
    effect: { kind: "delta", value: fields[1].step },
    enabled: true
  };
}

function renderLinkRule() {
  if (!appState.linkRuleDraft) throw new Error("MVU_LINK_RULE_DRAFT_MISSING");
  const draft = appState.linkRuleDraft;
  const operators = [">=", ">", "<=", "<", "=="];
  const effectKinds = [
    { id: "delta", label: "增量" },
    { id: "multiplier", label: "倍率" }
  ];
  const content = sectionTitle("当……", '<span class="muted">来源字段满足条件</span>') +
    '<section class="form-section rule-form-card"><label class="field-label">来源字段</label>' +
    '<select class="select-input" data-link-input="sourceFieldId" aria-label="来源字段">' +
    fieldSelectOptions(draft.sourceFieldId) + '</select><div class="number-row"><label>比较方式' +
    '<select class="select-input" data-link-input="operator">' +
    operators.map(function (operator) {
      return '<option value="' + escapeHtml(operator) + '"' +
        (draft.operator === operator ? " selected" : "") + ">" +
        escapeHtml(operator) + "</option>";
    }).join("") + '</select></label><label>阈值<input class="number-input" type="number" ' +
    'data-link-number="sourceThreshold" value="' + numberAttribute(draft.sourceThreshold) +
    '"></label></div></section>' +
    sectionTitle("则……", '<span class="muted">修改目标字段变化</span>') +
    '<section class="form-section rule-form-card"><label class="field-label">目标字段</label>' +
    '<select class="select-input" data-link-input="targetFieldId" aria-label="目标字段">' +
    fieldSelectOptions(draft.targetFieldId) + '</select><div class="number-row"><label>效果类型' +
    '<select class="select-input" data-link-effect-kind>' + effectKinds.map(function (kind) {
      return '<option value="' + kind.id + '"' +
        (draft.effect.kind === kind.id ? " selected" : "") + ">" +
        escapeHtml(kind.label) + "</option>";
    }).join("") + '</select></label><label>效果数值<input class="number-input" type="number" ' +
    'data-link-effect-value value="' + numberAttribute(draft.effect.value) +
    '"></label></div></section>' +
    '<div class="setting-group"><div class="setting-row"><span><strong>启用联动</strong>' +
    '<span class="description">停用后保留配置但不执行</span></span>' +
    toggleSwitch("data-link-toggle", "enabled", draft.enabled, "启用联动") + "</div></div>" +
    '<div class="rule-preview"><strong>' + mi("visibility") + "联动预览</strong><p>当 " +
    escapeHtml(linkFieldLabel(draft.sourceFieldId)) + " " + escapeHtml(draft.operator) + " " +
    numberText(draft.sourceThreshold) + " 时，" +
    escapeHtml(linkFieldLabel(draft.targetFieldId)) + "的" +
    escapeHtml(linkRuleEffectLabel(draft)) + "。</p></div>";

  return page(content, {
    title: appState.editingLinkRuleId ? "编辑联动" : "新增联动",
    top: { backScreen: "change" },
    action: {
      secondary: appState.editingLinkRuleId
        ? { action: "delete-link-rule", label: "删除", kind: "danger" }
        : { action: "cancel-link-rule", label: "取消" },
      primary: { action: "save-link-rule", label: "保存联动" }
    }
  });
}

function scopeKeyFor(scope) {
  const context = appState.snapshot.activeContext;
  if (scope === "global") return "global";
  if (scope === "character") {
    if (context.actorId === null) throw new Error("MVU_EFFECT_CHARACTER_CONTEXT_REQUIRED");
    return "character:" + context.actorId;
  }
  if (scope === "group") {
    if (context.groupId === null) throw new Error("MVU_EFFECT_GROUP_CONTEXT_REQUIRED");
    return "group:" + context.groupId;
  }
  if (scope === "chat") {
    if (context.chatId === null) throw new Error("MVU_EFFECT_CHAT_CONTEXT_REQUIRED");
    return "chat:" + context.chatId;
  }
  throw new Error("MVU_EFFECT_SCOPE_INVALID:" + scope);
}

function defaultEffectDraft() {
  const field = sortedFields().find(function (item) {
    const projection = fieldProjectionById(item.id);
    return projection && projection.bound && projection.scopeKey !== null;
  });
  if (!field) throw new Error("MVU_EFFECT_BOUND_FIELD_REQUIRED");
  appState.effectDurationMode = "time";
  appState.effectDurationHours = 24;
  return {
    targetFieldId: field.id,
    scope: field.scope,
    scopeKey: scopeKeyFor(field.scope),
    mode: "multiplier",
    value: 1.1,
    enabled: true,
    expiresAt: Date.now() + 86400000,
    remainingTurns: null,
    reason: "",
    source: "manual",
    createdAt: Date.now()
  };
}

function prepareEffectDraft(effect) {
  appState.editingEffectId = effect.id;
  appState.effectDraft = cloneJson(effect);
  if (effect.expiresAt !== null) {
    appState.effectDurationMode = "time";
    appState.effectDurationHours = Math.max(0, (effect.expiresAt - Date.now()) / 3600000);
  } else if (effect.remainingTurns !== null) {
    appState.effectDurationMode = "turns";
    appState.effectDurationHours = 24;
  } else {
    appState.effectDurationMode = "none";
    appState.effectDurationHours = 24;
  }
}

function effectStatus(effect) {
  if (effect.expiresAt !== null && effect.expiresAt <= Date.now()) {
    return { className: "warn", label: "已到期" };
  }
  if (effect.remainingTurns !== null && effect.remainingTurns <= 0) {
    return { className: "warn", label: "已耗尽" };
  }
  if (!effect.enabled) return { className: "warn", label: "已停用" };
  return { className: "good", label: "生效中" };
}

function temporaryEffectCanToggle(effect) {
  return !(effect.expiresAt !== null && effect.expiresAt <= Date.now()) &&
    !(effect.remainingTurns !== null && effect.remainingTurns <= 0);
}

function managementEffectCard(effect) {
  const field = fieldById(effect.targetFieldId);
  const status = effectStatus(effect);
  const icon = field ? normalizeIconName(field.icon) : "error";
  const tone = field ? requireThemeColor(field) : "#7058D8";
  return '<article class="temporary-effect-card" style="--tone:' + tone + '">' +
    '<button class="effect-card-main" data-effect-id="' + escapeHtml(effect.id) + '">' +
    '<span class="state-icon" style="--tone:' + tone + ";--tone-soft:" +
    softThemeColor(tone) + '">' + mi(icon) + '</span><span><strong>' +
    escapeHtml(field ? field.name : "无效字段引用（" + effect.targetFieldId + "）") +
    '</strong><small>' + escapeHtml(effect.reason) + '</small><em>' +
    escapeHtml(temporaryEffectValue(effect)) + " · " +
    escapeHtml(temporaryEffectDuration(effect)) + '</em></span>' +
    mi("chevron_right") + '</button><div class="effect-card-switch"><span class="status-pill ' +
    status.className + '">' + escapeHtml(status.label) + "</span>" +
    toggleSwitch(
      "data-effect-enabled-id",
      effect.id,
      effect.enabled,
      "启用临时效果",
      !temporaryEffectCanToggle(effect)
    ) +
    "</div></article>";
}

function renderEffects() {
  const effects = temporaryEffects().slice().sort(function (a, b) {
    return b.createdAt - a.createdAt || a.id.localeCompare(b.id);
  });
  const content = '<p class="muted rule-explainer">临时效果参与自然、每轮、规则与 AI 变化计算；手动直接设值不应用临时效果。</p>' +
    (effects.length > 0
      ? '<div class="temporary-effect-list">' + effects.map(managementEffectCard).join("") + "</div>"
      : emptyState("bolt", "还没有临时效果", "为已绑定字段创建一个限时倍率或增量。", null));
  const canCreate = sortedFields().some(function (field) {
    const projection = fieldProjectionById(field.id);
    return Boolean(projection && projection.bound && projection.scopeKey !== null);
  });
  return page(content, {
    title: "临时效果",
    top: {
      backScreen: "fields",
      rightAction: canCreate ? "new-effect" : "",
      rightText: canCreate ? "+ 新增" : ""
    }
  });
}

function renderEffect() {
  if (!appState.effectDraft) throw new Error("MVU_EFFECT_DRAFT_MISSING");
  const draft = appState.effectDraft;
  const durationModes = [
    { id: "none", label: "持续生效" },
    { id: "time", label: "按时间" },
    { id: "turns", label: "按轮次" }
  ];
  const durationInput = appState.effectDurationMode === "time"
    ? '<label class="field-label">剩余小时</label><input class="number-input" type="number" min="0.000278" ' +
      'data-effect-duration-hours aria-label="剩余小时" value="' +
      numberAttribute(appState.effectDurationHours) + '">'
    : appState.effectDurationMode === "turns"
      ? '<label class="field-label">剩余轮次</label><input class="number-input" type="number" min="1" step="1" ' +
        'data-effect-number="remainingTurns" aria-label="剩余轮次" value="' +
        numberAttribute(draft.remainingTurns) + '">'
      : '<p class="form-hint">此效果不会自动到期，可随时手动停用或删除。</p>';
  const content = '<section class="form-section"><label class="field-label">目标字段</label>' +
    '<select class="select-input" data-effect-input="targetFieldId" aria-label="目标字段">' +
    effectFieldSelectOptions(draft.targetFieldId) + '</select><label class="field-label">原因 *</label>' +
    '<textarea class="textarea-input" data-effect-input="reason" aria-label="原因" maxlength="500" ' +
    'placeholder="说明该效果为什么生效">' + escapeHtml(draft.reason) +
    "</textarea></section>" +
    sectionTitle("计算方式", "") +
    '<section class="form-section rule-form-card"><div class="number-row"><label>效果类型' +
    '<select class="select-input" data-effect-input="mode"><option value="multiplier"' +
    (draft.mode === "multiplier" ? " selected" : "") + '>倍率</option><option value="additive"' +
    (draft.mode === "additive" ? " selected" : "") + '>增量</option></select></label>' +
    '<label>效果数值<input class="number-input" type="number" data-effect-number="value" value="' +
    numberAttribute(draft.value) + '"></label></div><div class="setting-group compact-settings">' +
    '<div class="setting-row"><span><strong>启用效果</strong><span class="description">停用后保留配置</span></span>' +
    toggleSwitch("data-effect-toggle", "enabled", draft.enabled, "启用效果") +
    "</div></div></section>" +
    sectionTitle("作用域", '<span class="muted">跟随目标字段</span>') +
    '<section class="form-section rule-form-card"><div class="static-type-row">' +
    mi("my_location") + '<span><strong>' + escapeHtml(SCOPE_LABELS[draft.scope]) +
    '</strong><small>目标字段决定临时效果作用域</small></span></div>' +
    '<p class="scope-key-preview">作用键：<code>' + escapeHtml(draft.scopeKey) +
    "</code></p></section>" +
    sectionTitle("持续时间", "") +
    '<section class="form-section rule-form-card"><div class="option-grid three">' +
    durationModes.map(function (mode) {
      const selected = appState.effectDurationMode === mode.id;
      return '<button class="option-chip ' +
        (selected ? "active" : "") + '" data-effect-duration-mode="' + mode.id +
        '" aria-pressed="' + selected + '">' +
        escapeHtml(mode.label) + "</button>";
    }).join("") + "</div>" + durationInput + "</section>" +
    '<div class="rule-preview"><strong>' + mi("visibility") +
    "效果预览</strong><p>" + escapeHtml(linkFieldLabel(draft.targetFieldId)) + " · " +
    escapeHtml(temporaryEffectValue(draft)) + " · " +
    escapeHtml(temporaryEffectDuration(draft)) + "</p></div>";

  return page(content, {
    title: appState.editingEffectId ? "编辑临时效果" : "新增临时效果",
    top: { backScreen: "effects" },
    action: {
      secondary: appState.editingEffectId
        ? { action: "delete-effect", label: "删除", kind: "danger" }
        : { action: "cancel-effect", label: "取消" },
      primary: { action: "save-effect", label: "保存效果" }
    }
  });
}

function renderModelProbe() {
  if (appState.modelProbe === null) {
    return '<p class="inline-empty">尚未探测系统模型</p>';
  }
  const probe = appState.modelProbe;
  const title = probe.available ? "系统模型可用" : "系统模型不可用";
  const detail = [
    typeof probe.provider === "string" ? probe.provider : "",
    typeof probe.model === "string" ? probe.model : "",
    typeof probe.reason === "string" ? probe.reason : ""
  ].filter(function (item) {
    return item.length > 0;
  }).join(" · ");
  return '<div class="model-status ' + (probe.available ? "available" : "unavailable") + '">' +
    mi(probe.available ? "check_circle" : "error") + "<span><strong>" +
    escapeHtml(title) + "</strong><small>" +
    escapeHtml(detail || "后端未返回额外说明") + "</small></span></div>";
}

function renderJudgeResult() {
  if (appState.judgeResult === null) return "";
  const result = appState.judgeResult;
  const changes = result.changes;
  return sectionTitle("判断结果", '<span class="status-pill ' +
    (result.applied ? "good" : "") + '">' + (result.applied ? "已应用" : "仅预览") + "</span>") +
    '<article class="judge-result-card"><div class="judge-change-list">' +
    (changes.length > 0
      ? changes.map(function (change) {
          const field = fieldById(change.fieldId);
          return '<div class="judge-change"><span><strong>' +
            escapeHtml(field ? field.name : "无效字段引用（" + change.fieldId + "）") +
            '</strong><small>' + escapeHtml(change.reason) + " · 置信度 " +
            numberText(change.confidence) + '</small></span><b class="' +
            (change.delta >= 0 ? "positive" : "negative") + '">' +
            signedNumber(change.delta) + "</b></div>";
        }).join("")
      : '<p class="inline-empty">本次判断没有状态变化</p>') +
    '</div><details><summary>模型原始响应</summary><pre>' +
    escapeHtml(result.raw) + "</pre></details></article>";
}

function aiRecordCard(record) {
  return '<button class="soft-card ai-log" data-record-id="' + escapeHtml(record.id) + '">' +
    '<span class="delta" style="color:' +
    (record.delta >= 0 ? "var(--mint-ink)" : "var(--red-ink)") +
    '">' + signedNumber(record.delta) + '</span><span><strong>' +
    escapeHtml(record.fieldName) + '</strong><span>' + escapeHtml(record.reason) +
    '</span></span><time>' + escapeHtml(relativeTime(record.occurredAt)) + "</time></button>";
}

function renderAi() {
  const draft = requireFieldDraft();
  if (!appState.settingsDraft) throw new Error("MVU_SETTINGS_DRAFT_MISSING");
  const aiRecords = recordsForField(appState.selectedFieldId)
    .filter(function (record) { return record.source === "ai"; })
    .slice(0, 3);
  const content = '<div class="selected-field-banner">' +
    '<span class="state-icon" style="--tone:' + escapeHtml(draft.themeColor) +
    ";--tone-soft:" + softThemeColor(draft.themeColor) + '">' +
    mi(normalizeIconName(draft.icon)) + "</span><span><strong>" +
    escapeHtml(draft.name) + '</strong><small>当前编辑字段</small></span></div>' +
    '<div class="setting-group"><div class="setting-row"><span><strong>全局 AI 状态判断</strong>' +
    '<span class="description">控制整个数据集的 AI 更新入口</span></span>' +
    toggleSwitch("data-settings-toggle", "aiEnabled", appState.settingsDraft.aiEnabled, "全局 AI 状态判断") +
    '</div><div class="setting-row"><span><strong>允许 AI 修改此字段</strong>' +
    '<span class="description">字段级开关</span></span>' +
    toggleSwitch("data-ai-toggle", "enabled", draft.ai.enabled, "允许 AI 修改此字段") +
    "</div></div>" +
    sectionTitle("判断参数", '<button class="button secondary compact-button" data-action="probe-model">' +
      mi("sensors") + "探测模型</button>") +
    '<section class="form-section inline-form-section">' + renderModelProbe() +
    '<div class="number-row"><label>最低置信度<input class="number-input" type="number" min="0" max="1" step="0.01" ' +
    'data-ai-number="minConfidence" value="' + numberAttribute(draft.ai.minConfidence) +
    '"></label><label>单次最大变化<input class="number-input" type="number" min="0" ' +
    'data-ai-number="maxDelta" value="' + numberAttribute(draft.ai.maxDelta) +
    '"></label></div><label class="field-label" for="aiPrompt">字段判断提示</label>' +
    '<textarea class="textarea-input" id="aiPrompt" data-ai-input="prompt" maxlength="2000" ' +
    'placeholder="告诉模型应关注哪些互动事实">' + escapeHtml(draft.ai.prompt) +
    "</textarea></section>" +
    sectionTitle("测试判断", '<span class="muted">预览不会修改数值</span>') +
    '<section class="form-section inline-form-section"><label class="field-label" for="judgeMessage">消息事实</label>' +
    '<textarea class="textarea-input" id="judgeMessage" data-judge-message maxlength="4000" ' +
    'placeholder="输入一条用于判断的真实消息">' + escapeHtml(appState.judgeMessage) +
    '</textarea><p class="form-hint">预览和应用均使用已保存的 AI 设置；修改上方参数后请先点击“保存 AI 设置”。</p>' +
    '<div class="dual-actions"><button class="button secondary" data-action="judge-preview">' +
    mi("visibility") + '预览判断</button><button class="button primary" data-action="judge-commit">' +
    mi("done_all") + "判断并应用</button></div></section>" +
    renderJudgeResult() +
    sectionTitle("最近 AI 记录", "") +
    '<div class="ai-log-list">' +
    (aiRecords.length > 0
      ? aiRecords.map(aiRecordCard).join("")
      : '<p class="inline-empty">暂无 AI 更新记录</p>') +
    "</div>";

  return page(content, {
    title: "AI 自动更新",
    top: { backScreen: "edit" },
    action: {
      primary: { action: "save-ai-settings", label: "保存 AI 设置" }
    }
  });
}

function visibilityPicker(draft) {
  return '<div class="option-grid three" role="group" aria-label="模型可见性">' +
    Object.keys(MODEL_VISIBILITY_LABELS).map(function (visibility) {
      const selected = draft.modelVisibility === visibility;
      return '<button class="option-chip ' +
        (selected ? "active" : "") + '" data-model-visibility="' + visibility +
        '" aria-pressed="' + selected + '">' +
        escapeHtml(MODEL_VISIBILITY_LABELS[visibility]) + "</button>";
    }).join("") + "</div>";
}

function renderAdvanced() {
  const draft = requireFieldDraft();
  const content = '<div class="selected-field-banner">' +
    '<span class="state-icon" style="--tone:' + escapeHtml(draft.themeColor) +
    ";--tone-soft:" + softThemeColor(draft.themeColor) + '">' +
    mi(normalizeIconName(draft.icon)) + "</span><span><strong>" +
    escapeHtml(draft.name) + '</strong><small>当前编辑字段</small></span></div>' +
    sectionTitle("变量标识", "") +
    '<div class="setting-group"><div class="setting-row"><span><strong>内部 ID</strong>' +
    '<span class="description">由后端维护，不随名称改变</span></span><code class="field-id-code">' +
    escapeHtml(appState.editingFieldId || "保存后生成") + "</code></div></div>" +
    sectionTitle("模型可见性", '<span class="muted">控制状态注入模型的详细程度</span>') +
    visibilityPicker(draft) +
    sectionTitle("显示设置", "") +
    '<section class="form-section"><label class="field-label">主题色</label>' +
    themePicker(draft) + '<label class="field-label">图标</label>' + iconPicker(draft) + "</section>" +
    sectionTitle("数据集管理", "") +
    '<div class="option-grid data-actions-grid"><button class="button secondary" data-action="export-dataset">' +
    mi("ios_share") + '导出数据</button><button class="button secondary" data-action="choose-dataset-import">' +
    mi("download") + "导入数据</button></div>" +
    (appState.editingFieldId
      ? '<button class="button danger full-danger" data-action="delete-field">' +
        mi("delete") + "删除字段</button>"
      : "") +
    '<div class="info-panel">' + mi("info") +
    "<div><strong>数据导入</strong><p>导入会由后端校验 formatVersion 2，并在成功后重新读取快照。</p></div></div>";

  return page(content, {
    title: "高级选项",
    top: { backScreen: "edit" },
    action: {
      primary: { action: "save-advanced", label: "保存高级选项" }
    }
  });
}

function autoConditionSummary(condition) {
  if (condition.kind === "recentPositive") {
    return "最近出现 " + numberText(condition.count) + " 次积极互动";
  }
  if (condition.kind === "longInactive") {
    return "连续 " + numberText(condition.hours) + " 小时未互动";
  }
  if (condition.kind === "userCare") return "用户主动表达关心";
  if (condition.kind === "specialDay") return "当前日期是重要纪念日";
  if (condition.kind === "highFreq") {
    return "近期消息达到 " + numberText(condition.messages) + " 条";
  }
  if (condition.kind === "stateThreshold") {
    return linkFieldLabel(condition.fieldId) + " " + condition.operator + " " +
      numberText(condition.threshold);
  }
  throw new Error("MVU_AUTO_RULE_CONDITION_INVALID");
}

function autoEffectSummary(effects) {
  return effects.map(function (effect) {
    return linkFieldLabel(effect.fieldId) + " " + signedNumber(effect.delta);
  }).join("；");
}

function autoRuleCard(rule) {
  return '<button class="field-card auto-rule-card" data-auto-rule-id="' +
    escapeHtml(rule.id) + '"><span class="state-icon large" style="--tone:#7058D8;' +
    '--tone-soft:color-mix(in srgb, #7058D8 14%, white)">' + mi("rule") +
    '</span><span><strong>' + escapeHtml(rule.name) +
    '</strong><span class="description">' + escapeHtml(autoConditionSummary(rule.condition)) +
    '</span><span class="meta">效果：' + escapeHtml(autoEffectSummary(rule.effects)) +
    " · 冷却 " + numberText(rule.cooldownMs / 3600000) + ' 小时</span></span>' +
    '<span class="status-pill ' + (rule.enabled ? "good" : "warn") + '">' +
    (rule.enabled ? "已启用" : "已停用") + "</span>" + mi("chevron_right") + "</button>";
}

function renderRules() {
  const rules = appState.snapshot.autoRules.slice().sort(function (a, b) {
    return a.order - b.order || a.id.localeCompare(b.id);
  });
  const content = '<p class="muted rule-explainer">自动规则根据明确的消息事实执行，缺少事实时不会触发。</p>' +
    (rules.length > 0
      ? '<div class="rule-list auto-rule-list">' + rules.map(autoRuleCard).join("") + "</div>"
      : emptyState("rule", "还没有自动规则", "新增规则后，可按消息事实修改一个或多个状态。", null));
  return page(content, {
    title: "规则设置",
    top: { backScreen: "fields" },
    action: {
      primary: { action: "new-auto-rule", label: "+ 添加规则" }
    }
  });
}

function conditionForKind(kind) {
  if (kind === "recentPositive") return { kind: kind, count: 1 };
  if (kind === "longInactive") return { kind: kind, hours: 24 };
  if (kind === "userCare") return { kind: kind };
  if (kind === "specialDay") return { kind: kind };
  if (kind === "highFreq") return { kind: kind, messages: 20 };
  if (kind === "stateThreshold") {
    const field = sortedFields()[0];
    if (!field) throw new Error("MVU_AUTO_RULE_FIELD_REQUIRED");
    return { kind: kind, fieldId: field.id, operator: ">=", threshold: field.minimum };
  }
  throw new Error("MVU_AUTO_RULE_CONDITION_KIND_INVALID:" + kind);
}

function defaultAutoRuleDraft() {
  const fields = sortedFields();
  if (fields.length === 0) throw new Error("MVU_AUTO_RULE_FIELD_REQUIRED");
  const maxOrder = appState.snapshot.autoRules.reduce(function (maximum, rule) {
    return Math.max(maximum, rule.order);
  }, -1);
  return {
    name: "新自动规则",
    description: "",
    enabled: true,
    condition: { kind: "userCare" },
    effects: [{ fieldId: fields[0].id, delta: fields[0].step }],
    cooldownMs: 21600000,
    order: maxOrder + 1
  };
}

function renderConditionFields(condition) {
  if (condition.kind === "recentPositive") {
    return '<label class="field-label">积极互动次数</label><input class="number-input" type="number" min="1" step="1" ' +
      'data-auto-condition-number="count" aria-label="积极互动次数" value="' +
      numberAttribute(condition.count) + '">';
  }
  if (condition.kind === "longInactive") {
    return '<label class="field-label">未互动小时数</label><input class="number-input" type="number" min="0" ' +
      'data-auto-condition-number="hours" aria-label="未互动小时数" value="' +
      numberAttribute(condition.hours) + '">';
  }
  if (condition.kind === "highFreq") {
    return '<label class="field-label">消息数量</label><input class="number-input" type="number" min="1" step="1" ' +
      'data-auto-condition-number="messages" aria-label="消息数量" value="' +
      numberAttribute(condition.messages) + '">';
  }
  if (condition.kind === "stateThreshold") {
    const operators = [">=", ">", "<=", "<"];
    return '<label class="field-label">状态字段</label><select class="select-input" ' +
      'data-auto-condition-input="fieldId" aria-label="状态字段">' + fieldSelectOptions(condition.fieldId) +
      '</select><div class="number-row"><label>比较方式<select class="select-input" ' +
      'data-auto-condition-input="operator">' + operators.map(function (operator) {
        return '<option value="' + escapeHtml(operator) + '"' +
          (condition.operator === operator ? " selected" : "") + ">" +
          escapeHtml(operator) + "</option>";
      }).join("") + '</select></label><label>阈值<input class="number-input" type="number" ' +
      'data-auto-condition-number="threshold" value="' + numberAttribute(condition.threshold) +
      '"></label></div>';
  }
  return '<p class="form-hint">此条件不需要额外参数。</p>';
}

function autoEffectRow(effect, index, count) {
  return '<div class="auto-effect-row"><span class="stage-index">' + (index + 1) +
    '</span><label>状态字段<select class="select-input" data-auto-effect-index="' + index +
    '" data-auto-effect-property="fieldId">' + fieldSelectOptions(effect.fieldId) +
    '</select></label><label>变化值<input class="number-input" type="number" data-auto-effect-index="' +
    index + '" data-auto-effect-property="delta" value="' + numberAttribute(effect.delta) +
    '"></label>' + (count > 1
      ? '<button class="delete-stage" data-action="delete-auto-effect" data-effect-index="' +
        index + '" aria-label="删除效果">' + mi("delete") + "</button>"
      : "") + "</div>";
}

function renderRule() {
  if (!appState.autoRuleDraft) throw new Error("MVU_AUTO_RULE_DRAFT_MISSING");
  const draft = appState.autoRuleDraft;
  const conditionOptions = Object.keys(CONDITION_LABELS).map(function (kind) {
    return '<option value="' + kind + '"' + (draft.condition.kind === kind ? " selected" : "") +
      ">" + escapeHtml(CONDITION_LABELS[kind]) + "</option>";
  }).join("");
  const content = '<section class="form-section"><label class="field-label" for="ruleName">规则名称 *</label>' +
    '<input class="text-input" id="ruleName" data-auto-input="name" maxlength="80" value="' +
    escapeHtml(draft.name) + '"><label class="field-label" for="ruleDescription">描述</label>' +
    '<textarea class="textarea-input" id="ruleDescription" data-auto-input="description" maxlength="500">' +
    escapeHtml(draft.description) + "</textarea></section>" +
    sectionTitle("当……", '<span class="muted">满足以下条件时</span>') +
    '<section class="form-section rule-form-card"><label class="field-label">条件类型</label>' +
    '<select class="select-input" data-auto-condition-kind aria-label="条件类型">' +
    conditionOptions + "</select>" +
    renderConditionFields(draft.condition) + "</section>" +
    sectionTitle("则……", '<span class="muted">依次执行多个效果</span>') +
    '<section class="form-section rule-form-card"><div class="auto-effect-list">' +
    draft.effects.map(function (effect, index) {
      return autoEffectRow(effect, index, draft.effects.length);
    }).join("") + '</div><button class="button secondary add-stage-button" data-action="add-auto-effect">' +
    mi("add") + "添加效果</button></section>" +
    sectionTitle("触发限制", "") +
    '<section class="form-section rule-form-card"><div class="number-row"><label>冷却（小时）' +
    '<input class="number-input" type="number" min="0" data-auto-cooldown-hours value="' +
    numberAttribute(draft.cooldownMs / 3600000) + '"></label><label>执行顺序' +
    '<input class="number-input" type="number" step="1" data-auto-number="order" value="' +
    numberAttribute(draft.order) + '"></label></div><div class="setting-group compact-settings">' +
    '<div class="setting-row"><span><strong>启用规则</strong><span class="description">停用后保留配置但不执行</span></span>' +
    toggleSwitch("data-auto-toggle", "enabled", draft.enabled, "启用规则") +
    "</div></div></section>" +
    '<div class="rule-preview"><strong>' + mi("visibility") + "规则预览</strong><p>" +
    escapeHtml(autoConditionSummary(draft.condition)) + "时，" +
    escapeHtml(autoEffectSummary(draft.effects)) + "；冷却 " +
    numberText(draft.cooldownMs / 3600000) + " 小时。</p></div>";

  return page(content, {
    title: appState.editingAutoRuleId ? "编辑规则" : "新增规则",
    top: { backScreen: "rules" },
    action: {
      secondary: appState.editingAutoRuleId
        ? { action: "delete-auto-rule", label: "删除", kind: "danger" }
        : { action: "cancel-auto-rule", label: "取消" },
      primary: { action: "save-auto-rule", label: "保存规则" }
    }
  });
}

function recordFilterSelect(kind, value, options, label) {
  return '<label class="record-filter-select"><span>' + escapeHtml(label) +
    '</span><select data-record-filter="' + escapeHtml(kind) + '">' +
    options.map(function (option) {
      return '<option value="' + escapeHtml(option.value) + '"' +
        (option.value === value ? " selected" : "") + ">" +
        escapeHtml(option.label) + "</option>";
    }).join("") + "</select></label>";
}

function filteredRecords() {
  return appState.snapshot.records.filter(function (record) {
    const actorMatches = appState.recordFilters.actorId === "all" ||
      (appState.recordFilters.actorId === "__none__"
        ? record.actorId === null
        : record.actorId === appState.recordFilters.actorId);
    return actorMatches &&
      (appState.recordFilters.fieldId === "all" ||
        record.fieldId === appState.recordFilters.fieldId) &&
      (appState.recordFilters.source === "all" ||
        record.source === appState.recordFilters.source);
  }).sort(function (a, b) {
    return b.occurredAt - a.occurredAt;
  });
}

function historicalFieldVisual(record) {
  const field = fieldById(record.fieldId);
  if (field) {
    return {
      color: requireThemeColor(field),
      soft: softThemeColor(requireThemeColor(field)),
      icon: normalizeIconName(field.icon)
    };
  }
  return {
    color: "#7058D8",
    soft: "color-mix(in srgb, #7058D8 14%, white)",
    icon: "history"
  };
}

function timelineItem(record) {
  const visual = historicalFieldVisual(record);
  const today = dateKey(Date.now()) === dateKey(record.occurredAt);
  const timelineLabel = today ? relativeTime(record.occurredAt) : formatClock(record.occurredAt);
  return '<div class="timeline-item" style="--tone:' + visual.color + '">' +
    '<span class="timeline-time">' + escapeHtml(timelineLabel) + "</span>" +
    '<button class="timeline-card" data-record-id="' + escapeHtml(record.id) +
    '" style="--tone:' + visual.color + '">' +
    '<span class="state-icon" style="--tone:' + visual.color + ";--tone-soft:" +
    visual.soft + '">' + mi(visual.icon) + '</span><span><strong>' +
    escapeHtml(record.fieldName) + '</strong><span class="meta">' +
    escapeHtml(record.reason) + "<br>" + numberText(record.before) + " → " +
    numberText(record.after) + " · " + escapeHtml(record.actorName) + " · " +
    escapeHtml(relativeTime(record.occurredAt)) + '</span></span><span class="delta">' +
    signedNumber(record.delta) + "</span>" + mi("chevron_right") + "</button></div>";
}

function renderRecords() {
  const actorNames = new Map(appState.snapshot.actors.map(function (actor) {
    return [actor.characterId, actor.name];
  }));
  const fieldNames = new Map(sortedFields().map(function (field) {
    return [field.id, field.name];
  }));
  let hasUnscopedActor = false;
  appState.snapshot.records.forEach(function (record) {
    if (record.actorId === null) hasUnscopedActor = true;
    else if (!actorNames.has(record.actorId)) actorNames.set(record.actorId, record.actorName);
    if (!fieldNames.has(record.fieldId)) fieldNames.set(record.fieldId, record.fieldName);
  });
  const actorOptions = [{ value: "all", label: "全部角色" }].concat(
    Array.from(actorNames, function (entry) {
      return { value: entry[0], label: entry[1] };
    })
  );
  if (hasUnscopedActor) actorOptions.push({ value: "__none__", label: "无角色 / 全局" });
  const fieldOptions = [{ value: "all", label: "全部状态" }].concat(
    Array.from(fieldNames, function (entry) {
      return { value: entry[0], label: entry[1] };
    })
  );
  const sourceOptions = [{ value: "all", label: "全部来源" }].concat(
    Object.keys(SOURCE_LABELS).map(function (source) {
      return { value: source, label: SOURCE_LABELS[source] };
    })
  );
  const records = filteredRecords();
  const groups = [];
  records.forEach(function (record) {
    const key = dateKey(record.occurredAt);
    let group = groups.find(function (item) { return item.key === key; });
    if (!group) {
      group = { key: key, timestamp: record.occurredAt, records: [] };
      groups.push(group);
    }
    group.records.push(record);
  });
  const filters = '<div class="filter-chips real-record-filters">' +
    recordFilterSelect("actorId", appState.recordFilters.actorId, actorOptions, "角色") +
    recordFilterSelect("fieldId", appState.recordFilters.fieldId, fieldOptions, "状态") +
    recordFilterSelect("source", appState.recordFilters.source, sourceOptions, "来源") +
    "</div>";
  const timeline = groups.length > 0
    ? groups.map(function (group) {
        return '<h3 class="timeline-day">' + escapeHtml(dateGroupLabel(group.timestamp)) +
          '</h3><div class="timeline">' + group.records.map(timelineItem).join("") + "</div>";
      }).join("")
    : emptyState("filter_alt_off", "没有匹配记录", "调整角色、状态或来源筛选条件。", null);
  return page(filters + timeline, {
    title: "记录",
    top: { menu: true },
    className: "clean-page"
  });
}

function recordActorMarkup(record) {
  const actor = appState.snapshot.actors.find(function (item) {
    return item.characterId === record.actorId;
  });
  if (actor) return actorAvatarMarkup(actor, "record-actor-avatar", true);
  const initial = record.actorName.trim().slice(0, 1) || "·";
  return '<span class="record-actor-avatar actor-avatar-placeholder" aria-hidden="true">' +
    escapeHtml(initial) + "</span>";
}

function recordTrend(record) {
  const field = fieldById(record.fieldId);
  if (!field) {
    return '<div class="chart-empty">' + mi("history") +
      "<span>字段已删除，历史记录仍完整保留</span></div>";
  }
  return renderTrend(field, record.scopeKey, Number(appState.chartRange), record.fieldName + "历史趋势");
}

function keyValue(key, value) {
  return '<div class="key-value"><span class="key">' + escapeHtml(key) +
    '</span><span class="value">' + value + "</span></div>";
}

function renderRecordDetail() {
  const record = appState.snapshot.records.find(function (item) {
    return item.id === appState.selectedRecordId;
  });
  if (!record) {
    return page(emptyState("history", "记录不存在", "这条记录可能已被数据导入替换。", null), {
      title: "变化详情",
      top: { backScreen: "records" },
      className: "clean-page"
    });
  }
  const visual = historicalFieldVisual(record);
  const source = SOURCE_LABELS[record.source];
  if (!source) throw new Error("MVU_RECORD_SOURCE_INVALID:" + record.source);
  const effectIds = record.effectIds;
  const requested = keyValue("效果后请求值", signedNumber(record.effectiveRequestedDelta));
  const content = '<article class="record-hero"><span class="state-icon large" style="--tone:' +
    visual.color + ";--tone-soft:" + visual.soft + '">' + mi(visual.icon) +
    '</span><div><strong>' + escapeHtml(record.fieldName) +
    '</strong><span class="micro">' + escapeHtml(record.reason) +
    '</span></div><span class="delta-big" style="color:' + visual.color + '">' +
    signedNumber(record.delta) + "</span></article>" +
    '<div class="record-grid">' +
    keyValue("变化前", numberText(record.before)) +
    keyValue("变化后", '<strong style="color:' + visual.color + '">' +
      numberText(record.after) + "</strong>") +
    requested +
    keyValue("来源", escapeHtml(source)) +
    keyValue("时间", escapeHtml(formatDateTime(record.occurredAt))) +
    keyValue("影响角色", '<span class="actor-value">' + recordActorMarkup(record) +
      escapeHtml(record.actorName) + "</span>") +
    (effectIds.length > 0 ? keyValue("临时效果", escapeHtml(effectIds.length + " 个参与计算")) : "") +
    "</div>" +
    sectionTitle("原因", "") + '<article class="reason-card floral-reason"><p>' +
    escapeHtml(record.reason) + "</p></article>" +
    sectionTitle("趋势概览", '<span class="micro">' +
      escapeHtml(relativeTime(record.occurredAt)) + "</span>") +
    '<article class="chart-card">' + recordTrend(record) + "</article>";

  return page(content, {
    title: "变化详情",
    top: {
      backScreen: "records",
      rightAction: "close-record",
      rightIcon: "close",
      rightLabel: "关闭"
    },
    className: "clean-page"
  });
}

function drawerLink(icon, label, screen) {
  return '<button class="drawer-link' + (appState.screen === screen ? " active" : "") +
    '" data-screen="' + escapeHtml(screen) + '">' + mi(icon) + "<span>" +
    escapeHtml(label) + "</span>" + mi("chevron_right") + "</button>";
}

function sheetContent(kind) {
  if (kind === "help") {
    return '<h3>动态状态</h3><p>状态由手动调整、自然变化、每轮变化、状态联动、自动规则、临时效果和 AI 判断共同更新。</p>' +
      '<button class="button primary full-button" data-action="close-overlay">知道了</button>';
  }
  if (kind === "delete-field") {
    const draft = requireFieldDraft();
    return '<h3>删除“' + escapeHtml(draft.name) + '”？</h3>' +
      '<p>字段删除由后端统一处理关联数据；历史记录会保留字段名称快照。</p>' +
      '<button class="button danger full-button" data-action="confirm-delete-field">确认删除</button>';
  }
  throw new Error("MVU_SHEET_KIND_INVALID:" + kind);
}

function renderOverlay() {
  if (appState.drawer) {
    return '<div class="drawer-scrim" data-action="close-overlay"></div>' +
      '<aside class="side-drawer" role="dialog" aria-modal="true" aria-label="插件菜单">' +
      '<div class="drawer-profile">' + contextAvatarMarkup("drawer-avatar") +
      '<span><strong>' + escapeHtml(appState.snapshot.activeContext.actorName) +
      '</strong><span class="micro">动态状态 · MVU 角色状态插件</span></span>' +
      '<button class="drawer-close" data-action="close-overlay" aria-label="关闭菜单">' +
      mi("close") + '</button></div><div class="drawer-body">' +
      '<section class="drawer-group"><p>状态</p>' +
      drawerLink("favorite", "状态总览", "home") +
      drawerLink("article", "变化记录", "records") + "</section>" +
      '<section class="drawer-group"><p>配置</p>' +
      drawerLink("settings", "字段设置", "fields") +
      drawerLink("schedule", "自然变化与规则", "change") +
      drawerLink("account_tree", "规则设置", "rules") +
      drawerLink("bolt", "临时效果", "effects") +
      drawerLink("tune", "高级选项", "advanced") + "</section>" +
      '<section class="drawer-group"><p>外观</p>' +
      '<button class="drawer-link" data-action="choose-background">' +
      mi("wallpaper") + "<span>更换背景照片</span>" + mi("chevron_right") + "</button>" +
      '<button class="drawer-link" data-action="reset-background">' +
      mi("restart_alt") + "<span>恢复默认背景</span>" + mi("chevron_right") + "</button>" +
      "</section></div></aside>";
  }
  if (appState.sheet) {
    return '<div class="sheet-scrim" data-action="close-overlay"></div>' +
      '<section class="bottom-sheet" role="dialog" aria-modal="true" aria-label="操作确认">' +
      '<div class="sheet-handle"></div>' +
      sheetContent(appState.sheet) + "</section>";
  }
  return "";
}

function applyBackgroundPreference() {
  const storedBackground = window.localStorage.getItem(BACKGROUND_STORAGE_KEY);
  if (storedBackground === null) {
    document.documentElement.style.removeProperty("--selected-background-image");
    document.documentElement.classList.remove("has-custom-background");
    return;
  }
  document.documentElement.style.setProperty(
    "--selected-background-image",
    "url(" + JSON.stringify(storedBackground) + ")"
  );
  document.documentElement.classList.add("has-custom-background");
}

function readFileAsDataUrl(file) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.addEventListener("load", function () {
      if (typeof reader.result !== "string") {
        reject(new Error("MVU_BACKGROUND_READ_RESULT_INVALID"));
        return;
      }
      resolve(reader.result);
    }, { once: true });
    reader.addEventListener("error", function () {
      reject(reader.error || new Error("MVU_BACKGROUND_READ_FAILED"));
    }, { once: true });
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise(function (resolve, reject) {
    const image = new Image();
    image.addEventListener("load", function () {
      resolve(image);
    }, { once: true });
    image.addEventListener("error", function () {
      reject(new Error("MVU_BACKGROUND_DECODE_FAILED"));
    }, { once: true });
    image.src = dataUrl;
  });
}

async function encodeBackground(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    throw new Error("MVU_BACKGROUND_TYPE_UNSUPPORTED");
  }
  const source = await readFileAsDataUrl(file);
  const image = await loadImage(source);
  const ratio = Math.min(1, BACKGROUND_MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("MVU_BACKGROUND_CANVAS_CONTEXT_MISSING");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.88);
}

backgroundPicker.addEventListener("change", function () {
  void (async function () {
    const file = backgroundPicker.files && backgroundPicker.files[0];
    if (!file) return;
    const encodedBackground = await encodeBackground(file);
    window.localStorage.setItem(BACKGROUND_STORAGE_KEY, encodedBackground);
    applyBackgroundPreference();
    appState.drawer = false;
    render();
    showToast("背景照片已应用到全部页面");
    backgroundPicker.value = "";
  })().catch(function (error) {
    console.error("MVU background selection failed", error);
    showToast("背景照片设置失败，请查看运行日志");
  });
});

datasetImportPicker.addEventListener("change", function () {
  void (async function () {
    const file = datasetImportPicker.files && datasetImportPicker.files[0];
    if (!file) return;
    const button = appRoot.querySelector('[data-action="choose-dataset-import"]');
    await withBusy(button, "import-dataset", async function () {
      const json = await file.text();
      await callNative("importDataset", { json: json });
      clearEditorState();
      await reloadSnapshot();
      replaceScreen("fields");
      showToast("数据集已导入");
    });
    datasetImportPicker.value = "";
  })().catch(function (error) {
    console.error("MVU dataset import failed", error);
    datasetImportPicker.value = "";
    showToast("数据集导入失败，请查看运行日志");
  });
});

const renderers = {
  home: renderHome,
  detail: renderDetail,
  fields: renderFields,
  edit: renderEdit,
  stages: renderStages,
  change: renderChange,
  linkRule: renderLinkRule,
  effects: renderEffects,
  effect: renderEffect,
  ai: renderAi,
  advanced: renderAdvanced,
  rules: renderRules,
  rule: renderRule,
  records: renderRecords,
  recordDetail: renderRecordDetail
};

function render(options) {
  const config = options || {};
  const previousScroll = appRoot.querySelector(".screen-scroll");
  const previousScrollTop = config.preserveScroll === false || !previousScroll
    ? 0
    : previousScroll.scrollTop;
  const renderer = renderers[appState.screen];
  if (typeof renderer !== "function") throw new Error("MVU_SCREEN_RENDERER_MISSING:" + appState.screen);
  appRoot.innerHTML = renderer();
  if (screenCaption) screenCaption.textContent = SCREEN_META[appState.screen].caption;
  if (screenNav) screenNav.innerHTML = "";
  window.requestAnimationFrame(function () {
    try {
      if (config.preserveScroll !== false) {
        const nextScroll = appRoot.querySelector(".screen-scroll");
        if (nextScroll) {
          nextScroll.scrollTop = Math.min(
            previousScrollTop,
            Math.max(0, nextScroll.scrollHeight - nextScroll.clientHeight)
          );
        }
      }
      const overlayFocusTarget = appState.drawer
        ? appRoot.querySelector(".drawer-close")
        : appState.sheet
          ? appRoot.querySelector(".bottom-sheet button")
          : null;
      if (overlayFocusTarget instanceof HTMLButtonElement) overlayFocusTarget.focus();
      drawCharts();
    } catch (error) {
      console.error("MVU chart rendering failed", error);
    }
  });
}

function setScreen(screenId) {
  if (!SCREEN_IDS.has(screenId)) throw new Error("MVU_SCREEN_INVALID:" + screenId);
  if (appState.screen === screenId) {
    appState.drawer = false;
    appState.sheet = "";
    render();
    return;
  }
  appState.screen = screenId;
  appState.drawer = false;
  appState.sheet = "";
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("screen", screenId);
  window.history.pushState({ screen: screenId }, "", nextUrl);
  render({ preserveScroll: false });
}

function replaceScreen(screenId) {
  if (!SCREEN_IDS.has(screenId)) throw new Error("MVU_SCREEN_INVALID:" + screenId);
  appState.screen = screenId;
  appState.drawer = false;
  appState.sheet = "";
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("screen", screenId);
  window.history.replaceState({ screen: screenId }, "", nextUrl);
  render({ preserveScroll: false });
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("show");
  toastTimer = window.setTimeout(function () {
    toast.classList.remove("show");
  }, 2600);
}

async function withBusy(button, actionName, operation) {
  if (appState.busyAction) return;
  appState.busyAction = actionName;
  if (button instanceof HTMLButtonElement) {
    button.disabled = true;
    button.classList.add("busy");
    button.setAttribute("aria-busy", "true");
  }
  try {
    await operation();
  } finally {
    appState.busyAction = "";
    if (button instanceof HTMLButtonElement && button.isConnected) {
      button.disabled = false;
      button.classList.remove("busy");
      button.removeAttribute("aria-busy");
    }
  }
}

function drawCharts() {
  document.querySelectorAll("canvas[data-chart]").forEach(function (canvas) {
    drawTrend(canvas);
  });
}

function drawTrend(canvas) {
  const values = canvas.dataset.values.split(",").map(Number);
  const timestamps = canvas.dataset.timestamps.split(",").map(Number);
  const declaredMinimum = Number(canvas.dataset.minimum);
  const declaredMaximum = Number(canvas.dataset.maximum);
  if (values.length < 2 || values.length !== timestamps.length ||
      !values.every(Number.isFinite) || !timestamps.every(Number.isFinite) ||
      !Number.isFinite(declaredMinimum) || !Number.isFinite(declaredMaximum)) {
    throw new Error("MVU_CHART_DATA_INVALID");
  }
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(260, Math.round(rect.width));
  const height = Math.max(110, Math.round(rect.height));
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("MVU_CHART_CONTEXT_MISSING");
  context.scale(dpr, dpr);
  const color = canvas.dataset.color;
  const pad = { left: 28, right: 10, top: 12, bottom: 22 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  const minimum = Math.min(declaredMinimum, Math.min.apply(null, values));
  const maximum = Math.max(declaredMaximum, Math.max.apply(null, values));
  const span = maximum - minimum || 1;

  context.clearRect(0, 0, width, height);
  context.strokeStyle = "rgba(114,132,190,.16)";
  context.lineWidth = 1;
  context.setLineDash([3, 4]);
  [0, 0.33, 0.66, 1].forEach(function (fraction) {
    const y = pad.top + chartHeight * fraction;
    context.beginPath();
    context.moveTo(pad.left, y);
    context.lineTo(width - pad.right, y);
    context.stroke();
  });
  context.setLineDash([]);

  const points = values.map(function (value, index) {
    return {
      x: pad.left + chartWidth * (index / (values.length - 1)),
      y: pad.top + chartHeight * (1 - (value - minimum) / span)
    };
  });
  const area = context.createLinearGradient(0, pad.top, 0, height - pad.bottom);
  area.addColorStop(0, color + "55");
  area.addColorStop(1, color + "08");
  context.beginPath();
  context.moveTo(points[0].x, height - pad.bottom);
  points.forEach(function (point, index) {
    if (index === 0) {
      context.lineTo(point.x, point.y);
    } else {
      const previous = points[index - 1];
      const midX = (previous.x + point.x) / 2;
      context.bezierCurveTo(midX, previous.y, midX, point.y, point.x, point.y);
    }
  });
  context.lineTo(points[points.length - 1].x, height - pad.bottom);
  context.closePath();
  context.fillStyle = area;
  context.fill();

  context.beginPath();
  points.forEach(function (point, index) {
    if (index === 0) {
      context.moveTo(point.x, point.y);
    } else {
      const previous = points[index - 1];
      const midX = (previous.x + point.x) / 2;
      context.bezierCurveTo(midX, previous.y, midX, point.y, point.x, point.y);
    }
  });
  context.strokeStyle = color;
  context.lineWidth = 2.4;
  context.stroke();

  const dateFormatter = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" });
  const middleIndex = Math.floor((timestamps.length - 1) / 2);
  const labels = [
    { text: dateFormatter.format(new Date(timestamps[0])), x: pad.left, align: "left" },
    { text: dateFormatter.format(new Date(timestamps[middleIndex])), x: pad.left + chartWidth / 2, align: "center" },
    { text: dateFormatter.format(new Date(timestamps[timestamps.length - 1])), x: width - pad.right, align: "right" }
  ];
  context.fillStyle = "#687493";
  context.font = '11px "Microsoft YaHei UI", sans-serif';
  labels.forEach(function (label) {
    context.textAlign = label.align;
    context.fillText(label.text, label.x, height - 5);
  });
}

function clearEditorState() {
  appState.editingFieldId = "";
  appState.editingAutoRuleId = "";
  appState.editingLinkRuleId = "";
  appState.editingEffectId = "";
  appState.fieldDraft = null;
  appState.autoRuleDraft = null;
  appState.linkRuleDraft = null;
  appState.effectDraft = null;
  appState.modelProbe = null;
  appState.judgeResult = null;
}

function currentSnapshotRequest() {
  if (appState.snapshot === null) return {};
  const context = appState.snapshot.activeContext;
  // actorId is an explicit group-member override in the host contract. Passing the active
  // character of a one-to-one chat as that override makes the host correctly reject it because
  // a single-character chat has no member list.
  if (context.groupId === null || context.actorId === null) return {};
  return { actorId: context.actorId };
}

function isStaleActorSelectionError(error) {
  return error instanceof Error &&
    error.message.includes("MVU_HOST_SELECTED_ACTOR_NOT_IN_ACTIVE_CONTEXT:");
}

async function requestSnapshot(snapshotRequest) {
  try {
    return await callNative("snapshot", snapshotRequest);
  } catch (error) {
    // A group can change, or the host can switch back to a one-to-one chat, between two page
    // refreshes. Recover against the host's authoritative active context instead of leaving a
    // completed mutation looking like it failed.
    if (typeof snapshotRequest.actorId !== "string" || !isStaleActorSelectionError(error)) {
      throw error;
    }
    return callNative("snapshot", {});
  }
}

async function reloadSnapshot(request) {
  const previousActorId = appState.snapshot === null
    ? null
    : appState.snapshot.activeContext.actorId;
  const snapshotRequest = request === undefined ? currentSnapshotRequest() : request;
  const snapshot = await requestSnapshot(snapshotRequest);
  validateSnapshot(snapshot);
  const actorChanged = appState.snapshot !== null &&
    previousActorId !== snapshot.activeContext.actorId;
  appState.snapshot = snapshot;
  appState.settingsDraft = cloneJson(snapshot.settings);
  const fields = sortedFields();
  const selectedProjection = appState.selectedFieldId
    ? fieldProjectionById(appState.selectedFieldId)
    : null;
  const selectedStillUsable = Boolean(selectedProjection) &&
    (!actorChanged || Boolean(
      selectedProjection.definition.enabled &&
      selectedProjection.bound &&
      typeof selectedProjection.currentValue === "number"
    ));
  if (!selectedStillUsable) {
    const projected = snapshot.fields.find(function (projection) {
      return projection.definition.enabled && projection.bound &&
        typeof projection.currentValue === "number";
    });
    appState.selectedFieldId = projected
      ? projected.definition.id
      : (fields[0] ? fields[0].id : "");
  }
  if (actorChanged) {
    // A field draft belongs to the actor context it was opened for. Keeping it after a role
    // change can send later AI, natural-change, or advanced actions to the previous field.
    appState.editingFieldId = "";
    appState.fieldDraft = null;
    appState.modelProbe = null;
    appState.judgeResult = null;
  }
  if (appState.selectedFieldId) selectField(appState.selectedFieldId);
}

function formError(message) {
  const error = new Error("MVU_FORM_INVALID:" + message);
  error.userMessage = message;
  return error;
}

function numericInputValue(input) {
  return input.valueAsNumber;
}

function applyFieldSearchToDom() {
  const query = appState.fieldSearch.trim().toLocaleLowerCase("zh-CN");
  let visibleCount = 0;
  appRoot.querySelectorAll(".searchable-field-card").forEach(function (wrapper) {
    const card = wrapper.querySelector("[data-search-haystack]");
    const visible = Boolean(card && card.dataset.searchHaystack.includes(query));
    wrapper.hidden = !visible;
    if (visible) visibleCount += 1;
  });
  const empty = appRoot.querySelector(".field-search-empty");
  if (empty) empty.hidden = visibleCount > 0;
}

function syncManualSaveButton() {
  const button = appRoot.querySelector('[data-action="save-manual"]');
  if (!(button instanceof HTMLButtonElement)) return;
  const changed = Number.isFinite(appState.manualValue) &&
    (appState.manualOriginalValue === null ||
      appState.manualValue !== appState.manualOriginalValue);
  button.disabled = !changed;
}

function fieldRangeCardElement(fieldId) {
  return Array.from(appRoot.querySelectorAll("[data-range-card]")).find(function (card) {
    return card.dataset.rangeCard === fieldId;
  }) || null;
}

function syncFieldRangeCard(fieldId) {
  const field = requireField(fieldId);
  const draft = fieldRangeDraft(field);
  const validation = validateFieldRangeDraft(field, draft);
  const card = fieldRangeCardElement(fieldId);
  if (!(card instanceof HTMLElement)) return;

  card.style.setProperty(
    "--range-position",
    rangePreviewPosition(field, draft, validation.previewValue) + "%"
  );
  const lowerOutput = card.querySelector("[data-range-lower-output]");
  const upperOutput = card.querySelector("[data-range-upper-output]");
  const currentOutput = card.querySelector("[data-range-current-output]");
  if (lowerOutput) lowerOutput.textContent = numberText(draft.minimum);
  if (upperOutput) upperOutput.textContent = numberText(draft.maximum);
  if (currentOutput) {
    currentOutput.textContent = validation.previewValue === null
      ? "当前 —"
      : "换算后 " + numberText(validation.previewValue);
  }

  card.querySelectorAll("[data-range-number]").forEach(function (input) {
    input.classList.toggle("invalid", Boolean(validation.error));
    input.setAttribute("aria-invalid", String(Boolean(validation.error)));
  });
  const message = card.querySelector("[data-range-message]");
  if (message) {
    message.textContent = validation.error ||
      (validation.changed
        ? "保存后同步换算当前值、阶段与关联规则"
        : "可直接修改上下限，无需进入二级页面");
    message.classList.toggle("error", Boolean(validation.error));
    message.classList.toggle("changed", !validation.error && validation.changed);
  }
  const button = card.querySelector('[data-action="save-field-range"]');
  if (button instanceof HTMLButtonElement) {
    button.disabled = !validation.changed || Boolean(validation.error);
  }
}

function handleFormMutation(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) &&
      !(target instanceof HTMLTextAreaElement) &&
      !(target instanceof HTMLSelectElement)) {
    return;
  }

  if (target.matches("[data-field-search]")) {
    appState.fieldSearch = target.value;
    applyFieldSearchToDom();
    return;
  }

  if (target.matches("[data-manual-value]")) {
    appState.manualValue = numericInputValue(target);
    syncManualSaveButton();
    return;
  }

  if (target.matches("[data-range-number][data-range-field-id]")) {
    const fieldId = target.dataset.rangeFieldId;
    const property = target.dataset.rangeNumber;
    const field = requireField(fieldId);
    if (property !== "minimum" && property !== "maximum") {
      throw new Error("MVU_FIELD_RANGE_PROPERTY_INVALID:" + property);
    }
    fieldRangeDraft(field)[property] = numericInputValue(target);
    syncFieldRangeCard(fieldId);
    return;
  }

  if (target.matches("[data-field-input]")) {
    requireFieldDraft()[target.dataset.fieldInput] = target.value;
    return;
  }

  if (target.matches("[data-field-number]")) {
    const draft = requireFieldDraft();
    const property = target.dataset.fieldNumber;
    const value = numericInputValue(target);
    draft[property] = value;
    if (!appState.editingFieldId && property === "minimum" &&
        Number.isFinite(value) && draft.stages.length > 0) {
      // A new field has no list card yet. Keep its first stage anchored to the entered lower
      // bound so creation remains valid without sending the user through another editor.
      draft.stages[0].threshold = value;
    }
    return;
  }

  if (target.matches("[data-stage-id][data-stage-property]")) {
    const draft = requireFieldDraft();
    const stage = draft.stages.find(function (item) {
      return item.id === target.dataset.stageId;
    });
    if (!stage) throw new Error("MVU_STAGE_DRAFT_NOT_FOUND:" + target.dataset.stageId);
    stage[target.dataset.stageProperty] = target.dataset.stageProperty === "threshold"
      ? numericInputValue(target)
      : target.value;
    return;
  }

  if (target.matches("[data-natural-number]")) {
    requireFieldDraft().naturalChange[target.dataset.naturalNumber] = numericInputValue(target);
    return;
  }

  if (target.matches("[data-natural-unit-hours]")) {
    requireFieldDraft().naturalChange.unitMs = numericInputValue(target) * 3600000;
    return;
  }

  if (target.matches("[data-turn-number]")) {
    requireFieldDraft().perTurnChange[target.dataset.turnNumber] = numericInputValue(target);
    return;
  }

  if (target.matches("[data-ai-number]")) {
    requireFieldDraft().ai[target.dataset.aiNumber] = numericInputValue(target);
    return;
  }

  if (target.matches("[data-ai-input]")) {
    requireFieldDraft().ai[target.dataset.aiInput] = target.value;
    return;
  }

  if (target.matches("[data-judge-message]")) {
    appState.judgeMessage = target.value;
    return;
  }

  if (target.matches("[data-link-input]")) {
    appState.linkRuleDraft[target.dataset.linkInput] = target.value;
    return;
  }

  if (target.matches("[data-link-number]")) {
    appState.linkRuleDraft[target.dataset.linkNumber] = numericInputValue(target);
    return;
  }

  if (target.matches("[data-link-effect-kind]")) {
    appState.linkRuleDraft.effect.kind = target.value;
    return;
  }

  if (target.matches("[data-link-effect-value]")) {
    appState.linkRuleDraft.effect.value = numericInputValue(target);
    return;
  }

  if (target.matches("[data-auto-input]")) {
    appState.autoRuleDraft[target.dataset.autoInput] = target.value;
    return;
  }

  if (target.matches("[data-auto-number]")) {
    appState.autoRuleDraft[target.dataset.autoNumber] = numericInputValue(target);
    return;
  }

  if (target.matches("[data-auto-cooldown-hours]")) {
    appState.autoRuleDraft.cooldownMs = numericInputValue(target) * 3600000;
    return;
  }

  if (target.matches("[data-auto-condition-kind]")) {
    appState.autoRuleDraft.condition = conditionForKind(target.value);
    render();
    return;
  }

  if (target.matches("[data-auto-condition-input]")) {
    appState.autoRuleDraft.condition[target.dataset.autoConditionInput] = target.value;
    return;
  }

  if (target.matches("[data-auto-condition-number]")) {
    appState.autoRuleDraft.condition[target.dataset.autoConditionNumber] = numericInputValue(target);
    return;
  }

  if (target.matches("[data-auto-effect-index][data-auto-effect-property]")) {
    const index = Number(target.dataset.autoEffectIndex);
    const effect = appState.autoRuleDraft.effects[index];
    if (!effect) throw new Error("MVU_AUTO_EFFECT_DRAFT_NOT_FOUND:" + index);
    effect[target.dataset.autoEffectProperty] = target.dataset.autoEffectProperty === "delta"
      ? numericInputValue(target)
      : target.value;
    return;
  }

  if (target.matches("[data-effect-input]")) {
    const draft = appState.effectDraft;
    if (!draft) throw new Error("MVU_EFFECT_DRAFT_MISSING");
    const property = target.dataset.effectInput;
    draft[property] = target.value;
    if (property === "targetFieldId") {
      const field = requireField(target.value);
      const projection = fieldProjectionById(field.id);
      if (!projection || !projection.bound || projection.scopeKey === null) {
        throw new Error("MVU_EFFECT_TARGET_CONTEXT_NOT_BOUND:" + field.id);
      }
      draft.scope = field.scope;
      draft.scopeKey = projection.scopeKey;
      render();
    }
    return;
  }

  if (target.matches("[data-effect-number]")) {
    const draft = appState.effectDraft;
    if (!draft) throw new Error("MVU_EFFECT_DRAFT_MISSING");
    draft[target.dataset.effectNumber] = numericInputValue(target);
    return;
  }

  if (target.matches("[data-effect-duration-hours]")) {
    const hours = numericInputValue(target);
    appState.effectDurationHours = hours;
    appState.effectDraft.expiresAt = Number.isFinite(hours)
      ? Date.now() + hours * 3600000
      : Number.NaN;
    return;
  }

  if (target.matches("[data-record-filter]")) {
    appState.recordFilters[target.dataset.recordFilter] = target.value;
    render();
  }
}

appRoot.addEventListener("input", function (event) {
  try {
    handleFormMutation(event);
  } catch (error) {
    console.error("MVU form input failed", error);
    showToast(error.userMessage || "输入处理失败，请查看运行日志");
  }
});

appRoot.addEventListener("change", function (event) {
  try {
    handleFormMutation(event);
  } catch (error) {
    console.error("MVU form change failed", error);
    showToast(error.userMessage || "选项更新失败，请查看运行日志");
  }
});

function validateFieldPayload(draft) {
  const name = draft.name.trim();
  if (name.length === 0) throw formError("请输入字段名称");
  if (!Number.isFinite(draft.minimum) || !Number.isFinite(draft.maximum) ||
      draft.minimum >= draft.maximum) {
    throw formError("最小值必须小于最大值");
  }
  if (!Number.isFinite(draft.step) || draft.step <= 0) throw formError("步进必须大于 0");
  if (!Number.isFinite(draft.initialValue) ||
      draft.initialValue < draft.minimum || draft.initialValue > draft.maximum) {
    throw formError("初始值必须位于数值范围内");
  }
  if (!Object.prototype.hasOwnProperty.call(SCOPE_LABELS, draft.scope)) {
    throw formError("请选择有效作用域");
  }
  if (!Array.isArray(draft.bindingIds) ||
      !draft.bindingIds.every(function (bindingId) {
        return typeof bindingId === "string" && bindingId.length > 0;
      })) {
    throw formError("字段绑定标识无效");
  }
  if (draft.scope === "global" && draft.bindingIds.length > 0) {
    throw formError("全局字段不能包含绑定标识");
  }
  if (!Object.prototype.hasOwnProperty.call(MODEL_VISIBILITY_LABELS, draft.modelVisibility)) {
    throw formError("请选择有效模型可见性");
  }
  if (!/^#[0-9a-f]{6}$/i.test(draft.themeColor)) throw formError("请选择有效主题色");
  normalizeIconName(draft.icon);
  if (!Array.isArray(draft.stages) || draft.stages.length === 0) {
    throw formError("至少保留一个阶段");
  }

  const stages = draft.stages.map(function (stage) {
    const stageName = stage.name.trim();
    if (stageName.length === 0) throw formError("阶段名称不能为空");
    if (!Number.isFinite(stage.threshold) ||
        stage.threshold < draft.minimum || stage.threshold > draft.maximum) {
      throw formError("阶段阈值必须位于字段范围内");
    }
    return {
      id: stage.id,
      name: stageName,
      threshold: stage.threshold,
      description: stage.description.trim()
    };
  }).sort(function (a, b) {
    return a.threshold - b.threshold;
  });
  const ids = new Set(stages.map(function (stage) { return stage.id; }));
  if (ids.size !== stages.length) throw formError("阶段标识不能重复");
  if (stages[0].threshold !== draft.minimum) {
    throw formError("第一个阶段阈值必须等于字段最小值");
  }
  for (let index = 1; index < stages.length; index += 1) {
    if (stages[index - 1].threshold >= stages[index].threshold) {
      throw formError("阶段阈值必须严格递增");
    }
  }
  if (!Number.isFinite(draft.naturalChange.unitMs) || draft.naturalChange.unitMs <= 0 ||
      !Number.isFinite(draft.naturalChange.amount)) {
    throw formError("自然变化参数无效");
  }
  if (!Number.isInteger(draft.perTurnChange.intervalTurns) ||
      draft.perTurnChange.intervalTurns <= 0 ||
      !Number.isFinite(draft.perTurnChange.amount) ||
      !["user", "character", "both"].includes(draft.perTurnChange.countMode)) {
    throw formError("每轮变化参数无效");
  }
  if (!Number.isFinite(draft.ai.minConfidence) ||
      draft.ai.minConfidence < 0 || draft.ai.minConfidence > 1) {
    throw formError("最低置信度必须在 0 到 1 之间");
  }
  if (!Number.isFinite(draft.ai.maxDelta) || draft.ai.maxDelta < 0) {
    throw formError("单次最大变化不能小于 0");
  }

  return {
    name: name,
    description: draft.description.trim(),
    minimum: draft.minimum,
    maximum: draft.maximum,
    step: draft.step,
    initialValue: draft.initialValue,
    icon: normalizeIconName(draft.icon),
    themeColor: draft.themeColor.toUpperCase(),
    enabled: Boolean(draft.enabled),
    scope: draft.scope,
    modelVisibility: draft.modelVisibility,
    ai: {
      enabled: Boolean(draft.ai.enabled),
      minConfidence: draft.ai.minConfidence,
      maxDelta: draft.ai.maxDelta,
      prompt: draft.ai.prompt.trim()
    },
    stages: stages,
    bindingIds: Array.from(new Set(draft.bindingIds)),
    naturalChange: {
      enabled: Boolean(draft.naturalChange.enabled),
      unitMs: draft.naturalChange.unitMs,
      amount: draft.naturalChange.amount
    },
    perTurnChange: {
      enabled: Boolean(draft.perTurnChange.enabled),
      intervalTurns: draft.perTurnChange.intervalTurns,
      amount: draft.perTurnChange.amount,
      countMode: draft.perTurnChange.countMode
    }
  };
}

function validateLinkRule(draft) {
  if (!fieldById(draft.sourceFieldId) || !fieldById(draft.targetFieldId)) {
    throw formError("请选择仍然存在的来源和目标字段");
  }
  if (draft.sourceFieldId === draft.targetFieldId) {
    throw formError("来源字段与目标字段不能相同");
  }
  if (![">=", ">", "<=", "<", "=="].includes(draft.operator) ||
      !Number.isFinite(draft.sourceThreshold)) {
    throw formError("联动条件无效");
  }
  if (!["delta", "multiplier"].includes(draft.effect.kind) ||
      !Number.isFinite(draft.effect.value)) {
    throw formError("联动效果无效");
  }
  if (draft.effect.kind === "multiplier" && draft.effect.value <= 0) {
    throw formError("变化倍率必须大于 0");
  }
  const candidate = {
    sourceFieldId: draft.sourceFieldId,
    operator: draft.operator,
    sourceThreshold: draft.sourceThreshold,
    targetFieldId: draft.targetFieldId,
    effect: {
      kind: draft.effect.kind,
      value: draft.effect.value
    },
    enabled: Boolean(draft.enabled)
  };
  validateLinkGraphForUi(candidate);
  return candidate;
}

function validateLinkGraphForUi(candidate) {
  const rules = appState.snapshot.rules.filter(function (rule) {
    return rule.id !== appState.editingLinkRuleId;
  }).map(function (rule) {
    return {
      id: rule.id,
      sourceFieldId: rule.sourceFieldId,
      targetFieldId: rule.targetFieldId
    };
  });
  rules.push({
    id: appState.editingLinkRuleId || "draft_link_rule",
    sourceFieldId: candidate.sourceFieldId,
    targetFieldId: candidate.targetFieldId
  });
  const outgoing = new Map();
  rules.forEach(function (rule) {
    const entries = outgoing.get(rule.sourceFieldId) || [];
    entries.push(rule);
    outgoing.set(rule.sourceFieldId, entries);
  });
  function visit(fieldId, path, depth) {
    const entries = outgoing.get(fieldId) || [];
    entries.forEach(function (rule) {
      if (path.includes(rule.targetFieldId)) {
        throw formError("联动规则不能形成循环");
      }
      if (depth + 1 > MAX_LINK_CHAIN_DEPTH) {
        throw formError("联动链最多允许 " + MAX_LINK_CHAIN_DEPTH + " 层");
      }
      visit(rule.targetFieldId, path.concat(rule.targetFieldId), depth + 1);
    });
  }
  outgoing.forEach(function (_, sourceFieldId) {
    visit(sourceFieldId, [sourceFieldId], 0);
  });
}

function validateAutoRule(draft) {
  const name = draft.name.trim();
  if (name.length === 0) throw formError("请输入规则名称");
  if (!Object.prototype.hasOwnProperty.call(CONDITION_LABELS, draft.condition.kind)) {
    throw formError("请选择有效条件");
  }
  const condition = cloneJson(draft.condition);
  if (condition.kind === "recentPositive" &&
      (!Number.isInteger(condition.count) || condition.count <= 0)) {
    throw formError("积极互动次数必须为正整数");
  }
  if (condition.kind === "longInactive" &&
      (!Number.isFinite(condition.hours) || condition.hours < 0)) {
    throw formError("未互动小时数不能小于 0");
  }
  if (condition.kind === "highFreq" &&
      (!Number.isInteger(condition.messages) || condition.messages <= 0)) {
    throw formError("消息数量必须为正整数");
  }
  if (condition.kind === "stateThreshold") {
    if (!fieldById(condition.fieldId) ||
        ![">=", ">", "<=", "<"].includes(condition.operator) ||
        !Number.isFinite(condition.threshold)) {
      throw formError("状态阈值条件无效");
    }
  }
  if (!Array.isArray(draft.effects) || draft.effects.length === 0) {
    throw formError("至少添加一个规则效果");
  }
  const effects = draft.effects.map(function (effect) {
    if (!fieldById(effect.fieldId) || !Number.isFinite(effect.delta)) {
      throw formError("规则效果字段或变化值无效");
    }
    return { fieldId: effect.fieldId, delta: effect.delta };
  });
  if (!Number.isFinite(draft.cooldownMs) || draft.cooldownMs < 0) {
    throw formError("冷却时间不能小于 0");
  }
  if (!Number.isInteger(draft.order)) throw formError("执行顺序必须为整数");
  return {
    name: name,
    description: draft.description.trim(),
    enabled: Boolean(draft.enabled),
    condition: condition,
    effects: effects,
    cooldownMs: draft.cooldownMs,
    order: draft.order
  };
}

function validateTemporaryEffect(draft) {
  const targetField = fieldById(draft.targetFieldId);
  if (!targetField) throw formError("请选择仍然存在的目标字段");
  if (targetField.scope !== draft.scope) throw formError("临时效果作用域必须与目标字段一致");
  if (!Object.prototype.hasOwnProperty.call(SCOPE_LABELS, draft.scope)) {
    throw formError("临时效果作用域无效");
  }
  if (draft.scope === "global") {
    if (draft.scopeKey !== "global") throw formError("全局临时效果作用键无效");
  } else {
    const prefix = draft.scope + ":";
    if (!draft.scopeKey.startsWith(prefix) ||
        !targetField.bindingIds.includes(draft.scopeKey.slice(prefix.length))) {
      throw formError("临时效果作用键未绑定到目标字段");
    }
  }
  if (!["multiplier", "additive"].includes(draft.mode) || !Number.isFinite(draft.value)) {
    throw formError("临时效果计算参数无效");
  }
  if (draft.mode === "multiplier" && draft.value <= 0) {
    throw formError("倍率必须大于 0");
  }
  const reason = draft.reason.trim();
  if (reason.length === 0) throw formError("请填写临时效果原因");
  if (draft.expiresAt !== null && (!Number.isFinite(draft.expiresAt) || draft.expiresAt <= Date.now())) {
    throw formError("到期时间必须晚于当前时间");
  }
  if (draft.remainingTurns !== null &&
      (!Number.isInteger(draft.remainingTurns) || draft.remainingTurns <= 0)) {
    throw formError("剩余轮次必须为正整数");
  }
  if (draft.expiresAt !== null && draft.remainingTurns !== null) {
    throw formError("时间期限和轮次期限不能同时设置");
  }
  if (!["manual", "rule", "ai"].includes(draft.source)) throw formError("临时效果来源无效");
  if (!Number.isFinite(draft.createdAt)) throw formError("临时效果创建时间无效");
  return {
    targetFieldId: draft.targetFieldId,
    scope: draft.scope,
    scopeKey: draft.scopeKey,
    mode: draft.mode,
    value: draft.value,
    enabled: Boolean(draft.enabled),
    expiresAt: draft.expiresAt,
    remainingTurns: draft.remainingTurns,
    reason: reason,
    source: draft.source,
    createdAt: draft.createdAt
  };
}

const FIELD_EDITOR_SCREENS = ["edit", "stages", "change", "ai", "advanced"];

function ensureSelectedFieldDraft() {
  const alreadyEditingCurrentField = FIELD_EDITOR_SCREENS.includes(appState.screen) &&
    appState.fieldDraft &&
    (appState.editingFieldId === appState.selectedFieldId || appState.editingFieldId === "");
  if (alreadyEditingCurrentField) return appState.fieldDraft;
  if (!appState.selectedFieldId) throw formError("请先创建字段");
  return prepareFieldDraft(appState.selectedFieldId);
}

function prepareScreenState(screenId) {
  if (FIELD_EDITOR_SCREENS.includes(screenId)) {
    ensureSelectedFieldDraft();
  }
  if (screenId === "rule" && !appState.autoRuleDraft) {
    appState.editingAutoRuleId = "";
    appState.autoRuleDraft = defaultAutoRuleDraft();
  }
  if (screenId === "linkRule" && !appState.linkRuleDraft) {
    appState.editingLinkRuleId = "";
    appState.linkRuleDraft = defaultLinkRuleDraft();
  }
  if (screenId === "effect" && !appState.effectDraft) {
    appState.editingEffectId = "";
    appState.effectDraft = defaultEffectDraft();
  }
  if (screenId === "recordDetail" && !appState.selectedRecordId) {
    const record = appState.snapshot.records.slice().sort(function (a, b) {
      return b.occurredAt - a.occurredAt;
    })[0];
    if (record) appState.selectedRecordId = record.id;
  }
}

async function saveFieldAction(button) {
  const payload = validateFieldPayload(requireFieldDraft());
  const creatingField = appState.editingFieldId.length === 0;
  await withBusy(button, "save-field", async function () {
    let savedFieldId = appState.editingFieldId;
    if (appState.editingFieldId) {
      await callNative("updateField", { id: appState.editingFieldId, patch: payload });
    } else {
      const created = await callNative("addField", { field: payload });
      if (!created || typeof created.id !== "string") {
        throw new Error("MVU_ADD_FIELD_RESULT_INVALID");
      }
      savedFieldId = created.id;
    }
    await reloadSnapshot();
    appState.selectedFieldId = savedFieldId;
    if (creatingField) {
      // A search entered before creating a field can hide the successful result and make the
      // save appear to have failed. Show the new field explicitly after creation.
      appState.fieldSearch = "";
      appState.fieldTab = payload.enabled ? "active" : "all";
    }
    clearEditorState();
    replaceScreen("fields");
    showToast("字段已保存");
  });
}

async function saveFieldRangeAction(button) {
  const fieldId = button.dataset.fieldRangeId;
  if (typeof fieldId !== "string" || fieldId.length === 0) {
    throw new Error("MVU_FIELD_RANGE_ID_MISSING");
  }
  const field = requireField(fieldId);
  const draft = fieldRangeDraft(field);
  const validation = validateFieldRangeDraft(field, draft);
  if (validation.error) throw formError(validation.error);
  if (!validation.changed) {
    showToast("范围未变化，无需保存");
    return;
  }
  await withBusy(button, "save-field-range:" + fieldId, async function () {
    await callNative("updateField", {
      id: fieldId,
      patch: { minimum: draft.minimum, maximum: draft.maximum }
    });
    delete appState.fieldRangeDrafts[fieldId];
    await reloadSnapshot();
    render();
    showToast(field.name + "的数值范围已更新");
  });
}

async function saveStagesAction(button) {
  const payload = validateFieldPayload(requireFieldDraft());
  appState.fieldDraft.stages = cloneJson(payload.stages);
  if (!appState.editingFieldId) {
    setScreen("edit");
    showToast("阶段已写入新字段草稿");
    return;
  }
  const fieldId = appState.editingFieldId;
  await withBusy(button, "save-stages", async function () {
    await callNative("updateField", { id: fieldId, patch: { stages: payload.stages } });
    await reloadSnapshot();
    prepareFieldDraft(fieldId);
    replaceScreen("edit");
    showToast("阶段已保存");
  });
}

async function saveExistingFieldPatch(button, actionName, patch, successMessage, returnScreen) {
  if (!appState.editingFieldId) throw formError("请先保存字段，再配置此项");
  const fieldId = appState.editingFieldId;
  await withBusy(button, actionName, async function () {
    await callNative("updateField", { id: fieldId, patch: patch });
    await reloadSnapshot();
    prepareFieldDraft(fieldId);
    replaceScreen(returnScreen);
    showToast(successMessage);
  });
}

async function saveManualAction(button) {
  const field = requireField(appState.selectedFieldId);
  if (!Number.isFinite(appState.manualValue)) throw formError("请输入有效目标数值");
  if (appState.manualValue < field.minimum || appState.manualValue > field.maximum) {
    throw formError("目标数值必须位于字段范围内");
  }
  if (appState.manualOriginalValue !== null &&
      appState.manualValue === appState.manualOriginalValue) {
    showToast("数值未变化，无需保存");
    return;
  }
  await withBusy(button, "save-manual", async function () {
    await callNative("setStateValue", {
      scopeContext: scopeContext(),
      fieldId: field.id,
      value: appState.manualValue,
      reason: "手动调整"
    });
    await reloadSnapshot();
    render();
    showToast(field.name + "已更新");
  });
}

async function saveLinkRuleAction(button) {
  const rule = validateLinkRule(appState.linkRuleDraft);
  await withBusy(button, "save-link-rule", async function () {
    if (appState.editingLinkRuleId) {
      await callNative("updateLinkRule", {
        id: appState.editingLinkRuleId,
        patch: rule
      });
    } else {
      await callNative("addLinkRule", { rule: rule });
    }
    await reloadSnapshot();
    appState.editingLinkRuleId = "";
    appState.linkRuleDraft = null;
    appState.changeTab = "links";
    replaceScreen("change");
    showToast("联动规则已保存");
  });
}

async function saveAutoRuleAction(button) {
  const rule = validateAutoRule(appState.autoRuleDraft);
  await withBusy(button, "save-auto-rule", async function () {
    if (appState.editingAutoRuleId) {
      await callNative("updateAutoRule", {
        id: appState.editingAutoRuleId,
        patch: rule
      });
    } else {
      await callNative("addAutoRule", { rule: rule });
    }
    await reloadSnapshot();
    appState.editingAutoRuleId = "";
    appState.autoRuleDraft = null;
    replaceScreen("rules");
    showToast("自动规则已保存");
  });
}

async function saveTemporaryEffectAction(button) {
  const effect = validateTemporaryEffect(appState.effectDraft);
  await withBusy(button, "save-effect", async function () {
    if (appState.editingEffectId) {
      await callNative("updateTemporaryEffect", {
        id: appState.editingEffectId,
        patch: effect
      });
    } else {
      await callNative("addTemporaryEffect", { effect: effect });
    }
    await reloadSnapshot();
    appState.editingEffectId = "";
    appState.effectDraft = null;
    replaceScreen("effects");
    showToast("临时效果已保存");
  });
}

async function probeModelAction(button) {
  await withBusy(button, "probe-model", async function () {
    const probe = await callNative("probeModel", {});
    if (!probe || typeof probe.available !== "boolean" ||
        (probe.provider !== undefined && typeof probe.provider !== "string") ||
        (probe.model !== undefined && typeof probe.model !== "string") ||
        (probe.reason !== undefined && typeof probe.reason !== "string")) {
      throw new Error("MVU_MODEL_PROBE_RESULT_INVALID");
    }
    appState.modelProbe = probe;
    render();
  });
}

function validateJudgeResult(result) {
  if (!result || typeof result.available !== "boolean" ||
      typeof result.applied !== "boolean" || !Array.isArray(result.changes) ||
      typeof result.raw !== "string") {
    throw new Error("MVU_JUDGE_RESULT_INVALID");
  }
  result.changes.forEach(function (change) {
    if (!change || typeof change.fieldId !== "string" ||
        !Number.isFinite(change.delta) || typeof change.reason !== "string" ||
        !Number.isFinite(change.confidence)) {
      throw new Error("MVU_JUDGE_CHANGE_INVALID");
    }
  });
  return result;
}

function requireSavedAiSettingsForJudgement() {
  const fieldId = appState.editingFieldId;
  if (!fieldId) throw formError("请先保存字段，再进行 AI 判断");
  const savedField = fieldById(fieldId);
  const draft = requireFieldDraft();
  if (!savedField || !appState.settingsDraft) {
    throw new Error("MVU_AI_SETTINGS_STATE_MISSING");
  }
  const savedAi = savedField.ai;
  const draftAi = draft.ai;
  const fieldSettingsMatch = savedAi.enabled === Boolean(draftAi.enabled) &&
    savedAi.minConfidence === draftAi.minConfidence &&
    savedAi.maxDelta === draftAi.maxDelta &&
    savedAi.prompt === draftAi.prompt.trim();
  const globalSettingsMatch = appState.snapshot.settings.aiEnabled ===
    Boolean(appState.settingsDraft.aiEnabled);
  if (!fieldSettingsMatch || !globalSettingsMatch) {
    throw formError("AI 设置已修改，请先点击“保存 AI 设置”");
  }
  if (!appState.snapshot.settings.aiEnabled) {
    throw formError("请先开启并保存全局 AI 状态判断");
  }
  if (!savedField.enabled || !savedAi.enabled) {
    throw formError("请先启用并保存当前字段的 AI 修改权限");
  }
  const projection = fieldProjectionById(fieldId);
  if (!projection || !projection.bound || projection.currentValue === null) {
    throw formError("当前字段未绑定到这个聊天上下文");
  }
}

async function judgeStateAction(button, commit) {
  requireSavedAiSettingsForJudgement();
  const message = appState.judgeMessage.trim();
  if (message.length === 0) throw formError("请输入用于判断的消息事实");
  await withBusy(button, commit ? "judge-commit" : "judge-preview", async function () {
    const result = await callNative("judgeState", {
      scopeContext: scopeContext(),
      message: message,
      commit: commit
    });
    appState.judgeResult = validateJudgeResult(result);
    if (commit && appState.judgeResult.applied) {
      const fieldId = appState.editingFieldId;
      await reloadSnapshot();
      if (fieldId && fieldById(fieldId)) prepareFieldDraft(fieldId);
    }
    render();
    showToast(commit
      ? (appState.judgeResult.applied ? "AI 判断已应用" : "AI 判断未产生变化")
      : "AI 判断预览已完成");
  });
}

async function exportDatasetAction(button) {
  await withBusy(button, "export-dataset", async function () {
    const exported = await callNative("exportDataset", {});
    if (!exported || typeof exported.fileName !== "string" ||
        exported.fileName.trim().length === 0 || typeof exported.savedPath !== "string" ||
        exported.savedPath.trim().length === 0) {
      throw new Error("MVU_EXPORT_RESULT_INVALID");
    }
    showToast("已导出到 " + exported.savedPath);
  });
}

function toggleDraftBoolean(object, property) {
  object[property] = !object[property];
  render();
}

function handleChoiceButton(target) {
  if (target.matches("[data-field-icon]")) {
    requireFieldDraft().icon = target.dataset.fieldIcon;
    render();
    return true;
  }
  if (target.matches("[data-field-theme]")) {
    requireFieldDraft().themeColor = target.dataset.fieldTheme;
    render();
    return true;
  }
  if (target.matches("[data-field-scope]")) {
    const fieldDraft = requireFieldDraft();
    const nextScope = target.dataset.fieldScope;
    if (fieldDraft.scope !== nextScope) {
      fieldDraft.scope = nextScope;
      const bindingId = currentBindingIdForScope(nextScope);
      fieldDraft.bindingIds = bindingId === null ? [] : [bindingId];
    }
    render();
    return true;
  }
  if (target.matches("[data-bind-actor]")) {
    const actorId = target.dataset.bindActor;
    const index = requireFieldDraft().bindingIds.indexOf(actorId);
    if (index >= 0) requireFieldDraft().bindingIds.splice(index, 1);
    else requireFieldDraft().bindingIds.push(actorId);
    render();
    return true;
  }
  if (target.matches("[data-context-binding]")) {
    const bindingId = target.dataset.contextBinding;
    const bindings = requireFieldDraft().bindingIds;
    const index = bindings.indexOf(bindingId);
    if (index >= 0) bindings.splice(index, 1);
    else bindings.push(bindingId);
    render();
    return true;
  }
  if (target.matches("[data-field-toggle]")) {
    toggleDraftBoolean(requireFieldDraft(), target.dataset.fieldToggle);
    return true;
  }
  if (target.matches("[data-natural-toggle]")) {
    toggleDraftBoolean(requireFieldDraft().naturalChange, target.dataset.naturalToggle);
    return true;
  }
  if (target.matches("[data-turn-toggle]")) {
    toggleDraftBoolean(requireFieldDraft().perTurnChange, target.dataset.turnToggle);
    return true;
  }
  if (target.matches("[data-turn-count-mode]")) {
    requireFieldDraft().perTurnChange.countMode = target.dataset.turnCountMode;
    render();
    return true;
  }
  if (target.matches("[data-ai-toggle]")) {
    toggleDraftBoolean(requireFieldDraft().ai, target.dataset.aiToggle);
    return true;
  }
  if (target.matches("[data-settings-toggle]")) {
    toggleDraftBoolean(appState.settingsDraft, target.dataset.settingsToggle);
    return true;
  }
  if (target.matches("[data-model-visibility]")) {
    requireFieldDraft().modelVisibility = target.dataset.modelVisibility;
    render();
    return true;
  }
  if (target.matches("[data-link-toggle]")) {
    toggleDraftBoolean(appState.linkRuleDraft, target.dataset.linkToggle);
    return true;
  }
  if (target.matches("[data-auto-toggle]")) {
    toggleDraftBoolean(appState.autoRuleDraft, target.dataset.autoToggle);
    return true;
  }
  if (target.matches("[data-effect-toggle]")) {
    toggleDraftBoolean(appState.effectDraft, target.dataset.effectToggle);
    return true;
  }
  if (target.matches("[data-effect-duration-mode]")) {
    const mode = target.dataset.effectDurationMode;
    appState.effectDurationMode = mode;
    if (mode === "none") {
      appState.effectDraft.expiresAt = null;
      appState.effectDraft.remainingTurns = null;
    } else if (mode === "time") {
      appState.effectDraft.expiresAt = Date.now() + appState.effectDurationHours * 3600000;
      appState.effectDraft.remainingTurns = null;
    } else if (mode === "turns") {
      appState.effectDraft.expiresAt = null;
      appState.effectDraft.remainingTurns = 10;
    } else {
      throw new Error("MVU_EFFECT_DURATION_MODE_INVALID:" + mode);
    }
    render();
    return true;
  }
  return false;
}

appRoot.addEventListener("click", function (event) {
  void handleAppClick(event).catch(function (error) {
    console.error("MVU Web UI action failed", error);
    showToast(error.userMessage || "操作失败，请查看运行日志");
  });
});

async function handleAppClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  if (handleChoiceButton(target.closest("button") || target)) return;

  const stateFieldTarget = target.closest("[data-field-id]");
  if (stateFieldTarget) {
    selectField(stateFieldTarget.dataset.fieldId);
    setScreen("detail");
    return;
  }

  const editFieldTarget = target.closest("[data-edit-field]");
  if (editFieldTarget) {
    prepareFieldDraft(editFieldTarget.dataset.editField);
    setScreen("edit");
    return;
  }

  const recordTarget = target.closest("[data-record-id]");
  if (recordTarget) {
    appState.selectedRecordId = recordTarget.dataset.recordId;
    setScreen("recordDetail");
    return;
  }

  const autoRuleTarget = target.closest("[data-auto-rule-id]");
  if (autoRuleTarget) {
    const rule = appState.snapshot.autoRules.find(function (item) {
      return item.id === autoRuleTarget.dataset.autoRuleId;
    });
    if (!rule) throw new Error("MVU_AUTO_RULE_NOT_FOUND:" + autoRuleTarget.dataset.autoRuleId);
    appState.editingAutoRuleId = rule.id;
    appState.autoRuleDraft = cloneJson(rule);
    setScreen("rule");
    return;
  }

  const linkRuleTarget = target.closest("[data-link-rule-id]");
  if (linkRuleTarget) {
    const rule = appState.snapshot.rules.find(function (item) {
      return item.id === linkRuleTarget.dataset.linkRuleId;
    });
    if (!rule) throw new Error("MVU_LINK_RULE_NOT_FOUND:" + linkRuleTarget.dataset.linkRuleId);
    appState.editingLinkRuleId = rule.id;
    appState.linkRuleDraft = cloneJson(rule);
    setScreen("linkRule");
    return;
  }

  const effectTarget = target.closest("[data-effect-id]");
  if (effectTarget) {
    const effect = temporaryEffects().find(function (item) {
      return item.id === effectTarget.dataset.effectId;
    });
    if (!effect) throw new Error("MVU_TEMPORARY_EFFECT_NOT_FOUND:" + effectTarget.dataset.effectId);
    prepareEffectDraft(effect);
    setScreen("effect");
    return;
  }

  const effectEnabledTarget = target.closest("[data-effect-enabled-id]");
  if (effectEnabledTarget) {
    const effect = temporaryEffects().find(function (item) {
      return item.id === effectEnabledTarget.dataset.effectEnabledId;
    });
    if (!effect) throw new Error("MVU_TEMPORARY_EFFECT_NOT_FOUND:" + effectEnabledTarget.dataset.effectEnabledId);
    if (!temporaryEffectCanToggle(effect)) {
      throw formError("该临时效果已到期或耗尽，请打开详情设置新的时效");
    }
    await withBusy(effectEnabledTarget, "toggle-effect", async function () {
      await callNative("updateTemporaryEffect", {
        id: effect.id,
        patch: { enabled: !effect.enabled }
      });
      await reloadSnapshot();
      render();
      showToast(effect.enabled ? "临时效果已停用" : "临时效果已启用");
    });
    return;
  }

  const fieldTabTarget = target.closest("[data-field-tab]");
  if (fieldTabTarget) {
    appState.fieldTab = fieldTabTarget.dataset.fieldTab;
    render();
    return;
  }

  const changeTabTarget = target.closest("[data-change-tab]");
  if (changeTabTarget) {
    appState.changeTab = changeTabTarget.dataset.changeTab;
    render();
    return;
  }

  const chartRangeTarget = target.closest("[data-chart-range]");
  if (chartRangeTarget) {
    appState.chartRange = chartRangeTarget.dataset.chartRange;
    render();
    return;
  }

  const actorTarget = target.closest("[data-select-actor]");
  if (actorTarget) {
    const actorId = actorTarget.dataset.selectActor;
    if (typeof actorId !== "string" || actorId.length === 0) {
      throw new Error("MVU_ROLE_SELECTION_ACTOR_ID_MISSING");
    }
    if (appState.snapshot.activeContext.actorId === actorId) return;
    await withBusy(actorTarget, "select-actor", async function () {
      await reloadSnapshot({ actorId: actorId });
      render();
    });
    return;
  }

  const screenTarget = target.closest("[data-screen]");
  if (screenTarget) {
    const screenId = screenTarget.dataset.screen;
    prepareScreenState(screenId);
    setScreen(screenId);
    return;
  }

  const actionTarget = target.closest("[data-action]");
  if (!actionTarget) return;
  const action = actionTarget.dataset.action;

  if (action === "go-back") {
    window.history.back();
  } else if (action === "open-drawer") {
    // Refresh the selected role projection before opening so the drawer never shows stale state.
    await reloadSnapshot();
    appState.drawer = true;
    render();
  } else if (action === "close-overlay") {
    appState.drawer = false;
    appState.sheet = "";
    render();
  } else if (action === "show-help") {
    appState.sheet = "help";
    render();
  } else if (action === "choose-background") {
    backgroundPicker.click();
  } else if (action === "reset-background") {
    window.localStorage.removeItem(BACKGROUND_STORAGE_KEY);
    applyBackgroundPreference();
    appState.drawer = false;
    render();
    showToast("已恢复默认背景");
  } else if (action === "new-field") {
    appState.editingFieldId = "";
    appState.fieldDraft = defaultFieldDraft();
    setScreen("edit");
  } else if (action === "cancel-field-edit") {
    appState.editingFieldId = "";
    appState.fieldDraft = null;
    setScreen("fields");
  } else if (action === "edit-selected-field") {
    prepareFieldDraft(appState.selectedFieldId);
    setScreen("edit");
  } else if (action === "open-ai-for-selected" || action === "open-ai-settings") {
    ensureSelectedFieldDraft();
    setScreen("ai");
  } else if (action === "open-change-settings") {
    ensureSelectedFieldDraft();
    setScreen("change");
  } else if (action === "open-advanced-settings") {
    ensureSelectedFieldDraft();
    setScreen("advanced");
  } else if (action === "edit-stages") {
    ensureSelectedFieldDraft();
    setScreen("stages");
  } else if (action === "save-manual") {
    await saveManualAction(actionTarget);
  } else if (action === "step-manual") {
    const field = requireField(appState.selectedFieldId);
    const direction = Number(actionTarget.dataset.stepDirection);
    const current = Number.isFinite(appState.manualValue) ? appState.manualValue : field.initialValue;
    appState.manualValue = Math.max(field.minimum, Math.min(field.maximum, current + direction * field.step));
    const input = appRoot.querySelector("[data-manual-value]");
    if (input instanceof HTMLInputElement) input.value = appState.manualValue;
    syncManualSaveButton();
  } else if (action === "save-field-range") {
    await saveFieldRangeAction(actionTarget);
  } else if (action === "save-field") {
    await saveFieldAction(actionTarget);
  } else if (action === "save-stages") {
    await saveStagesAction(actionTarget);
  } else if (action === "balance-stages") {
    const draft = requireFieldDraft();
    const count = draft.stages.length;
    draft.stages.forEach(function (stage, index) {
      stage.threshold = draft.minimum + ((draft.maximum - draft.minimum) * index) / count;
    });
    render();
  } else if (action === "add-stage") {
    const draft = requireFieldDraft();
    const threshold = draft.minimum + ((draft.maximum - draft.minimum) * draft.stages.length) /
      (draft.stages.length + 1);
    draft.stages.push({
      id: "stage_" + Date.now().toString(36) + "_" + draft.stages.length,
      name: "新阶段",
      threshold: threshold,
      description: ""
    });
    render();
  } else if (action === "delete-stage") {
    const draft = requireFieldDraft();
    draft.stages = draft.stages.filter(function (stage) {
      return stage.id !== actionTarget.dataset.stageId;
    });
    render();
  } else if (action === "settle-natural") {
    await withBusy(actionTarget, "settle-natural", async function () {
      await callNative("settleNatural", { scopeContext: scopeContext() });
      const fieldId = appState.editingFieldId;
      await reloadSnapshot();
      if (fieldId && fieldById(fieldId)) prepareFieldDraft(fieldId);
      render();
      showToast("自然变化已结算");
    });
  } else if (action === "save-natural") {
    const payload = validateFieldPayload(requireFieldDraft());
    await saveExistingFieldPatch(actionTarget, "save-natural", {
      naturalChange: payload.naturalChange
    }, "自然变化已保存", "change");
  } else if (action === "save-turn") {
    const payload = validateFieldPayload(requireFieldDraft());
    await saveExistingFieldPatch(actionTarget, "save-turn", {
      perTurnChange: payload.perTurnChange
    }, "每轮变化已保存", "change");
  } else if (action === "new-link-rule") {
    appState.editingLinkRuleId = "";
    appState.linkRuleDraft = defaultLinkRuleDraft();
    setScreen("linkRule");
  } else if (action === "cancel-link-rule") {
    appState.linkRuleDraft = null;
    setScreen("change");
  } else if (action === "save-link-rule") {
    await saveLinkRuleAction(actionTarget);
  } else if (action === "delete-link-rule") {
    const ruleId = appState.editingLinkRuleId;
    if (!ruleId) throw new Error("MVU_LINK_RULE_ID_MISSING");
    await withBusy(actionTarget, "delete-link-rule", async function () {
      await callNative("deleteLinkRule", { id: ruleId });
      await reloadSnapshot();
      appState.editingLinkRuleId = "";
      appState.linkRuleDraft = null;
      appState.changeTab = "links";
      replaceScreen("change");
      showToast("联动规则已删除");
    });
  } else if (action === "probe-model") {
    await probeModelAction(actionTarget);
  } else if (action === "judge-preview") {
    await judgeStateAction(actionTarget, false);
  } else if (action === "judge-commit") {
    await judgeStateAction(actionTarget, true);
  } else if (action === "save-ai-settings") {
    const payload = validateFieldPayload(requireFieldDraft());
    if (!appState.editingFieldId) throw formError("请先保存字段，再配置 AI");
    const fieldId = appState.editingFieldId;
    await withBusy(actionTarget, "save-ai-settings", async function () {
      await callNative("updateField", { id: fieldId, patch: { ai: payload.ai } });
      await callNative("updateSettings", {
        patch: { aiEnabled: Boolean(appState.settingsDraft.aiEnabled) }
      });
      await reloadSnapshot();
      prepareFieldDraft(fieldId);
      render();
      showToast("AI 设置已保存");
    });
  } else if (action === "save-advanced") {
    const payload = validateFieldPayload(requireFieldDraft());
    await saveExistingFieldPatch(actionTarget, "save-advanced", {
      modelVisibility: payload.modelVisibility,
      themeColor: payload.themeColor,
      icon: payload.icon
    }, "高级选项已保存", "advanced");
  } else if (action === "export-dataset") {
    await exportDatasetAction(actionTarget);
  } else if (action === "choose-dataset-import") {
    datasetImportPicker.click();
  } else if (action === "delete-field") {
    appState.sheet = "delete-field";
    render();
  } else if (action === "confirm-delete-field") {
    const fieldId = appState.editingFieldId;
    if (!fieldId) throw new Error("MVU_FIELD_ID_MISSING");
    await withBusy(actionTarget, "delete-field", async function () {
      await callNative("deleteField", { id: fieldId });
      clearEditorState();
      await reloadSnapshot();
      replaceScreen("fields");
      showToast("字段已删除");
    });
  } else if (action === "new-auto-rule") {
    appState.editingAutoRuleId = "";
    appState.autoRuleDraft = defaultAutoRuleDraft();
    setScreen("rule");
  } else if (action === "cancel-auto-rule") {
    appState.autoRuleDraft = null;
    setScreen("rules");
  } else if (action === "add-auto-effect") {
    const field = sortedFields()[0];
    if (!field) throw formError("请先创建字段");
    appState.autoRuleDraft.effects.push({ fieldId: field.id, delta: field.step });
    render();
  } else if (action === "delete-auto-effect") {
    const index = Number(actionTarget.dataset.effectIndex);
    appState.autoRuleDraft.effects.splice(index, 1);
    render();
  } else if (action === "save-auto-rule") {
    await saveAutoRuleAction(actionTarget);
  } else if (action === "delete-auto-rule") {
    const ruleId = appState.editingAutoRuleId;
    if (!ruleId) throw new Error("MVU_AUTO_RULE_ID_MISSING");
    await withBusy(actionTarget, "delete-auto-rule", async function () {
      await callNative("deleteAutoRule", { id: ruleId });
      await reloadSnapshot();
      appState.editingAutoRuleId = "";
      appState.autoRuleDraft = null;
      replaceScreen("rules");
      showToast("自动规则已删除");
    });
  } else if (action === "new-effect") {
    appState.editingEffectId = "";
    appState.effectDraft = defaultEffectDraft();
    setScreen("effect");
  } else if (action === "cancel-effect") {
    appState.effectDraft = null;
    setScreen("effects");
  } else if (action === "save-effect") {
    await saveTemporaryEffectAction(actionTarget);
  } else if (action === "delete-effect") {
    const effectId = appState.editingEffectId;
    if (!effectId) throw new Error("MVU_TEMPORARY_EFFECT_ID_MISSING");
    await withBusy(actionTarget, "delete-effect", async function () {
      await callNative("deleteTemporaryEffect", { id: effectId });
      await reloadSnapshot();
      appState.editingEffectId = "";
      appState.effectDraft = null;
      replaceScreen("effects");
      showToast("临时效果已删除");
    });
  } else if (action === "close-record") {
    window.history.back();
  } else {
    throw new Error("MVU_UI_ACTION_UNKNOWN:" + action);
  }
}

window.addEventListener("popstate", function () {
  try {
    const screen = new URLSearchParams(window.location.search).get("screen");
    const nextScreen = screen && SCREEN_IDS.has(screen) ? screen : "home";
    prepareScreenState(nextScreen);
    appState.screen = nextScreen;
    appState.drawer = false;
    appState.sheet = "";
    render({ preserveScroll: false });
  } catch (error) {
    console.error("MVU history navigation failed", error);
    showToast(error.userMessage || "页面导航失败，请查看运行日志");
  }
});

async function boot() {
  appRoot.innerHTML = '<section class="app-screen clean-page bridge-loading">' +
    '<div class="loading-orb">' + mi("favorite") +
    "</div><p>正在连接动态状态数据…</p></section>";
  try {
    applyBackgroundPreference();
    await reloadSnapshot();
    prepareScreenState(appState.screen);
    render();
  } catch (error) {
    console.error("MVU Web UI failed to initialize", error);
    appRoot.innerHTML = '<section class="app-screen clean-page bridge-error">' +
      '<div class="loading-orb error">' + mi("error") +
      "</div><h2>动态状态无法载入</h2><p>" +
      escapeHtml(error.message) + "</p></section>";
  }
}

void boot();
