from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ContractModel(BaseModel):
    """Base for request/response models that must stay aligned with TypeScript."""

    model_config = ConfigDict(extra="forbid")


FlagLabel = Literal["red", "yellow", "green", "gray"]
ModalityStatus = Literal["available", "unsupported", "not_enough_signal", "error"]


class PostEnvelope(ContractModel):
    platform: Literal["x"]
    contentKey: str = Field(min_length=1)
    tweetId: str | None = None
    url: str | None = None
    authorHandle: str | None = None
    visibleText: str
    normalizedText: str
    textHash: str | None = None
    imageUrls: list[str] | None = None
    extractedAt: datetime


class ScoreSettings(ContractModel):
    evidenceCoverageMinimum: float = Field(ge=0, le=100)
    redThreshold: float = Field(ge=0, le=100)
    yellowThreshold: float = Field(ge=0, le=100)


class ScoreRequest(ContractModel):
    post: PostEnvelope
    settings: ScoreSettings


class ModalityScore(ContractModel):
    status: ModalityStatus
    score: float | None = Field(default=None, ge=0, le=100)
    reason: str | None = None


class ModalityScores(ContractModel):
    text: ModalityScore | None = None
    image: ModalityScore | None = None
    audio: ModalityScore | None = None
    video: ModalityScore | None = None


class ScoreResponse(ContractModel):
    ok: bool
    detectorScore: float | None = Field(default=None, ge=0, le=100)
    evidenceCoverage: float = Field(ge=0, le=100)
    labelRecommendation: FlagLabel
    reasons: list[str]
    modalityScores: ModalityScores
    modelName: str
    modelVersion: str
    errorCode: str | None = None


class ErrorResponse(ContractModel):
    ok: Literal[False] = False
    errorCode: str
    message: str
    details: list[dict[str, object]] | None = None


class HealthResponse(ContractModel):
    """The local service health payload used by the extension popup."""

    status: Literal["ok"] = "ok"
    service: str
    version: str
    model_loaded: bool
