import os
import re
from threading import Lock

import modal

APP_NAME = "slop-frog-imbue-detector"
CACHE_DIR = "/cache"
BASE_MODEL_ID = "Qwen/Qwen3-4B"
BASE_MODEL_REVISION = "1cfa9a7208912126459214e8b04321603b3df60c"
ADAPTER_MODEL_ID = "DarrenJiaImbue/ai-detection-demo-qwen_3_4b"
ADAPTER_MODEL_REVISION = "1122ecd1b1b19ee0b147e862f204acdc1ad98dc3"
MODEL_MAX_LENGTH = 1024
WORDS_FOR_FULL_TEXT_COVERAGE = 20
WARMUP_TEXT = (
    "This Modal warmup sentence initializes the Imbue detector before the "
    "extension sends real feed posts."
)

image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "fastapi>=0.115,<1.0",
        "pydantic>=2.8,<3.0",
        "torch>=2.5,<3.0",
        "transformers>=4.56,<5.0",
        "peft>=0.13,<1.0",
        "accelerate>=0.34,<2.0",
        "safetensors>=0.4,<1.0",
        "huggingface-hub>=0.25,<1.0",
    )
    .env(
        {
            "HF_HOME": CACHE_DIR,
            "HF_HUB_CACHE": f"{CACHE_DIR}/hub",
            "TRANSFORMERS_CACHE": f"{CACHE_DIR}/hub",
        }
    )
)

hf_cache = modal.Volume.from_name("slop-frog-hf-cache", create_if_missing=True)
app = modal.App(APP_NAME)


class ModalQwenDetector:
    def __init__(self) -> None:
        self._lock = Lock()
        self._loaded = False
        self._load_error = None
        self._torch = None
        self._tokenizer = None
        self._model = None

    def ensure_loaded(self) -> bool:
        if self._loaded:
            return True

        with self._lock:
            if self._loaded:
                return True
            try:
                self._load()
                self.score_text(WARMUP_TEXT)
            except Exception as exception:
                self._load_error = str(exception)
                self._loaded = False
                return False

            self._load_error = None
            self._loaded = True
            return True

    def _load(self) -> None:
        import torch
        from peft import PeftModel
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        if not torch.cuda.is_available():
            raise RuntimeError("CUDA is unavailable in this Modal container.")

        class NormedLinear(torch.nn.Module):
            def __init__(self, hidden_size: int, num_labels: int) -> None:
                super().__init__()
                self.norm = torch.nn.LayerNorm(hidden_size, dtype=torch.bfloat16)
                self.linear = torch.nn.Linear(
                    hidden_size, num_labels, bias=False, dtype=torch.bfloat16
                )

            def forward(self, hidden):
                return self.linear(self.norm(hidden))

        tokenizer = AutoTokenizer.from_pretrained(
            BASE_MODEL_ID,
            revision=BASE_MODEL_REVISION,
            cache_dir=CACHE_DIR,
        )
        base = AutoModelForSequenceClassification.from_pretrained(
            BASE_MODEL_ID,
            revision=BASE_MODEL_REVISION,
            num_labels=4,
            torch_dtype=torch.bfloat16,
            cache_dir=CACHE_DIR,
        )
        base.config.pad_token_id = tokenizer.pad_token_id
        base.score = NormedLinear(base.config.hidden_size, 4)

        model = PeftModel.from_pretrained(
            base,
            ADAPTER_MODEL_ID,
            revision=ADAPTER_MODEL_REVISION,
            cache_dir=CACHE_DIR,
        )
        self._model = model.to("cuda").eval()
        self._tokenizer = tokenizer
        self._torch = torch

    @property
    def model_loaded(self) -> bool:
        return self._loaded

    @property
    def load_error(self) -> str | None:
        return self._load_error

    def score_text(self, text: str) -> float:
        if self._torch is None or self._tokenizer is None or self._model is None:
            raise RuntimeError("Detector has not been loaded.")

        encoded = self._tokenizer(
            text,
            return_tensors="pt",
            truncation=True,
            max_length=MODEL_MAX_LENGTH,
        )
        inputs = {name: value.to("cuda") for name, value in encoded.items()}
        with self._torch.inference_mode():
            logits = self._model(**inputs).logits.float()

        if not bool(self._torch.isfinite(logits).all()):
            raise RuntimeError("Detector returned non-finite logits.")

        probabilities = self._torch.softmax(logits, dim=-1)
        buckets = self._torch.arange(
            logits.shape[-1], device=logits.device, dtype=probabilities.dtype
        )
        expected_bucket = (probabilities * buckets).sum(dim=-1).item()
        return float((expected_bucket / (logits.shape[-1] - 1)) * 100)


