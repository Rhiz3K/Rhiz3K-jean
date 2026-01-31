# Agent Instructions

This repository is a Tauri v2 + React (Vite) + TypeScript app with a Rust backend; follow established patterns.

## Workflow

- Start with `git status -sb`, skim `README.md`, and check `package.json` scripts.
- Prefer small, focused changes; avoid drive-by refactors.
- Don't start a dev server unless explicitly requested.
- After non-trivial changes, run `npm run check:all` (or a targeted subset + explain why).

## Build / Lint / Test Commands

```bash
npm install
npm run dev
npm run tauri:dev
npm run tauri:dev:rdp
npm run build
npm run tauri:build
npm run tauri:check
npm run check:all

npm run typecheck
npm run lint
npm run lint:fix
npm run format
npm run format:check
npm run test
npm run test:run
npm run rust:fmt:check
npm run rust:clippy
npm run rust:test
```

## Run A Single Test

Vitest includes: `src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}` (see `vitest.config.ts`).

```bash
npm run test -- src/services/preferences.test.ts
npm run test:run -- src/services/preferences.test.ts
npm run test:run -- -t "loads preferences"
npm run test:run -- src/services/preferences.test.ts -t "loads preferences"
```

Rust:

```bash
npm run rust:test
npm run rust:test -- my_test_name
cd src-tauri && cargo test my_test_name
```

## Repo Map (Where Things Live)

- `src/components/`: React UI (mostly `.tsx`, PascalCase files/components)
- `src/hooks/`: React hooks (usually `use-*.ts`, `use-*.tsx`)
- `src/store/`: Zustand stores (kebab-case, e.g. `chat-store.ts`)
- `src/services/`: TanStack Query hooks + all `invoke()` I/O (kebab-case)
- `src/lib/commands/`: React command system (commands are plain objects)
- `src-tauri/`: Rust backend (all filesystem / privileged operations)
- `docs/developer/`: project patterns; read before making architectural changes

## Architecture Rules (Don't Fight These)

- State "onion":
  - local UI state: React `useState`
  - global transient UI state: Zustand (`src/store/*`)
  - persisted/remote/backend state: TanStack Query (`src/services/*`)
- Never call `invoke()` directly in components; wrap it in `src/services/*`.
- Route user actions through the command system when they should be available via
  command palette / menus / shortcuts. See `docs/developer/command-system.md`.

## Code Style (TypeScript / React)

- Formatting: Prettier is canonical (see `prettier.config.js`):
  - no semicolons, single quotes, 2 spaces, print width 80, LF line endings
- Lint: ESLint strict + stylistic + React hooks; warnings are errors (`npm run lint`).
- Imports:
  - Prefer `@/...` alias instead of deep relative paths.
  - Use type-only imports (`@typescript-eslint/consistent-type-imports`):
    - `import type { Foo } from '@/types/foo'`
    - Inline type imports are OK: `import { x, type Foo } from 'pkg'`
  - Avoid import side effects from type-only imports.
- Naming:
  - components: `PascalCase` function + file name (`PreferencesDialog.tsx`)
  - hooks: `useXxx` (`use-command-context.ts` pattern is common here)
  - stores: `useXxxStore` exported from `src/store/*`
  - booleans: `isX`, `hasX`, `canX`.
- Types:
  - Avoid `any`; prefer `unknown` + narrowing.
  - Keep exported/public types in `src/types/*` when shared.
  - For TanStack Query keys, use `as const` and helper fns (see `src/services/*`).

## Error Handling / Logging

- Prefer `logger` (`src/lib/logger.ts`) over `console.*` in app code.
- `invoke()` failures may not be `Error`; normalize with `String(error)` or an
  `instanceof Error` guard.
- User-visible operations: toast success/failure (Sonner) and log details.
- Background operations: log; avoid noisy toasts unless the user must act.
- When running outside Tauri (browser), guard with `isTauri()` and return sensible
  defaults (pattern used in `src/services/preferences.ts`).

## Performance Patterns (Critical)

- Zustand in callbacks: use `useStore.getState()` to avoid render cascades.
- Zustand selectors: select primitives/derivations; avoid returning a getter
  function from a selector (it won't subscribe to underlying data).
- Stateful UI components (e.g. resizable panels): prefer CSS visibility
  (`hidden`/`invisible`) over conditional rendering.
- Use `React.memo` at meaningful boundaries to stop cascade propagation.
  See `docs/developer/performance-patterns.md`.

## Testing Style

- Frontend: Vitest + Testing Library, global setup in `src/test/setup.ts`.
- Prefer user-facing assertions (roles/text) over implementation details.
- For Query hooks, use shared providers/utilities in `src/test/test-utils.tsx`.

## Local Search (Important)

Use `mgrep` first (semantic search). If unavailable, fall back to `rg`.

```bash
mgrep "Where are the chat model options defined?"
mgrep -m 10 "Where is the Codex CLI config written?"
rg "invoke\(" src -n
```

## Cursor / Copilot Rules

- No Cursor rules found in `.cursor/rules/` and no `.cursorrules` file.
- No Copilot instructions found in `.github/copilot-instructions.md`.

If any of these appear later, treat them as higher-priority local agent rules.

## Skills

Project skills live in `.codex/skills/<skill>/SKILL.md`.

- Invoke a skill with `$skill-name` (example: `$react-architect`).
- List available skills with `/skills`.
