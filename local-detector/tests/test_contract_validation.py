import json
import sys
import unittest
from pathlib import Path

from pydantic import ValidationError

DETECTOR_DIR = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = DETECTOR_DIR.parent
sys.path.insert(0, str(DETECTOR_DIR))

from schemas import ScoreRequest, ScoreResponse  # noqa: E402
from scorer import LocalDetectorScorer  # noqa: E402


SETTINGS = {
    "evidenceCoverageMinimum": 50,
    "redThreshold": 75,
    "yellowThreshold": 40,
}


class ScoreRequestContractTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
