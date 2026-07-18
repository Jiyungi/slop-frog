import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from pydantic import ValidationError
from fastapi.testclient import TestClient

DETECTOR_DIR = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = DETECTOR_DIR.parent
sys.path.insert(0, str(DETECTOR_DIR))

import app as detector_app  # noqa: E402
from schemas import ErrorResponse, ScoreRequest, ScoreResponse  # noqa: E402
from scorer import LocalDetectorScorer  # noqa: E402


SETTINGS = {
    "evidenceCoverageMinimum": 50,
    "redThreshold": 75,
    "yellowThreshold": 40,
}


class ScoreRequestContractTests(unittest.TestCase):
    @staticmethod
    def medium_fixture_request() -> ScoreRequest:
        fixtures_path = REPOSITORY_ROOT / "extension/src/shared/fixtures.json"
        fixtures = json.loads(fixtures_path.read_text())
        medium_fixture = next(
            fixture for fixture in fixtures if fixture["name"] == "medium-yellow"
        )
        return ScoreRequest.model_validate(
            {"post": medium_fixture["post"], "settings": SETTINGS}
        )

    def test_shared_fixtures_match_score_request(self) -> None:
        fixtures_path = REPOSITORY_ROOT / "extension/src/shared/fixtures.json"
        fixtures = json.loads(fixtures_path.read_text())

        for fixture in fixtures:
            request = ScoreRequest.model_validate(
                {"post": fixture["post"], "settings": SETTINGS}
            )
            self.assertEqual(request.post.contentKey, fixture["post"]["contentKey"])

    def test_malformed_request_is_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            ScoreRequest.model_validate(
                {
                    "post": {"platform": "x", "contentKey": "missing-fields"},
                    "settings": SETTINGS,
                }
            )

    def test_short_fixture_returns_gray_for_insufficient_evidence(self) -> None:
        fixtures_path = REPOSITORY_ROOT / "extension/src/shared/fixtures.json"
        fixtures = json.loads(fixtures_path.read_text())
        short_fixture = next(fixture for fixture in fixtures if fixture["name"] == "short-gray")
        request = ScoreRequest.model_validate(
            {"post": short_fixture["post"], "settings": SETTINGS}
        )

        result = LocalDetectorScorer().score(request)

        self.assertIsInstance(result, ScoreResponse)
        self.assertEqual(result.labelRecommendation, "gray")
        self.assertLess(result.evidenceCoverage, SETTINGS["evidenceCoverageMinimum"])
        self.assertIn("not_enough_signal", result.reasons)

    def test_detector_label_thresholds_match_the_shared_contract(self) -> None:
        self.assertEqual(
            LocalDetectorScorer.label_for_score(
                75, SETTINGS["redThreshold"], SETTINGS["yellowThreshold"]
            ),
            "yellow",
        )
        self.assertEqual(
            LocalDetectorScorer.label_for_score(
                40, SETTINGS["redThreshold"], SETTINGS["yellowThreshold"]
            ),
            "yellow",
        )
        self.assertEqual(
            LocalDetectorScorer.label_for_score(
                39.9, SETTINGS["redThreshold"], SETTINGS["yellowThreshold"]
            ),
            "green",
        )
        self.assertEqual(
            LocalDetectorScorer.label_for_score(
                75.1, SETTINGS["redThreshold"], SETTINGS["yellowThreshold"]
            ),
            "red",
        )

    def test_model_unavailable_is_typed(self) -> None:
        result = LocalDetectorScorer().score(self.medium_fixture_request())

        self.assertIsInstance(result, ErrorResponse)
        self.assertEqual(result.errorCode, "model_unavailable")

    def test_model_unavailable_returns_typed_json(self) -> None:
        original_runtime = detector_app.scorer._runtime
        original_model_loaded = detector_app.scorer.model_loaded
        original_load_error = detector_app.scorer._load_error
        detector_app.scorer._runtime = None
        detector_app.scorer.model_loaded = False
        detector_app.scorer._load_error = None
        try:
            with patch.object(detector_app.scorer, "load_model", return_value=False):
                with TestClient(detector_app.app) as client:
                    response = client.post(
                        "/score", json=self.medium_fixture_request().model_dump(mode="json")
                    )
        finally:
            detector_app.scorer._runtime = original_runtime
            detector_app.scorer.model_loaded = original_model_loaded
            detector_app.scorer._load_error = original_load_error

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["errorCode"], "model_unavailable")

    def test_invalid_request_returns_typed_json(self) -> None:
        with patch.object(detector_app.scorer, "load_model", return_value=False):
            with TestClient(detector_app.app) as client:
                response = client.post("/score", json={"post": {}, "settings": {}})

        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["errorCode"], "invalid_request")

    def test_simulated_inference_failure_returns_typed_json(self) -> None:
        class FailingRuntime:
            def score(self, _: str) -> float:
                raise RuntimeError("simulated failure")

        original_runtime = detector_app.scorer._runtime
        original_model_loaded = detector_app.scorer.model_loaded
        detector_app.scorer._runtime = FailingRuntime()  # type: ignore[assignment]
        detector_app.scorer.model_loaded = True
        try:
            # Prevent the real multi-gigabyte model from loading in this isolated
            # HTTP test; the fake runtime exercises the actual error response.
            with patch.object(detector_app.scorer, "load_model", return_value=True):
                with TestClient(detector_app.app) as client:
                    response = client.post(
                        "/score", json=self.medium_fixture_request().model_dump(mode="json")
                    )
        finally:
            detector_app.scorer._runtime = original_runtime
            detector_app.scorer.model_loaded = original_model_loaded

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.headers["content-type"].split(";")[0], "application/json")
        self.assertEqual(response.json()["errorCode"], "internal_failure")


if __name__ == "__main__":
    unittest.main()
