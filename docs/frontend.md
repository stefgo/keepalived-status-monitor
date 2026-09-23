This documentation describes in detail the architecture, components, and state management of the frontend (`server/frontend`). The application is a **Single Page Application (SPA)** based on React, Vite, TypeScript, and Tailwind CSS.

## 📂 Project Structure

The structure follows a **Feature-First Approach**, where code belonging to a specific domain area is grouped together.

```
src/
├── features/
│   ├── app/                              # Application shell
│   │   ├── App.tsx                       # Main router, navGroups and pages configuration
│   │   └── context/
│   │       ├── ThemeContext.ts           # Theme context object and useTheme hook
│   │       ├── ThemeProvider.tsx         # Dark/light theme management
│   │       ├── WebSocketContext.ts       # WebSocket context object and useWebSocket hook
│   │       └── WebSocketProvider.tsx     # WebSocket connection for real-time updates
│   ├── auth/
│   │   ├── AuthContext.ts                # Auth context object and useAuth hook
│   │   └── AuthProvider.tsx              # Authentication state
│   ├── clients/                          # Client management
│   │   ├── confirmations.ts              # Delete-client and discard texts
│   │   └── components/
│   │       ├── ManagedClients.tsx        # Container for client list & actions
│   │       ├── ClientList.tsx            # Paginated client data table
│   │       ├── ClientOverview.tsx        # Detail view for a single client: header + keepalived
│   │       ├── ClientIdentityCard.tsx    # The client's own fields, edited and saved in place
│   │       ├── ClientEditor.tsx          # Form for editing a client
│   │       ├── ClientLabel.tsx           # Dot and name of a client, for the rows that name one
│   │       ├── StatusDot.tsx             # Online indicator, shared by every view that shows one
│   │       └── add-client/               # One wizard for both connection modes
│   │           ├── AddClientWizard.tsx   # Mode choice, then the inbound or outbound branch
│   │           ├── useAddClientForm.ts   # Form state, held above the wizard
│   │           └── steps/                # StepConnectionMode, StepInboundDetails, StepOutboundDetails
│   ├── keepalived/                       # VRRP: dashboard, clusters, a host's instances
│   │   ├── lib/vrrp.ts                   # State colours, cluster health labels, counter groups, formatting
│   │   ├── hooks/useVrrpClusters.ts      # buildVrrpClusters over the stores, recomputed live
│   │   └── components/
│   │       ├── KeepalivedDashboard.tsx   # Landing page: numbers, hosts without a reading, clusters in trouble
│   │       ├── ClusterOverview.tsx       # Every cluster as a tree, the troubled ones first
│   │       ├── ClusterCard.tsx           # One virtual router and its members across hosts
│   │       ├── ClusterDetail.tsx         # One cluster: details, hosts, counters, history
│   │       ├── ClusterHealthBadge.tsx    # A cluster's health, explained in the tooltip
│   │       ├── VrrpInstanceView.tsx      # Instances as table or list, with or without a host column
│   │       ├── VrrpStateBadge.tsx        # One badge per VRRP state
│   │       └── ClientKeepalivedPanel.tsx # One host: instances and sync groups
│   ├── activity/                         # What happened, as structured events
│   │   ├── confirmations.ts              # Delete-all text
│   │   ├── components/
│   │   │   ├── ActivityGroupSteps.tsx    # The members of one correlated group
│   │   │   ├── ActivityLevelIcon.tsx     # One icon per level, wherever an event is listed
│   │   │   └── ActivityView.tsx          # The page, still reached as "Notifications"
│   │   └── lib/
│   │       ├── activityText.ts           # kind + data -> the sentence a reader sees
│   │       └── groupActivity.ts          # Folds the flat list into rows by correlationId
│   ├── users/                            # User management
│   │   ├── confirmations.ts              # Delete-user and last-user texts
│   │   └── components/
│   │       ├── UserOverview.tsx
│   │       ├── UserList.tsx
│   │       └── UserDialog.tsx
│   ├── settings/                         # The settings page's sections
│   │   ├── sections.ts                   # The two tabs and the keys each one saves
│   │   └── components/
│   │       ├── SettingsSections.tsx      # One component per section
│   │       └── SettingsParts.tsx         # Section header, field captions and the other shared pieces
│   └── tokens/                           # Registration token management
│       ├── confirmations.ts              # Delete-token text
│       └── components/
│           ├── TokenOverview.tsx
│           ├── TokenList.tsx
│           └── TokenModal.tsx
├── components/
│   ├── LoadingIndicator.tsx              # "Something is on its way", for a view with nothing yet
│   ├── NotFoundCard.tsx                  # A page whose subject does not exist, with the way back
│   ├── listDefaults.ts                   # Page size (20 own page, 10 inside a tab) and pagination
│   └── menuEntry.ts                      # Class of a detail page's action-menu entry
├── hooks/
│   ├── useSearchQueryParam.ts            # Search box and active tab, held in the URL
│   ├── useNow.ts                         # One shared clock for durations that keep counting
│   └── useEscapeToLeave.ts               # Escape on a detail page leads back, unless a field has focus
├── lib/
│   └── apiFetch.ts                       # fetch for authenticated endpoints, central 401 handling
├── pages/                                # Route entry points
│   ├── Login.tsx                         # Authentication page (Local & OIDC)
│   └── Settings.tsx                      # System settings page
├── stores/                               # Global state management (Zustand)
│   ├── useClientStore.ts                 # Registered clients and online/offline status
│   ├── useKeepalivedStore.ts             # The last keepalived reading per client
│   ├── useActivityStore.ts               # The activity list and the per-user seen state
│   ├── useSchedulerStore.ts              # Status of the schedulers the server runs
│   └── useUIStore.ts                     # UI state (sidebar collapse, persisted)
└── utils.ts                              # General utility functions
```

