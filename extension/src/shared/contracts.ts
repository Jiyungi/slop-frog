export type Platform = "x";

export type FlagLabel = "red" | "yellow" | "green" | "gray";

export type VoteValue = "looks_ai" | "looks_human" | "unsure";

export type AppealReason =
  | "human_written"
  | "ai_assisted_not_fully_ai"
  | "missing_context"
  | "other";

export type AppealStatus =
  | "none"
  | "submitted"
  | "under_review"
  | "accepted"
  | "rejected";

export type SlopControlKind = "evidence" | "feedback" | "appeal";

export type PanelKind = "evidence" | "feedback" | "appeal";

export type SlopIconName = "Flag" | "MessageSquareCheck" | "ShieldAlert";

export type ModalityStatus =
  | "available"
  | "unsupported"
  | "not_enough_signal"
  | "error";

export interface PostEnvelope {
  platform: Platform;
  contentKey: string;
  tweetId?: string;
  url?: string;
  authorHandle?: string;
  visibleText: string;
  normalizedText: string;
  textHash?: string;
  imageUrls?: string[];
  extractedAt: string;
}

export interface ExtensionSettings {
  evidenceCoverageMinimum: number;
  redThreshold: number;
  yellowThreshold: number;
  localDetectorUrl: string;
  showNumericScore: boolean;
  autoFilterRed: boolean;
}

export interface ScoreRequest {
  post: PostEnvelope;
  settings: Pick<
    ExtensionSettings,
    "evidenceCoverageMinimum" | "redThreshold" | "yellowThreshold"
  >;
}

export interface ModalityScore {
  status: ModalityStatus;
  score?: number;
  reason?: string;
}

export interface ScoreResponse {
  ok: boolean;
  detectorScore?: number;
  evidenceCoverage: number;
  labelRecommendation: FlagLabel;
  reasons: string[];
  modalityScores: {
    text?: ModalityScore;
    image?: ModalityScore;
    audio?: ModalityScore;
    video?: ModalityScore;
  };
  modelName: string;
  modelVersion: string;
  errorCode?: string;
}

export interface CommunityAggregate {
  contentKey: string;
  voteCount: number;
  weightedAiScore: number | null;
  looksAiWeight: number;
  looksHumanWeight: number;
  unsureWeight: number;
  appealStatus?: AppealStatus;
  latestVerdictLabel?: FlagLabel;
  updatedAt?: string;
}

export interface SlopScoreResult {
  contentKey: string;
  label: FlagLabel;
  slopScore: number | null;
  detectorScore: number | null;
  communityScore: number | null;
  evidenceCoverage: number;
  reasons: string[];
  autoFiltered: boolean;
}

export interface SlopControl {
  kind: SlopControlKind;
  icon: SlopIconName;
  tooltip: string;
  ariaLabel: string;
  visibleLabel?: string;
  opens: PanelKind;
}

export interface EvidencePanelModel {
  kind: "evidence";
  contentKey: string;
  result: SlopScoreResult;
  detector: Pick<
    ScoreResponse,
    "modelName" | "modelVersion" | "modalityScores" | "reasons"
  >;
  community?: CommunityAggregate;
  grayReason?: string;
  scoreHistory: VerdictHistoryPoint[];
  volumeHistory: VolumeScorePoint[];
}

export interface FeedbackPanelModel {
  kind: "feedback";
  contentKey: string;
  question: "what_do_you_think";
  options: VoteValue[];
  selectedVote?: VoteValue;
}

export interface AppealPanelModel {
  kind: "appeal";
  contentKey: string;
  question: "why_is_this_wrong";
  options: AppealReason[];
  selectedReason?: AppealReason;
}

export interface VerdictHistoryPoint {
  createdAt: string;
  slopScore: number | null;
  label: FlagLabel;
}

export interface VolumeScorePoint {
  volume: number;
  slopScore: number | null;
}

export interface CommunityVote {
  contentKey: string;
  platform: Platform;
  vote: VoteValue;
  reviewerId: string;
  reviewerWeight: number;
  createdAt: string;
}

export interface AppealRequest {
  contentKey: string;
  reviewerId: string;
  reason: AppealReason;
  note?: string;
  status: Exclude<AppealStatus, "none">;
  createdAt: string;
}

export const SLOP_CONTROLS: readonly SlopControl[] = [
  {
    kind: "evidence",
    icon: "Flag",
    tooltip: "View Slop Score evidence",
    ariaLabel: "View Slop Score evidence",
    visibleLabel: "Flag",
    opens: "evidence",
  },
  {
    kind: "feedback",
    icon: "MessageSquareCheck",
    tooltip: "Add feedback",
    ariaLabel: "Add community feedback",
    opens: "feedback",
  },
  {
    kind: "appeal",
    icon: "ShieldAlert",
    tooltip: "Appeal label",
    ariaLabel: "Appeal this label",
    opens: "appeal",
  },
] as const;

export const FEEDBACK_OPTIONS: readonly VoteValue[] = [
  "looks_ai",
  "looks_human",
  "unsure",
] as const;

export const APPEAL_REASON_OPTIONS: readonly AppealReason[] = [
  "human_written",
  "ai_assisted_not_fully_ai",
  "missing_context",
  "other",
] as const;
