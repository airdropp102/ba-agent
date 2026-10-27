"""Actual Codex-backed Harness² experiment; admitted input only, no gold in contexts."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import threading

from adapter import BAAdapter, FrozenLibrary, ANCHOR, REPO, write_json, digest_dir
from run import code_digest
from harness2.core.library import Library
from harness2.core.proposer import Proposer, Reply, ProposerError
from harness2.core.schedule import run_task


class LiveAdapter(BAAdapter):
    def __init__(self, root, config_file):
        self.config_file = Path(config_file).resolve()
        self.local = threading.local()
        self.config = json.loads(self.config_file.read_text())
        super().__init__(root)
        descriptor = self.rpc({"operation": "describe"})
        self.catalog = descriptor["guidance"]
        self.records = {task["id"]: task for task in self.config["tasks"]}

    def task_prompt(self, task_id):
        return "Prepare DRAFT source-grounded BA requirements and open questions:\n" + self.records[task_id]["brief"]

    def rpc(self, payload):
        request = dict(payload, configFile=str(self.config_file))
        request.setdefault("requestId", hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest())
        result = subprocess.run([self.node, str(REPO / "scripts/harness2/live-runtime.mjs")],
                                input=json.dumps(request), capture_output=True, text=True,
                                check=True, timeout=180, cwd=self.root,
                                env={"PATH": os.defpath, "LANG": "en_US.UTF-8"})
        return json.loads(result.stdout)

    def bridge(self, payload, *, timeout=30):
        if payload.get("operation") == "describe":
            return super().bridge(payload, timeout=timeout)
        return self.rpc(dict(payload, operation="solve", requestId=self.local.request_id))

    def execute(self, task_id, harness_dir, run_id, *, timeout=None):
        self.local.request_id = "solve-" + hashlib.sha256((str(self.root) + run_id).encode()).hexdigest()
        return super().execute(task_id, harness_dir, run_id, timeout=timeout)


class CodexProposer(Proposer):
    adapter: LiveAdapter
    frozen = False

    def call(self, mission, context_dir, label, **kwargs):
        context = Path(context_dir)
        # No reflection call or adoption on held-out tests; preserve train library.
        if self.frozen and label.startswith("experience."):
            reply = Reply(label=label, text="NO_ENTRY", ok=True, attempts=0)
            self._calls.append(reply)
            return reply
        operation = "reflect" if label.startswith("experience.") else "select" if label.startswith("select.") else "edit"
        evidence = {"mission": mission}
        for path in sorted(context.rglob("*")):
            if path.is_symlink():
                raise ProposerError("Symlink context forbidden", attempts=0)
            if path.is_file() and path.suffix in (".md", ".json", ".txt"):
                evidence[str(path.relative_to(context))] = path.read_text(encoding="utf-8")
        try:
            response = self.adapter.rpc({"operation": operation, "requestId": hashlib.sha256((str(context) + label).encode()).hexdigest(),
                                         "evidence": json.dumps(evidence, ensure_ascii=False)})
        except Exception as error:
            raise ProposerError(f"Codex {operation} failed; inspect invocation ledger ({type(error).__name__})", attempts=1) from error
        workspace = None
        if operation == "edit":
            workspace = context / "harness"
            (workspace / "LongTermMEMORY.md").write_text(json.dumps(response["guidanceIds"]) + "\n")
            text = "<notes>" + response["notes"][:6000] + "</notes>"
        elif operation == "reflect":
            adopted = json.loads((context / "harness/LongTermMEMORY.md").read_text())
            ids = response["guidanceIds"]
            if not set(ids) <= set(adopted):
                raise ProposerError("Reflection attempted to retain unadopted guidance", attempts=1)
            # Only generic catalog IDs cross task boundaries; no customer/notes text.
            text = ("<experience>\ncue: Source-grounded draft requirements\nlesson: Consider analyst guidance " + ", ".join(ids) +
                    "\nevidence: Reflection selected catalog IDs from the adopted harness after inspecting task-local execution contrasts.\n"
                    "confidence: model hypothesis; human semantic review pending\n</experience>") if ids else "NO_ENTRY"
        else:
            candidates = {p.stem for p in (context / "candidates").glob("*.md")}
            if response["choice"] not in candidates:
                raise ProposerError("Invalid anonymous selection", attempts=1)
            text = "<why>" + response["notes"][:6000] + "</why>\n```choice\n" + response["choice"] + "\n```"
        reply = Reply(label=label, text=text, ok=True, workspace=workspace, attempts=1)
        self._calls.append(reply)
        return reply


def run_live(config_file):
    config_file = Path(config_file).resolve()
    config = json.loads(config_file.read_text())
    output = Path(config["output"])
    report = {"schemaVersion": "ba.harness2.live-run.v1", "status": "RUNNING", "kind": config["kind"],
              "corpusHash": config["corpusHash"], "model": config["model"], "provider": "codex", "rows": [],
              "semanticScore": None, "learningGain": None, "productionAccepted": False,
              "manifest": {"appCodeSha256": code_digest(), "plan": config["plan"], "policy": config["policy"],
                           "upstreamRevision": config["upstreamRevision"], "reasoningEffort": "low", "maxCalls": config["maxCalls"]}}
    write_json(output / "report.json", report)
    libraries = {}
    order = [("C", task, "train") for task in config["tasks"] if task["split"] == "train"]
    order += [(arm, task, "test") for task in config["tasks"] if task["split"] == "test" for arm in ("A", "B", "C")]
    for index, (arm, task, phase) in enumerate(order):
        adapter = LiveAdapter(output / f"{phase}-{arm}-{task['id']}", config_file)
        prop = CodexProposer(adapter.spec.channels["proposer"])
        prop.adapter, prop.frozen = adapter, phase == "test"
        library = None
        domain = task["domain"]
        lib_root = output / "library" / "seq"
        if arm == "C":
            if domain not in libraries:
                libraries[domain] = Library(root=lib_root, domain=domain, surface=adapter.substrate.surface())
            library = libraries[domain] if phase == "train" else FrozenLibrary(root=lib_root, domain=domain, surface=adapter.substrate.surface())
        before = digest_dir(lib_root)
        row = {"phase": phase, "arm": arm, "task": task["id"], "groupId": task["groupId"], "domain": domain,
               "memoryEntriesBefore": library.entries() if library else [], "memoryDigestBefore": before, "status": "FAILED"}
        try:
            if arm == "A":
                chosen = adapter.execute(task["id"], None, "baseline")
            else:
                result = run_task(task["id"], 1, adapter=adapter, prop=prop, runs_root=adapter.spec.runs_root, modes=("seq",), library=library)
                if result.status != "ok" or not result.modes.get("seq", {}).get("ok") or result.modes["seq"].get("fell_back"):
                    raise RuntimeError("Harness recursion failed or fell back; no automatic rerun")
                chosen = Path(result.selections["seq"]["chosen_run_dir"])
            artifact = json.loads((chosen / "result.json").read_text())
            row.update(status="COMPLETED", predictions=artifact["predictions"], rawEvidence=artifact["rawEvidence"],
                       guidanceIds=artifact["guidanceIds"], instruction=artifact["instruction"], deliverable=str(chosen.relative_to(output)))
            if any(not r["ok"] for r in adapter.executions):
                raise RuntimeError("One or more solver attempts failed")
            if phase == "test" and arm == "C" and digest_dir(lib_root) != before:
                raise RuntimeError("Frozen train memory changed")
        except Exception as error:
            row.update(status="FAILED", errorType=type(error).__name__)
            report["status"] = "INCOMPLETE"
        row.update(memoryDigestAfter=digest_dir(lib_root), memoryEntriesAfter=library.entries() if library else [])
        report["rows"].append(row)
        write_json(output / "report.json", report)
        print(f"[{index+1}/{len(order)}] {phase}/{arm}/{task['id']}: {row['status']}", flush=True)
        if row["status"] != "COMPLETED":
            return report
    report["status"] = "AWAITING_HUMAN_REVIEW"
    report["note"] = "Actual Codex outputs; synthetic pilot is not real-corpus acceptance or evidence of semantic learning."
    write_json(output / "report.json", report)
    # Reviewers get gold only after the complete execution record has been committed.
    corpus = json.loads(Path(config["corpusFile"]).read_text())
    packet = {"schemaVersion": "ba.harness2.review-packet.v1", "runHash": hashlib.sha256((output / "report.json").read_bytes()).hexdigest(),
              "kind": config["kind"], "cases": [c for c in corpus["cases"] if c["split"] == "test"], "outputs": [r for r in report["rows"] if r["phase"] == "test"]}
    write_json(output / "review-packet.json", packet)
    for reviewer in ("reviewer-a", "reviewer-b", "adjudicator"):
        judgments = []
        for row in packet["outputs"]:
            judgments.append({"caseId": row["task"], "arm": row["arm"], **{key: [{"predictionId": p["id"], "verdict": "PENDING", "matchedGoldIds": [], "supportQuote": "", "note": ""} for p in row["predictions"][key]] for key in ("functional", "nonFunctional")}})
        write_json(output / f"{reviewer}.json", {"schemaVersion": "ba.harness2.review.v1", "runHash": packet["runHash"], "reviewerId": "", "reviewedAt": "", "judgments": judgments})
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        result = run_live(args.config)
        raise SystemExit(0 if result["status"] == "AWAITING_HUMAN_REVIEW" else 1)
    except Exception as error:
        print(f"Live experiment stopped ({type(error).__name__}); inspect ledger/report, do not replay.", file=sys.stderr)
        raise SystemExit(1)