---

## 🚦 Routing & Navigation

Routing is controlled via `react-router-dom` v7 in `App.tsx`.

| Path                | Component       | Description                                                         |
| :------------------ | :-------------- | :------------------------------------------------------------------ |
| `/login`            | `Login.tsx`     | Authentication page (Local & OIDC).                                 |
| `/`                 | `AppLayout`     | The `KeepalivedDashboard`.                                          |
| `/clusters`         | `AppLayout`     | Every VRRP cluster (`ClusterOverview`).                             |
| `/clusters/:vrid`, `/clusters/:site/:vrid` | `AppLayout` | One VRRP cluster (`ClusterDetail`); `?net=` where several share site and VRID. |
| `/clients`          | `AppLayout`     | Registered clients overview.                                        |
| `/clients/new`      | `AppLayout`     | The `AddClientWizard`.                                              |
| `/client/:clientId` | `AppLayout`     | Detail view of a specific client: identity and keepalived.          |
| `/client/:clientId/edit` | `AppLayout` | The `ClientEditor` for that client.                               |
| `/client/:clientId/instance/:instanceName` | `AppLayout` | Redirects to the cluster of that instance; kept for old links. |
| `/notifications`    | `AppLayout`     | The activity list. The path and the menu entry keep the old name.   |
| `/users`            | `AppLayout`     | User management.                                                    |
| `/tokens`           | `AppLayout`     | Registration token management.                                      |
| `/settings`         | `AppLayout`     | System settings (retention of tokens and activity).                 |

All routes except `/login` are wrapped in a `ProtectedRoute` component that redirects unauthenticated users to `/login`.

The `AppLayout` uses the `Dashboard` component from `@stefgo/react-ui-components`. Since library 3.0 it renders **only the navigation** and highlights the entry whose `path` matches; the page content is a `<Routes>` element passed to it as `children`. A `DashboardPage` entry is therefore `{ id, path, nav }` — path (with `:param` segments), plus label, icon and an optional badge. Navigation is organised into `navGroups` (`overview` with the dashboard, `resources` titled "Monitoring" with clusters and clients, `notification`, `admin`).

A path no entry claims reaches the catch-all route and renders a **404 card** that names the path and leads back to the clients view. The Dashboard used to fall back to its first page silently, so an unknown URL looked like the clients page.

**The pages are loaded on demand** (`React.lazy` with a `Suspense` fallback), so a chunk arrives with the route that needs it. The previous shape passed every page as an element to the Dashboard, which built the tree of every page on every render of the shell even though one was on screen.

Each route takes what it needs from the stores itself: `ClientsRoute` and `ClientDetailRoute` read `useClientStore`, the keepalived pages read `useKeepalivedStore` and `useClientStore`. A client id that is not in the store yet renders the list rather than redirecting, because a link to a client arrives before the client list does.

---

## 🔐 Authentication

Authentication is managed by the `AuthProvider` (`src/features/auth/AuthProvider.tsx`); components read it through `useAuth` from `AuthContext.ts`.

Each context is split the same way: the context object and its hook live in a JSX-free `.ts` module, the provider component in a `.tsx` file of its own. A module that exports a component next to a hook cannot be swapped by Vite's Fast Refresh, and `react-refresh/only-export-components` reports it as an error.

- **Session**: The JWT never reaches JavaScript. The server keeps it in the httpOnly cookie `kasm_session`, which the browser sends with every request and with the WebSocket handshake. The page only reads the flag cookie `kasm_auth`, which carries no secret, to decide whether to render the login form.
- **Provider**: The `AuthProvider` wraps the app and provides `isAuthenticated`, `user` (`{ id, username }` from `GET /api/v1/me`, `null` until it answers), `login()` and `logout()`. `logout()` clears the flag, calls `POST /api/auth/logout` to remove the httpOnly cookie, and returns to `/login`.
- **Login Flow**:
    1. **Local**: POST to `/api/login` → the server sets the cookies → `login()`.
    2. **OIDC**: Redirect to `/api/auth/login` → provider callback with code → the backend exchanges the code, sets the cookies and redirects to `/`. Nothing is passed in the URL.
