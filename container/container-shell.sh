#!/usr/bin/env bash
set -euo pipefail

# Sandbox sessions currently expose a terminal device without a controlling
# TTY/process group. Running the user shell inside `script(1)` allocates a
# nested PTY so Ctrl+C/Ctrl+D and job control work as expected.
exec /usr/bin/script -qefc "/usr/bin/zsh -i" /dev/null
