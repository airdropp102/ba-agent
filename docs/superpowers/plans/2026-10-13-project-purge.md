# Project Purge Implementation Plan

Approved in-chat design: preview by default, explicit --confirm for offline deletion, preserve environment/runtime/global engineering tasks. Use superpowers:executing-plans inline; no Git repository available.

- [x] Bootstrap global continuity and create task before modifications.
- [x] Write CLI tests for preview/deletion and active SQLite process refusal; verify failure before implementation.
- [x] Add scripts/project-purge.mjs and package script; discover UUID-scoped records/mirrors without importing legacy data.
- [x] Stage filesystem paths, delete scoped SQLite records transactionally, restore staged paths on precommit failure; support cleanup retry.
- [x] Cover orphan mirrors, symlink refusal and preservation of projectless records; document SETUP usage.
- [x] Review, run regression and required offline diagnostics, checkpoint and handoff.

Limits: requires lsof and operator-stopped processes. Detection is not an OS lock preventing an operator from starting a new server afterward. Existing backups and external service copies are excluded. No production project deletion during implementation.
