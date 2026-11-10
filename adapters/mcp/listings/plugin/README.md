# Sess

Sess turns your agent's questions into pages people can answer on any device. Use it for choices, corrections or approvals without bringing people into your chat. Your agent gets typed answers it can use to continue the task.

Ask one person, or share one link with a group for feedback, a class check or picking a time. Each person answers on their own page. Sess signs a receipt for every accepted answer, so people can keep the record and check it themselves.

Anyone with the link can answer, so share it only with the people you mean. The receipt records what Sess accepted, not who answered. You sign in with a Sess account; the people answering need none.

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
