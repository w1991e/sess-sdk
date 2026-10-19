#!/bin/sh
# Runs a command with the Sess key and provider keys read from the macOS login Keychain:
#
#   ./with-keychain.sh <openai|anthropic|gemini|xai|meta|openrouter> -- <command> [args...]
#   ./with-keychain.sh all -- <command> [args...]        (the weekly check: every key present)
#
# The keys go only into the child's environment (exported, never on a command line). Nothing is
# printed, logged or written. For one provider, a missing or empty item stops it before the
# command runs; with `all`, the Sess key is required and a provider whose item is missing is left
# out (the weekly check then skips it).
#
# Keychain items (generic passwords, by service name):
#   Sess                 sess-qual-sess-api-key
#   OpenAI               sess-test-openai-api-key     (the existing OpenAI project key)
#   Anthropic            sess-test-anthropic-api-key  (the existing Anthropic API key)
#   Gemini, xAI, Meta,   sess-qual-gemini-key, sess-qual-xai-key, sess-qual-meta-key,
#   OpenRouter           sess-qual-openrouter-key
set -eu

usage() {
  echo 'usage: with-keychain.sh <openai|anthropic|gemini|xai|meta|openrouter|all> -- <command> [args...]' >&2
  exit 2
}

[ $# -ge 3 ] || usage
provider=$1
[ "$2" = "--" ] || usage
shift 2

item_of() {
  case "$1" in
    openai) echo sess-test-openai-api-key ;;
    anthropic) echo sess-test-anthropic-api-key ;;
    gemini) echo sess-qual-gemini-key ;;
    xai) echo sess-qual-xai-key ;;
    meta) echo sess-qual-meta-key ;;
    openrouter) echo sess-qual-openrouter-key ;;
    *) return 1 ;;
  esac
}

case "$provider" in
  all) providers='openai anthropic gemini xai meta openrouter' ;;
  *)
    item_of "$provider" > /dev/null || usage
    providers=$provider
    ;;
esac

command -v security > /dev/null 2>&1 || {
  echo 'This needs the macOS security command (login Keychain).' >&2
  exit 1
}

missing() {
  echo "The Keychain item $1 is missing or empty. Add it first; nothing was run." >&2
  exit 1
}

SESS_API_KEY=$(security find-generic-password -s sess-qual-sess-api-key -w 2> /dev/null) || missing sess-qual-sess-api-key
[ -n "$SESS_API_KEY" ] || missing sess-qual-sess-api-key
export SESS_API_KEY

for p in $providers; do
  item=$(item_of "$p")
  if KEY=$(security find-generic-password -s "$item" -w 2> /dev/null) && [ -n "$KEY" ]; then
    case "$p" in
      openai) OPENAI_API_KEY=$KEY && export OPENAI_API_KEY ;;
      anthropic) ANTHROPIC_API_KEY=$KEY && export ANTHROPIC_API_KEY ;;
      gemini) GEMINI_API_KEY=$KEY && export GEMINI_API_KEY ;;
      xai) XAI_API_KEY=$KEY && export XAI_API_KEY ;;
      meta) META_API_KEY=$KEY && export META_API_KEY ;;
      openrouter) OPENROUTER_API_KEY=$KEY && export OPENROUTER_API_KEY ;;
    esac
  elif [ "$provider" != all ]; then
    missing "$item"
  fi
done
unset KEY

exec "$@"
