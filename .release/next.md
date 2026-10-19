<!--
The hand-written part of the next release: what is new, why it matters, and
what an upgrade needs. It is placed above the list of commits in the GitHub
release and in CHANGELOG.md.

Write below this comment. Use "###" for headings -- "##" is the level of the
version itself. A release with nothing written here is refused. A beta from
dev keeps the text; the stable release from main empties this file again.

Nothing inside an HTML comment is published.
-->

### A new client is there before its agent

Adding an inbound client now creates it right away, under the name you give it, marked
*Awaiting registration*; the registration token is part of that client. When the token runs
out, the client's page issues a new one. The *Client Tokens* page and its retention settings
are gone -- there is nothing left to tidy up.

*Re-register Agent* in a client's menu issues a token for a client that is already
registered. The agent that registers with it takes the client over with its settings and
history; before, every new registration created a new client and left the old one behind.

### The level of an activity event can be set per kind

Each kind of event in the activity history has a built-in level. It can now be changed in
the settings, under *Activity History*, with one select per kind. A kind can also be set to
"none": such an event is no longer stored and reaches no webhook. The two events an incident opens and closes with cannot be switched off.

A changed level applies to events from then on; events that are stored already keep theirs.

### A cluster's page names its virtual IPs

The details at the top of a cluster's page now list the cluster's virtual IPs, where they
showed the network those addresses sit on.

### The agent says at start whether it can see keepalived

An agent that was started without `pid: host` sees only its own container. It reported
keepalived as not running, like a host that really runs none, and its log said nothing. The
agent now checks this once at start and writes the result to its log: that it found
keepalived, that the host runs none, or that it does not see the host's processes and needs
`pid: host`.

### Wrapped text in tables sits closer

Text that wraps onto a second line in a table cell now sits as closely as text anywhere else
in the application; its lines were further apart than the text's size called for. Rows of a
single line are a little lower than before.

### A click beside a checkbox no longer opens the member

In a cluster's list of members, a click that just missed a member's comparison checkbox used
to open that member's host. The space around the checkbox now belongs to it: a click there
neither opens the host nor ticks the box.

### Labels in the list view line up

In the list view, which shows each row as a card of labels and values, every value of a
row now starts at the same edge. A long label wraps instead of pushing its value aside, so
on a narrow screen it no longer runs out of the row.

### Upgrading

- Registration tokens issued before the upgrade no longer work. Add the client again, or
  generate a new token on a waiting client. The `/api/v1/tokens` endpoints are replaced by
  `POST /api/v1/clients/inbound`, and `token_retention_days` and
  `token_cleanup_interval_hours` can be deleted from `config.yaml`.
- The webhook templates behave as before; their engine now comes from a package the stefgo
  projects share.
