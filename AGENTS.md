# Codex Agent Instructions

This repository is a Tauri v2 + React (Vite) app/template with established architecture and performance patterns.

## Workflow

- Start with `git status` and a quick skim of `README.md`.
- Follow project patterns in:
  - `docs/developer/architecture-guide.md`
  - `docs/developer/performance-patterns.md`
  - `docs/developer/command-system.md`
- Prefer small, focused changes; keep code style consistent; avoid unrelated refactors.
- After non-trivial changes, run `npm run check:all` (or at least targeted typecheck/tests).
- Don’t start a dev server unless explicitly requested.

## Local Search (Important)

Use `mgrep` for searching local files (semantic search).

Examples:

```bash
mgrep "Where are the chat model options defined?"
mgrep -m 10 "Where is the Codex CLI config written?"
```

If `mgrep` is unavailable/quota-blocked, fall back to `rg`.

## Skills

Project skills live in `.codex/skills/<skill>/SKILL.md`.

- Invoke a skill in Codex with `$skill-name` (example: `$react-architect`).
- List available skills with `/skills`.

