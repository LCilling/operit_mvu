import type {
  DataChangeRecord,
  DataField,
  DataLinkRule,
  MessageFact,
  MvuSettings,
  TemporaryEffectReasonTemplate,
  TurnCounter,
} from "./model";

/** Sources that can produce a field change and be filtered by an effect operation. */
export type ChangeSource = "manual" | "natural" | "per_turn" | "rule" | "ai";

export type RuleActorSelector =
  | { kind: "any" }
  | { kind: "current_actor" }
  | { kind: "selected"; actorIds: string[] }
  | { kind: "group"; groupIds: string[] };

export type RuleTargetSelector =
  | { kind: "trigger_actor" }
  | { kind: "all_bound" }
  | { kind: "selected"; actorIds: string[] };

export type RuleActionV3 =
  | { kind: "change_field"; fieldId: string; target: RuleTargetSelector; delta: number; effectGroupIds: string[] }
  | { kind: "activate_effect_group"; effectGroupId: string };

export interface RuleDefinitionV3 {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  triggerActorSelector: RuleActorSelector;
  conditionId: string;
  actions: RuleActionV3[];
  cooldownHours: number;
  executionOrder: number;
  createdAt: string;
  updatedAt: string;
}

export type EffectActorSelector =
  | { kind: "all_bound" }
  | { kind: "trigger_actor" }
  | { kind: "selected"; actorIds: string[] };

export type EffectOperation =
  | { kind: "immediate_delta"; value: number }
  | { kind: "fixed_adjustment"; value: number; sources: ChangeSource[] }
  | { kind: "positive_multiplier"; value: number; sources: ChangeSource[] }
  | { kind: "negative_multiplier"; value: number; sources: ChangeSource[] }
  | { kind: "all_multiplier"; value: number; sources: ChangeSource[] };

export interface FieldEffectDefinition {
  id: string;
  fieldId: string;
  actorSelector: EffectActorSelector;
  operations: EffectOperation[];
}

/** An absolute active-effect lifetime. Definitions omit this when no reusable default exists. */
export interface EffectDuration {
  expiresAt: string | null;
  remainingTurns: number | null;
}

/** Maximum source text accepted by new v3 editor/API requests. */
export const EFFECT_REASON_SOURCE_MAX_LENGTH = 512;
/** Compatibility ceiling for reason source retained from legacy persisted documents. */
export const EFFECT_REASON_LEGACY_STORAGE_MAX_LENGTH = 16_384;
/** Maximum size of any one value substituted into a reason template. */
export const EFFECT_REASON_VARIABLE_MAX_LENGTH = 256;
/** Shared persistence ceiling for resolved active snapshots and change-record reasons. */
export const EFFECT_REASON_RENDERED_MAX_LENGTH = 2_048;
/** @deprecated Use EFFECT_REASON_SOURCE_MAX_LENGTH for new editor/API input. */
export const EFFECT_REASON_TEXT_MAX_LENGTH = EFFECT_REASON_SOURCE_MAX_LENGTH;

/** Deterministic UTF-16 truncation that never leaves a dangling high surrogate. */
export function truncateEffectReasonText(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  const truncated = value.slice(0, maximum);
  return /[\uD800-\uDBFF]$/.test(truncated) ? truncated.slice(0, -1) : truncated;
}

/** Reusable reason source. Template text is retained for lossless v2 compatibility but ignored when rendered. */
export interface EffectReasonConfig {
  mode: "template" | "custom";
  template: TemporaryEffectReasonTemplate;
  text: string;
}

