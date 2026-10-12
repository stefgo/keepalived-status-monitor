<!--
The hand-written part of the next release: what is new, why it matters, and
what an upgrade needs. It is placed above the list of commits in the GitHub
release and in CHANGELOG.md.

Write below this comment. Use "###" for headings -- "##" is the level of the
version itself. A release with nothing written here is refused. A beta from
dev keeps the text; the stable release from main empties this file again.

Nothing inside an HTML comment is published.
-->

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

### Upgrading

Nothing has to be done. The webhook templates behave as before; their engine now comes from
a package the stefgo projects share.
