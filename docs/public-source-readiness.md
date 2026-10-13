# Public SDK source readiness

`@sess/sdk` is intended for public source and npm distribution after the owner's release
decision. The runtime/renderer and testbed remain private. Package checks and public-source
checks cover different boundaries; passing either is not publication authorization.

## Automated source and history coverage

The independent `Source/history scan` CI job runs once per SDK pull request or branch push.
It uses the pinned Actions checkout with `fetch-depth: 0`, which fetches every retained
source branch and tag. The report records the exact candidate, local ref/head inventory,
tracked file count, reachable commit count, scanner provenance and safe finding metadata.
It scans both the current tracked working-tree content and complete reachable Git history
of those refs, including the initial commit, merge additions and removed markers. A shallow
checkout is rejected. Before changing visibility, recheck the live branch/tag inventory
against that exact report and rerun after any ref change; a new visibility change is not
authorized by this checklist.

The current-tree input comes from `git ls-files --cached --stage -z`: tests, dotfiles,
extensionless files, documentation, scanner configuration and lockfiles are included.
Tracked symlink targets are scanned as literal text and never dereferenced. Unsupported
submodules and unmerged entries fail instead of silently leaving coverage gaps. Ignored
local credentials are neither scanned nor copied into artifacts. History is scanned in
a disposable bare mirror, so a local `.gitleaksignore` cannot silently suppress it. Inline
`gitleaks:allow` comments are disabled; tracked fingerprint ignore files are rejected.
There is no ignored-findings baseline or project-wide file/history exclusion.

The binary is gitleaks **8.30.1** from its official Linux x86_64 release. The archive
SHA-256 is `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb`; the extracted binary
SHA-256 is `88f91962aa2f93ac6ab281d553b9e125f5197bbbce38f9f2437f7299c32e5509`. Both acquisition
and execution verify integrity and execution verifies the version. The exact upstream
[default rules](https://github.com/gitleaks/gitleaks/blob/v8.30.1/config/gitleaks.toml) are
vendored as `.github/gitleaks-upstream-v8.30.1.toml`, with Git blob
`256f64790ea6d954f0041024be2938089ae1e7a7` and SHA-256
`e163e53b9e7e8a8511e77271e2b323ed057759542a6d988258afe3a1fa329caf`. The wrapper validates those
bytes and removes only the upstream global suppression block before loading all default
detection rules. This makes the upstream file, lockfiles and normally excluded extensions
part of the scan. Default rule-level detection semantics remain intact. SESS credential,
webhook, capability URL and private-key-header rules add product-specific detection.

The project exceptions each require the exact path and exact complete line/value. One
`sess-credential` exception covers the pinned public OpenAPI's single synthetic management
credential example. One `generic-api-key` exception covers the deliberately public replay
identity in `tests/unit/checkpoint-corrections.test.ts`; that identity proves punctuation-byte
preservation and provides no authentication. The controls prove each fixture is benign and
that another path, one changed byte, extra line content or a neighboring marker still fails.
Every proposed exception requires its own benign positive control and adjacent negative
controls plus a non-author focused review. No test-directory, generic digest, broad
high-entropy or commit-range exception is permitted.

The fast `check:secrets` command retains private-runtime-import and known credential-pattern
checks across every tracked file. `check:package` retains the tarball allowlist, lifecycle,
dependency, export, source-map and installed-consumer checks. The maintained source/history
scanner supplements these checks and does not replace them. Source/history controls include
all R2 omitted locations, upstream global path omissions, tracked symlink non-dereference,
ignored local credential exclusion, removed-commit detection and a separately retained
branch's marker. All controls use synthetic values generated in disposable repositories.

For a full local scan in an actual complete Linux x86_64 Git checkout:

```bash
bash scripts/install-gitleaks.sh /tmp/sess-gitleaks-8.30.1
GITLEAKS_BIN=/tmp/sess-gitleaks-8.30.1/gitleaks node --test scripts/test-source-scan.mjs
GITLEAKS_BIN=/tmp/sess-gitleaks-8.30.1/gitleaks node scripts/scan-source-history.mjs
```

Only `.artifacts/source-history-scan.json` may be retained by the scanner job. It contains
rule/path/line/commit metadata and outcomes, never matched values, source lines, commit
messages, author identities or raw scanner logs/reports. Temporary reports/content/mirrors
are deleted. A scanner acquisition/error is a failed/not-run assessment, not a clean scan.

## Owner release checklist

- Verify the exact source/history job and normal package/matrix CI for the selected head.
  Reconcile exposed branches/tags with the report; source about to become public must be
  covered, including retained branches. Treat deletion/visibility/publication as separate
  owner actions requiring their authorized checks.
- Review exposed documentation, Git metadata, issue/PR discussions, branch names, links,
  archived workflow logs/artifacts, organization references and operational instructions
  for private information. A pattern scanner cannot prove absence of every private detail
  or every possible secret. Its decoding/archive depth is bounded and non-text binary
  content requires a separate content review before public exposure.
- Check license/NOTICE, security-reporting contact and the actual private reporting setup.
  Verify scope ownership, release-tag/environment protection and selected publisher setup
  before a separately approved genuine candidate publication.
- Obtain the non-author review of this scanner policy and any later changes. A candidate
  can alter its own CI/policy, so a passing candidate-defined scan does not prove reviewer
  independence or a base-controlled approval. Protect the real emitted check context after
  it first reports; never add a nonexistent context or relax stronger default-branch rules.

This checklist is preparation evidence. Registry installation, publisher provenance,
deployed-browser/manual-refresh behavior and an unaffiliated developer trial remain
separate release/demo evidence.
