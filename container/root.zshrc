autoload -Uz colors compinit vcs_info

colors

mkdir -p ~/.cache/zsh
compinit -d ~/.cache/zsh/zcompdump

setopt AUTO_CD
setopt AUTO_MENU
setopt COMPLETE_IN_WORD
setopt HIST_IGNORE_ALL_DUPS
setopt HIST_IGNORE_SPACE
setopt HIST_REDUCE_BLANKS
setopt INTERACTIVE_COMMENTS
setopt PROMPT_SUBST
setopt SHARE_HISTORY

HISTFILE=~/.zsh_history
HISTSIZE=10000
SAVEHIST=10000

zstyle ':completion:*' menu select
zstyle ':completion:*' matcher-list 'm:{a-z}={A-Z}'
zstyle ':vcs_info:*' enable git
zstyle ':vcs_info:git:*' check-for-changes true
zstyle ':vcs_info:git:*' stagedstr '+'
zstyle ':vcs_info:git:*' unstagedstr '*'
zstyle ':vcs_info:git:*' formats ' %F{244}[%b%c%u]%f'
zstyle ':vcs_info:git:*' actionformats ' %F{244}[%b|%a%c%u]%f'

precmd() {
  vcs_info
}

if [ -r /usr/share/zsh-autosuggestions/zsh-autosuggestions.zsh ]; then
  source /usr/share/zsh-autosuggestions/zsh-autosuggestions.zsh
fi

if [ -r /usr/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh ]; then
  source /usr/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh
fi

bindkey '^[[A' history-beginning-search-backward
bindkey '^[[B' history-beginning-search-forward

export SHELL=/usr/bin/zsh

ccccocc_print_startup_banner() {
  local -a agents editors tooling
  local cmd

  for cmd in claude codex; do
    if command -v "$cmd" >/dev/null 2>&1; then
      agents+=("$cmd")
    fi
  done

  for cmd in vim emacs; do
    if command -v "$cmd" >/dev/null 2>&1; then
      editors+=("$cmd")
    fi
  done

  for cmd in git node npm curl; do
    if command -v "$cmd" >/dev/null 2>&1; then
      tooling+=("$cmd")
    fi
  done

  print -P "%F{81}ccccocc%f %F{244}sandbox terminal%f"
  print "Workspace: /workspace"

  if (( ${#agents[@]} > 0 )); then
    print "Agents: ${(j:, :)agents}"
  fi

  if (( ${#editors[@]} > 0 )); then
    print "Editors: ${(j:, :)editors}"
  fi

  if (( ${#tooling[@]} > 0 )); then
    print "Tooling: ${(j:, :)tooling}"
  fi

  print ""
}

if [[ -o interactive && -z "${CCCCOCC_STARTUP_BANNER_SHOWN:-}" ]]; then
  export CCCCOCC_STARTUP_BANNER_SHOWN=1
  ccccocc_print_startup_banner
fi

PROMPT='%F{81}%~%f${vcs_info_msg_0_} $ '
