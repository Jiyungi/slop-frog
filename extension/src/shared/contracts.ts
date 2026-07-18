export type Platform = "x";

export type FlagLabel = "red" | "yellow" | "green" | "gray";

export type VoteValue = "looks_ai" | "looks_human" | "unsure";

export type AppealStatus =
  | "none"
  | "submitted"
  | "under_review"
  | "accepted"
  | "rejected";

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
  reason: string;
  status: Exclude<AppealStatus, "none">;
  createdAt: string;
}