- **Stale flag**: The flag can outlive the session (a restarted server with a new `jwtSecret`, an expired token). The first request, `/api/v1/me`, then answers `401` and `apiFetch` logs out.
- **API calls**: Every request to an authenticated endpoint goes through `apiFetch` (`src/lib/apiFetch.ts`). It sends the request with `credentials: "same-origin"`, so the session cookie goes along, and reacts to `401` in one place: it calls the `logout` the `AuthProvider` registered with `setUnauthorizedHandler` and throws `SessionExpiredError`, so the router lands on `/login`. Stores and components therefore take no token parameter. `Login.tsx` keeps plain `fetch` on purpose — `/api/login` and `/api/auth/config` are unauthenticated, and a wrong password must produce an error message, not a logout.
- **Expiry**: Besides the `401` handling, the `AuthProvider` logs out at the `expiresAt` that `/api/v1/me` reports, because a dashboard fed only by the WebSocket may not send a request for a long time.
- **Login UI**: The `Login.tsx` page uses the pre-built `LoginPage` component from `@stefgo/react-ui-components`, configured with app title, auth type, and handler callbacks.

---

## 🗂️ State Management

### Modular State Management

We use **Zustand** split into specialized stores to maintain a clean, reactive state.

- **`useClientStore`**: Holds the master list of registered clients and their real-time online/offline status. Provides `fetchClients`, `deleteClient`, `updateClient`, and `setClients` (used by WebSocket updates).
- **`useKeepalivedStore`**: The last reading per client (`states: Record<clientId, KeepalivedState>`). `setState` takes one from `KEEPALIVED_STATE_UPDATE`, `fetchStates` loads all of them once after login (the WebSocket pushes them too), and `refresh(clientId)` asks one agent to read now — the result arrives over the socket like any other reading. Clusters are not stored: `useVrrpClusters` derives them.
- **`useActivityStore`**: The activity list (`ActivityRecord[]`) and `currentUserId`, which the per-event seen state is kept against. Fed by `ACTIVITY_UPDATE`, `ACTIVITY_APPENDED` and by `fetchEvents` on connect; `markManySeen` and `clearAll` update optimistically and then call the API.
- **`useSchedulerStore`**: `schedulers`, the status of each scheduler the server runs (`notification-cleanup`, `token-cleanup`). Filled by `setSchedulers` from `GET /api/v1/settings/scheduler-status` and kept current by `applyUpdate` from `SCHEDULER_STATUS_UPDATE`, one scheduler at a time.
- **`useUIStore`**: Manages global UI state — currently sidebar collapse state. Uses Zustand's `persist` middleware to save state to `localStorage` (`kasm-ui-storage`).

### Real-time Updates (WebSocket)

The `WebSocketProvider` (`src/features/app/context/WebSocketProvider.tsx`) maintains a persistent WebSocket connection to the backend (`ws://.../ws/dashboard`), authenticated by the session cookie the browser sends with the handshake. It also hands `user.id` to `useActivityStore.setCurrentUserId`. Incoming messages are dispatched to the stores:

| Event                  | Handler                                          |
| :--------------------- | :----------------------------------------------- |
| `CLIENTS_UPDATE`       | `useClientStore.setClients`                      |
| `KEEPALIVED_STATE_UPDATE` | `useKeepalivedStore.setState(state)`          |
| `ACTIVITY_UPDATE`      | `useActivityStore` — replaces the activity list  |
| `ACTIVITY_APPENDED`    | `useActivityStore.appendEvents` — merges new events by id, newest first |
| `SCHEDULER_STATUS_UPDATE` | `useSchedulerStore.applyUpdate`               |

On connect the server sends `CLIENTS_UPDATE`, every stored keepalived reading and the activity list by itself, so the first screen fills without a REST call.

---

## 🧩 Feature Details

### ManagedClients (`features/clients`)

The container component for the client management view. Coordinates between the client list, the editor and the add-client wizard.

