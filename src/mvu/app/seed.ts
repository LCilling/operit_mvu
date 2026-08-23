/** Production configuration templates. Runtime identities and state are bootstrapped explicitly. */
import { klona } from "../port/util";
import type {
  DataActor,
  DataAutoRule,
  DataField,
  DataLinkRule,
  DataStage,
  MvuDataset,
} from "./model";

/** No demo identity may enter production state. */
export const DEFAULT_ACTORS: DataActor[] = [];

function stages(names: readonly string[], minimum: number, maximum: number): DataStage[] {
  const width = (maximum - minimum) / names.length;
  return names.map((name, index) => ({
    id: `stage_${index}`,
    name,
    description: `${name}阶段`,
    threshold: index === 0 ? minimum : Math.round((minimum + index * width) * 100) / 100,
  }));
}

function field(options: {
  id: string;
  name: string;
  description: string;
  minimum?: number;
  maximum?: number;
  initialValue: number;
  icon: string;
  themeColor: string;
  enabled: boolean;
  stageNames: readonly string[];
  naturalAmount?: number;
  perTurnAmount?: number;
  order: number;
}): DataField {
  const minimum = options.minimum ?? 0;
  const maximum = options.maximum ?? 100;
  return {
    id: options.id,
    name: options.name,
    description: options.description,
    minimum,
    maximum,
    step: 1,
    initialValue: options.initialValue,
    icon: options.icon,
    themeColor: options.themeColor,
    enabled: options.enabled,
    scope: "character",
    modelVisibility: "full",
    ai: {
      enabled: false,
      minConfidence: 0.7,
      maxDelta: 10,
      prompt: "",
    },
    stages: stages(options.stageNames, minimum, maximum),
    bindingIds: [],
    naturalChange: {
      enabled: options.naturalAmount !== undefined,
      unitMs: 3_600_000,
      amount: options.naturalAmount ?? 0,
    },
    perTurnChange: {
      enabled: false,
      intervalTurns: 3,
      amount: options.perTurnAmount ?? 0,
      countMode: "both",
    },
    order: options.order,
  };
}

export const DEFAULT_FIELDS: DataField[] = [
  {
    ...field({
      id: "field_affinity",
      name: "亲密度",
      description: "与角色的情感关系状态，影响语气、行为和情感表现。",
      initialValue: 30,
      icon: "Favorite",
      themeColor: "#ff4f87",
      enabled: true,
      stageNames: ["陌生", "熟悉", "亲密", "依赖"],
      naturalAmount: 0.5,
      perTurnAmount: 2,
      order: 1,
    }),
    stages: [
      { id: "stage_0", name: "陌生", description: "关系尚未建立。", threshold: 0 },
      { id: "stage_1", name: "熟悉", description: "开始形成稳定的熟悉感。", threshold: 20 },
      { id: "stage_2", name: "亲密", description: "愿意主动表达亲近与关心。", threshold: 50 },
      { id: "stage_3", name: "依赖", description: "形成深度信任与情感依赖。", threshold: 80 },
    ],
  },
  field({
    id: "field_excite", name: "兴奋度", description: "当前即时情绪兴奋水平。",
    initialValue: 20, icon: "Bolt", themeColor: "#ff8a2a", enabled: true,
    stageNames: ["低落", "平稳", "高涨", "兴奋", "亢奋"], perTurnAmount: 3, order: 2,
  }),
  field({
    id: "field_fatigue", name: "疲劳", description: "当前精神与身体疲劳程度。",
    initialValue: 10, icon: "Bedtime", themeColor: "#5b8ff9", enabled: true,
    stageNames: ["轻松", "轻度", "中度", "重度", "耗竭"], naturalAmount: 1,
    perTurnAmount: -1, order: 3,
  }),
  field({
    id: "field_pressure", name: "压力", description: "心理压力与焦虑程度。",
    initialValue: 20, icon: "LocalFireDepartment", themeColor: "#e45c63", enabled: true,
    stageNames: ["放松", "轻压", "紧张", "高压"], naturalAmount: -0.5,
    perTurnAmount: 1, order: 4,
  }),
  field({
    id: "field_emotion", name: "情绪", description: "当前情绪倾向。", minimum: -100,
    maximum: 100, initialValue: 0, icon: "Mood", themeColor: "#8a63e8", enabled: true,
    stageNames: ["低落", "平静", "愉悦", "高涨", "兴奋", "亢奋"], naturalAmount: 0.25,
    perTurnAmount: 1, order: 5,
  }),
  field({
    id: "field_desire", name: "欲望", description: "对用户的欲望强度。",
    initialValue: 10, icon: "EcgHeart", themeColor: "#ef5da8", enabled: true,
    stageNames: ["克制", "萌动", "明显", "强烈", "炽热"], perTurnAmount: 1, order: 6,
  }),
  field({
    id: "field_trust", name: "信任度", description: "角色愿意分享内心想法的信任程度。",
    initialValue: 50, icon: "AutoAwesome", themeColor: "#7d5cf3", enabled: false,
    stageNames: ["戒备", "观察", "信任", "依赖"], perTurnAmount: 1, order: 7,
  }),
  field({
    id: "field_jealous", name: "嫉妒", description: "对关系竞争的不安。",
    initialValue: 0, icon: "MoodBad", themeColor: "#5f78d6", enabled: false,
    stageNames: ["平静", "在意", "嫉妒", "强烈"], perTurnAmount: 1, order: 8,
  }),
  field({
    id: "field_security", name: "安全感", description: "对当前环境与关系的安全感。",
    initialValue: 50, icon: "Shield", themeColor: "#3a9d89", enabled: false,
    stageNames: ["不安", "一般", "安心", "笃定"], perTurnAmount: 1, order: 9,
  }),
  field({
    id: "field_anger", name: "愤怒", description: "事件驱动的短期情绪反应。",
    initialValue: 0, icon: "Whatshot", themeColor: "#d94d4d", enabled: false,
    stageNames: ["平静", "不满", "愤怒", "暴怒"], perTurnAmount: 2, order: 10,
  }),
];

