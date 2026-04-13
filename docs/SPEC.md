# ccccocc — Codex CLI/Claude Code on Cloudflare Containers

## Overview

Implement **ccccocc**, a focused web app for running **Codex CLI** and **Claude Code** on **Cloudflare Containers**.

The product framing can say **Cloudflare Containers**, but the implementation should target **Sandbox SDK**. Treat Containers as the underlying platform that powers Sandbox SDK, not the primary interface the app should program against.

The implementation should ship as a production-grade browser terminal with:

- **React + TypeScript** on the frontend
- **Cloudflare Workers + Sandbox SDK** on the backend
- **`ghostty-web`** as the browser terminal
- Cloudflare's native Sandbox terminal WebSocket path for PTY transport

Do **not** build an SSH bridge. Connect directly to Cloudflare Sandbox terminal WebSockets.

## Product Intent

The product should feel like a minimal, practical interface for running **Codex CLI** and **Claude Code** on Cloudflare Containers. Internally, it should rely on **Sandbox SDK**, not a hand-rolled container orchestration layer.

Keep the implementation centered on:

- launching or attaching to the correct container and session
- running agentic terminal tools reliably
- reconnecting safely
- preserving state where intended
- surfacing session and container lifecycle clearly

Use the shorthand name **ccccocc** where helpful, but do not let branding drive unnecessary architecture.

## Scope and Non-Goals

Keep the implementation simple and single-project.

Default structural expectations:

- one repository
- one main app
- one package unless there is a compelling reason otherwise
- frontend and Worker code in the same project tree
- no internal packages created only for neatness
- no extra apps, shared libraries, or workspace tooling unless there is a real need

Do **not** introduce a pnpm monorepo, Turborepo, Nx workspace, or multi-package architecture unless the existing repository already uses one or there is a clearly justified technical need.

The following are out of scope unless explicitly requested:

- a full IDE or browser code editor
- a general-purpose terminal hosting platform
- SSH gateway infrastructure
- custom container orchestration abstractions that duplicate Sandbox SDK
- a multi-package or monorepo platform skeleton
- a rich file browser, editor pane, or project management UI
- collaborative terminal features beyond basic shared-attach handling and warnings
- automatic multi-agent orchestration beyond creating isolated sessions for separate runs

For the initial UI, one browser tab or window may host multiple logical terminal tabs, but only one active terminal surface needs to be visible at a time. Split panes and platform-style chrome are not required.

## Platform Abstraction Boundary

Use **Sandbox SDK** as the primary backend abstraction.

Implementation rules:

- treat **Sandbox SDK** as the default and preferred interface for terminal attach, sessions, exec, lifecycle, and filesystem-related workflows that it already supports
- do **not** build a custom shim or protocol for manipulating the container when **Sandbox SDK** already provides the needed capability
- do **not** target raw Containers primitives first and then recreate Sandbox-like semantics in application code
- do **not** add avoidable abstraction layers between the app and Sandbox SDK
- only drop to lower-level or raw Containers behavior if Sandbox SDK cannot satisfy a concrete requirement
- if a lower-level escape hatch is needed, keep it narrow, explicitly justified, and isolated

The intended stack is:

- product framing: **Cloudflare Containers**
- implementation API: **Sandbox SDK**
- terminal transport: Cloudflare's native terminal WebSocket path exposed by Sandbox SDK

Do **not** invent a custom protocol or control plane for:

- PTY attach
- shell session semantics
- container exec semantics
- container lifecycle manipulation
- reconnection behavior already supported by Sandbox SDK

unless there is a documented gap that requires it.

## Core Architecture

Build the smallest clean architecture that can ship:

1. A React terminal workspace UI that supports **multiple logical in-app terminal tabs within a single browser tab or window**.
2. A `TerminalPane` backed by `ghostty-web` for the **currently active logical terminal tab**.
3. A Worker route for terminal attach, for example `/ws/terminal?id=<sandboxId>&session=<optionalSessionId>`, that upgrades to WebSocket and proxies to the sandbox PTY.
4. Optional Durable Object control-plane code only where it adds value, such as auth or session ownership, connection bookkeeping, or collaborative attach policy.

