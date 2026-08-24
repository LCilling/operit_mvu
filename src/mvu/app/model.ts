/** MVU dynamic-state application model. Version 2 is a clean unpublished format. */
export interface DataActor {
  characterId: string;
  name: string;
  avatarUri?: string;
  enabled: boolean;
}

export type StateScope = "character" | "group" | "global" | "chat";

/** Every scope input is explicit. null means the host has no such identity. */
export interface StateScopeContext {
  chatId: string | null;
  actorId: string | null;
  groupId: string | null;
  actorName: string;
}

export interface DataStage {
  id: string;
  name: string;
  description: string;
  /** Inclusive lower bound; the first stage must equal its field minimum. */
  threshold: number;
}

export interface FieldAiConfig {
  enabled: boolean;
  minConfidence: number;
  maxDelta: number;
  prompt: string;
}

export interface NaturalChangeConfig {
  enabled: boolean;
  unitMs: number;
  amount: number;
}

export interface PerTurnChangeConfig {
  enabled: boolean;
  intervalTurns: number;
  amount: number;
  countMode: "user" | "character" | "both";
}

export interface DataField {
  id: string;
  name: string;
  description: string;
  minimum: number;
  maximum: number;
  step: number;
  initialValue: number;
  icon: string;
  themeColor: string;
  enabled: boolean;
  scope: StateScope;
  modelVisibility: "full" | "stage_only" | "hidden";
  ai: FieldAiConfig;
  stages: DataStage[];
  /** Stable IDs belonging to the selected scope. Global fields require no binding. */
  bindingIds: string[];
  naturalChange: NaturalChangeConfig;
  perTurnChange: PerTurnChangeConfig;
  order: number;
}

export interface DataLinkRule {
  id: string;
  sourceFieldId: string;
  operator: ">=" | ">" | "<=" | "<" | "==";
  sourceThreshold: number;
  targetFieldId: string;
  effect: { kind: "multiplier"; value: number } | { kind: "delta"; value: number };
  enabled: boolean;
}

export type AutoRuleCondition =
  | { kind: "recentPositive"; count: number }
  | { kind: "longInactive"; hours: number }
  | { kind: "userCare" }
  | { kind: "specialDay" }
  | { kind: "highFreq"; messages: number }
  | { kind: "stateThreshold"; fieldId: string; operator: ">=" | "<=" | ">" | "<"; threshold: number }
  | {
      kind: "aiJudgement";
      /** Human-readable category; presets and custom values share the same backend contract. */
      triggerType: string;
      /** Concrete facts the model must observe before the rule can match. */
      requirement: string;
      minimumConfidence: number;
    };

export interface AutoRuleEffect {
  fieldId: string;
  delta: number;
  /** Explicit temporary modifiers applied to this result after its rule matches. */
  temporaryEffectIds: string[];
}

export interface DataAutoRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  condition: AutoRuleCondition;
  effects: AutoRuleEffect[];
  cooldownMs: number;
  order: number;
}

export type TemporaryEffectReasonTemplate =
  | "general"
  | "positive"
  | "negative"
  | "environment"
  | "relationship";

export interface DataTemporaryEffectTarget {
  fieldId: string;
  scope: StateScope;
  scopeKey: string;
}

export interface DataTemporaryEffect {
  id: string;
  /** One effect can modify several fields, including fields with different scopes. */
  targets: DataTemporaryEffectTarget[];
  mode: "multiplier" | "additive";
  value: number;
  enabled: boolean;
  expiresAt: number | null;
  remainingTurns: number | null;
  reasonMode: "template" | "custom";
  reasonTemplate: TemporaryEffectReasonTemplate;
  /** Required only for custom reasons. Template reasons are resolved by the backend. */
  reason: string;
  createdAt: number;
}

/** One strict model judgement for an AI-driven automatic rule condition. */
export interface AiRuleJudgement {
  ruleId: string;
  matched: boolean;
  confidence: number;
  reason: string;
}

export interface DataChangeRecord {
  id: string;
  scope: StateScope;
  scopeKey: string;
  fieldId: string;
  fieldName: string;
  actorId: string | null;
  actorName: string;
  chatId: string | null;
  groupId: string | null;
  before: number;
  after: number;
  /** Delta requested before range clamping. */
  requestedDelta: number;
  /** Requested delta after active temporary effects, before range clamping. */
  effectiveRequestedDelta: number;
  /** Actual committed delta after clamping. */
  delta: number;
  stageBefore: string;
  stageAfter: string;
  reason: string;
  source: "manual" | "natural" | "per_turn" | "rule" | "ai";
  ruleIds: string[];
  effectIds: string[];
  confidence: number | null;
  messageId: string | null;
  variantId: string | null;
  occurredAt: number;
}

export interface TurnCounter {
  userMessages: number;
  characterMessages: number;
}

export interface MessageAutomationSignals {
  recentPositiveCount: number | null;
  userCareDetected: boolean | null;
  lastInteractionAt: number | null;
  messageCountInLast24Hours: number | null;
  specialDayDetected: boolean | null;
}

export interface MessageFact extends MessageAutomationSignals {
  messageId: string;
  variantId: string | null;
  /** Persisted message text, capped by the service before storage. */
  content: string;
  chatId: string | null;
  actorId: string | null;
  groupId: string | null;
  role: "user" | "character";
  occurredAt: number;
}

export interface MvuSettings {
  aiEnabled: boolean;
}

export interface MvuConfiguration {
  fields: DataField[];
  rules: DataLinkRule[];
  autoRules: DataAutoRule[];
  temporaryEffects: DataTemporaryEffect[];
  settings: MvuSettings;
}

export interface MvuDataset {
  formatVersion: 2;
  createdAt: number;
  revision: number;
  settings: MvuSettings;
  fields: DataField[];
  /**
   * Untouched production templates awaiting their one permitted host binding.
   * An ID is removed as soon as bootstrap succeeds or the user explicitly
   * configures that field's scope/bindings.
   */
  pendingBootstrapFieldIds: string[];
  rules: DataLinkRule[];
  autoRules: DataAutoRule[];
  temporaryEffects: DataTemporaryEffect[];
  /** Runtime values keyed by scopeKey -> fieldId. */
  stateValues: Record<string, Record<string, number>>;
  records: DataChangeRecord[];
  /** Natural-settlement anchors keyed by scopeKey -> fieldId. */
  lastSettled: Record<string, Record<string, number>>;
  /** Per-turn counters keyed by scopeKey -> fieldId. */
  turnCounters: Record<string, Record<string, TurnCounter>>;
  processedMessageIds: string[];
  /** Cooldown timestamps keyed by automation scopeKey -> ruleId. */
  ruleLastTriggered: Record<string, Record<string, number>>;
  /** Recent persisted facts keyed by automation scopeKey. */
  messageFacts: Record<string, MessageFact[]>;
}