- **Functionality**:
    - Displays the list of registered clients (`ClientList`).
    - Opens the client editor (`ClientEditor`) for renaming a client, setting its site (part of the VRRP cluster key: hosts of one cluster need the same site), for inbound clients editing or switching off the address its connections must come from, and for outbound clients the address the server dials. `Escape` leaves the editor and discards, as the Cancel button beside it does; while anything has been changed the footer says so, which is the safety net for both. The field is validated with `Ipv4OrCidrSchema` from `@kasm/shared`, the same rule the server applies; server errors are shown in the form. An allowed address that would not let `inboundLastIp` — the address of the agent's last successful connect — back in is called out beneath the field, using the same `isIpAllowed` the server decides with. It does not block saving: the value is well-formed and the agent may have moved on purpose, so this is a consequence worth seeing, not a reason to refuse.
    - Opens the `AddClientWizard` — one flow for both connection modes, replacing the former "Add Outbound Client" dialog and "Generate New Token" button.
    - The row menu's **Reload** asks the agent to read keepalived now, or — for an offline outbound client — dials it again.
    - A **keepalived** column sums up the host's last reading: `2 instances · 1 MASTER`, with FAULTs called out, or "Not running" / "Unreadable".
    - Deletes clients after a confirmation that says what goes (the server-side record and last keepalived reading) and what stays (keepalived on the host; the agent keeps running but is refused).

### LoadingIndicator (`components`)

"Something is on its way", for a view with nothing to show yet — a lazy route, the settings loading, a client's first keepalived reading. `role="status"` announces the label when it appears; the spinner is decorative.

### StatusDot (`features/clients`)

The dot that says whether the server currently holds a connection to a client — in the client list, the client header and the host column of every cluster.

It takes a boolean rather than a client's status field, because two of the call sites have only the boolean: the comparison belongs to the caller, the appearance belongs to the component. The dot is `aria-hidden`, since every place that shows it also names the state in text.

### Dialogs

`Modal` from `@stefgo/react-ui-components` is what a dialog is built from. The three hand-built overlays that preceded it (`fixed inset-0 bg-black/80 …`) had no focus trap, no Escape, no scroll lock and no focus return.

- `UserDialog` turns `closeOnOverlayClick` off: it holds unsaved input, and a stray click beside it should not discard the work.
- `TokenModal` turns `closeOnEscape` off as well and hides the close button. The token is in the clear exactly once, so dismissing the dialog is not a way out but the loss of what the flow was for; the button below it is the only way on.

Editors that live in the workspace rather than in a dialog bring their own `Escape` on a `window` listener — see `AddClientWizard` and `ClientEditor`.

### Confirmations

Every question before an action, and every notice after a failed one, goes through `useConfirm()` from the library. `ConfirmProvider` sits next to `ToastProvider` in `App.tsx` and renders the one dialog that answers; no component keeps a pending request, a busy flag or a `ConfirmDialog` of its own, and no component calls `window.alert` or `window.confirm`.

- `confirm(options)` resolves `true` or `false`. An action that is quick to hand off — a pull, a discard — runs after the `await`.
- An action whose outcome is worth waiting for — a delete — goes in `onConfirm`. The dialog stays open and busy until it settles; a rejection keeps it open with the error inside it, next to the button that retries. That is why the store's delete actions throw rather than reporting the failure themselves.
- `alert(describeFailure(title, error))` from `utils.ts` reports a failure of an action that was not asked about first, such as the cleanups in Settings.

**The texts live in a `confirmations.ts` per feature** (`activity`, `clients`, `tokens`, `users`), one `describeX(...)` per action, returning the complete options including `variant`. A component decides *that* it asks, never *what* the question says or whether it is `danger`. The reasoning behind a wording — what the agent really does, what stays on the host — is kept as a comment on its function.

### AddClientWizard (`features/clients/components/add-client`)

One flow for both connection modes, built on `Wizard` from `@stefgo/react-ui-components`. Step 1 is the decision about which side opens the connection; step 2 is the branch that follows from it. As two separate entry points this was a decision the operator had to have made before reaching a form.

It lives in the workspace rather than in a modal, because the two branches end in different things: a token to carry to another machine, or a connection attempt that may fail with a reason worth reading.

- **Inbound branch**: display name and allowed address for the client the token will create. Both optional — without them the agent's hostname names the client and the address it registers from becomes its allowed address. Ends in a `TokenModal`, which shows the token once.
- **Outbound branch**: hostname, target address and the agent's setup PIN (or its `KASM_REGISTRATION_SECRET`); finishing dials the agent straight away, and a refusal is shown on the step with the agent's own reason.
- The wizard renders only the current step, so the form state lives above it in `useAddClientForm` — a step holding its inputs in its own `useState` would lose them on Back.
- Both fields that the server validates are checked in the form with the same functions the endpoints use (`Ipv4OrCidrSchema`, `normaliseTargetAddress` from `@kasm/shared`).
- `Escape` leaves the wizard. The listener sits on `window`, one level further out than menus and dialogs that listen on `document` and stop the event there, so an open select closes itself without taking the wizard with it. It is off while the token is on screen: that dialog is acknowledged by button, because the token is shown exactly once.

### ClientOverview (`features/clients`)

