FROM docker.io/cloudflare/sandbox:0.8.9

# Install shell/tooling packages, then Node.js for Claude Code and Codex CLI.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    curl \
    emacs-nox \
    git \
    gnupg \
    vim-nox \
    wget \
    zsh \
    zsh-autosuggestions \
    zsh-syntax-highlighting \
  # Install GitHub CLI (gh) from official GitHub repository
  && mkdir -p -m 755 /etc/apt/keyrings \
  && wget -nv -O /etc/apt/keyrings/githubcli-archive-keyring.gpg https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh \
  # Install Node.js
  && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

# Install Claude Code, Codex CLI, and OpenCode CLI
RUN npm i -g @anthropic-ai/claude-code @openai/codex opencode-ai

COPY container-shell.sh /usr/local/bin/ccccocc-shell
COPY root.zshrc /root/.zshrc
COPY xdg-open /usr/local/bin/xdg-open
COPY gh-wrapper /usr/local/bin/gh-wrapper
RUN chmod 0755 /usr/local/bin/ccccocc-shell /usr/local/bin/xdg-open /usr/local/bin/gh-wrapper

# Set environment for GitHub CLI browser opening and use the wrapper for better UX
ENV GH_BROWSER=/usr/local/bin/xdg-open
ENV BROWSER=/usr/local/bin/xdg-open

WORKDIR /workspace
