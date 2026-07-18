from dataclasses import dataclass, field
from pathlib import Path
import re

from schemas import (
    ErrorResponse,
    ModalityScore,
    ModalityScores,
    ScoreRequest,
    ScoreResponse,
)

WORDS_FOR_FULL_TEXT_COVERAGE = 20
MODEL_MAX_LENGTH = 1024
MODEL_REVISION = "1122ecd1b1b19ee0b147e862f204acdc1ad98dc3"


@dataclass(frozen=True)
class EvidenceCoverage:
    score: float
    word_count: int


def calculate_evidence_coverage(text: str) -> EvidenceCoverage:
    """Map usable text length to the shared 0-100 evidence-coverage scale."""

    word_count = len(re.findall(r"\b\w+\b", text))
    score = min(100.0, (word_count / WORDS_FOR_FULL_TEXT_COVERAGE) * 100.0)
    return EvidenceCoverage(score=score, word_count=word_count)


class QwenMpsRuntime:
    """Run Imbue's Qwen3 detector locally through Apple Silicon MPS."""

    def __init__(self, base_model_path: Path, adapter_path: Path) -> None:
        self.base_model_path = base_model_path
        self.adapter_path = adapter_path
        self._torch = None
        self._tokenizer = None
        self._model = None

    @classmethod
    def from_local_assets(cls) -> "QwenMpsRuntime":
        assets_path = Path(__file__).resolve().parent / "models" / "imbue"
        return cls(
            base_model_path=assets_path / "qwen_3_4b_base",
            adapter_path=assets_path / "qwen_3_4b",
        )

    def load(self) -> None:
        """Load only the already-downloaded artifacts; never fetch from the network."""

        if not self.base_model_path.is_dir() or not self.adapter_path.is_dir():
            raise RuntimeError("The pinned Imbue Qwen model assets are not installed.")

        import torch
        from peft import PeftModel
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        if not torch.backends.mps.is_available():
            raise RuntimeError("Apple Metal Performance Shaders (MPS) is unavailable.")

        # This head exactly matches the adapter's score.norm.* and
        # score.linear.* weights. Keeping it in bfloat16 avoids the NaN output
        # seen with a float16 Qwen backbone on MPS.
        class NormedLinear(torch.nn.Module):
            def __init__(self, hidden_size: int, num_labels: int) -> None:
                super().__init__()
                self.norm = torch.nn.LayerNorm(hidden_size, dtype=torch.bfloat16)
                self.linear = torch.nn.Linear(
                    hidden_size, num_labels, bias=False, dtype=torch.bfloat16
                )

            def forward(self, hidden):  # type: ignore[no-untyped-def]
                return self.linear(self.norm(hidden))

        tokenizer = AutoTokenizer.from_pretrained(
            self.base_model_path, local_files_only=True
        )
        base = AutoModelForSequenceClassification.from_pretrained(
            self.base_model_path,
            num_labels=4,
            dtype=torch.bfloat16,
            local_files_only=True,
        )
        base.config.pad_token_id = tokenizer.pad_token_id
        base.score = NormedLinear(base.config.hidden_size, 4)

        self._model = PeftModel.from_pretrained(
            base, self.adapter_path, local_files_only=True
        ).to("mps").eval()
        self._torch = torch
        self._tokenizer = tokenizer

    def score(self, text: str) -> float:
        """Return Imbue's expected four-bucket AI-evidence score on a 0-100 scale."""

        if self._torch is None or self._tokenizer is None or self._model is None:
            raise RuntimeError("The Qwen MPS runtime has not been loaded.")

        encoded = self._tokenizer(
            text,
            return_tensors="pt",
            truncation=True,
            max_length=MODEL_MAX_LENGTH,
        )
        inputs = {name: value.to("mps") for name, value in encoded.items()}
        with self._torch.inference_mode():
            logits = self._model(**inputs).logits.float()
            self._torch.mps.synchronize()

        if not bool(self._torch.isfinite(logits).all()):
            raise RuntimeError("The Qwen MPS runtime returned non-finite logits.")

        probabilities = self._torch.softmax(logits, dim=-1)
        buckets = self._torch.arange(
            logits.shape[-1], device=logits.device, dtype=probabilities.dtype
        )
        score = (probabilities * buckets).sum(dim=-1).item()
        return float((score / (logits.shape[-1] - 1)) * 100)


@dataclass
class LocalDetectorScorer:
    """Owns the local Imbue detector lifecycle and shared response mapping."""

    model_name: str = "imbue-qwen3-4b-ai-text-detector"
    model_version: str = MODEL_REVISION
    model_loaded: bool = field(default=False, init=False)
    _runtime: QwenMpsRuntime | None = field(default=None, init=False, repr=False)
    _load_error: str | None = field(default=None, init=False, repr=False)

    def load_model(self) -> bool:
        """Load the exact pinned Qwen adapter and base model into MPS memory."""

        try:
            runtime = QwenMpsRuntime.from_local_assets()
            runtime.load()
        except Exception as exception:  # surfaced as a typed /score response
            self._runtime = None
            self._load_error = str(exception)
            self.model_loaded = False
            return False

        self._runtime = runtime
        self._load_error = None
        self.model_loaded = True
        return True

    @staticmethod
    def label_for_score(score: float, red_threshold: float, yellow_threshold: float) -> str:
        if score > red_threshold:
            return "red"
        if score >= yellow_threshold:
            return "yellow"
        return "green"

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

        if self._runtime is None:
            message = "The local detector model has not been initialized yet."
            if self._load_error:
                message = f"The local detector model is unavailable: {self._load_error}"
            return ErrorResponse(errorCode="model_unavailable", message=message)

        detector_score = self._runtime.score(request.post.normalizedText)
        return ScoreResponse(
            ok=True,
            detectorScore=detector_score,
            evidenceCoverage=coverage.score,
            labelRecommendation=self.label_for_score(
                detector_score,
                request.settings.redThreshold,
                request.settings.yellowThreshold,
            ),
            reasons=["local_qwen_detector"],
            modalityScores=ModalityScores(
                text=ModalityScore(status="available", score=detector_score),
                image=ModalityScore(status="unsupported"),
                audio=ModalityScore(status="unsupported"),
                video=ModalityScore(status="unsupported"),
            ),
            modelName=self.model_name,
            modelVersion=self.model_version,
        )
