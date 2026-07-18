from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from schemas import ErrorResponse, HealthResponse, ScoreRequest, ScoreResponse
from scorer import LocalDetectorScorer

SERVICE_NAME = "slop-frog-local-detector"
SERVICE_VERSION = "0.1.0"

app = FastAPI(title="Slop Frog Local Detector", version=SERVICE_VERSION)
scorer = LocalDetectorScorer()


@app.exception_handler(RequestValidationError)
async def request_validation_error_handler(
    _: Request, exception: RequestValidationError
) -> JSONResponse:
    """Return contract errors in a stable shape for the extension."""

    response = ErrorResponse(
        errorCode="invalid_request",
        message="Request does not match the ScoreRequest contract.",
        details=exception.errors(),
    )
    return JSONResponse(status_code=422, content=response.model_dump(mode="json"))


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Confirm that the localhost detector service is available."""

    return HealthResponse(
        service=SERVICE_NAME,
        version=SERVICE_VERSION,
        model_loaded=scorer.model_loaded,
    )


@app.post("/score", response_model=ScoreResponse | ErrorResponse)
def score(request: ScoreRequest) -> ScoreResponse | JSONResponse:
    """Return a gray result before model inference when evidence is too sparse."""

    result = scorer.score(request)
    if isinstance(result, ErrorResponse):
        return JSONResponse(status_code=503, content=result.model_dump(mode="json"))
    return result