Additional architectural constraints:

- treat raw `sandboxId` and `session` values as internal implementation details, not trusted user input
- prefer resolving the target sandbox or session from an authorized workspace, task, or app-level record where practical
- if raw IDs are accepted, the Worker must verify that the authenticated user is allowed to attach before opening the terminal
- prefer **no Durable Object by default** unless there is a clear coordination or hibernation need
- do **not** introduce a Durable Object just because WebSockets are involved
- do **not** put unnecessary middleware in the PTY byte path
- use Cloudflare's **direct terminal WebSocket protocol**, not the xterm-specific `SandboxAddon`

## Terminal Protocol

The client must:

- set `ws.binaryType = "arraybuffer"` **before** connecting
- treat incoming **binary** frames as terminal output that may contain ANSI and VT sequences
- treat incoming **text** frames as JSON status or control messages
- accept that the server may replay buffered terminal output **before** a `ready` message arrives
- send keystrokes to the server as **binary UTF-8**
- send resize events as **JSON text** in this shape:

```json
{ "type": "resize", "cols": 120, "rows": 40 }
```

The PTY survives client disconnects, and reconnecting should reattach to the **same** session instead of silently creating a fresh shell.

## Session Model

Use sessions deliberately.

Terminology:

- a **sandbox** is the container
- a **session** is the shell context inside the sandbox
- a **browser tab or window** is a client view onto app state
- an **in-app terminal tab** is a logical terminal slot in the product UI

Each session has its own:

- working directory
- environment
- shell state
- history

The canonical ownership model is **logical terminal tab -> session**, not **browser tab -> session**.

The preferred session strategy is:

- **one sandbox per user or workspace**
- **one session per logical in-app terminal tab, task, or agent**
- **multiple logical terminal tabs may exist inside one browser tab or window, each with its own distinct session**

Session behavior must follow these rules:

- refreshing the page, reconnecting the socket, or reopening the same browser tab or window should usually restore the same **set of logical terminal tabs** and reattach each one to its intended session
- creating a **new** in-app terminal tab, starting a separate Claude or Codex run, or choosing **New terminal tab / New session** should create a **new** session
- switching between logical terminal tabs should switch between existing sessions, not generate new ones
- opening the same session from a second browser tab or window should be treated as an intentional **shared attach** case, not as a reason to silently create another session
- do **not** assume that an existing session still has the expected `cwd` or environment, because missing session IDs may be auto-created with defaults

Multiple browser clients can attach to the **same** session and all send input. Treat that as a feature only when intentional. Otherwise:

- prevent accidental multi-attach to a single interactive agent terminal, or
- clearly surface shared-session mode in the UI

Session creation must be explicit and configurable. Do not rely on implicit defaults. At minimum, allow configuration of:

- `cwd`
- environment variables
- labels such as `agent`, `task`, and `createdAt`

If browser storage is used for refresh persistence, persist the **logical tab model**, not a single global `sessionId`. The stored model should include:

- a collection of logical tab records
- a stable UI tab ID for each logical tab
- a stable backend session ID for each logical tab
- the active logical tab ID

For the initial implementation, per-window browser storage is acceptable, but it must store **multiple logical tabs and multiple session IDs**, not a singleton session.

## Frontend Requirements

Implement a minimal terminal workspace UI composed of:

- a `TerminalWorkspace` container that manages **multiple logical in-app terminal tabs within one browser tab or window**
- a `TerminalPane` terminal view for the **currently active logical terminal tab**

### TerminalWorkspace

`TerminalWorkspace` should:

- maintain a collection of logical terminal tabs
- assign each logical terminal tab a stable UI tab ID and stable backend session ID
- store display metadata such as title, label, agent, or task when useful
- maintain the active logical terminal tab ID
- support creating a new logical terminal tab
- support switching between logical terminal tabs
- support closing a logical terminal tab with **explicit documented semantics**
- persist the logical tab model across refresh within the same browser tab or window

