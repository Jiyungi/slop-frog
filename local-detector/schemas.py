from typing import Literal

from pydantic import BaseModel


class HealthResponse(BaseModel):
    """The local service health payload used by the extension popup."""

    status: Literal["ok"] = "ok"
    service: str
    version: str
    model_loaded: bool
