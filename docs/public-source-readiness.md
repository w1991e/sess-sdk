# Public source scan

The `Source/history scan` CI job scans the current tracked content and the complete reachable Git
history of every retained branch and tag with a pinned, SHA-verified gitleaks release and the
upstream default rules plus SESS-specific rules. A shallow checkout is rejected; there is no
ignored-findings baseline. `check:secrets` and `check:package` run alongside it and are not
replaced by it. A pattern scanner cannot prove the absence of every secret.

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
