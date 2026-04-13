FROM docker.io/cloudflare/sandbox:0.8.9

# Install shell/tooling packages, then Node.js for Claude Code and Codex CLI.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    curl \
    emacs-nox \
    git \
    vim-nox \
    zsh \
    zsh-autosuggestions \
    zsh-syntax-highlighting \
  && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

# Install Claude Code and Codex CLI
RUN npm i -g @anthropic-ai/claude-code @openai/codex

COPY container-shell.sh /usr/local/bin/ccccocc-shell
COPY root.zshrc /root/.zshrc
RUN chmod 0755 /usr/local/bin/ccccocc-shell

WORKDIR /workspace
