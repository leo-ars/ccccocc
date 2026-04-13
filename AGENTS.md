# AGENTS.md

## Rules To Remember

- Use Sandbox SDK as the primary abstraction. Do not add an SSH bridge, custom container control plane, or extra proxy layers when `@cloudflare/sandbox` already covers the job.
- Preserve the ownership model `user/workspace -> sandbox` and `logical terminal tab -> session`. Do not collapse those boundaries for convenience.

## Naming

- The product name is `ccccocc`, always lowercase.
- Product framing may say "Cloudflare Containers", but implementation choices should target Sandbox SDK and Cloudflare's native terminal WebSocket path.

## Repository Status

- This repo is no longer a blank scaffold. Multi-tab workspace state, reconnect handling, shared-session detection, backup and restore, and Cloudflare Access auth already exist in the live tree.
- Frontend files are under active iteration. Expect unrelated local edits and avoid reverting them.
- Terminal behavior is platform-sensitive. Automated tests help, but reconnect, alternate-screen TUIs, and container lifecycle changes still need manual verification.

## Source Of Truth

- The live source tree wins when docs drift.
- `docs/SPEC.md` is the product and architecture intent.
- `README.md` is the human-facing guide. Keep repo-operating instructions here in `AGENTS.md`.
- `src/shared/protocol.ts` is the shared terminal control contract.
- `src/client/workspace/store.ts` and `src/client/workspace/types.ts` own the logical tab and session persistence model.
- `src/worker/auth.ts` owns auth mode selection and sandbox ownership derivation.
- `wrangler.jsonc` is the runtime binding contract.
- `worker-configuration.d.ts` and `dist/` are generated outputs. Regenerate them; do not hand-edit them.

## Working Rules

- Keep edits scoped and minimal.
- Multiple agents may be working in parallel. Do not revert unrelated changes.
- Assume the dev server may already be running. Do not start `npm run dev` unless the user asks or the task clearly requires it.
- Keep the repo single-package unless there is a concrete technical need to change that.
- Prefer explicit code over clever code. Small duplication is acceptable when it keeps session or auth behavior obvious.
- Preserve the split between `src/client`, `src/worker`, and `src/shared`. If both client and worker do not need a type or helper, it probably does not belong in `src/shared`.
- Prefer direct use of existing `@cloudflare/sandbox` APIs. Do not add another abstraction layer unless the repo has a concrete gap.
- Avoid extra control-plane infrastructure. The Sandbox class is already the Durable Object; add more coordination only when there is a clear need.
- Keep the PTY byte path simple. Do not insert avoidable middleware or transform layers between terminal I/O and `proxyTerminal`.
- For Cloudflare runtime or Sandbox behavior that may have changed, prefer current official Cloudflare docs over memory.

## Important Invariants

- The client should identify sandboxes by `workspace`, not raw sandbox IDs. The worker derives `sandboxId = ${userId}-${workspace}` after authentication.
- One sandbox exists per user and workspace. One backend session exists per logical in-app terminal tab.
- Refresh persistence is per browser tab or window via `sessionStorage`. The persisted model is the tab collection plus active tab, not a single global session ID.
- Closing a UI tab detaches from the backend session by default. Do not silently delete sessions unless the UI explicitly says it will.
- Creating a new tab or choosing "New Session" must use explicit session creation semantics. Do not rely on implicit session auto-creation for intended `cwd`, environment, or labels.
- Sandbox sessions may be silently created with defaults when referenced. Reattaching to a session ID is not proof that the expected shell state still exists.
- Terminal WebSocket behavior is fixed: incoming binary frames are PTY output, incoming text frames are JSON control and status, outgoing binary frames are UTF-8 keystrokes, outgoing text frames are resize messages, and buffered PTY replay may arrive before `ready`.
- `ghostty-web` should be initialized once at app startup. Reconnect flows should clear terminal state before replay to avoid duplicate output.
- Control-key handling is custom in the terminal adapter path to work around `ghostty-web` encoder issues. Preserve that behavior when changing input handling.
- `cwd` for created sessions must stay under `/workspace`.
- Session env vars are sanitized server-side. Labels returned by the session API are client metadata only; the Sandbox SDK does not persist them.
- Dev auth is intentionally localhost-only when Access is not configured. Non-local hosts must reject requests until Access is configured.
- Containers are ephemeral. Without backup and restore or mounted object storage, files, processes, sessions, and shell state disappear on restart or idle eviction.

## Validation

- `npm run typecheck` for most changes. This regenerates `worker-configuration.d.ts`.
- `npm test` for unit and worker route coverage.
- `npm run build` when changing bundling, routes, runtime bindings, or container wiring.
- `npm run types:generate` after changing `wrangler.jsonc` or `.dev.vars.example`.
- Use `test/MANUAL_TEST_CHECKLIST.md` for reconnect, multi-tab, shared-session, resize, paste, and interactive TUI regression checks.
- Manual verification is still expected for alternate-screen apps, network interruption recovery, container restart detection, and Cloudflare Access flows.

## Quick References

- Product overview and setup: `README.md`
- Product and architecture intent: `docs/SPEC.md`
- App shell and workspace UI: `src/client/App.tsx`, `src/client/components/TerminalWorkspace.tsx`, `src/client/components/TabStrip.tsx`, `src/client/components/SessionControls.tsx`
- Terminal integration: `src/client/terminal/adapter.ts`, `src/client/terminal/socket.ts`, `src/client/terminal/useSharedSessionDetection.ts`
- Tab and session persistence: `src/client/workspace/store.ts`, `src/client/workspace/types.ts`
- Worker routes and lifecycle APIs: `src/worker/index.ts`
- Auth and sandbox ownership: `src/worker/auth.ts`
- Shared protocol types: `src/shared/protocol.ts`
- Container bootstrap: `container/Dockerfile`, `container/container-shell.sh`, `container/root.zshrc`
- Tests and manual checklist: `test/`