Closing a UI tab must **not** silently destroy the backend session unless the UI explicitly says that is what close means.

Avoid modeling the app as **one browser tab or window -> one session**.

### TerminalPane

`TerminalPane` should:

- mount a `ghostty-web` terminal into a real DOM container
- compute terminal dimensions from the rendered element
- send an initial resize only after the socket is usable
- forward user input from the terminal to the socket as binary UTF-8
- write incoming binary output directly into the terminal
- debounce resize handling
- support copy, paste, selection, and focus management
- show clear connection states: `connecting`, `connected`, `reconnecting`, `ended`, and `error`
- support reconnect-to-same-session without remount glitches
- never double-bind keyboard handlers across React re-renders
- dispose all event listeners, sockets, and terminal resources on unmount

Frontend design constraints:

- one active terminal pane at a time is sufficient for the initial implementation
- isolate the terminal adapter behind a small interface so `ghostty-web` can be swapped later
- do not entangle terminal rendering with session or business logic
- keep CSS simple and let the terminal fill its parent container
- prefer explicit cleanup over relying on garbage collection

## Authentication and Authorization

Use **Cloudflare Access** as the primary authentication system for **ccccocc**.

Authentication and authorization are separate concerns:

- Cloudflare Access proves identity
- the app enforces workspace, sandbox, and session ownership

- protect the app and terminal routes with Cloudflare Access on deployed or tunneled hostnames
- have the Worker validate the Access JWT and derive user identity from verified claims
- do **not** build a parallel username and password auth system unless explicitly required
- do **not** trust identity-related headers unless they come from the expected deployment path and the JWT has been validated

Keep the auth boundary simple:

- Access at the edge
- Worker verifies identity
- app enforces authorization and ownership

### Local Development and Testing

Plain localhost should not be treated as a full simulation of Cloudflare Access edge behavior.

For local development:

- allow an explicit **dev-only auth mode** or mocked verified identity for fast iteration
- gate that dev-only auth mode tightly to local development and disable it in deployed environments
- treat dev-only auth mode as a **localhost-only developer convenience**, not part of the real auth path
- when testing real Cloudflare Access through a tunnel or staging hostname, ensure the dev-only auth mode is **off**
- use **Cloudflare Tunnel + Access** on a development hostname, or a deployed staging hostname protected by Access, for real end-to-end auth testing
- document both flows clearly: fast local app development without full Access edge enforcement, and real end-to-end Access testing through Cloudflare
- do **not** leave a local auth bypass enabled in production

## Backend Requirements

Use **Sandbox SDK** directly in the Worker or backend code wherever it already covers the required behavior.

Do **not** spend time building custom container-control shims, raw protocol wrappers, or alternative terminal and session orchestration paths if Sandbox SDK already provides the needed API.

The Worker terminal handler should:

- validate **Cloudflare Access identity** and workspace or session ownership before opening a terminal
- extract authenticated user identity from verified Access claims
- when `session` is present, resolve the session and call `session.terminal(request)`
- otherwise call `sandbox.terminal(request, { cols, rows })`
- keep the route narrow: authenticate, authorize, normalize params, proxy the upgrade, and return structured errors
- avoid proxying through extra WebSocket hops unless there is a concrete need

Runtime and SDK configuration:

- use TypeScript throughout
- set `SANDBOX_TRANSPORT = "websocket"` unless there is a strong reason not to

## Lifecycle and Persistence

Handle lifecycle explicitly.

Sandbox state persists only while the container is active. When the sandbox goes idle and stops:

- files are lost unless persisted elsewhere
- processes are gone
- shell state is gone
- code context is gone

Default idle time is short-lived, and `sleepAfter` is configurable.

If using `keepAlive: true`:

- treat it as an explicit operational choice
- do not allow sandboxes to run indefinitely without cleanup
- implement destruction or expiration paths when they are no longer needed

