from fastapi import FastAPI

from schemas import HealthResponse
from scorer import LocalDetectorScorer

SERVICE_NAME = "slop-frog-local-detector"
SERVICE_VERSION = "0.1.0"

app = FastAPI(title="Slop Frog Local Detector", version=SERVICE_VERSION)
scorer = LocalDetectorScorer()


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Confirm that the localhost detector service is available."""

    return HealthResponse(
        service=SERVICE_NAME,
        version=SERVICE_VERSION,
        model_loaded=scorer.model_loaded,
    )
