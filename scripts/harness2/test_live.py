"""No-network contract for the live driver and its exact planned invocation count."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from adapter import BAAdapter
from live import LiveAdapter, run_live


class LiveDriverTests(unittest.TestCase):
    def test_real_core_protocol_uses_23_operations_and_freezes_memory(self):
        with tempfile.TemporaryDirectory(prefix="ba-h2-live-fake-") as directory:
            root = Path(directory).resolve()
            tasks = [{"id": f"FAKE-{split}", "split": split, "domain": "ba", "groupId": split,
                      "brief": "Synthetic fixture for transport-free core verification."} for split in ("train", "test")]
            corpus_file = root / "corpus.json"
            corpus_file.write_text(json.dumps({"cases": tasks}))
            config = {"output": str(root), "kind": "synthetic-smoke", "corpusHash": "fixture-only",
                      "model": "fake-model", "tasks": tasks, "plan": {"plannedCalls": 23},
                      "policy": {}, "maxCalls": 24, "upstreamRevision": "fixture", "corpusFile": str(corpus_file)}
            config_file = root / "config.json"
            config_file.write_text(json.dumps(config))
            operations = []

            def rpc(adapter, request):
                operation = request["operation"]
                if operation == "describe":
                    return {"guidance": {"clarify-scope": "Scope question", "clarify-nfr": "NFR question"}}
                operations.append((operation, request["requestId"]))
                if operation == "solve":
                    result = BAAdapter.bridge(adapter, {"task": "train-requests", "guidanceIds": request["guidanceIds"]})
                    result["predictions"] = {"functional": [], "nonFunctional": []}
                    result["rawEvidence"] = {"confirmed": 0, "grounded": 0}
                    return result
                return {"guidanceIds": ["clarify-scope"], "notes": "Deterministic transport-free integration fixture"}

            with patch.object(LiveAdapter, "rpc", rpc):
                result = run_live(config_file)
            self.assertEqual(result["status"], "AWAITING_HUMAN_REVIEW")
            self.assertEqual(len(operations), 23)
            self.assertEqual(len({request_id for _, request_id in operations}), 23)
            self.assertEqual(sum(op == "solve" for op, _ in operations), 13)
            self.assertEqual(sum(op == "edit" for op, _ in operations), 9)
            self.assertEqual(sum(op == "reflect" for op, _ in operations), 1)
            self.assertEqual(len(result["rows"]), 4)
            frozen = result["rows"][-1]
            self.assertTrue(frozen["memoryEntriesBefore"])
            self.assertEqual(frozen["memoryDigestBefore"], frozen["memoryDigestAfter"])
            self.assertFalse(result["productionAccepted"])
            self.assertIsNone(result["semanticScore"])
            for name in ("reviewer-a", "reviewer-b", "adjudicator"):
                review = json.loads((root / f"{name}.json").read_text())
                self.assertEqual(review["reviewerId"], "")


if __name__ == "__main__":
    unittest.main()