detector = ModalQwenDetector()


@app.function(
    image=image,
    gpu=os.environ.get("SLOP_FROG_MODAL_GPU", "L4"),
    volumes={CACHE_DIR: hf_cache},
    timeout=150,
    scaledown_window=600,
)
@modal.asgi_app()
def api():
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware

    web_app = FastAPI(title="Slop Frog Modal Imbue Detector", version="0.1.0")
    web_app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )

    @web_app.get("/health")
    def health():
        ready = detector.ensure_loaded()
        return {
            "status": "ok" if ready else "error",
            "service": "slop-frog-modal-imbue-detector",
            "version": "0.1.0",
            "model_loaded": ready,
            "modelName": "imbue-qwen3-4b-ai-text-detector",
            "modelVersion": ADAPTER_MODEL_REVISION,
            "detail": detector.load_error,
        }

    @web_app.post("/score")
    def score(request: dict):
        post = request.get("post") or {}
        settings = request.get("settings") or {}
        normalized_text = str(post.get("normalizedText") or post.get("visibleText") or "")
        coverage = calculate_evidence_coverage(normalized_text)

        if coverage < float(settings.get("evidenceCoverageMinimum", 50)):
            return gray_response("not_enough_signal", coverage)

        if not detector.ensure_loaded():
            return gray_response("model_unavailable", coverage, detector.load_error)

        try:
            detector_score = detector.score_text(normalized_text)
        except Exception as exception:
            return gray_response("internal_failure", coverage, str(exception))

        return {
            "ok": True,
            "detectorScore": detector_score,
            "evidenceCoverage": coverage,
            "labelRecommendation": label_for_score(
                detector_score,
                float(settings.get("redThreshold", 75)),
                float(settings.get("yellowThreshold", 40)),
            ),
            "reasons": ["modal_imbue_qwen_detector"],
            "modalityScores": {
                "text": {"status": "available", "score": detector_score},
                "image": {"status": "unsupported", "reason": "mvp_text_first"},
                "audio": {"status": "unsupported", "reason": "mvp_text_first"},
                "video": {"status": "unsupported", "reason": "mvp_text_first"},
            },
            "modelName": "imbue-qwen3-4b-ai-text-detector",
            "modelVersion": ADAPTER_MODEL_REVISION,
        }

    return web_app


def calculate_evidence_coverage(text: str) -> float:
    word_count = len(re.findall(r"\b\w+\b", text))
    return min(100.0, (word_count / WORDS_FOR_FULL_TEXT_COVERAGE) * 100.0)


def label_for_score(score: float, red_threshold: float, yellow_threshold: float) -> str:
    if score > red_threshold:
        return "red"
    if score >= yellow_threshold:
        return "yellow"
    return "green"


def gray_response(reason: str, coverage: float, detail: str | None = None) -> dict:
    reasons = [reason]
    if detail:
        reasons.append(detail[:220])
    return {
        "ok": True,
        "detectorScore": None,
        "evidenceCoverage": coverage,
        "labelRecommendation": "gray",
        "reasons": reasons,
        "modalityScores": {
            "text": {"status": "error", "reason": reason},
            "image": {"status": "unsupported", "reason": "mvp_text_first"},
            "audio": {"status": "unsupported", "reason": "mvp_text_first"},
            "video": {"status": "unsupported", "reason": "mvp_text_first"},
        },
        "modelName": "imbue-qwen3-4b-ai-text-detector",
        "modelVersion": ADAPTER_MODEL_REVISION,
        "errorCode": reason,
    }