The detail view for a single client, shown when navigating to `/client/:clientId`. An
`EntityHeader` names the client and keeps keepalived's state on screen as details —
running, unreadable or stopped with its version and PID, instances, MASTER, FAULT
(`summarizeKeepalived`). A FAULT count above zero is also a badge in the title row, and a
failed reading's error sits in the header's `alert`. The client's identity stays behind
"Show more" — id, agent version, allowed or target address, time of the last reading. Its
menu reads keepalived now (online clients only) and opens the editor.

Below it `ClientKeepalivedPanel` shows the last reading: the `VrrpInstanceView` and the sync
groups. A row opens the page of the instance's cluster, where its counters are. **An
offline client keeps its reading on screen**, dimmed and with a line saying that it is the
last one reported rather than the present state — the server keeps it for exactly that.

### KeepalivedDashboard (`features/keepalived`)

The landing page at `/`. Four `StatCard`s — hosts online, VRRP clusters (with the instance
count), MASTER (with the FAULT count) and warnings — then a card listing online hosts without a
usable reading (keepalived stopped or unreadable), then every cluster whose health is not
`ok`. A healthy fleet shows the numbers and one line saying so.

### ClusterOverview & ClusterCard (`features/keepalived`)

`/clusters` is one `DataMultiView` in tree mode, the clusters needing attention first. The
first level is the virtual router — VRID, virtual addresses and the health badge
(`CLUSTER_HEALTH` in `lib/vrrp.ts`, with the explanation as the tooltip); the second level is
its hosts — online dot, link to the client, instance, VRRP state, priority — ordered by
effective priority, so the node that should be MASTER is on top. Every row starts expanded. An
offline member's row is dimmed. A cluster row opens the cluster's page, a host row the host.
The search matches VRID, site, network, address, host and instance name and keeps a whole
cluster when one of its hosts matches. The list view, which narrow screens always get, shows
one entry per cluster with its hosts inside it; its addresses open the cluster's page.

`ClusterCard` is the same cluster as a single card — the virtual addresses (a link to the
cluster's page) and VRID as its title, a `VrrpInstanceView` with a host column as its body,
where a row opens the host. It leaves out the VRID (`showVrid={false}`), which is part of the
cluster's identity and the same on every row. The virtual addresses are not: they belong to
the host that carries them, and a member serving a short list is read off them. Like the
interface and the advertisement interval, they are shown in the list view only — an address
list needs a line per row, which a table column cannot give it. The dashboard lists the
troubled clusters with this card; the cluster page uses it as its list of hosts, with a
plain title, since its header says the rest.

**Clusters are derived, never fetched.** `useVrrpClusters` runs `buildVrrpClusters` from
`@kasm/shared` over the readings in `useKeepalivedStore` and the online clients in
`useClientStore`. That is the function the server's `/api/v1/keepalived/clusters` runs, so the
page and the endpoint cannot disagree, and a client going offline changes a cluster's health
on the next render without anything being sent. Readings of clients that have since been
deleted are left out.

### ClusterDetail (`features/keepalived`)

One cluster at `/clusters/<vrid>`, or `/clusters/<site>/<vrid>` for clients with a site,
opened from a cluster row, a cluster card's title or an instance row on a client's page.
`clusterPath` in `lib/vrrp.ts` builds the address. A VRID is unique per broadcast domain
only: two segments of one site may use the same one, and only then does the path carry
`?net=` (`clusterNetworkKey`) to tell them apart. A bare path that fits several clusters
shows a list to pick from. A cluster without a VRID has no page.

- An `EntityHeader` with site / VRID and the health badge. It carries four details, all of
  them shown: site, VRID and the network — what identifies the cluster — and the latest
  reading. Nothing hides behind a "Show more", so the header keeps no `persist` key.
  Everything that belongs to one host rather than to the cluster is read off the host table
  below: which one is MASTER, which are online, their instance names, interfaces,
  advertisement intervals, sync groups and virtual addresses. Offline hosts and members
  whose address list falls short are named in the header's alert.
- The cluster's `ClusterCard` as the list of hosts; a row opens the host. Its `compare` prop
  adds a leading checkbox column (`leadingHeader` / `leading` of `VrrpInstanceView`) that picks
  the hosts the counters are compared for.
- **Counters side by side**, one column per compared host, ordered by effective priority, the
  counter column sticky while the rest scrolls. At first only the hosts that counted packet or
  authentication errors are compared (`defaultCompareSelection`); where none did, the card
  says so and waits for a pick. Where a compared host counted errors, the table shows only
  the groups holding them; "Show all" in the card header brings back the others, "Show errors
  only" narrows it again. Only the reader's own picks are kept, in memory, so a host that joins later still gets the
  default. They are only
  worth reading together: what the MASTER sends, a BACKUP receives. `groupCounters` puts them
  into groups (advertisements, MASTER role, priority zero, packet errors, authentication
  errors) under one name whichever dump they came from — the text dump says
  `advertisements_received`, the JSON dump `advert_rcvd`, and one agent may send both. A
  counter this build does not know lands in "Other" rather than being dropped. An error
  count above zero is red.
- The last 20 activity events of the cluster's instances, each led by its host, trace left
  out as on the activity page. Where all hosts name the instance alike, a link opens that
  page searching for the name.

A cluster no host reports any more shows a `NotFoundCard` leading back to the cluster list.
The instance page this one replaced, `/client/:clientId/instance/:instanceName`, is kept as
a redirect to the instance's cluster, so old links still land.

### VrrpInstanceView & VrrpStateBadge (`features/keepalived`)

One view for a host's instances and for a cluster's members: instance (with its sync group),
state (with the configured state where it differs), interface, VRID, priority (configured →
effective where a track script moved it), advertisement interval, virtual addresses and the
last transition. A `DataMultiView` that shows them as a table or a list; interface and
advertisement interval are in the list only, to keep the table narrow. Every card has its
own toggle, and the choice is stored under one key (`vrrpInstanceViewMode`) for all of them.
A narrow screen always gets the list. Rows keep the caller's order until a column (instance,
state, priority) is sorted. A row with an `href` opens it and passes the current path as
`from`, which the page it opens uses as the way back. `VrrpStateBadge` gives every state one colour, everywhere:
MASTER `success`, BACKUP `info`, FAULT `error`, INIT and STOP `warning`, the rest `neutral`.

