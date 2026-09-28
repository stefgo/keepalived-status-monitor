# 1.0.0 (2026-09-28)


### Bug Fixes

* **activity:** Restore the seen state when marking fails ([452c3dc](https://github.com/stefgo/keepalived-status-monitor/commit/452c3dc2cb7c9ecd29cb8d6e61ed79748cec25f7))
* **activity:** Use the pulse icon for the activity page ([bbb7dff](https://github.com/stefgo/keepalived-status-monitor/commit/bbb7dff6b65db7a9a9983c89d03a235f05d0193f))
* Answer 404 when deleting a token that does not exist ([cc21e13](https://github.com/stefgo/keepalived-status-monitor/commit/cc21e13b19a2ea64e5ea72302da07fa4d012fa6b))
* **client:** Report a permission error on the dump file instead of a timeout ([72d1cd2](https://github.com/stefgo/keepalived-status-monitor/commit/72d1cd298a5ef2247e77afd4e9d1d2392030b9b4))
* **clients:** Drop the client ID from the client list ([5ad2cd7](https://github.com/stefgo/keepalived-status-monitor/commit/5ad2cd7e3b60041d03731f80bf6ed5ed0ee4b5ab))
* **client:** Signal keepalived once more before reporting a missing dump ([a752d70](https://github.com/stefgo/keepalived-status-monitor/commit/a752d7010f435e6da2b6b9938d89d4a4768a85f8))
* **clients:** Move the client ID from the editor header into the form ([1bda948](https://github.com/stefgo/keepalived-status-monitor/commit/1bda948f4c464457bd19b694d3673b3b7f2a1af0))
* **clusters:** Build the counter table on DataTreeTable ([4220973](https://github.com/stefgo/keepalived-status-monitor/commit/42209738e26ade61f9ee181b2e59aa5973b364f0))
* **clusters:** Expand only the clusters that need a look ([42eaa05](https://github.com/stefgo/keepalived-status-monitor/commit/42eaa057a29b4c079c9e257d0848f23887c2518d))
* **clusters:** Flag inactive and offline hosts with a red badge ([e9cbad1](https://github.com/stefgo/keepalived-status-monitor/commit/e9cbad1090bb26fd6ae3f946e12965a773c6f1a9))
* **clusters:** Keep a host whose keepalived stopped in its cluster ([ae46618](https://github.com/stefgo/keepalived-status-monitor/commit/ae466189d3a178a18145bc0c37a6f8921cb69567))
* **clusters:** Show a single badge per host in the cluster overview ([d366c51](https://github.com/stefgo/keepalived-status-monitor/commit/d366c51dd5a11ed2ed84e52ffeef8afe748aeab6))
* Compare the agent's secrets in constant time ([88530ed](https://github.com/stefgo/keepalived-status-monitor/commit/88530ede9a533c49bb145e6a978d0ffa10fd8fdb))
* **dashboard:** Point every stat card at what it counts ([d46ff9a](https://github.com/stefgo/keepalived-status-monitor/commit/d46ff9aa6050cd7f7c7353f3873a89452019ef82))
* **dashboard:** Show no message when nothing needs attention ([2efb311](https://github.com/stefgo/keepalived-status-monitor/commit/2efb3117dbc7e979f4e147989289e6e8af1d66ec))
* **dependencies:** update @stefgo/react-ui-components to version 4.3.1 ([8fc40a4](https://github.com/stefgo/keepalived-status-monitor/commit/8fc40a486fcb5c54ce402c6d4a21fb7e4fd0ee43))
* **deps:** Update @stefgo/react-ui-components to 4.1.1 ([cbe0c0b](https://github.com/stefgo/keepalived-status-monitor/commit/cbe0c0b94df2aaa5d4ac9f8ddef680f16cf36721))
* **deps:** update @stefgo/react-ui-components to version 4.2.0 ([3a087a5](https://github.com/stefgo/keepalived-status-monitor/commit/3a087a5cb6863906ec3040e00995e9bf0298487a))
* **deps:** update @stefgo/react-ui-components to version 4.2.1 ([add8e07](https://github.com/stefgo/keepalived-status-monitor/commit/add8e0725fcc9c5ce531594ea7f58d0a1592269f))
* **docker:** Let the health checks follow the port and scheme actually served ([83198d5](https://github.com/stefgo/keepalived-status-monitor/commit/83198d57676f506e8c382f534e1b3de4507c8a06))
* Harden the agent container and document what its permissions allow ([cfd1172](https://github.com/stefgo/keepalived-status-monitor/commit/cfd11721194b18744f89a473fe23d246d3908b7b))
* Highlight only the clickable rows in the VRRP cluster table ([3a41f70](https://github.com/stefgo/keepalived-status-monitor/commit/3a41f70618d8b2ac7acf991946ed1edef08f4dd1))
* Let VRRP instances be read as a table or a list ([f672801](https://github.com/stefgo/keepalived-status-monitor/commit/f6728015bcfd817b659490f5838a5b152efbf619))
* List Clients above VRRP Clusters and drop the keepalived column ([3f30f98](https://github.com/stefgo/keepalived-status-monitor/commit/3f30f985efa30774eb31a6265bb3eef2dda77ed5))
* Make the accent green more vivid at unchanged contrast ([18703b0](https://github.com/stefgo/keepalived-status-monitor/commit/18703b0ede9c52f1036adf44091aac9cb8d3b457)), closes [#10982d](https://github.com/stefgo/keepalived-status-monitor/issues/10982d) [#087a21](https://github.com/stefgo/keepalived-status-monitor/issues/087a21)
* Name the searched fields in the client list placeholder ([65eb7f9](https://github.com/stefgo/keepalived-status-monitor/commit/65eb7f94a86fcd1ba38ebc7efd949b1eb3c74684))
* Prefix the client name with its site on the client page ([eda3a7a](https://github.com/stefgo/keepalived-status-monitor/commit/eda3a7aab5768d5445c6d84f91d801614c540ca8))
* Prefix the VRID with the site in the VRRP cluster overview ([b935d7d](https://github.com/stefgo/keepalived-status-monitor/commit/b935d7d5cd7187799eebf77eddd3b342f0b8ddea))
* Record the disconnect time in last_seen ([73ef60a](https://github.com/stefgo/keepalived-status-monitor/commit/73ef60a48487e63ea5b7ffcc60e9cb3e10ab6a4b))
* Replace wording left over from the Docker instance manager ([a144643](https://github.com/stefgo/keepalived-status-monitor/commit/a1446439c780ab4cab2134eaa50d58af31a703b4))
* Retry unacknowledged activity and persist the queue on a crash ([f89d837](https://github.com/stefgo/keepalived-status-monitor/commit/f89d8370903daa5e458e15b54d402210dde53a0b))
* Roll back optimistic activity updates when the request fails ([9c75fd4](https://github.com/stefgo/keepalived-status-monitor/commit/9c75fd4a66387e7b3d278d79a96e5ffcb17f92dc))
* **scheduler:** Keep the first planned run of a scheduler across restarts ([e834a4f](https://github.com/stefgo/keepalived-status-monitor/commit/e834a4fb54ae048ed92d1b116231a323a9a70d66))
* **server:** Reload the SPA when a chunk from a previous deploy is gone ([c3e88a7](https://github.com/stefgo/keepalived-status-monitor/commit/c3e88a7a184caa112018cd74bfe588c9e447cc37))
* Show a client's page by what its agent reports now ([d64ade7](https://github.com/stefgo/keepalived-status-monitor/commit/d64ade7315296efb0e30a0f25a38e363d3596991))
* Show the keepalived summary as header details instead of stat cards ([d1c7645](https://github.com/stefgo/keepalived-status-monitor/commit/d1c764591afee1840a0b86669ea14e606054e3f2))
* Show the VRRP clusters as one tree table with a page header ([1c08a4a](https://github.com/stefgo/keepalived-status-monitor/commit/1c08a4af345f676063c1d43b910c9dd9c7d497ca))
* **tokens:** Compare token expiry as a timestamp, not as text ([8154f75](https://github.com/stefgo/keepalived-status-monitor/commit/8154f75a2e06f201c4ebe95b701b9cbc223369d7))
* Validate the dashboard WebSocket stream against shared ([dcd0520](https://github.com/stefgo/keepalived-status-monitor/commit/dcd0520f4cfd930efb792a4dd70060a68759e063))
* **webhooks:** Keep the monospace font to the editor's textareas ([bb7a0bd](https://github.com/stefgo/keepalived-status-monitor/commit/bb7a0bdc910f65402dad8f6163935589911ed34c))
* **webhooks:** Let the placeholder explanation span the full width ([fa1ec71](https://github.com/stefgo/keepalived-status-monitor/commit/fa1ec71743301569efdf7c8b516a9a0ca8a5be5f))
* **webhooks:** Narrow the minimum level field to the method's width ([bcfdd50](https://github.com/stefgo/keepalived-status-monitor/commit/bcfdd502aa6ffb003730f2250e84d637a78656ab))
* **webhooks:** Set the body template in the preview's font size ([9c8018c](https://github.com/stefgo/keepalived-status-monitor/commit/9c8018c0de8c7c50c1f1aa410a85d96d098adc94))
* **webhooks:** Set the target column in the regular font ([e8a93b2](https://github.com/stefgo/keepalived-status-monitor/commit/e8a93b2135ed19c5da1dc459dd0669e83aaa7288))
* Write VRRP states in sentence case ([d784b74](https://github.com/stefgo/keepalived-status-monitor/commit/d784b743e2b17bc4e23f04b31f5273cd4c1df5bc))


### Features

* **activity:** Filter-aware seen handling on the notifications page ([9d96cf7](https://github.com/stefgo/keepalived-status-monitor/commit/9d96cf793564a39018daac0cd042131323bbdb03))
* **activity:** Rename the notifications page to Activity ([768bc77](https://github.com/stefgo/keepalived-status-monitor/commit/768bc7724c6fc09249d0c0b966d7af44663a3031))
* **activity:** Report changes of a VRRP cluster as a whole ([33b7ae0](https://github.com/stefgo/keepalived-status-monitor/commit/33b7ae0fef34db0535ca7a3dd3adf40386d305f0))
* **activity:** Report the seen state per user ([f51072d](https://github.com/stefgo/keepalived-status-monitor/commit/f51072d1db77716171fc50e1d6ad547c180c9b87))
* **activity:** Report VRRP incidents from one confirmed cluster state ([0cb35dc](https://github.com/stefgo/keepalived-status-monitor/commit/0cb35dc6ee4ff1bac2a033ecca92122c62b17543))
* Ask for the setup PIN in the outbound Add Client wizard ([8b1c7d8](https://github.com/stefgo/keepalived-status-monitor/commit/8b1c7d89d829f9576ba2cbe2d8c6027a5749c87b))
* Choose which hosts the cluster page compares counters of ([b78b48f](https://github.com/stefgo/keepalived-status-monitor/commit/b78b48fdd09ce4e6d36809f7ad44d4491277963b))
* **client:** Close the register page once the agent is registered ([b65ee08](https://github.com/stefgo/keepalived-status-monitor/commit/b65ee08f68011ca5caa61f8865033070e8fd8463))
* **client:** Register outbound agents with the setup PIN instead of a config secret ([43b38bc](https://github.com/stefgo/keepalived-status-monitor/commit/43b38bc089e9a5326caac9a218cce17b9cd1ff0e))
* **client:** Serve only the web routes the configuration calls for ([85960a6](https://github.com/stefgo/keepalived-status-monitor/commit/85960a69390511fd1887c66dde5b4c5aba8d9cd1))
* **dashboard:** Keep the open stat card list in the URL ([e6fdb43](https://github.com/stefgo/keepalived-status-monitor/commit/e6fdb43fcb8cac867e56db64fee02b5659970386))
* **dashboard:** Open the activity list from the Errors / Warnings card ([cf79455](https://github.com/stefgo/keepalived-status-monitor/commit/cf79455f90b309eeca0c7500db1aedd84ad9a870))
* **dashboard:** Open the cluster list below the stat cards ([d8fb41d](https://github.com/stefgo/keepalived-status-monitor/commit/d8fb41dda64fe0842d03bf641d979a1bffc89046))
* **dashboard:** Open the host list below the stat cards ([0993819](https://github.com/stefgo/keepalived-status-monitor/commit/099381983de09f0820c7de8675fe668fb00afc31))
* **dashboard:** Open the master list from the MASTER card ([5b2fa8d](https://github.com/stefgo/keepalived-status-monitor/commit/5b2fa8de6b76722d05cdc3365836aa3ecab12226))
* **dashboard:** Simplify the cluster cards on the dashboard ([d68e38c](https://github.com/stefgo/keepalived-status-monitor/commit/d68e38cce8fe0d3dcfffca721c3df9e4bbc679e1))
* Dial outbound agents over TLS ([2165aaf](https://github.com/stefgo/keepalived-status-monitor/commit/2165aafac6bdc6f7e433a90277a0fcacab021e7c))
* Give every VRRP cluster its own page ([dd61340](https://github.com/stefgo/keepalived-status-monitor/commit/dd6134008b12233e2d5253a15700f52a94e21b65))
* Give every VRRP instance a page of its own ([5fdad19](https://github.com/stefgo/keepalived-status-monitor/commit/5fdad19e6d47df684166f6f1e4d2af039e6af159))
* Let keepalived trigger readings through a notify FIFO or endpoint ([7a11685](https://github.com/stefgo/keepalived-status-monitor/commit/7a11685ae08956c5deea8fe65b8d91103623ba5b))
* Make the backend port configurable ([6ab2343](https://github.com/stefgo/keepalived-status-monitor/commit/6ab2343f52e81fc21fd3e33e2a64083dd950c0af))
* Monitor keepalived VRRP instances across hosts ([ef24fbe](https://github.com/stefgo/keepalived-status-monitor/commit/ef24fbec0d7ea5bea16e23a1fccec7a4f5917971))
* Open the cluster counters on the errors that were counted ([c87e3b1](https://github.com/stefgo/keepalived-status-monitor/commit/c87e3b163e1d4fb5e026d3c0d42d5cf1f3aadf25))
* Put a cluster's identity in its header and its hosts' addresses in the rows ([fa50b23](https://github.com/stefgo/keepalived-status-monitor/commit/fa50b23c3a550ff0fbbdea817554c11fc34c15d6))
* Report a registration the agent could not store ([0890048](https://github.com/stefgo/keepalived-status-monitor/commit/0890048f0aeea1f9c46c91e175af568d99588536))
* Separate VRRP clusters by a per-client site ([734e888](https://github.com/stefgo/keepalived-status-monitor/commit/734e888f60c990fb544974819b01fbc8c47f2f53))
* **settings:** Persist the state of every server scheduler ([0568315](https://github.com/stefgo/keepalived-status-monitor/commit/0568315d4e75dca1502164c11ca986adbfa6722a))
* Show only the client name in the client list ([fd5930b](https://github.com/stefgo/keepalived-status-monitor/commit/fd5930b918b77779ab9d2f9989751bf83be19d7d))
* **tokens:** Store registration tokens as SHA-256 hashes only ([4756fda](https://github.com/stefgo/keepalived-status-monitor/commit/4756fdaf99b68aae1fc8f20eee67647c79592e3b))
* **webhooks:** Add conditions, loops and filters to body templates ([7d63362](https://github.com/stefgo/keepalived-status-monitor/commit/7d63362080b3a5c1aa6c66048436f34d460f9eda))
* **webhooks:** Open the editor from the edit button only ([89ea786](https://github.com/stefgo/keepalived-status-monitor/commit/89ea7867e8ccfea0f672e6ce5da1903e8b7e34ba))
* **webhooks:** Report events to external services with a JSON template ([21975ca](https://github.com/stefgo/keepalived-status-monitor/commit/21975ca9ba1872d7ca34d46599d979fdb1fc593e))
* **webhooks:** Rework the editor's enabled switch and field layout ([d724a82](https://github.com/stefgo/keepalived-status-monitor/commit/d724a82ab6cbb12d8b8fc13d8b5a20d03609334f))
* **webhooks:** Switch a webhook on and off from the table ([31a3446](https://github.com/stefgo/keepalived-status-monitor/commit/31a34468d7e0a4f599f590f6ce40c479f878f945))


### Performance Improvements

* **activity:** Broadcast the seen state only when it changed ([a5716eb](https://github.com/stefgo/keepalived-status-monitor/commit/a5716eb264c7db4f556b754605dc7ee131262064))
* **activity:** Keep the seen state in its own table ([21ac3ba](https://github.com/stefgo/keepalived-status-monitor/commit/21ac3bab90768df823b44576db911ee637c09b1f))
* **activity:** Mark a group seen in one request ([7528720](https://github.com/stefgo/keepalived-status-monitor/commit/75287206589bc6af3fb15f46d7142c36ef5e52b4))
* **activity:** Push new events as a delta instead of the whole list ([5643231](https://github.com/stefgo/keepalived-status-monitor/commit/5643231b5ca864f5c376b52eb05fb8bd4108dc26))
* **frontend:** Derive the notification badge tone in a store selector ([81dde10](https://github.com/stefgo/keepalived-status-monitor/commit/81dde105a8dc78aa6967828e0a05ee03f066d223))


### BREAKING CHANGES

* **tokens:** GET /api/v1/tokens returns tokenHash instead of token, and
DELETE /api/v1/tokens/:tokenHash takes the hash instead of the token.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
* **settings:** retention_invalid_tokens_days is now token_retention_days.
The old value is not carried over; the default is 30 days.
retention_invalid_tokens_count is gone, the token cleanup keeps no minimum.
Both old keys are removed from config.yaml at startup. The response of
scheduler-status has a new shape and no longer contains
notificationCleanupLastRun.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
* **client:** A registered agent can no longer be registered again from
its web UI. Delete identity.json from its data directory and restart the
agent; it then prints a new setup PIN.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
* **client:** registrationSecret in the agent's config.yaml is no longer
read; an agent that still has it logs a warning and waits for the setup PIN or
KASM_REGISTRATION_SECRET instead. Agents that are already registered are not
affected.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