Do **not** pretend `/workspace` is durable.

Add an explicit persistence strategy, preferably mounted object storage, for:

- repositories
- generated files
- checkpoints
- artifacts that must survive sandbox restarts

## Durable Object Guidance

Durable Objects are optional. If they are used for coordination or collaborative attach:

- use the **WebSocket Hibernation API**
- do not use standard WebSocket handling if hibernation is expected
- keep constructor work minimal
- assume in-memory state is lost on wake
- persist any per-connection metadata needed for recovery

Do **not** put the PTY byte stream behind unnecessary Durable Object logic.

## Security Requirements

Use **Cloudflare Access** as the authentication layer for the app and terminal routes.

Security rules:

- never let an untrusted caller choose arbitrary sandbox IDs or session IDs without authorization checks
- validate workspace ownership and session ownership before attach
- validate Access identity before attach
- avoid exposing terminal routes without proper Access protection
- do not trust spoofed identity headers from non-Access contexts

Do **not** leak real credentials into the sandbox terminal environment unless that is a deliberate, reviewed decision.

When sandboxed code needs to reach external APIs:

- prefer a Worker-side proxy pattern
- keep real secrets in the Worker
- inject short-lived credentials only where absolutely needed

## UX Requirements

The UI should make session state visible and intentional.

Required UX elements:

- a visible logical terminal tab strip or equivalent tab list
- a visible banner for shared-session mode
- an explicit **New terminal tab / New session** action that creates a **new shell session**, not just a reconnect
- explicit support for switching between logical terminal tabs, where switching activates the existing session for that tab
- an explicit **Reconnect current tab / current session** action that attempts to reattach to the **existing intended session** for the active logical tab
- explicit handling for closing a logical terminal tab, with UI copy that makes it clear whether close means **detach UI only** or **terminate or reset the backend session**
- clear messaging for `connecting`, `reconnecting`, `ended`, and `error`
- clear indication when a reconnect resumed an existing PTY versus when a brand-new shell was created

## Edge Cases and Hazards

The implementation must explicitly handle all of the following.

### Protocol and Connection

- **Buffered output before ready**: do not drop or reorder early binary frames.
- **Binary vs text frame confusion**: never treat terminal bytes as JSON or vice versa.
- **Reconnect duplication**: reconnect should not append duplicate client-side buffered text when the server is already replaying PTY output.
- **Half-open reconnect loops**: if the network flakes, avoid stacking duplicate sockets or duplicate reconnect timers.

### Resize and Rendering

- **0x0 or stale resize**: never send invalid terminal dimensions.
- **Resize storms**: debounce and clamp values to positive integers.
- **Initial layout race**: do not compute cols or rows before the container has measurable size.
- **Font/load jitter**: terminal sizing can drift if measured before fonts are ready.

### Session Correctness

- **Session auto-creation trap**: a deleted or missing session ID may silently come back with default `cwd` or environment.
- **Wrong-session reconnect**: reconnect must target the same intended session unless the user explicitly asks for a new one.
- **Single-global-session bug**: do **not** store or derive only one global `sessionId` for the entire browser tab or window if the UI supports multiple logical terminal tabs.
- **Tab model loss on refresh**: refreshing the browser tab or window should restore the logical tab model and its per-tab session bindings, not collapse everything into one fresh session.
- **Shared attach hazard**: two browser tabs can type into the same shell at once.
- **Close-tab ambiguity**: closing a UI tab must not implicitly destroy the backend session unless that behavior is explicit in both UI and implementation.
- **Agent collision**: Claude Code and Codex CLI should not accidentally share one interactive shell unless explicitly intended.

### Sandbox Lifecycle

- **Container restart**: if the sandbox idles out or restarts, surface a clear message that old process and shell state are gone unless persisted.
- **Long-running setup commands**: if setup uses `exec()` and it times out, remember the process may still continue server-side.
- **keepAlive leaks**: long-lived sandboxes must eventually be cleaned up.

