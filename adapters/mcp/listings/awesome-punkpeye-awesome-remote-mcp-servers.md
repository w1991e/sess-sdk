# punkpeye/awesome-remote-mcp-servers entry

Unposted draft for the founder's review. Nothing here is forked, opened or posted. The founder opens every fork, pull request, issue and form from his own account; nothing posts from the orchestrator. punkpeye/awesome-remote-mcp-servers had 2,877 stars on GitHub's public API on 2026-11-09: https://github.com/punkpeye/awesome-remote-mcp-servers

Where each rule was read:

- CONTRIBUTING.md (blob 263e96fea0635f959b03760436519289c611c467): a public endpoint that answers an MCP initialize request (CI checks it), usable by anyone, Streamable HTTP or SSE, a Glama connector badge on the second line (CI checks it resolves), the three-line entry format, an authentication marker, one sentence of at most 120 characters ending in a period, alphabetical within each category (case-insensitive), the account opening the PR must have starred the repository
- the pull request template (blob 0bdca7be719a0c6bc63befb679a080088bd50f2b): Server, Endpoint and four checkboxes
- README.md: the Workplace & Productivity section

Every OWNER: line is for the owner to do, then delete.

## Target

`README.md`, section `### 🏢 Workplace & Productivity`, in alphabetical order (case-insensitive) between `SayBriefly` and `SheetRender`.

## Entry

```markdown
- [Sess](https://sess.si) `https://mcp.sess.si/mcp`
  [![Sess MCP connector](https://glama.ai/mcp/connectors/si.sess/sess/badges/score.svg)](https://glama.ai/mcp/connectors/si.sess/sess)
  🔐 - Let your agent ask a person and continue with their answer.
```

The list's CI sends an MCP initialize request to https://mcp.sess.si/mcp; a 401 sign-in challenge is the correct answer from our endpoint (founder 2026-11-09 21:36Z).

OWNER: the badge is required; the Glama connector page for si.sess/sess answered 200, titled Sess - MCP Connector, and its badge answered 200 with image/svg+xml, on 2026-11-09. Confirm that connector is yours before you rely on it.

OWNER: CONTRIBUTING.md requires the account opening the pull request to have starred the list: the founder stars it himself.

## Pull request

Title: `Add Sess`

Body (the list's pull request template, with no box ticked):

```markdown
**Server:** Sess
**Endpoint:** https://mcp.sess.si/mcp

- [ ] The endpoint is public and answers an MCP `initialize` request
- [ ] Entry is in the correct category, in alphabetical order
- [ ] Entry has its Glama connector badge on the second line
- [ ] Auth marker matches what the endpoint actually does
```

OWNER: tick each box only once you have confirmed it. Fork the list and open the pull request from your own account, as drafted (founder 2026-11-09 21:36Z: submit as drafted).
