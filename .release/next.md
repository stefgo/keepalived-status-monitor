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

### Upgrading

Nothing has to be done. The webhook templates behave as before; their engine now comes from
a package the stefgo projects share.