### React and Browser Behavior

- **Double event binding**: do not register `onData` or keyboard handlers multiple times across re-renders.
- **Unmount leaks**: do not leave orphaned sockets, intervals, resize observers, or terminal instances.
- **Paste and key handling**: preserve raw input behavior expected by terminal UIs.
- **Alternate screen and full-screen TUIs**: tools like Claude Code and Codex CLI must behave correctly enough for resize, raw keys, scrollback, and full-screen switching.

### Security

- **Unauthorized attach**: never trust query params alone.
- **Secret spillage**: do not blindly inject repo tokens, API keys, or credentials into the terminal environment.
- **Excessive privilege**: sandbox and session access should be scoped to the owning workspace or user.

## Testing Requirements

### Unit Tests

Add unit tests for the terminal WebSocket protocol adapter covering:

- binary output handling
- JSON control and status handling
- ready, exit, and error states
- reconnect logic
- resize serialization
- input encoding as binary UTF-8

### Integration Tests

Add integration tests for the Worker route with mocked:

- verified Cloudflare Access identity
- rejected or invalid Access identity
- authorization behavior
- Sandbox SDK objects
- sandbox lookup
- session lookup
- terminal upgrade and proxy behavior

### Manual Test Checklist

Add at least one manual checklist covering:

- local development with dev-only auth mode
- real end-to-end auth testing via Cloudflare Tunnel + Access
- initial connect
- creating multiple logical terminal tabs in one browser tab or window
- switching between logical terminal tabs and confirming each keeps its own session state
- reconnect after browser refresh and restoration of the logical tab model
- reconnect after brief network interruption
- shared attach warning
- resize behavior
- paste behavior
- session isolation
- sandbox idle or restart behavior
- persistence via mounted storage
- running full-screen interactive tools such as Claude Code or Codex CLI

## Implementation Workflow

The main implementing agent may and should use sub-agents when that improves speed, coverage, or quality.

Useful delegation targets include:

- researching `ghostty-web` integration details
- researching Cloudflare Sandbox terminal and session behavior
- implementing the frontend terminal adapter
- implementing the Worker terminal route
- designing reconnect state handling
- writing unit and integration tests
- reviewing security hazards and lifecycle edge cases

Delegation rules:

- the **main agent remains responsible** for final architecture, integration, and correctness
- do **not** let sub-agents make incompatible assumptions without reconciliation
- use sub-agents to explore alternatives, but have the main agent choose the final design
- use sub-agents for targeted code changes, but have the main agent review and integrate them
- use sub-agents to generate tests and edge-case checklists, then validate them centrally
- avoid unnecessary delegation for trivial changes or tiny edits
- when sub-agents disagree, the main agent must explicitly resolve the conflict and document the reasoning

A reasonable delegation plan is:

1. Validate `ghostty-web` integration details and any compatibility gaps.
2. Validate Cloudflare Sandbox terminal and session lifecycle semantics, including reconnect behavior.
3. Implement frontend terminal integration.
4. Implement backend terminal routing and auth checks.
5. Design or implement tests.
6. Integrate, reconcile, review, and polish the final result.

Sub-agents are not authoritative on their own. The main agent must ensure the shipped implementation is coherent end to end.

## Deliverables

Provide all of the following:

1. Working code, not just a design document.
2. A short README section explaining architecture, lifecycle assumptions, and cleanup.
3. A list of changed files.
4. A short note calling out any unresolved `ghostty-web` compatibility gaps versus the xterm-oriented Cloudflare examples.

## Implementation Preferences

Implementation choices should favor:

- minimal, practical design
- clarity over framework cleverness
- a replaceable terminal adapter
- the most direct PTY path possible
- correctness under reconnects and long-running agent sessions

## Final Implementation Summary

When the implementation is complete, the final summary should cover:

- the architecture chosen
- why `ghostty-web` was used
- how reconnect and lifecycle are handled
- what remains risky in production