export interface EffectGroupDefinition {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  fieldEffects: FieldEffectDefinition[];
  defaultReason: EffectReasonConfig;
  defaultDuration?: EffectDuration;
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedEffectTarget {
  fieldId: string;
  actorId: string | null;
  scope: DataField["scope"];
  scopeKey: string;
}

export interface EffectReasonSnapshot extends EffectReasonConfig {}

export interface ActiveEffectDefinitionSnapshot {
  name: string;
  description: string;
  updatedAt: string;
  fieldEffects: FieldEffectDefinition[];
}

export interface ActiveEffectInstance {
  id: string;
  definitionId: string;
  triggerActorId?: string;
  resolvedTargets: ResolvedEffectTarget[];
  duration: EffectDuration;
  activatedAt: string;
  reason: EffectReasonSnapshot;
  /** Missing only on legacy v3 files; the store hydrates it before use. */
  definitionSnapshot?: ActiveEffectDefinitionSnapshot;
}

export type ConditionSender = MessageFact["role"];

export interface AiSemanticPredicate {
  /** Stable canonical key used to associate an AI result with exactly one predicate. */
  id: string;
  triggerType: string;
  requirement: string;
  minimumConfidence: number;
}

/** The condition vocabulary retains every v2 condition while allowing reusable compositions. */
export type ConditionPredicate =
  | { kind: "recent_positive"; count: number }
  | { kind: "long_inactive"; hours: number }
  | { kind: "user_care" }
  | { kind: "special_day" }
  | { kind: "high_frequency"; messages: number; windowHours?: number; bucketHours?: number }
  | { kind: "field_comparison"; fieldId: string; operator: ">=" | "<=" | ">" | "<" | "=="; value: number }
  | { kind: "message_count"; count: number; windowHours: number; sender?: ConditionSender }
  | { kind: "keywords"; includeAny: string[]; includeAll: string[]; exclude: string[]; windowHours?: number; caseSensitive?: boolean }
  | { kind: "sender"; senders: ConditionSender[] }
  | { kind: "actor"; actorIds: string[] }
  | { kind: "group"; groupIds: string[] }
  | { kind: "concrete_date"; dates: string[] }
  | { kind: "repeating_date"; month: number; day: number }
  | ({ kind: "ai_semantic" } & AiSemanticPredicate);

export type ConditionExpression =
  | { kind: "and"; children: ConditionExpression[] }
  | { kind: "or"; children: ConditionExpression[] }
  | { kind: "not"; child: ConditionExpression }
  | { kind: "predicate"; predicate: ConditionPredicate };

export interface ConditionDefinition {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  expression: ConditionExpression;
  createdAt: string;
  updatedAt: string;
}

/** Durable per-hour counters retained independently from capped message facts. */
export interface HourlyMessageBucket {
  startedAt: number;
  messageCount: number;
}

/** Metadata is the visibility boundary for one append-only JSONL segment. */
export interface RecordSegmentMetadata {
  index: number;
  fileName: string;
  committedLineCount: number;
  firstOccurredAt: number;
  lastOccurredAt: number;
  firstRevision: number;
  lastRevision: number;
  /** Exact per field/scope counts used to page one field without scanning all history. */
  filterCounts?: Record<string, number>;
}

/** Only lines named by this committed manifest are visible to readers. */
export interface RecordManifest {
  segments: RecordSegmentMetadata[];
  recordCount: number;
  nextSegmentIndex: number;
}

/**
 * The pure migration representation. Runtime/storage integration is intentionally
 * deferred; copied v2 runtime facts stay available until the v3 store owns them.
 */
export interface MvuDatasetV3 {
  formatVersion: 3;
  createdAt: string;
  revision: number;
  settings: MvuSettings;
  fields: DataField[];
  pendingBootstrapFieldIds: string[];
  linkRules: DataLinkRule[];
  conditions: ConditionDefinition[];
  rules: RuleDefinitionV3[];
  effectGroups: EffectGroupDefinition[];
  activeEffects: ActiveEffectInstance[];
  stateValues: Record<string, Record<string, number>>;
  recordManifest: RecordManifest;
  lastSettled: Record<string, Record<string, number>>;
  turnCounters: Record<string, Record<string, TurnCounter>>;
  processedMessageIds: string[];
  ruleLastTriggered: Record<string, Record<string, number>>;
  messageFacts: Record<string, MessageFact[]>;
  hourlyMessageBuckets: Record<string, HourlyMessageBucket[]>;
}

export interface MigrationResult {
  dataset: MvuDatasetV3;
  /** Record bodies are staged separately and become visible with the config commit. */
  records: DataChangeRecord[];
  report: {
    migratedFields: number;
    migratedRules: number;
    migratedConditions: number;
    migratedEffectGroups: number;
    warnings: string[];
  };
}
