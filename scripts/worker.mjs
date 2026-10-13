#!/usr/bin/env node
/** Worker-only process. No HTTP listener. Shares SQLite WAL with API server. */
process.env.BA_WORKER_ONLY='true';
process.env.BA_WORKER_ENABLED='true';
await import('../src/server.js');