export const DEFAULT_RULES: DataLinkRule[] = [
  {
    id: "rule_excite_to_affinity",
    sourceFieldId: "field_excite",
    operator: ">=",
    sourceThreshold: 70,
    targetFieldId: "field_affinity",
    effect: { kind: "multiplier", value: 1.25 },
    enabled: true,
  },
  {
    id: "rule_fatigue_to_affinity",
    sourceFieldId: "field_fatigue",
    operator: ">=",
    sourceThreshold: 60,
    targetFieldId: "field_affinity",
    effect: { kind: "delta", value: -2 },
    enabled: true,
  },
];

export const DEFAULT_AUTO_RULES: DataAutoRule[] = [
  {
    id: "auto_positive", name: "连续积极互动", description: "最近对话持续积极互动。",
    enabled: true, condition: { kind: "recentPositive", count: 6 },
    effects: [{ fieldId: "field_affinity", delta: 4 }], cooldownMs: 6 * 3_600_000, order: 1,
  },
  {
    id: "auto_inactive", name: "长时间未交流", description: "超过一天没有交流。",
    enabled: true, condition: { kind: "longInactive", hours: 24 },
    effects: [{ fieldId: "field_affinity", delta: -2 }], cooldownMs: 24 * 3_600_000, order: 2,
  },
  {
    id: "auto_care", name: "主动关心", description: "用户主动关心角色。",
    enabled: true, condition: { kind: "userCare" },
    effects: [{ fieldId: "field_affinity", delta: 3 }], cooldownMs: 0, order: 3,
  },
  {
    id: "auto_special", name: "特别的日子", description: "角色的重要纪念日。",
    enabled: true, condition: { kind: "specialDay" },
    effects: [{ fieldId: "field_affinity", delta: 10 }], cooldownMs: 0, order: 4,
  },
  {
    id: "auto_high_frequency", name: "高频互动", description: "一天内产生大量消息。",
    enabled: true, condition: { kind: "highFreq", messages: 20 },
    effects: [{ fieldId: "field_excite", delta: 5 }], cooldownMs: 24 * 3_600_000, order: 5,
  },
];

export function buildSeedDataset(createdAt: number = Date.now()): MvuDataset {
  return {
    formatVersion: 2,
    createdAt,
    revision: 0,
    settings: { aiEnabled: true },
    fields: klona(DEFAULT_FIELDS),
    pendingBootstrapFieldIds: DEFAULT_FIELDS
      .filter((fieldDefinition) =>
        fieldDefinition.scope !== "global" && fieldDefinition.bindingIds.length === 0
      )
      .map((fieldDefinition) => fieldDefinition.id),
    rules: klona(DEFAULT_RULES),
    autoRules: klona(DEFAULT_AUTO_RULES),
    temporaryEffects: [],
    stateValues: {},
    records: [],
    lastSettled: {},
    turnCounters: {},
    processedMessageIds: [],
    ruleLastTriggered: {},
    messageFacts: {},
  };
}