`Escape` on a detail page is handled by `hooks/useEscapeToLeave`. It does nothing while the focus is in a field, so Escape in a list's search box clears nothing and leaves nothing.

### ActivityView (`features/activity`)

The page at `/notifications` — the menu entry keeps the name, what it shows does not. Its
entries are structured events: a `kind`, a `level`, what the event is about and the facts of
that kind.

**The text is written here.** `activityText.ts` is the one place a wording exists: an agent
reports `vrrp.state_changed` with the two states and nothing else, and the sentence —
"VRRP instance VI_WEB: MASTER → BACKUP" — is composed from that. So an agent of an older version stays useful without knowing how today's
dashboard phrases things, a wording can be changed without asking a fleet of hosts to
update, and the level filter works on `level` rather than on a search through prose. A
kind this build does not know still gets a row — the fallback prints the kind itself, because
dropping the line would hide an observation nobody can make again.

**Rows are groups.** `groupActivity.ts` folds the flat list by `correlationId`: a summarising
event is the head, the rest are its expandable steps (`ActivityGroupSteps`, with an `N steps`
badge). None of today's kinds carries a `correlationId`, so every row is a single event; the
mechanism stays for kinds that will. The head carries the most
severe level in the group, so a run whose last step failed does not read as an untroubled
one. Grouping is a lookup, not a guess — whoever caused the group put its id on every member
— so nothing depends on arrival order and an event delayed by an offline stretch still lands
in its group hours later. A group with no head yet (an action still running) is stood in for
by its earliest member, so no event can go missing.

**The level filter is a minimum.** It sits at the right end of the search bar (`searchActions`)
and opens on what needs a look: `error` while an error is unseen, else `warning` while a
warning is, else `info` — the same rule as the sidebar badge. The start is fixed once the list
is known, so marking rows seen does not move the filter. `trace` events — agents connecting
and disconnecting — are hidden until `trace` is chosen.

**A second filter hides what has been seen.** Next to the level filter, `all` / `unseen`
switches between the whole list and the rows with something unseen in them; under `unseen` a
row leaves the list once it is marked seen. It starts at `all`.

**"Mark as seen" follows the filter.** It marks the unseen events of every row the level
filter and the search leave, across all pages, and nothing the reader has not been shown.

**Entries are not deleted one by one.** A row can be marked seen; the history goes as a whole
("Delete all") or through retention. The sidebar badge does not
count them either. An event that names a host but carries no `clientName` (recorded before
the server stored it) gets the name from `useClientStore` by `clientId`.

Everything else is found through the search box, as on the other lists (`useSearchQueryParam`,
so the query survives a reload). It matches the sentence a row shows, its detail line, the
`kind`, and the host, VRRP instance, VRID and interface the event is about — the latter three
are also shown as chips under the line. A group matches when
any of its events does, so a step is found under the operation it belongs to. The sidebar
badge counts single unseen events, not groups.

### UserOverview (`features/users`)

Manages user accounts. Supports creating, editing, and deleting users via a `UserDialog` form. Deleting asks first; the dialog states that a session the account already holds stays valid until it expires, because the API checks only the JWT. For the last remaining user a second dialog explains why it cannot be deleted instead of sending the request. `UserList` is a `DataMultiView` like every other list: search by username, a list view for narrow screens, pagination.

### TokenOverview (`features/tokens`)

