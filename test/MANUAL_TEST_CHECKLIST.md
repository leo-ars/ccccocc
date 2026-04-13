# Manual Test Checklist

Run through these scenarios after deploying or during local development.

## Connection

- [ ] Open the app — terminal connects, shows the startup tooling banner, and reaches a shell prompt
- [x] Connection state indicator shows green "Connected"
- [x] Type `echo hello` and press Enter — output appears correctly
- [x] Check browser console — no errors during initial connection
- [ ] Banner lists bundled tools such as `claude`, `codex`, `vim`, and `emacs`

## Control codes

- [ ] Run `cat` (or `sleep 999`) and press Ctrl+C — process is interrupted
- [ ] Run `cat` and press Ctrl+D — sends EOF, cat exits
- [ ] Press Ctrl+Z in a foreground process — process is suspended
- [ ] Press Ctrl+A, Ctrl+E in a shell — cursor moves to start/end of line
- [ ] Press Ctrl+L — clears the terminal screen
- [ ] Select text in terminal, then Ctrl+C — copies to clipboard (does NOT send SIGINT)

## Multiple terminal tabs

- [x] Click "+" to create a second tab — new tab appears in tab strip, new session ID
- [ ] Click "+" again for a third tab — "Terminal 3" title, unique session ID
- [x] In tab 1: `export FOO=tab1 && cd /tmp`
- [x] Switch to tab 2: `echo $FOO && pwd` — FOO is empty, cwd is `/workspace`
- [x] Switch back to tab 1: `echo $FOO && pwd` — FOO=tab1, cwd=/tmp (session preserved)
- [x] Each tab shows its own connection state dot in the tab strip
- [x] Active tab is visually highlighted

## Tab persistence on refresh

- [x] Create 2 tabs, note their session IDs from the session bar
- [x] Run a command in each tab (e.g., `export MARKER=tabN`)
- [x] Refresh the browser (F5 / Ctrl+R)
- [x] Both tabs are restored in the tab strip with the same session IDs
- [x] Switch between tabs — each resumes its PTY (shell state preserved)
- [ ] Message shows "[Resumed existing PTY session]"

## Close tab

- [ ] Create 3 tabs
- [x] Close the middle tab via the X button
- [x] Tab is removed from the strip — neighbor tab becomes active
- [x] The closed tab's backend session is NOT destroyed (could reconnect via API)
- [ ] Close all tabs — a fresh default tab is created automatically
- [x] Close button tooltip says "Detach tab (session stays alive)"

## Reconnect — browser refresh

- [x] Note the session ID from the session bar
- [x] Refresh the browser
- [x] The terminal reconnects to the **same** session (PTY buffer replayed)
- [x] Previous shell state (working directory, variables) is preserved
- [x] No duplicate output lines from the replay
- [ ] Message shows "[Resumed existing PTY session]"
- [x] Indicator transitions: Connecting -> Connected

## Reconnect — brief network interruption

- [ ] Simulate network drop (DevTools -> Network -> Offline, wait 3s, re-enable)
- [ ] Indicator transitions: Reconnecting -> Connected
- [ ] Terminal resumes without creating a new shell
- [ ] No duplicate or garbled output after reconnect
- [ ] Message shows "[Resumed existing PTY session]"

## Reconnect — explicit button

- [ ] Click the "Reconnect" button in the session bar
- [ ] Terminal briefly clears and re-renders with server-replayed output
- [ ] Same session ID is shown

## Container restart detection

- [ ] Leave the terminal idle longer than `sleepAfter` (default 10m)
- [ ] Interact with the terminal after idle
- [ ] If container restarted: yellow warning "[Container restarted — previous state is gone unless persisted]"
- [ ] Shell comes back in a clean state (fresh `/workspace`)

## New Session

- [ ] Click "New Session"
- [ ] A new session ID appears in the session bar
- [ ] Terminal shows a fresh shell prompt (new cwd, no history)
- [ ] Previous session is not destroyed (could reconnect to it via code)

## Shared attach warning

- [ ] Open the app in two browser windows (not tabs within the app)
- [ ] In window 2, ensure the same session ID is active (e.g., duplicate the browser tab)
- [ ] Verify orange "Shared session" banner appears in both windows
- [ ] Type in one window — output appears in both
- [ ] Close one browser window — banner disappears in the remaining window
- [ ] Click "New Session" in one window — banner disappears (different sessions now)

## Resize

- [ ] Resize browser window — terminal reflows correctly
- [ ] Drag DevTools panel to resize — terminal adjusts
- [ ] Run `tput cols && tput lines` — values match the visible terminal
- [ ] Rapidly resize — no error storms in console (debounced)

## Paste

- [ ] Copy a multiline string and paste into the terminal
- [ ] Characters appear correctly (no double-paste, no encoding issues)
- [ ] Ctrl+V and right-click paste both work

## Session isolation

- [x] Open two "New Session" tabs
- [x] In session A: `export FOO=bar && cd /tmp`
- [x] In session B: `echo $FOO && pwd`
- [x] Verify `$FOO` is empty and cwd is `/workspace` in session B

## Sandbox idle / restart

- [ ] Leave the terminal idle longer than `sleepAfter` (default 10m)
- [ ] Interact with the terminal after idle
- [ ] Verify a clear message indicates state was lost (container restarted)
- [ ] Shell comes back in a clean state

## Persistence (backup / restore)

- [ ] Write a file in `/workspace`: `echo "test" > /workspace/myfile.txt`
- [ ] Call backup API: `curl -X POST /api/workspace/backup?workspace=default`
- [ ] Note the returned backup `id`
- [ ] Let sandbox idle out or destroy it: `curl -X DELETE /api/sandbox?workspace=default`
- [ ] Restore: `curl -X POST /api/workspace/restore?workspace=default -d '{"id":"<backup-id>"}'`
- [ ] Verify the file survives: `cat /workspace/myfile.txt`

## Full-screen interactive tools

- [ ] Run `vim` or `emacs` — alternate screen renders correctly
- [ ] Resize the window while in the editor — no rendering glitches
- [ ] Exit the editor — normal scrollback is restored
- [ ] Run `top` or `htop` — live-updating TUI renders properly
- [ ] Run Claude Code (if installed) — interactive UI works
- [ ] Run Codex CLI (if installed) — interactive UI works
- [ ] Arrow keys, Ctrl+C, Ctrl+D behave correctly in all tools

## Auth — dev mode (no Access configured)

- [x] Open the app without any credentials — terminal connects (dev mode)
- [x] Workspace label shows "default"
- [ ] Sandbox ID is derived from "dev-user" identity

## Auth — Cloudflare Access (CF_ACCESS_AUD + CF_ACCESS_TEAM set)

- [ ] Configure Cloudflare Access on the app hostname
- [ ] Set `CF_ACCESS_AUD` and `CF_ACCESS_TEAM` secrets
- [ ] Access the app through the Access-protected hostname — login flow works
- [ ] Terminal connects after Access authentication
- [ ] Sandbox is scoped to the authenticated user (check derived sandbox ID)
- [ ] A different user gets a different sandbox (isolated workspaces)

## Authorization

- [ ] Two different authenticated users cannot access each other's sandboxes
- [ ] The `?workspace=` param creates separate sandboxes for the same user
- [ ] The `?id=` param is ignored (sandbox derived from user identity)

## Error states

- [ ] Connect to a non-existent workspace — meaningful error or fresh sandbox created
- [ ] Kill the container process — exit status displayed in terminal
- [ ] Server sends an error frame — state indicator shows "Error"
- [ ] Invalid JSON body to session creation — 400 error returned
- [ ] cwd outside /workspace — 400 error returned
