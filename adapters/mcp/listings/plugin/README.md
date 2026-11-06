# Sess

Let your agent ask a person and continue with their answer. Your agent describes a form and gets a link at once. The person answers on any device, and your agent continues with a typed answer and a signed receipt.

Anyone with the link can answer, so share it only with the person you mean. The receipt records what Sess accepted, not who answered. Check answers before your agent acts on them. You sign in with a Sess account. The person answering needs none.

## Connect

- Server URL: `https://mcp.sess.si/mcp` (Streamable HTTP).
- Setup for each agent host: https://docs.sess.si/add-to-your-agent/

## Tools

- `sess_ask`: Ask a short question through Sess (writes)
- `sess_request`: Ask a person through Sess (writes)
- `sess_response`: Read the person’s Sess answer (read-only, safe to repeat)
- `sess_publish`: Show the next Sess step (writes, safe to repeat)
- `sess_complete`: Finish the Sess interaction (writes, cannot be undone, safe to repeat)

## Help

- Support: https://docs.sess.si/support/
- License: Apache-2.0