Lists registration tokens via `TokenList` — a `DataMultiView` with search over token hash, display name and address — and deletes them after asking. Tokens are **issued in the `AddClientWizard`**, not here: that is where the two defaults a token carries — display name and allowed address — are entered, and a second entry point would only produce tokens without them. The list shows a token by the first 12 characters of its SHA-256 hash (the full hash in the tooltip), since the server keeps nothing else; the token itself is shown once, in the wizard's `TokenModal`. It shows both defaults per token, or "From the agent" for a token that carries neither.

### Settings (`pages/Settings.tsx`, `features/settings`)

System settings page, one section per tab: Client Tokens and Notification History. The tabs are the library's `useTabs`/`TabList`/`TabPanel`, and the open one is kept in the URL (`?tab=`). The sections live in `features/settings/components`; `features/settings/sections.ts` names the keys each one edits.

**Every section saves on its own.** Its Save sends only its own keys, and `PUT /api/v1/settings/cleanup` merges them into the stored block, so a section never writes over edits in another one. A tab with unsaved edits carries a dot. The manual maintenance runs act on the saved values, not on unsaved edits.

**Every tab follows one layout:** its settings, then one `SchedulerBox` headed "Scheduler". It shows Status (`Running…` or `Idle`), Last Run (with "manual" when a user started it), Next Run (or "Disabled") and Result, and, below a divider, the `ManualRun` row with its Run Now button. The box draws no field borders: its values are to read, not to edit. It reads `useSchedulerStore`; the result is worded by `describeRunResult` (`features/settings/lib/runResult.ts`), in red for a failed or interrupted run. The settings page uses no monospaced type.

| Setting                                      | Description                                                                   |
| :------------------------------------------- | :---------------------------------------------------------------------------- |
| `token_retention_days`                       | Days to keep used/expired registration tokens before cleanup.                 |
| `token_cleanup_interval_hours`               | Automatic token cleanup interval. `0` disables.                               |
| `notification_retention_days`                | Days to keep activity events.                                                 |
| `notification_retention_count`               | Minimum number of the newest activity events always kept.                     |
| `notification_cleanup_interval_hours`        | Automatic activity cleanup interval. `0` disables.                            |

- `GET/PUT /api/v1/settings/cleanup` — Fetch and save settings.
- `POST /api/v1/settings/cleanup/invalid-tokens` — Manually run the token cleanup.
- `POST /api/v1/settings/cleanup/notifications` — Manually run the activity cleanup.
- `GET /api/v1/settings/scheduler-status` — Status, last and next run of both schedulers.

How often an agent reads keepalived is not a server setting: it is `keepalived.pollInterval`
in the agent's own `config.yaml`, because the agent reads on its own clock whether or not the
server is reachable.

The client list's "Capabilities" column lists what the connected agent declared, as it named
it (`vrrp`); an offline client shows `–`, because capabilities belong to the build on the
wire, and a connected agent that declares none shows "None".

---

## 🎨 Styling & Theming

- **Tech Stack**: Tailwind CSS v3 with the `@stefgo/react-ui-components/tailwind-preset` as the base configuration.
- **Dark Mode**: Supported via the `class` strategy. The `dark` class is applied to the `<html>` tag, controlled by `ThemeProvider`. **A colour is one class, not two:** `bg-card` resolves per theme because the preset redefines the custom property behind it in its `.dark` block. The `…-dark` twins (`dark:bg-card-dark`) are gone with library 3.0, and the preset sets `darkMode` itself.
- **UI Library**: All generic components (Buttons, Inputs, Cards, Dashboard shell, etc.) come from `@stefgo/react-ui-components`. Domain-specific components live in `src/features/`.
- **Colours are roles, not palette values**: `bg-success`, `text-error`, `text-warning`, `text-info`, `bg-error-bg`. The library decides once what a role looks like in either theme, so a status dot cannot be a different green from one view to the next. Status pills are the `Badge` component.
- **Custom Tailwind Extensions**: the font family **Inter**, and nothing else. The former `app.text-footer` (`#444444`) only existed to stay readable on a white panel, and `shadow-glow-online` was a fixed green; the online dot uses `shadow-glow-success`, which the preset derives from the success token.
- **Tailwind Integration**: Tailwind merges `darkMode` and `safelist` from the preset, but **not** `content`: a `content` array in the app's config replaces the preset's rather than extending it. The library's own glob is therefore spread back in, or every class only the library uses is missing from the output:

```javascript
content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}", ...preset.content, ...localUiContent],
```

### Working against a local checkout of the UI library

By default Vite, Tailwind and the type check all use the **installed** `@stefgo/react-ui-components` (pinned in `server/frontend/package.json`). A build must not depend on a sibling checkout that CI and the Docker build do not have.

To develop the library and the app together, set `VITE_USE_LOCAL_UI=true` in the shell (optionally `VITE_UI_COMPONENTS_PATH`, default `../../../react-ui-components` relative to `server/frontend`):

