"""Offline A/B/C contracts and frozen-transfer experiment, not a semantic benchmark."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import random
import subprocess
import sys

from adapter import BAAdapter, FrozenLibrary, OfflineProposer, PIN, REPO, digest_dir, write_json
from harness2.core.library import Library
from harness2.core.schedule import mode_token, run_task


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def code_digest():
    files = []
    for folder in ("src", "skills", "schemas", "scripts/harness2"):
        files.extend(p for p in (REPO / folder).rglob("*") if p.is_file() and "__pycache__" not in p.parts)
    files += [REPO / "scripts/harness2.mjs", REPO / "package.json"]
    return digest({str(p.relative_to(REPO)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(files) if p.exists()})


def run_experiment(output, *, k=1, mode="sequential", seed=42):
    if isinstance(k, bool) or not isinstance(k, int) or not 1 <= k <= 3:
        raise ValueError("Offline recursion budget k must be 1..3")
    if mode not in ("parallel", "sequential") or isinstance(seed, bool) or not isinstance(seed, int):
        raise ValueError("Invalid mode or seed")
    output = Path(output).expanduser().absolute()
    if output.is_symlink():
        raise ValueError("Output symlinks forbidden")
    output = output.resolve()
    output.mkdir(parents=True, exist_ok=False)  # exclusive namespace: no incompatible resume
    output.chmod(0o700)
    descriptor_adapter = BAAdapter(output / "descriptor")
    descriptor = descriptor_adapter.descriptor
    tasks = descriptor["tasks"]
    train = [t["id"] for t in tasks if t["split"] == "train"]
    test = [t["id"] for t in tasks if t["split"] == "test"]
    if {t["group"] for t in tasks if t["split"] == "train"} & {t["group"] for t in tasks if t["split"] == "test"}:
        raise ValueError("Train/test project groups overlap")
    random.Random(seed).shuffle(train)
    random.Random(seed + 1).shuffle(test)
    online = [t["id"] for t in tasks]
    random.Random(seed).shuffle(online)
    manifest = {
        "format": "ba.harness2.offline.v1", "upstreamRevision": PIN,
        "appRevision": subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO, check=True, text=True, capture_output=True).stdout.strip(),
        "appCodeSha256": code_digest(), "corpusSha256": digest(tasks),
        "splitSha256": digest({"train": train, "test": test}),
        "taskOrderSha256": digest({"online": online, "transfer": train + test}),
        "policy": descriptor["policy"], "schemaSha256": digest(descriptor["schema"]),
        "guidanceCatalogSha256": digest(descriptor["guidance"]),
        "provider": "offline-scripted", "solverModel": None, "improverModel": None,
        "sampling": "deterministic fixture; no model sampling", "k": k, "mode": mode, "seed": seed,
        "python": sys.version.split()[0], "node": subprocess.run([descriptor_adapter.node, "--version"], text=True, capture_output=True, check=True).stdout.strip(),
        "taskOrders": {"online": online, "train": train, "test": test},
        "scope": "synthetic integration only; live BA provider path and semantic scoring are not implemented",
    }
    write_json(output / "manifest.json", manifest)
    rows = []
    errors = []
    token = mode_token(mode)

    def save(*, final=False):
        report = {"status": ("OFFLINE_INTEGRATION_FAIL" if errors else "OFFLINE_INTEGRATION_PASS") if final else "RUNNING",
                  "completed": final, "expectedRows": len(tasks) * 6,
                  "manifest": manifest, "rows": rows, "errors": errors,
                  "semanticScore": None, "learningGain": None, "costUsd": None,
                  "usageStatus": "UNKNOWN", "externalModelCalls": 0,
                  "note": "Scripted solver/editor contrasts are fixtures, not learned model performance. Upstream usd defaults are unmeasured and excluded."}
        write_json(output / "report.json", report)
        return report

    save()
    for protocol, order in (("online", online), ("transfer", train + test)):
        for arm in ("A", "B", "C"):
            adapter = BAAdapter(output / protocol / arm)
            proposer = OfflineProposer(adapter.spec.channels["proposer"])
            libraries = {}
            for index, task in enumerate(order):
                phase = "stream" if protocol == "online" else ("train" if task in train else "test")
                domain = adapter.domain_of(task)
                root = output / protocol / arm / "library" / token
                library = None
                if arm == "C":
                    if domain not in libraries:
                        libraries[domain] = Library(root=root, domain=domain, surface=adapter.substrate.surface())
                    library = libraries[domain]
                    if phase == "test":
                        library = FrozenLibrary(root=root, domain=domain, surface=adapter.substrate.surface())
                before = library.entries() if library else []
                before_digest = digest_dir(root)
                start, call_start = len(adapter.executions), len(proposer._calls)
                status, chosen, failure = "FAILED", None, None
                try:
                    if arm == "A":
                        chosen = adapter.execute(task, None, f"A-{task}")
                        status = "OK" if adapter.delivered(chosen) else "FAILED"
                    else:
                        result = run_task(task, k, adapter=adapter, prop=proposer,
                                          runs_root=adapter.spec.runs_root, modes=(token,), seed=seed, library=library)
                        if result.status not in ("ok", "skipped"):
                            raise RuntimeError("; ".join(result.errors) or result.status)
                        mode_result = result.modes[token]
                        if not mode_result.get("ok") or mode_result.get("fell_back") or mode_result.get("errors"):
                            raise RuntimeError("Recursion failed or used fallback stages; inspect upstream summary.json")
                        selection = result.selections[token]
                        chosen = Path(selection["chosen_run_dir"])
                        if not adapter.delivered(chosen):
                            raise RuntimeError("Selected rollout lacks a validated delivery")
                        status = "OK"
                except Exception as error:
                    # Keep failure visible and continue other independent arm/case contracts.
                    failure = f"{type(error).__name__}: {error}"[:1000]
                    errors.append({"protocol": protocol, "arm": arm, "task": task, "error": failure})
                calls = proposer._calls[call_start:]
                if any(not x["ok"] for x in adapter.executions[start:]) and status == "OK":
                    status = "FAILED"
                    failure = "One or more solver attempts failed"
                    errors.append({"protocol": protocol, "arm": arm, "task": task, "error": failure})
                after = library.entries() if library else []
                after_digest = digest_dir(root)
                if phase == "test" and arm == "C" and before_digest != after_digest:
                    status = "FAILED"
                    errors.append({"protocol": protocol, "arm": arm, "task": task, "error": "Frozen library changed"})
                selected_ids, instruction = [], None
                if status == "OK":
                    artifact = json.loads((chosen / "result.json").read_text())
                    selected_ids, instruction = artifact["guidanceIds"], artifact["instruction"]
                row = {"protocol": protocol, "phase": phase, "arm": arm, "task": task, "domain": domain,
                       "streamIndex": index, "status": status, "error": failure,
                       "memoryEntriesBefore": before, "memoryEntriesAfter": after,
                       "memoryDigestBefore": before_digest, "memoryDigestAfter": after_digest,
                       "solverExecutions": len(adapter.executions) - start,
                       "failedSolverExecutions": sum(not x["ok"] for x in adapter.executions[start:]),
                       "adaptationCalls": sum(not r.label.startswith(("select.", "experience.")) for r in calls),
                       "reflectionCalls": sum(r.label.startswith("experience.") for r in calls),
                       "selectionCalls": sum(r.label.startswith("select.") for r in calls),
                       "libraryReadCalls": sum(bool(r.offline_retrieved_ids) for r in calls),
                       "retrievedGuidanceIds": sorted({x for r in calls for x in r.offline_retrieved_ids}),
                       "guidanceIds": selected_ids, "instruction": instruction,
                       "deliverable": str(chosen.relative_to(output)) if chosen is not None else None,
                       "tokens": None, "costUsd": None, "semanticScore": None}
                rows.append(row)
                save()  # each completed or failed case remains inspectable after interruption
    for protocol in ("online", "transfer"):
        for task in online:
            b, c = [next(r for r in rows if (r["protocol"], r["arm"], r["task"]) == (protocol, arm, task)) for arm in ("B", "C")]
            if (b["solverExecutions"], b["adaptationCalls"]) != (c["solverExecutions"], c["adaptationCalls"]):
                errors.append({"protocol": protocol, "task": task, "error": "B/C adaptation budgets differ"})
    return save(final=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--k", type=int, default=1, choices=range(1, 4))
    parser.add_argument("--mode", choices=("parallel", "sequential"), default="sequential")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        report = run_experiment(args.output, k=args.k, mode=args.mode, seed=args.seed)
    except Exception as error:
        print(f"Offline benchmark failed: {error}", file=sys.stderr)
        return 1
    print(f"{report['status']}: {len(report['rows'])} arm/case records; {len(report['errors'])} errors; no semantic score.")
    print(str(args.output / "report.json"))
    return int(bool(report["errors"]))


if __name__ == "__main__":
    raise SystemExit(main())
