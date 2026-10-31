# History rewrite, 2026-10-24

Founder 2026-10-24 18:05Z, 19:25Z and 19:40Z. This repository was recreated from a rewritten history, so that the founder's personal name and email appear nowhere in it. The previous repository is kept, private and untouched, as `w1991e/sess-sdk-archive`. Its pull requests, refs and discussions stay there for our records. The archive is never public.

**What changed in the history:**
- The legal name, the surname alone and the personal email were replaced in file contents and commit messages.
- Author and committer identities carrying them now read `w1991e <w1991e@users.noreply.github.com>`.
- Nothing else changed. The tip of `master` has the same tree as before the rewrite (`67307cc7`), so the current files are byte-identical.

**Read back after the push:**
- the name scan over every branch, tag, commit message and identity reads 0;
- the full-history secret scan (gitleaks 8.30.1, with the effective config from `scripts/source-scan-lib.mjs`) finds no leaks in 381 commits;
- the new repository's 24 branches and tags equal the rewritten ones exactly.

**Published packages are unchanged.** npm tarballs are immutable, and their provenance attestations still name the pre-rewrite commits below. Those commits now live only in the archive. The SDK tarballs 0.1.0-rc.4, rc.5, rc.7 and rc.8 keep the NOTICE text they were published with.

## Tags (same names; old commit → new commit)

| Tag | Old | New |
|---|---|---|
| `create-agent-v0.1.0-rc.1` | `3d30047c5b702d7dd6e205c9427967071249bd11` | `ab8be59b53e56603b41190924aaed69ee73ca0e9` |
| `create-agent-v0.1.0-rc.2` | `769ff1eea5035f14ece2778695643028c8a8ba69` | `2601974899d3dc6bff78b66654116a1c7f52efba` |
| `create-agent-v0.1.0-rc.3` | `0fde9cd2858c6a7c2ded319aa81dd2e850610067` | `79a09169300cd2d0167deaa3471671c69d618163` |
| `create-agent-v0.1.0-rc.4` | `ade8f835a6eeebba4090b13a26c9817028807657` | `df4083bda8b82c8de95f61459a215f3ba19162bd` |
| `mcp-v0.1.0-rc.1` | `7eebb0e8e8a5b22c56f93ae79d82f392eb5f65d6` | `16697ce74a2dbfe8d1c62f3c96bf774e0fdf0020` |
| `mcp-v0.1.0-rc.2` | `0fde9cd2858c6a7c2ded319aa81dd2e850610067` | `79a09169300cd2d0167deaa3471671c69d618163` |
| `mcp-v0.1.0-rc.3` | `ade8f835a6eeebba4090b13a26c9817028807657` | `df4083bda8b82c8de95f61459a215f3ba19162bd` |
| `openclaw-v0.1.0-rc.1` | `d08fe805ffe79fcce11ea5e4976fed2ae2c734b9` | `62674c8377111c36d6db968a71c936bd92d999d2` |
| `openclaw-v0.1.0-rc.2` | `0fde9cd2858c6a7c2ded319aa81dd2e850610067` | `79a09169300cd2d0167deaa3471671c69d618163` |
| `openclaw-v0.1.0-rc.3` | `ade8f835a6eeebba4090b13a26c9817028807657` | `df4083bda8b82c8de95f61459a215f3ba19162bd` |
| `v0.1.0-rc.4` | `4cae0ea290b4498fe7c5301e524e7b8aca2caf31` | `ea5531db4308f14735bd87674889c2ec73f00053` |
| `v0.1.0-rc.5` | `da04717673649f9954bc8eea8f8f7c4fb8ab615a` | `0b697338e01bdae8d43516846ad7ce17bedb194f` |
| `v0.1.0-rc.7` | `e8e36ceb1724e7532b6037744ac27b4e7a588b47` | `87c2aebba1e4d5faf5ef94dfbe471df9763288db` |
| `v0.1.0-rc.8` | `efc023a0d56b4f1dd7a7993bf0dcf40e40f28be1` | `10c551b22f7477fed62c960d0eb99c1f27d15ef6` |

## Commits named in this repository's release packets (old → new)

| Old | New | Named in |
|---|---|---|
| `0220ea93d166` | `f2dbd2ecc581` | adapters/mcp/release/rc3-packet.md |
| `043802c8be77` | `dc6a99778217` | adapters/openclaw/release/rc4-packet.md |
| `0763daff19fb` | `10cf42a1e917` | adapters/openclaw/release/rc4-packet.md |
| `0fde9cd2858c` | `79a09169300c` | adapters/mcp/compatibility.json; adapters/openclaw/compatibility.json |
| `2ab260fffa08` | `dec1103696a8` | adapters/openclaw/release/rc4-packet.md |
| `3dbd7fd239a9` | `c93809791375` | adapters/openclaw/compatibility.json |
| `3e9f4e23f5a7` | `40c0acaf951b` | adapters/openclaw/release/rc4-packet.md |
| `58bbe8f811b8` | `5aa120a3646f` | adapters/openclaw/release/rc3-packet.md; create-agent/release/rc4-packet.md |
| `722810aab7d7` | `a1348cdca9ea` | adapters/openclaw/release/rc4-packet.md |
| `7bd8153b1b71` | `b98eee52f5ca` | adapters/openclaw/release/rc4-packet.md |
| `7eebb0e8e8a5` | `16697ce74a2d` | adapters/mcp/compatibility.json |
| `7fcf1009525d` | `82352fa48304` | adapters/openclaw/release/rc4-packet.md |
| `93784f3653d6` | `b0116a8d35d4` | create-agent/release/rc2-packet.md |
| `a830ddfca9a9` | `4061a25e6532` | create-agent/release/rc3-packet.md |
| `ade8f835a6ee` | `df4083bda8b8` | adapters/mcp/compatibility.json; adapters/mcp/release/rc3-packet.md; adapters/openclaw/compatibility.json |
| `b6fdaf44941f` | `695b806e64bc` | adapters/openclaw/release/rc4-packet.md |
| `d08fe805ffe7` | `62674c837711` | adapters/openclaw/compatibility.json |
| `d1627f17313c` | `f73ab0046eb7` | release/rc8-packet.md |
| `d84847bb0b17` | `e882fbe7f6f4` | create-agent/release/rc5-packet.md |
| `dcc202668388` | `842f6ed1ec44` | adapters/openclaw/release/rc4-packet.md |
| `e8e36ceb1724` | `87c2aebba1e4` | release/rc7-packet.md |

A SHA quoted in an earlier packet or changelog refers to the archive. Use these tables to find the same commit here.
