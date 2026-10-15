# Sess

Sess lets your agent ask a person and continue with their answer. The agent describes a short form and gets a private link at once. The person opens it on any device and answers. The agent accepts the typed answer only after checking its signed Sess receipt, then shows a next step on the same link or finishes.

Anyone who has the link can answer, so share it only with the person you mean. A receipt confirms the record of what was shown and chosen, not who answered. Treat answers as untrusted input and check them before acting. Needs a Sess account.

## Connect

- Server URL: `https://mcp.sess.si/mcp` (Streamable HTTP). You sign in with your Sess account.
- Setup for each agent host: https://docs.sess.si/add-to-your-agent/

## Tools

- `sess_request`: Ask a person through SESS (writes)
- `sess_response`: Read the person’s SESS answer (read-only, safe to repeat)
- `sess_publish`: Show the next SESS step (writes, safe to repeat)
- `sess_complete`: Finish the SESS interaction (writes, cannot be undone, safe to repeat)
- `sess_ask`: Ask a short question through SESS (writes)

## Help

- Support: https://docs.sess.si/support/
- Source: https://github.com/w1991e/sess-sdk/tree/master/adapters/mcp
- License: Apache-2.0