| Tool | Installed package (default) | `VITE_USE_LOCAL_UI=true` |
| :--- | :--- | :--- |
| Vite | resolves the package from `node_modules` | aliases the import to `<path>/src/index.ts` |
| Tailwind | preset and `content` glob from the package | loads the checkout's `tailwind-preset.js` and scans `<path>/src/**/*.{ts,tsx}` |
| Type check | `npm run typecheck -w server/frontend` | `npm run typecheck:local-ui -w server/frontend` (`tsconfig.local-ui.json`) |

Always switch all three together; otherwise the compiler checks one version of the library while Vite bundles another. Tailwind swaps the preset with the glob, because the preset carries the theme — on the installed preset a local build would run new components on the old theme. `tsconfig.local-ui.json` cannot read environment variables and uses the default path. `compose.dev.yaml` already sets `VITE_USE_LOCAL_UI=true` for the dev container.

---

## 📦 UI Library (`@stefgo/react-ui-components`)

The app is heavily integrated with `@stefgo/react-ui-components`, pinned to an exact version (4.1.0). Components used:

| Component / Type       | Usage                                                     |
| :--------------------- | :-------------------------------------------------------- |
| `Dashboard`            | App shell with sidebar, user menu, theme toggle. Renders navigation; the pages come from the app's routes as `children`. |
| `DashboardPage`        | Type for a navigation entry (`{ id, path, nav }`).        |
| `LoginPage`            | Pre-built login form UI (local & OIDC).                   |
| `Card`                 | Generic surface card. `padding="none"` for a card that holds a table. |
| `StatCard`             | Stat tile — the dashboard numbers (clickable, leading to their page). |
| `Input`                | Form input field.                                         |
| `Button`               | Button with variants (primary, secondary, danger).        |
| `DataTable`            | Table view with sorting and paging.                       |
| `DataMultiView`        | Switches between table, list and tree views for data.     |
| `DataTableDef`         | Column definitions for table mode.                        |
| `DataListDef` / `DataListColumnDef` | Column definitions for list mode.            |
| `DataAction`           | Typed action descriptors for data row operations.         |
| `ActionMenu`           | Context ("kebab") menu for per-item actions.              |
| `useActionMenu`        | Hook for `ActionMenu` state; supplies the trigger's `anchor`. |
| `useTabs` / `TabList` / `TabPanel` | The settings page's sections. See below. |
| `Modal`                | The base every dialog is built from — focus trap, Escape, scroll lock, focus return. |
| `Wizard` / `WizardStep` | The step flow the `AddClientWizard` is built on.          |
| `Select`               | Dropdown in the forms.                                    |
| `useToast` / `ToastProvider` | Transient result messages raised from the shell.     |
| `cn`                   | Class-name join; the app uses it where it draws a surface itself. |
| `ConfirmProvider` / `useConfirm` | Every confirmation and failure notice. See [Confirmations](#confirmations). |
| `Badge`                | Status pill in one of five roles (`success`, `warning`, `error`, `info`, `neutral`). |
| `Checkbox`             | Checkbox with label, `indeterminate` for a partial selection.  |
| `ActionButton`         | Round icon button with a tooltip — close, copy, expand, kebab.  |
| `EntityHeader`         | Header of the client page: title, badges, actions, and details that open on request. Whether they are open is kept in `localStorage` (`kasm.client.details`). |
| `FOCUS_RING` / `FOCUS_RING_INSET` / `FOCUS_RING_NONE` | The focus ring for the few surfaces the app still draws itself: an inline chip, a tab, a menu entry. Every library component brings its own. |

**The data views own sorting and paging.** A view receives the complete set in `data` and takes the page *after* sorting, which is what makes a column sort cover every row instead of the ten on screen. The page state lives in the view, configured through `pagination(PAGE_SIZE.…)` from `components/listDefaults.ts` — 20 rows for a list that is a page of its own, 10 for one inside a tab; `usePagination` is only for holding it outside, and the app does not need it. Sorting, search and view mode follow the same shape: `sort={{ defaultValue: [...] }}`, `search={{ value, onChange }}`, `viewMode={{ persist: { key, scope: "local" } }}` — the persistence vocabulary that replaced the bare `storageKey` in library 4.0; `scope: "local"` is what `storageKey` did, so a chosen view mode survived the move.

**The tabs are the library's.** The settings page drives its section list and the panels beside it from one `useTabs({ tabs, value, onChange, orientation: "vertical" })`: it supplies the roles, the tab-to-panel wiring, the roving tabindex and the arrow keys. `TabPanel` keeps a panel that has been opened once mounted (`visited`), so unsaved edits survive a switch away and back. The active tab itself is a URL parameter, so a reload and a shared link land on the same tab.
