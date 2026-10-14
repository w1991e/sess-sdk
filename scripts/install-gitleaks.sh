#!/usr/bin/env bash
set -euo pipefail

# Match the reviewed runtime scanner; updates need full upstream integrity review.
if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 || $# != 1 ]]; then
  printf '%s\n' 'This pinned scanner installer requires Linux x86_64 and an output directory.' >&2
  exit 1
fi
scanner_work=$(mktemp -d)
trap 'rm -rf "$scanner_work"' EXIT
curl --fail --silent --show-error --location \
  --output "$scanner_work/gitleaks.tgz" \
  https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz
printf '%s  %s\n' \
  551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb \
  "$scanner_work/gitleaks.tgz" | sha256sum --check --status
tar --extract --gzip --no-same-owner --file "$scanner_work/gitleaks.tgz" \
  --directory "$scanner_work" gitleaks
printf '%s  %s\n' \
  88f91962aa2f93ac6ab281d553b9e125f5197bbbce38f9f2437f7299c32e5509 \
  "$scanner_work/gitleaks" | sha256sum --check --status
[[ "$("$scanner_work/gitleaks" version)" == 8.30.1 ]]
mkdir -p "$1"
install -m 0755 "$scanner_work/gitleaks" "$1/gitleaks"
printf '%s\n' 'Installed checksum-verified gitleaks 8.30.1.'
