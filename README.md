# ccccocc — Codex CLI / Claude Code on Cloudflare Containers

`ccccocc` is a browser terminal for running Codex CLI and Claude Code inside Cloudflare Containers via Sandbox SDK. The frontend uses `ghostty-web` and attaches directly to the Sandbox terminal WebSocket, so there is no SSH bridge or extra proxy layer.

See also:

- [docs/SPEC.md](docs/SPEC.md) for product and architecture intent
- [AGENTS.md](AGENTS.md) for repository working guidelines

## Highlights

- Direct PTY attach over Cloudflare's native Sandbox terminal WebSocket protocol
- One sandbox per authenticated user and workspace, with one shell session per logical terminal tab
- Multi-tab terminal workspace with refresh persistence and reconnect-to-the-same-session behavior
- Shared-session detection when the same backend session is open in multiple browser windows
- Backup and restore endpoints for `/workspace`, with optional durable mounts via Cloudflare storage
- Preinstalled terminal tooling for agent workflows, including Codex CLI, Claude Code, `vim`, and terminal `emacs`
- Cloudflare Access auth in production and localhost-only dev mode when Access is unset

## Architecture

- `src/client/` is the React frontend. `TerminalWorkspace` owns logical tabs, and `TerminalPane` renders the active `ghostty-web` terminal.
- `src/client/workspace/store.ts` persists the logical tab model in `sessionStorage`, including stable UI tab IDs, backend session IDs, and the active tab.
- `src/worker/index.ts` authenticates requests, derives the owned sandbox ID from user identity and workspace, proxies terminal attach, and exposes session, backup, restore, and destroy APIs.
- `container/` defines the Sandbox image, bundled terminal tooling, and shell bootstrap used for interactive sessions.

## Runtime model

- A sandbox is the container for one user and workspace.
- A session is a shell inside that sandbox.
- A logical terminal tab is a stable UI tab bound to a stable session ID.
- Refreshing the page restores the tab model and reconnects each tab to its session.
- Closing a UI tab detaches from the session by default; it does not destroy the backend session.
- Container restarts are destructive unless data is explicitly backed up or mounted.

## Authentication

- Access mode: set `CF_ACCESS_AUD` and `CF_ACCESS_TEAM` to require `Cf-Access-Jwt-Assertion` and scope sandboxes to the authenticated user.
- Dev mode: when both vars are unset, requests are allowed only on `localhost`, `127.0.0.1`, or `::1` and run as a synthetic `dev-user`.
- Authorization: the client passes `workspace`; the worker derives the actual sandbox ID server-side, preventing cross-user sandbox access.

## Local development

```bash
npm install
npm run dev
npm test
npm run typecheck
```

Notes:

- Copy `.dev.vars.example` to `.dev.vars` when you need local secrets.
- `npm run typecheck` regenerates `worker-configuration.d.ts` from `wrangler.jsonc` and `.dev.vars.example`.
- Manual terminal verification scenarios live in `test/MANUAL_TEST_CHECKLIST.md`.

## Deployment

```bash
npm run deploy
wrangler secret put CF_ACCESS_AUD
wrangler secret put CF_ACCESS_TEAM
```

Notes:

- Production should run with Cloudflare Access enabled.
- `/workspace` is not durable by default. Use backup and restore or mount object storage if you need persistence across container restarts.
- If you test Access locally, expose the app through an Access-protected hostname, for example with `cloudflared tunnel`.

## API surface

| Method | Path                                           | Auth | Description                             |
| ------ | ---------------------------------------------- | ---- | --------------------------------------- |
| GET    | `/ws/terminal?workspace=&session=&cols=&rows=` | Yes  | WebSocket terminal attach               |
| POST   | `/api/sessions?workspace=`                     | Yes  | Create session `{id, cwd, env, labels}` |
| DELETE | `/api/sessions?workspace=&session=`            | Yes  | Delete session                          |
| DELETE | `/api/sandbox?workspace=`                      | Yes  | Destroy sandbox                         |
| POST   | `/api/workspace/backup?workspace=`             | Yes  | Create backup `{dir, name}`             |
| POST   | `/api/workspace/restore?workspace=`            | Yes  | Restore backup `{id, dir}`              |
| GET    | `/api/health`                                  | No   | Health check                            |

## Project layout

- `src/client/` React UI, terminal integration, and workspace state
- `src/worker/` Worker routes, auth, terminal proxy, and lifecycle APIs
- `src/shared/` shared protocol types for client and worker
- `container/` Sandbox image and shell startup
- `docs/SPEC.md` product and architecture intent
- `test/` unit tests, worker route tests, and the manual verification checklist

## Verification

- `npm test` covers terminal protocol, adapter, workspace store, shared-session detection, and worker routes.
- `npm run build` validates the frontend bundle and Worker packaging before release.
- `test/MANUAL_TEST_CHECKLIST.md` covers reconnect, multi-tab, shared-attach, resize, paste, and interactive terminal behavior that still needs manual confirmation.
