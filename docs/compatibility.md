# Compatibility and evidence

SDK version: **0.1.0-rc.4**, the first candidate to be published (pinned in
[release/sdk-candidate.json](../release/sdk-candidate.json)); documentation-only change from
**0.1.0-rc.3**, which is held and will not be published. This version is independent of HTTP API
`info.version` 0.1.0 and the runtime's Git commit.

The reviewed snapshot includes authenticated workspace context on owner create/retrieve from runtime
commit `6007a406ff0a64fe0fdfe484a0a568e49e97f0b0`. Its SHA-256 is
`68acc8dfe74c2f33b266e06536405d3c8c7cca49787d62e0e3d1c6cf5a191ce5`; exact provenance and generator
version are in [contract-lock.json](../contract/contract-lock.json). That companion change is under
review, not asserted deployed. Existing baseline `31ce5d557e6c6dd14972c8e8923f68ea294ce9b3` works with
an explicit trusted expected workspace. The original snapshot SHA-256 was
`8d4c04593b1137cc9730e3836b77173c463e03c7fe1b6cc53a0d51de5890cc65`.

| Consumer                    | Support / verification boundary                               |
| --------------------------- | ------------------------------------------------------------- |
| Node 22                     | Maintained patches at or above 22.14; CI pin 22.23.3          |
| Node 24                     | Recommended; CI pin 24.21.0                                   |
| JavaScript ESM              | Compiled package; no consumer build tool                      |
| TypeScript                  | Minimum 5.9; packed declarations checked with 5.9.3 and 7.0.2 |
| CommonJS                    | Async `import()` only; no synchronous `require` promise       |
| macOS / Windows             | Packed import smoke, not the entire runtime test matrix       |
| Server bundler              | Packed esbuild Node fixture; no browser safety claim          |
| Browser / Bun / Deno / edge | Not advertised or certified                                   |
| OpenClaw / MCP / A2A        | Deferred; no host compatibility claim or dependency           |

One ESM build uses explicit exports and `.js` relative paths, following
[Node package semantics](https://nodejs.org/api/packages.html) and
[TypeScript library guidance](https://www.typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options.html).
The maintained [Node release schedule](https://nodejs.org/en/about/previous-releases) should be
rechecked when updating pins. The engine floor is not a recommendation to run an obsolete patch.

Tests are three complementary lanes: SDK offline/loopback/crypto and packed-consumer checks;
independent raw HTTP tests canonical in the reference testbed, executed by private runtime CI;
and the actual SDK-powered testbed against that isolated runtime. Pinned test-only source/tarball
artifacts allow private repositories to run those checks without cross-repository live credentials.
Their manifests identify the exact input; copies must be regenerated, never hand-maintained.

CI reports at a particular PR head are evidence for that head. Registry installs, authorized preview
checks and independent developer cold-start observation are separate post-release evidence. A local
tarball pass does not establish npm scope ownership, public provenance or deployed interoperability.
No browser no-refresh claim, live production certification or independent user-study result is made.
