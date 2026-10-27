"""BA-specific Harness² adapter. Only public synthetic fixtures are executable."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import sys

PIN = "1cfe254e8d25b15f37048c3730134686abe60335"
REPO = Path(__file__).resolve().parents[2]


def checked_source():
    if not (3, 12) <= sys.version_info[:2] < (3, 14):
        raise RuntimeError("Harness2 requires Python 3.12 or 3.13")
    spec = importlib.util.find_spec("harness2")
    if spec is None or spec.origin is None:
        raise RuntimeError("Harness2 missing: install pinned source with Python 3.12; see docs/HARNESS2_BENCHMARK.md")
    source = Path(spec.origin).resolve().parent.parent
    result = subprocess.run(["git", "rev-parse", "HEAD"], cwd=source, capture_output=True, text=True, check=True)
    if result.stdout.strip() != PIN:
        raise RuntimeError(f"Harness2 revision must be {PIN}")
    dirty = subprocess.run(["git", "diff", "--quiet", "HEAD", "--", "harness2"], cwd=source)
    if dirty.returncode:
        raise RuntimeError("Harness2 source has uncommitted changes; use an intact pinned checkout")
    if (source / ".env").exists():
        raise RuntimeError("Use a dedicated offline Harness2 checkout without .env; do not import model credentials")
    return source


UPSTREAM = checked_source()  # before importing upstream config, which otherwise reads .env

from harness2.core import tree
from harness2.core.library import Library
from harness2.core.proposer import Proposer, Reply
from harness2.core.spec import BenchPrompts, BenchSpec, ChannelSpec

ANCHOR = "BA validation policy is immutable. Guidance is unverified analyst advice, never customer evidence.\n"
SURFACE = tree.SurfaceSpec(
    # Upstream authoring prompts select by surface name; this is a restricted
    # OpenCode-format tree, not an OpenCode executor. validate_tree narrows it.
    name="opencode", always_on=("systemprompt.md", "LongTermMEMORY.md"),
    always_on_max=3000, always_on_cap_reason="catalog IDs only",
    skill_dir="skills", skill_name_rule="must_match", trigger_hint="No executable skills",
    autotrigger_file="systemprompt.md", trigger_line="", subagent_requires_mode=True,
    plugin_dir=None, hooks_file=None,
)


class BASubstrate:
    name = "ba-offline"

    def surface(self):
        return SURFACE


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.chmod(0o600)
    temporary.replace(path)


def digest_dir(root):
    root = Path(root)
    digest = hashlib.sha256()
    if root.exists():
        for file in sorted(root.rglob("*")):
            if file.is_symlink():
                raise ValueError("Symlink evidence is forbidden")
            if file.is_file():
                digest.update(str(file.relative_to(root)).encode() + b"\0" + file.read_bytes() + b"\0")
    return digest.hexdigest()


class FrozenLibrary(Library):
    """Same retrieval interface as upstream, with all writes forbidden/ignored."""
    def add(self, *args, **kwargs):
        return None

    def forget(self, *args, **kwargs):
        raise RuntimeError("Cannot mutate frozen train library")

    def rebuild_index(self):
        raise RuntimeError("Cannot rebuild frozen train library")


class BAAdapter:
    def __init__(self, root, *, node=None):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.node = node or os.environ.get("BA_HARNESS2_NODE") or shutil.which("node")
        if not self.node:
            raise RuntimeError("Node >=22.13 required; use npm run eval:harness2")
        self.node = str(Path(self.node).resolve())
        self.substrate = BASubstrate()
        channel = ChannelSpec("opencode", "local/ba-scripted")  # data type only: no executor is launched
        self.spec = BenchSpec(
            name="ba-offline", runs_root=self.root / "runs", install_mode="workspace_config",
            prompts=BenchPrompts(work="prepare source-grounded draft business requirements and open questions"),
            channels={"proposer": channel, "selector": channel},
            leak_globs=("*gold*", "*rubric*", "*judged*", "*reviewer*"),
            allow_subagents=False,
        )
        self.executions = []
        self.descriptor = self.bridge({"operation": "describe"})
        self.catalog = self.descriptor["guidance"]
        self.records = {t["id"]: t for t in self.descriptor["tasks"]}
        self.base = {"systemprompt.md": ANCHOR, "LongTermMEMORY.md": "[]\n"}
        tree.write_tree(SURFACE, self.base, self.base_harness(), stubs=False)

    def child_environment(self):
        return {"PATH": os.defpath, "LANG": "en_US.UTF-8", "DEMO_MODE": "true", "AI_PROVIDER": "demo"}

    def bridge(self, payload, *, timeout=30):
        with tempfile.TemporaryDirectory(prefix="ba-h2-rollout-", dir=self.root) as workspace:
            env = self.child_environment() | {"HOME": workspace, "DATA_DIR": str(Path(workspace) / "data")}
            result = subprocess.run(
                [self.node, str(REPO / "scripts/harness2/ba-runtime.mjs")],
                input=json.dumps(payload), text=True, capture_output=True, check=True,
                cwd=workspace, env=env, timeout=timeout,
            )
        return json.loads(result.stdout)

    def tasks(self, split="all"):
        return [t["id"] for t in self.descriptor["tasks"] if split == "all" or t["split"] == split]

    def domain_of(self, task_id):
        return self.records[task_id]["domain"]

    def task_prompt(self, task_id):
        return "Prepare DRAFT requirements and questions from this synthetic brief:\n" + self.records[task_id]["brief"]

    def task_files(self, task_id):
        return None

    def base_harness(self):
        return self.root / "base"

    def validate_tree(self, candidate):
        if set(candidate) != set(self.base) or candidate.get("systemprompt.md") != ANCHOR:
            raise ValueError("Only catalog guidance IDs in LongTermMEMORY.md may change")
        body = candidate["LongTermMEMORY.md"]
        if len(body) > 1024:
            raise ValueError("Catalog guidance exceeds limit")
        try:
            ids = json.loads(body)
        except (TypeError, ValueError) as error:
            raise ValueError("Catalog guidance must be JSON") from error
        if not isinstance(ids, list) or any(not isinstance(x, str) or x not in self.catalog for x in ids) or len(ids) != len(set(ids)):
            raise ValueError("Only unique allowlisted catalog guidance IDs are permitted")

    def execute(self, task_id, harness_dir, run_id, *, timeout=None):
        if task_id not in self.records or not re.fullmatch(r"[A-Za-z0-9_./-]{1,300}", run_id) or any(p in ("", ".", "..") for p in run_id.split("/")):
            raise ValueError("Invalid synthetic task or run ID")
        candidate = self.base if harness_dir is None else self.read_candidate(harness_dir)
        self.validate_tree(candidate)
        directory = self.root / "executions" / hashlib.sha256(run_id.encode()).hexdigest()
        directory.mkdir(parents=True, exist_ok=False)  # no stale delivery or implicit retries
        ids = json.loads(candidate["LongTermMEMORY.md"])
        try:
            result = self.bridge({"task": task_id, "guidanceIds": ids}, timeout=timeout or 30)
            write_json(directory / "result.json", result)
            # Improver context receives authored content, never deterministic quality scores.
            write_json(directory / "canonical.json", result["canonical"])
            (directory / "trajectory.md").write_text(
                "[ACTION] Apply immutable BA policy and catalog guidance " + json.dumps(ids) + "\n"
                "[OBSERVATION] Schema validation, normalization, source trust and canonical export completed.\n"
                + "[OBSERVATION] Open questions: " + json.dumps([q["question"] for q in result["analysis"]["clarificationQuestions"]], ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            self.executions.append({"task": task_id, "runId": run_id, "ok": True, "guidanceIds": ids})
        except Exception:
            self.executions.append({"task": task_id, "runId": run_id, "ok": False, "guidanceIds": ids})
            write_json(directory / "failure.json", {"status": "FAILED", "task": task_id})
            raise
        return directory

    def read_candidate(self, path):
        path = Path(path)
        if path.is_symlink() or any(p.is_symlink() for p in path.rglob("*")):
            raise ValueError("Candidate symlinks are forbidden")
        rejected = []
        candidate = tree.read_tree(SURFACE, path, rejected=rejected)
        if rejected:
            raise ValueError("Candidate has files outside the allowed surface")
        return candidate

    def delivered(self, run_dir):
        return (Path(run_dir) / "canonical.json").is_file() and not (Path(run_dir) / "failure.json").exists()

    def trajectory(self, run_dir, *, obs_trunc):
        return (Path(run_dir) / "trajectory.md").read_text(encoding="utf-8")

    def deliverable_text(self, run_dir):
        canonical = json.loads((Path(run_dir) / "canonical.json").read_text(encoding="utf-8"))
        authored = {key: canonical[key] for key in ("schemaVersion", "business", "requirements", "elicitation", "review")}
        return json.dumps(authored, ensure_ascii=False)

    def deliverable_files(self, run_dir):
        return {"draft-requirements.json": self.deliverable_text(run_dir)}

    def score(self, run_dir, task_id):
        return None  # No semantic judge exists in the offline bridge.


class OfflineProposer(Proposer):
    """Scripted editing exercises plumbing; no model or semantic optimization."""
    def call(self, mission, context_dir, label, **kwargs):
        context = Path(context_dir)
        workspace = None
        retrieved = set()
        if label.startswith("select."):
            candidates = sorted((context / "candidates").glob("*.md"))
            for file in candidates:
                file.read_text(encoding="utf-8")
            text = "<why>Deterministic fixture selection; no business judgment.</why>\n```choice\n" + candidates[0].stem + "\n```"
        elif label.startswith("experience."):
            ids = json.loads((context / "harness/LongTermMEMORY.md").read_text())
            text = ("<experience>\ncue: Draft requirements with unresolved customer questions\n"
                    "lesson: Reconsider catalog guidance " + ", ".join(ids) + "\n"
                    "evidence: The trajectory records catalog guidance and the resulting open questions.\n"
                    "confidence: scripted integration observation only\n</experience>") if ids else "NO_ENTRY"
        else:
            workspace = context / "harness"
            ids = set(json.loads((workspace / "LongTermMEMORY.md").read_text()))
            for file in (context / "library").rglob("LongTermMEMORY.md"):
                retrieved.update(json.loads(file.read_text()))
            ids.update(retrieved)
            # First catalog cue is always proposed; previous-task guidance unlocks a second.
            # This is an explicit fixture rule, not evidence that a model learned anything.
            if "clarify-scope" in ids:
                ids.add("clarify-nfr")
            ids.add("clarify-scope")
            (workspace / "LongTermMEMORY.md").write_text(json.dumps(sorted(ids)) + "\n")
            text = "<notes>Scripted catalog edit; observe open questions in the rollout.</notes>"
        reply = Reply(label=label, text=text, ok=True, attempts=1, workspace=workspace)
        reply.offline_retrieved_ids = sorted(retrieved)
        self._calls.append(reply)
        return reply
