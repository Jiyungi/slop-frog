from dataclasses import dataclass
import re

from schemas import (
    ErrorResponse,
    ModalityScore,
    ModalityScores,
    ScoreRequest,
    ScoreResponse,
)

WORDS_FOR_FULL_TEXT_COVERAGE = 20


@dataclass(frozen=True)
class EvidenceCoverage:
    score: float
    word_count: int


def calculate_evidence_coverage(text: str) -> EvidenceCoverage:
    """Map usable text length to the shared 0-100 evidence-coverage scale."""

    word_count = len(re.findall(r"\b\w+\b", text))
    score = min(100.0, (word_count / WORDS_FOR_FULL_TEXT_COVERAGE) * 100.0)
    return EvidenceCoverage(score=score, word_count=word_count)


@dataclass(frozen=True)
class LocalDetectorScorer:
    """Owns model lifecycle metadata while inference is added incrementally."""

    model_name: str = "slop-frog-local-detector"
    model_version: str = "0.1.0"
    model_loaded: bool = False

    def score(self, request: ScoreRequest) -> ScoreResponse | ErrorResponse:
        """Return gray before invoking a model when evidence is insufficient."""

        coverage = calculate_evidence_coverage(request.post.normalizedText)
        if coverage.score < request.settings.evidenceCoverageMinimum:
            return ScoreResponse(
                ok=True,
                detectorScore=None,
                evidenceCoverage=coverage.score,
                labelRecommendation="gray",
                reasons=[
                    "not_enough_signal",
                    "Not enough usable text is available to score this post.",
                ],
                modalityScores=ModalityScores(
                    text=ModalityScore(
                        status="not_enough_signal", reason="not_enough_signal"
                    ),
                    image=ModalityScore(status="unsupported"),
                    audio=ModalityScore(status="unsupported"),
                    video=ModalityScore(status="unsupported"),
                ),
                modelName=self.model_name,
                modelVersion=self.model_version,
            )

        return ErrorResponse(
            errorCode="model_unavailable",
            message="The local detector model has not been initialized yet.",
        )
