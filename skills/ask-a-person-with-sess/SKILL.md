---
name: ask-a-person-with-sess
description: "Asks a person outside the conversation for an approval, sign-off, decision or structured answer through a private link they open on any device, and returns a typed answer with a receipt signed by Sess, an independent third party. Use when the user needs someone else's go-ahead, confirmation, choice or details before work continues, especially when that person has no account or is outside the organization, when the answer needs more than yes or no, or when proof of the answer must be signed by someone other than the agent. Needs no signup or API key to start: one HTTP call returns the link to give the person."
---

# Ask a person with Sess

> Sess lets AI agents ask people through a private Sess link. Whatever a person decides, Sess signs the receipt.

## Ask a person now, no signup

No account or API key: one API call creates a trial Session, and you get back a link to share and a credential your agent uses to read the answer.

1. Create the trial Session. No `Authorization` header: this API call starts a new trial.

```http
POST https://api.sess.si/v1/trial/sessions
Content-Type: application/json

{
  "interaction": {
    "mode": "interactive",
    "title": "Which time works for a call?",
    "source": {
      "kind": "sess_surface",
      "components": [
        {
          "type": "field",
          "name": "time",
          "label": "Time",
          "required": true,
          "schema": { "type": "string", "enum": ["10:00", "14:00", "16:00"] },
          "option_labels": { "10:00": "10 am", "14:00": "2 pm", "16:00": "4 pm" }
        }
      ]
    },
    "actions": [{ "id": "submit", "label": "Send", "intent": "submit" }]
  }
}
```

The `201` response holds `id`, `human_url`, `management_credential` and `action_expires_at`. The management credential is never shown again; keep it secret.

To ask again, send the same call with `Authorization: Bearer <management_credential>`. One trial takes up to 10 Sessions in its first 24 hours, 3 active at a time.
For more, a person can create a free Sess account at https://app.sess.si/app/sign-in and give the agent an API key.

2. Show `human_url` to the person. They open it on any device and answer. Send it only to them.

On a terminal, print the link as a QR code so the person can open it on a phone.

3. Read the Session every few seconds until `status` is `"responded"`. Reading never changes the Session, so polling is safe. Keep polling until the person answers or `action_expires_at` passes; do not stop early.

```http
GET https://api.sess.si/v1/trial/sessions/{id}
Authorization: Bearer <management_credential>
```

4. Read the answer back to the person. Their typed answer is `responses[0].data`, for example `{"time": "14:00"}`.

Any agent can check a Sess receipt with no account and no key, on [Verify](https://sess.si/verify/) or through the public check routes.

- The receipt for one answer, in its bundle: `POST https://api.sess.si/v1/receipts/verify`
- A closing receipt, with the answers' receipts: `POST https://api.sess.si/v1/receipts/verify-closing`
- A receipt record: `POST https://api.sess.si/v1/receipts/verify-archival`
- Receipt keys: `GET https://api.sess.si/.well-known/sess-receipt-keys.json`

To ask whether an app may act on a receipt now, use POST /v1/receipts/verify. To ask whether the record is genuine, before or after its expiry, use POST /v1/receipts/verify-authenticity.

Limits: 3 trials per network per day; the link can be answered for 1 hour.

Text limits: a title up to 60 characters, a field label up to 40, a choice label up to 30 and a button label up to 16.

For your own question, change the title, the field and the action: see Writing a Surface in the [docs llms.txt](https://docs.sess.si/llms.txt). More as Markdown: [Quickstart](https://docs.sess.si/quickstart/index.html.md), [How Sess works](https://docs.sess.si/concepts/index.html.md), [Limits](https://docs.sess.si/limits/index.html.md), [API reference](https://docs.sess.si/reference/index.html.md), [Receipts](https://docs.sess.si/receipts/index.html.md).

## Check the receipt

Each accepted response carries a `receipt`: a compact JWS signed with Ed25519 (`alg` `EdDSA`, `typ` `sess-receipt-2+jwt`, and a `kid`). The public keys are at `https://api.sess.si/.well-known/sess-receipt-keys.json`. The issuer is the API origin, and the audience is the Session's workspace (for a trial, the `workspace_id` in the `201` response).

## What the receipt shows and does not show

The receipt records what Sess accepted: the Session, Event, revision and its hash, the action, a hash of the input, the responder's assurance (`link_holder`) and the time. It does not prove that the person understood the page or that anything happened afterwards.

Who answered: someone with the link, not a verified identity. A Sess receipt is not a legal e-signature.

## The trial's limits

A trial can hold up to 3 active Sessions and create 10 in its 24 hours: send `Authorization: Bearer <management_credential>` with the same create API call to add one. A trial Session answers one round; publishing a next revision needs an API key.

The management credential reads the Sessions and typed results of its own trial and creates more Sessions in that trial. It cannot publish a next revision, complete a Session or set up webhooks, and it is not an API key.

## Keep going

Claiming links a trial to the person's account, so that their API keys can read its Sessions. A claim needs both the management credential and their signed-in account. The Sess link can never claim a trial. How: "Claim a trial into your account" in the [Quickstart](https://docs.sess.si/quickstart/index.html.md).

## The link

Send `human_url` only to the person. Never post it publicly or log it.
