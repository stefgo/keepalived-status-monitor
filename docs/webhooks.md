# 🪝 Webhooks

KASM can report activity events to external services — a chat channel, a push service, an
incident tool, a script of your own. Each webhook sends a **JSON body you write yourself**,
with placeholders for the data of the event that triggered it.

Webhooks are managed on the **Webhooks** page in the sidebar, under Administration. The API is described under
[Webhooks in the API reference](api.md#-webhooks).

## When a webhook fires

Every event the server stores for the first time goes to every enabled webhook whose
filters it passes:

- **Minimum level** — `trace`, `info`, `warning` or `error`. The default, `warning`, covers a
  master giving up its role, a stopped keepalived and every error.
- **Event kinds** — a comma-separated list of patterns, `*` as wildcard: `vrrp.*`,
  `keepalived.stopped`. Empty means every kind. The kinds are listed in the
  [Activity reference](api.md#-activity).

An event an agent delivers twice — it reconnects before it saw the acknowledgement — is
stored once and reported once.

## Delivery

- `POST` (or `PUT`) with `Content-Type: application/json` and the headers you configured.
- Per attempt the configured timeout applies (default 10 s). When nothing answers, or the
  target answers 5xx or 429, the delivery is tried twice more, after 1 s and 5 s.
- Events are sent to one target in the order they arrived.
- The outcome of the last delivery is shown in the list. A failure is logged, but **does not
  create an activity event** — a broken target would otherwise report its own failures to
  itself.
- There is no persistent queue. A server restart during a retry loses that delivery; the
  event itself stays in the activity list.

## Templates

A template is **valid JSON** with `{{…}}` placeholders in its strings. It is filled in on the
parsed JSON, never as text, so a quote or a brace in an event's data cannot break the body.

| Written as | Becomes |
| :--------- | :------ |
| `"{{event.data}}"` — a string that is only one placeholder | The value **with its type**: an object stays an object, a number a number, a missing value `null`. |
| `"Host {{client.name}} is {{event.data.to}}"` — a placeholder inside text | Text. A missing value is empty, an object is written as JSON. |
| `{{client.name \| default("server")}}` | The fallback when the value is missing, `null` or empty. The fallback is a JSON value: `"text"`, `0`, `null`. |
| `{ "{{event.kind}}": … }` | Placeholders work in keys too, as text. |

Placeholders also work in the **URL** and in **header values**, always as text.

A path must start with `event`, `client` or `webhook`; anything else is refused when
the webhook is saved, as is a template that is not valid JSON. The editor page shows a live
preview rendered with a sample event, and **Send Test** delivers that sample to the target.

### What a template can read

| Placeholder | Content |
| :---------- | :------ |
| `event.message` | The sentence the dashboard shows, e.g. `VRRP instance VI_1: Master → Backup` |
| `event.detail` | The dashboard's second line, such as a priority or an error; `null` if none |
| `event.kind` | `vrrp.state_changed`, `keepalived.stopped`, … |
| `event.level` | `trace`, `info`, `warning` or `error` |
| `event.occurredAt` | When it happened on the host (ISO 8601) |
| `event.receivedAt` | When the server received it |
| `event.source` | `agent` or `server` |
| `event.id` | Unique id of the event |
| `event.correlationId` | Groups events that belong together; mostly `null` |
| `event.subject` | `{ instanceName, vrid, interface }` for VRRP events; single fields as `event.subject.vrid` |
| `event.data` | The facts of the kind, e.g. `{ from, to, priority, effectivePriority }`; single fields as `event.data.to` |
| `client.name` | Display name, else hostname |
| `client.hostname` | Hostname reported by the agent |
| `client.site` | The client's site |
| `client.id` | Client id |
| `webhook.name` | The webhook's own name |

`client` is `null` for an event the server reports about itself (`scheduler.failed`); use
`default(...)` where that matters. Which fields `event.data` carries per kind is listed in
the [Activity reference](api.md#-activity).

## Examples

**Slack / Mattermost incoming webhook**

```json
{
    "text": ":rotating_light: *{{client.name | default(\"KASM\")}}* — {{event.message}}"
}
```

**Microsoft Teams (workflow webhook)**

```json
{
    "type": "message",
    "attachments": [{
        "contentType": "application/vnd.microsoft.card.adaptive",
        "content": {
            "type": "AdaptiveCard",
            "version": "1.4",
            "body": [
                { "type": "TextBlock", "weight": "Bolder", "text": "{{client.name | default(\"KASM\")}} ({{event.level}})" },
                { "type": "TextBlock", "wrap": true, "text": "{{event.message}}" }
            ]
        }
    }]
}
```

**Gotify** — URL `https://gotify.example.com/message`, header `X-Gotify-Key: <app token>`

```json
{
    "title": "{{client.name | default(\"KASM\")}}: {{event.kind}}",
    "message": "{{event.message}}",
    "priority": 8
}
```

**Failover summary** — one message per change of a VRRP cluster, with the new master and the
state of every host. Event kinds `vrrp.master_changed, vrrp.split_brain, vrrp.master_lost`,
minimum level `info`:

```json
{
    "text": "{{event.message}}",
    "vrid": "{{event.data.vrid}}",
    "site": "{{event.data.site}}",
    "master": "{{event.data.master}}",
    "previous": "{{event.data.previousMaster}}",
    "health": "{{event.data.health}}",
    "hosts": "{{event.data.members}}"
}
```

`hosts` arrives as an array with `host`, `state`, `priority`, `online`, `reporting` and
`readAt` per member. These events are made by the server once the readings of all hosts agree
— see [Cluster events](api.md#-activity). With the agents' notify FIFO or notify endpoint
switched on, that is within a second of the failover; with the timer alone, up to
`pollInterval`.

**Your own endpoint**, with the complete event

```json
{
    "source": "kasm",
    "host": "{{client.hostname}}",
    "site": "{{client.site}}",
    "event": {
        "id": "{{event.id}}",
        "kind": "{{event.kind}}",
        "level": "{{event.level}}",
        "at": "{{event.occurredAt}}",
        "subject": "{{event.subject}}",
        "data": "{{event.data}}"
    }
}
```

## Security

- Header values — typically a token — are stored **in the clear** in the server database and
  shown in the editor to every user who can log in. Everyone with a login can manage
  webhooks, just as they can manage everything else.
- The server makes the requests, so it can reach whatever the server can reach, internal
  addresses included. That is intended for targets on the internal network; keep it in mind
  when handing out logins.
- The log names a failing webhook and the reason, never its headers.
