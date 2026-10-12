# Working on the SESS SDK

Keep this package a server-side integration library. The public HTTP contract controls its behavior;
runtime state, authorization, receipts and hosted rendering belong to SESS. Business workflow,
durable checkpoints and external side effects belong to the application. Do not add framework
dependencies, speculative endpoints or a renderer.

Read the relevant source and contract before changing behavior. Run `npm ci --ignore-scripts`,
then `npm run check`. Preserve creation's no-retry rule, exact mutation replay identity, trusted
receipt bindings, redacted errors, and explicit outcome uncertainty. Test the packed artifact.
Ordinary tests use synthetic data and never production credentials.

One independent focused review and applicable green CI are the normal merge path. Preparing
a branch/PR does not authorize npm publication, visibility changes or production operations.
Follow the current owner's actual instructions rather than inventing additional approval gates.
