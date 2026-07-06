---
name: graph
description: Query the OLIMP project knowledge graph to find relevant code before fixing bugs or making changes. Invoke with a plain description of what needs to be fixed or understood.
---

# Graph-Assisted Code Help

## How This Works

The OLIMP project has a knowledge graph at `graphify-out/graph.json` (513 nodes, JS + server code).
When this skill is invoked, run graphify queries FIRST to locate the relevant code, then fix/explain.

## Step 1 — Run graphify queries

Extract 1–3 key English terms from the user's description (function names, feature names, keywords).
Run from the project root:

```bash
export PATH="$PATH:/sessions/eloquent-adoring-fermi/.local/bin"
cd /sessions/eloquent-adoring-fermi/mnt/SIXSEVEN

# Main search — use when looking for a feature or bug area
graphify query "<keyword>" --budget 600

# Deep dive — use when you already know the function name
graphify explain "<FunctionName>"

# Connection trace — use when you need to understand a call chain
graphify path "<FuncA>" "<FuncB>"
```

Query terms must be **English** — the graph is indexed by JS identifiers and file names.

| User says | Query to run |
|-----------|-------------|
| "карусель абонементів" | `graphify query "plans carousel"` |
| "розклад на сьогодні" | `graphify query "today schedule renderTodaySchedule"` |
| "кнопка входу" | `graphify query "login auth"` |
| "як завантажуються клієнти" | `graphify query "loadClients"` |
| "помилка при збережені тренера" | `graphify query "saveTrainer"` |

## Step 2 — Read only what the graph points to

Each result shows `src=<file> loc=L<line>`. Read ONLY those specific lines — do not scan full files.

## Step 3 — Fix or explain

Make the targeted change. If you modified JS or server files, run:
```bash
graphify update /sessions/eloquent-adoring-fermi/mnt/SIXSEVEN
```

## Key god nodes (most connected — check these first for cross-cutting issues)

- `apiFetch()` — all API calls go through here (`public/js/api.js L114`)
- `formatDate()` — date/time formatting (`public/js/api.js`)
- `authRequired()` — server-side auth middleware (`server/middleware/auth.js L33`)
- `escapeHtml()` — output sanitization (used everywhere)
- `renderPlans()` — subscription card rendering (`public/js/admin.js L950`)
