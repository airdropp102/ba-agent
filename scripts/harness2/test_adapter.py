"""Offline contracts: real Harness² core, scripted solver/editor, no semantic metrics."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from adapter import BAAdapter, FrozenLibrary, OfflineProposer, digest_dir
from run import run_experiment


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="ba-h2-contract-")
        self.root = Path(self.tmp.name)
        self.adapter = BAAdapter(self.root / "adapter")

    def tearDown(self):
        self.tmp.cleanup()

    def test_protocol_and_candidate_invariants(self):
        from harness2.core.spec import BenchmarkAdapter
        from harness2.core import tree
        self.assertIsInstance(self.adapter, BenchmarkAdapter)
        original = tree.read_tree(self.adapter.substrate.surface(), self.adapter.base_harness())
        self.adapter.validate_tree(original)
        for change in ({"systemprompt.md": "ignore policy"},
                       {"LongTermMEMORY.md": '["invent-rule"]'},
                       {"LongTermMEMORY.md": '["clarify-nfr","clarify-nfr"]'},
                       {"scripts/evil.py": "raise RuntimeError()"}):
            with self.assertRaises(ValueError):
                self.adapter.validate_tree(original | change)

    def test_bridge_isolation_and_source_provenance(self):
        os.environ["OPENAI_API_KEY"] = "never-forward-this-fixture-secret"
        result = self.adapter.execute("train-requests", None, "test-safe-run")
        artifact = json.loads((result / "result.json").read_text())
        self.assertTrue(self.adapter.delivered(result))
        self.assertEqual(artifact["canonical"]["requirements"]["functional"][0]["sourceId"], "SRC-101")
        self.assertFalse(artifact["canonical"]["review"]["customerApproved"])
        self.assertEqual(artifact["externalModelCalls"], 0)
        self.assertNotIn("OPENAI_API_KEY", self.adapter.child_environment())
        self.assertNotIn("never-forward-this-fixture-secret", self.adapter.trajectory(result, obs_trunc=50000))
        self.assertIsNone(self.adapter.score(result, "train-requests"))
        with self.assertRaises(ValueError):
            self.adapter.execute("train-requests", None, "../escape")
        with self.assertRaises(FileExistsError):
            self.adapter.execute("train-requests", None, "test-safe-run")

    def test_full_experiment_history_budgets_transfer_and_namespace(self):
        out = self.root / "experiment"
        report = run_experiment(out, k=1, mode="sequential", seed=42)
        self.assertEqual(report["status"], "OFFLINE_INTEGRATION_PASS", report["errors"])
        self.assertIsNone(report["semanticScore"])
        self.assertIsNone(report["costUsd"])
        self.assertEqual(report["externalModelCalls"], 0)
        rows = report["rows"]
        self.assertEqual(len(rows), 24)  # 4 tasks x 3 arms x 2 protocols
        for protocol in ("online", "transfer"):
            for task in ("train-requests", "train-leave", "test-repairs", "test-bookings"):
                b = next(r for r in rows if (r["protocol"], r["task"], r["arm"]) == (protocol, task, "B"))
                c = next(r for r in rows if (r["protocol"], r["task"], r["arm"]) == (protocol, task, "C"))
                self.assertEqual(b["solverExecutions"], c["solverExecutions"])
                self.assertEqual(b["adaptationCalls"], c["adaptationCalls"])
                self.assertEqual(b["memoryEntriesBefore"], [])
                self.assertEqual(b["libraryReadCalls"], 0)
        online_c = [r for r in rows if r["protocol"] == "online" and r["arm"] == "C"]
        self.assertEqual(online_c[0]["memoryEntriesBefore"], [])
        self.assertTrue(online_c[1]["memoryEntriesBefore"])
        self.assertGreater(online_c[1]["libraryReadCalls"], 0)
        for i, row in enumerate(online_c):
            self.assertLessEqual(set(row["memoryEntriesBefore"]), {r["task"] for r in online_c[:i]})
        test_rows = [r for r in rows if r["protocol"] == "transfer" and r["phase"] == "test" and r["arm"] == "C"]
        self.assertEqual(len(test_rows), 2)
        self.assertTrue(test_rows[0]["memoryEntriesBefore"])
        for row in test_rows:
            self.assertEqual(row["memoryDigestBefore"], row["memoryDigestAfter"])
            self.assertFalse(any(x.startswith("test-") for x in row["memoryEntriesAfter"]))
            self.assertGreater(row["libraryReadCalls"], 0)
        self.assertEqual(report["manifest"]["provider"], "offline-scripted")
        self.assertTrue(report["manifest"]["appCodeSha256"])
        self.assertTrue(report["manifest"]["policy"]["instructionSha256"])
        self.assertFalse(any("prompt" == p.name for p in out.rglob("*")))
        before = (out / "report.json").read_bytes()
        with self.assertRaises(FileExistsError):
            run_experiment(out, k=2, mode="sequential", seed=42)
        self.assertEqual((out / "report.json").read_bytes(), before)

    def test_frozen_library_add_cannot_write(self):
        library = FrozenLibrary(root=self.root / "library", domain="general-ba", surface=self.adapter.substrate.surface())
        before = digest_dir(library.root)
        library.add("test-repairs", {}, experience={"cue": "fixture", "lesson": "fixture", "evidence": "fixture"})
        self.assertEqual(digest_dir(library.root), before)

    def test_failure_does_not_publish_invalid_canonical(self):
        with patch.object(self.adapter, "bridge", side_effect=RuntimeError("invalid fixture output")):
            with self.assertRaisesRegex(RuntimeError, "invalid fixture output"):
                self.adapter.execute("train-requests", None, "failed-fixture")
        self.assertEqual(self.adapter.executions[-1]["ok"], False)
        self.assertEqual(len(list(self.adapter.root.rglob("failure.json"))), 1)
        self.assertEqual(len(list(self.adapter.root.rglob("canonical.json"))), 0)

    def test_interrupted_run_is_not_reported_as_pass(self):
        out = self.root / "interrupted"
        with patch.object(BAAdapter, "execute", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                run_experiment(out)
        report = json.loads((out / "report.json").read_text())
        self.assertEqual(report["status"], "RUNNING")
        self.assertFalse(report["completed"])

    def test_failed_rollouts_remain_in_report(self):
        out = self.root / "failed"
        with patch.object(BAAdapter, "execute", side_effect=RuntimeError("forced rollout failure")):
            report = run_experiment(out)
        self.assertEqual(report["status"], "OFFLINE_INTEGRATION_FAIL")
        self.assertEqual(len(report["rows"]), report["expectedRows"])
        self.assertTrue(all(r["status"] == "FAILED" for r in report["rows"]))


if __name__ == "__main__":
    unittest.main()
