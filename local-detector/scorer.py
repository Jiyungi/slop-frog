from dataclasses import dataclass


@dataclass(frozen=True)
class LocalDetectorScorer:
    """Owns model lifecycle metadata while inference is added incrementally."""

    model_name: str = "slop-frog-local-detector"
    model_version: str = "0.1.0"
    model_loaded: bool = False
