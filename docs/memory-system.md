# Memory System

The persistent agent memory system allows agents and operators to store, retrieve, and manage information across sessions.

## Architecture

```
Browser (memory-view.mjs)
  ↓ same-origin /api/memory/*
task-server.js (port 3876)
  ↓ proxy via routes/memory-routes.js
memory-api-server.mjs (port 3879)
  ↓ reads/writes
~/workspace/main/memory/  (.md files)
~/workspace/main/MEMORY.md (root memory)
```

## Memory Files

| Path | Purpose |
|------|---------|
| `MEMORY.md` | Root long-term memory (curated, manual) |
| `memory/YYYY-MM-DD.md` | Daily notes (auto-created) |
| `memory/behavior.md` | Standing behavior rules and user preferences |
| `memory/<topic>.md` | Topic-specific memory files |

## API Endpoints

### File Operations

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/memory/list` | List all memory files with metadata |
| `GET` | `/api/memory/file/:name` | Read a specific file |
| `POST` | `/api/memory/file/:name` | Create a new `.md` file |
| `PUT` | `/api/memory/file/:name` | Update an existing file |
| `POST` | `/api/memory/file/:name/append` | Append content to a file |
| `DELETE` | `/api/memory/file/:name` | Delete a file |
| `GET` | `/api/memory/root` | Read MEMORY.md |
| `GET` | `/api/memory/context` | Assembled prompt context for agent injection |

### Search & Facts

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/memory/search?q=` | Semantic search via unified query |
| `GET` | `/api/memory/facts` | Fact statistics |
| `GET` | `/api/memory/facts/list` | List facts (optional `?namespace=`) |
| `POST` | `/api/memory/facts` | Create/update a fact |
| `DELETE` | `/api/memory/facts` | Delete a fact |
| `GET` | `/api/memory/facts/search` | Search facts |

### Status

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/memory/status` | System status (index, embeddings) |
| `GET` | `/api/memory/stats` | Aggregate statistics |

## Context Assembly

`GET /api/memory/context?scope=all&limit=5` assembles a prompt-ready context block:

1. `MEMORY.md` root (first 3000 chars)
2. `behavior.md` (if exists)
3. Today's daily note (if exists)
4. Most recent files up to limit

Returns:
```json
{
  "context": "--- MEMORY.md (root) ---\n...\n\n--- Memory: behavior.md ---\n...",
  "files": ["behavior.md", "2026-04-28.md"],
  "totalFiles": 54,
  "includedFiles": 4
}
```

## Security

- File operations validate paths: only `.md` files, no hidden files, `basename()` enforced
- All routes proxied through task-server auth middleware
- No subdirectory traversal (flat file model)

## Frontend

The Memory view (`src/shell/native-views/memory-view.mjs`) provides:
- **Browse tab:** File list with stats, filter, create button
- **Editor:** Full text editor with save (Ctrl+S), delete
- **Search tab:** Semantic search across memory files
- **Facts tab:** Structured fact management
- **Status tab:** System health and index status
