# FlowBoard — Feature Tour

A guided walk through every screen in FlowBoard, in the order you would meet
them. This is the **reader's** guide: it explains what each surface does and how
to drive it, not how it is built. If you want the code, start at
[`AGENTS.md`](../AGENTS.md).

Setup instructions live in the [README](../README.md). The tour below assumes you
have run `pnpm db:seed` and signed in as the seeded administrator, which is why
every screen already has realistic data in it.

---

## Contents

1. [Signing in](#1-signing-in)
2. [The shell: sidebar, topbar, org switcher](#2-the-shell-sidebar-topbar-org-switcher)
3. [Organizations, teams, and members](#3-organizations-teams-and-members)
4. [Projects and the custom workflow editor](#4-projects-and-the-custom-workflow-editor)
5. [The Kanban board](#5-the-kanban-board)
6. [The task sheet](#6-the-task-sheet)
7. [Backlog and sprints](#7-backlog-and-sprints)
8. [Roadmap (Gantt)](#8-roadmap-gantt)
9. [Table](#9-table)
10. [Calendar](#10-calendar)
11. [Reports dashboard](#11-reports-dashboard)
12. [Working together: realtime and presence](#12-working-together-realtime-and-presence)
13. [Notifications](#13-notifications)
14. [Command palette and search](#14-command-palette-and-search)
15. [Theme Studio](#15-theme-studio)
16. [Arabic and right-to-left](#16-arabic-and-right-to-left)
17. [Administration](#17-administration)
18. [The diagnostics drawer](#18-the-diagnostics-drawer)
19. [Keyboard shortcuts](#19-keyboard-shortcuts)

---

## 1. Signing in

FlowBoard has **no public sign-up**. There are exactly two ways to get an
account, and both start with somebody who already has one:

- an administrator **provisions** you from `/admin/users`, or
- somebody sends you an **invite link** (`/invite/<token>`), which you open,
  choose a password on, and are signed straight in.

The login page is at `/login`. The seeded administrator is
`admin@flowboard.dev` / `admin1234`; every other demo account uses
`password1234`. Both are printed at the end of `pnpm db:seed`.

An invite link can be opened whether or not you are already signed in, and it can
carry three things: the organization you are joining, the role you get there, and
— optionally — a direct grant into one specific project, so a contractor can be
invited to exactly one project and nothing else.

## 2. The shell: sidebar, topbar, org switcher

Every signed-in screen sits inside the same frame.

- The **sidebar** is contextual. Inside a project it lists the six project
  surfaces — Board, Backlog, Roadmap, Table, Calendar, Dashboard — plus Project
  settings. Inside an organization it lists Organization, Teams, Members, and Org
  settings. Below those sit your personal destinations (Notifications, Profile,
  Theme) and, if you are a global administrator, the Admin section.
- The sidebar **collapses to an icon rail**; each icon keeps its name as a
  tooltip. On a narrow screen it becomes a drawer instead.
- The **topbar** carries the org switcher (you can belong to several
  organizations), the command-palette trigger, the presence avatars for the
  project you are looking at, a **light/dark toggle**, a **language switcher**
  (English ↔ العربية), the notification bell, and your account menu.

The topbar is an extension point rather than a fixed bar: features register
themselves into a `start` / `center` / `end` slot, which is how the bell and the
diagnostics toggle appear there without anything editing the topbar itself.

## 3. Organizations, teams, and members

FlowBoard's hierarchy is **Organizations → Teams → Projects**, and a person can
belong to more than one organization at a time.

| Screen                | Path                   | What you do there                                                               |
| --------------------- | ---------------------- | ------------------------------------------------------------------------------- |
| Organization home     | `/o/:orgSlug`          | The org's projects, with a **Create project** action.                           |
| Teams                 | `/o/:orgSlug/teams`    | Create teams and set their membership.                                          |
| Members               | `/o/:orgSlug/members`  | The people in the org, their role (admin or member), and the **Invite** action. |
| Organization settings | `/o/:orgSlug/settings` | Name and slug.                                                                  |

Roles work in three tiers and the widest one wins: a **global admin** can do
everything; an **org admin** can do everything inside their organization; a
**project role** (admin / member / viewer) applies to one project. A viewer can
read every view but cannot change anything — every write control is simply not
there for them.

## 4. Projects and the custom workflow editor

A project owns a key (`FLOW`), which is what gives its issues keys like
`FLOW-142`. Issue numbers are allocated by the server, so two people creating a
task at the same moment never collide.

Project settings (`/o/:orgSlug/p/:projectKey/settings`) has four tabs:

- **General** — name, key, description.
- **Workflow** — the interesting one. You define **your own columns**: their
  names, their colours, their order, which of the three categories they count as
  (to-do / in-progress / done), and an optional **work-in-progress limit**. Below
  the column list is a **transition matrix**: a grid where you tick which moves
  are legal. The rule is deliberately forgiving — a status with **no** transitions
  defined allows every move; as soon as you tick one, the ticked set becomes the
  whitelist. So you get an open board by default and a strict one only when you
  ask for it.
- **Members** — who is on the project and at what role.
- **Labels** — the project's label set, with colours.

The workflow is enforced everywhere, not just on the board: an illegal move is
refused by the server whether it came from a drag, an inline table edit, or the
task sheet.

## 5. The Kanban board

`/o/:orgSlug/p/:projectKey/board`

One column per workflow status, in your configured order.

- **Drag a card** between columns or within one to reorder. The card moves
  instantly and the server confirms behind it; if the move is refused, the card
  springs back and you get a toast saying why.
- **Illegal drops are styled as illegal while you drag** — the board already
  knows your transition rules and your WIP limits, so a column that would reject
  the card tells you before you let go.
- A column at its **WIP limit** shows a badge; over the limit it turns
  attention-coloured.
- **Swimlanes** split the board into horizontal bands: none, by assignee, by
  epic, or by priority. Lanes collapse, and the collapsed set is remembered per
  project.
- The **filter bar** narrows the board by assignee, type, priority, label, and a
  text query. Filters are remembered per project.
- **Quick add** puts a new task straight into a column without leaving the board.
- The board is fully **keyboard-drivable** — see §19.

## 6. The task sheet

Click any card, row, bar, or chip and the task opens as a **sheet over the view
you were in**. The URL becomes `…/board/t/FLOW-142`, so it is a real, shareable
deep link — and closing the sheet is just the browser's Back, with the board
still exactly where you left it.

Inside:

- **Title and description.** The description is Markdown, and typing `@` opens a
  mention picker. Mentioning somebody notifies them.
- **Fields sidebar** — type (epic / story / task / bug / subtask), status,
  priority, assignee, reporter, story points, start and due date, sprint, labels,
  and the epic it belongs to.
- **Subtasks** — a checklist of child issues you can create in place.
- **Dependencies** — "blocks" / "is blocked by". FlowBoard refuses to create a
  cycle.
- **Watchers** — watch or unwatch; watchers get notified about changes.
- **Comments** — a thread, with mentions, edit, and delete.
- **Attachments** — drag a file in. It uploads straight from your browser to
  object storage, so a large file never queues behind the API.
- **Activity** — the complete, append-only history of the issue: every field
  change with its old and new value, every comment, every status move, and who
  did it.

## 7. Backlog and sprints

`/o/:orgSlug/p/:projectKey/backlog`

The backlog page stacks your sprints above the un-sprinted backlog. Drag issues
between sections and within them to reorder; every section shows a **points
summary** so you can see what you are committing to.

- **Create a sprint**, give it a name and dates.
- **Start** it — FlowBoard stamps the committed story points at that moment,
  which is what makes velocity meaningful later. Only one sprint can be active at
  a time.
- **Complete** it — you are asked where the unfinished issues should go (the next
  sprint, or back to the backlog), and the completed points are stamped.

## 8. Roadmap (Gantt)

`/o/:orgSlug/p/:projectKey/roadmap`

A real timeline, not a picture of one.

- A **tree sidebar** on one side (epics with their children), the **timeline** on
  the other.
- **Drag a bar** to move an issue's dates; **drag its edge** to resize. Both
  write back to the issue's start and due date.
- **Dependency arrows** are drawn as SVG between blocked and blocking issues.
- **Epics roll up** — an epic's bar spans its children.
- **Three zoom levels** (week / month / quarter) change the axis granularity, and
  a "today" line marks the current date.
- Hundreds of rows stay smooth: only the visible ones are rendered.

## 9. Table

`/o/:orgSlug/p/:projectKey/table`

The spreadsheet view. Twelve columns are available — key, title, type, status,
priority, assignee, points, sprint, labels, start date, due date, and last
updated.

- **Edit in place.** Click a cell and change it; each column has the right editor
  (a select for status, a date picker for dates, a user picker for assignee).
- **Choose your columns** from the column popover; your choice is remembered.
- **Sort and filter**, page through results, and **export to CSV** — the export
  respects your current columns, filters, and sort.
- The grid is keyboard-navigable like a spreadsheet (§19).

## 10. Calendar

`/o/:orgSlug/p/:projectKey/calendar`

Month or week. Issues appear on their due date as chips.

- **Drag a chip onto another day** to reschedule it.
- The **unscheduled tray** along the side holds everything with no due date —
  drag one onto a day to schedule it.
- Click a chip to open the task sheet over the calendar.

## 11. Reports dashboard

`/o/:orgSlug/p/:projectKey/dashboard`

Six charts, each in its own card:

| Report              | What it answers                                                   |
| ------------------- | ----------------------------------------------------------------- |
| **Burndown**        | Is the active sprint on track to finish?                          |
| **Burnup**          | How much scope was added while we were working?                   |
| **Cumulative flow** | Where is work piling up? (Built from the activity history.)       |
| **Velocity**        | How many points do we actually complete per sprint?               |
| **Cycle time**      | How long does an issue take from start to done? (A scatter plot.) |
| **Workload**        | Who is carrying how much right now?                               |

A sprint picker and a date-range picker sit at the top. Clicking a point in the
cycle-time scatter opens that issue.

## 12. Working together: realtime and presence

FlowBoard is live. When a teammate moves a card, renames an issue, comments, or
starts a sprint, your screen updates within about a second — you do not refresh
and you do not lose your scroll position.

**Presence avatars** in the topbar show who else is looking at the project you
are in.

Your own actions never arrive twice: the change you made is applied by your own
click, and the broadcast that goes to everyone else deliberately skips you. If
your connection drops and comes back, FlowBoard refetches rather than pretending
it saw everything in between.

## 13. Notifications

In-app only — FlowBoard sends no email.

Seven things notify you:

| Trigger              | You are notified when…                               |
| -------------------- | ---------------------------------------------------- |
| **Task assigned**    | an issue is assigned to you                          |
| **Mentioned**        | someone `@`-mentions you in a description or comment |
| **Status changed**   | an issue you watch moves                             |
| **Comment added**    | someone comments on an issue you watch               |
| **Sprint started**   | a sprint you are in starts                           |
| **Sprint completed** | a sprint you are in completes                        |
| **Due soon**         | an issue assigned to you is approaching its due date |

The first six are reactions to somebody's click. **Due soon** is different: it is
a periodic sweep, and it will not nag you about the same issue twice in a day.

The **bell** in the topbar carries an unread count and opens a menu of the most
recent items; `/notifications` is the full list, with mark-as-read and
mark-all-read. New notifications arrive live — the badge increments without a
refresh. Each row is a complete sentence ("Dana assigned FLOW-142 _Fix the login
redirect_ to you") and clicking it opens the issue.

## 14. Command palette and search

**Ctrl+K** (⌘K on macOS) opens the command palette from anywhere. It has three
lanes:

- **Navigation** — every destination you can currently reach, gated by context:
  project views only appear inside a project, org pages only inside an
  organization, admin pages only for global admins.
- **Search** — type to search issues across the whole organization, by key
  (`FLOW-14…`) or by title.
- **Create** — create a task without leaving the page you are on.

Matching runs on the _displayed_ label, so an Arabic session types Arabic and
finds things.

## 15. Theme Studio

`/theme`

- **Eight colour presets** — Default, Graphite, Ocean, Forest, Sunset, Rose,
  Amber, and High Contrast — each shown as a card with a miniature preview of a
  light and a dark screen.
- **Light and dark are both complete.** Switching modes is not a filter over one
  palette; each mode has its own values.
- **Edit any token by hand** and watch the app restyle as you type.
- **Eight font presets** — Inter, IBM Plex Sans, Manrope, DM Sans, Space Grotesk,
  Source Serif 4, JetBrains Mono, IBM Plex Mono — each with an Arabic-capable
  fallback, so switching language never breaks your typography.
- **Density** — comfortable or compact — changes row heights and padding across
  every view at once.
- **Import / export JSON**, so a theme is a file you can share.
- The **browser tab icon is generated from your accent colour**, live.

Your theme is applied before the app paints, so you never see a flash of the
wrong palette on reload.

## 16. Arabic and right-to-left

FlowBoard ships **English and Arabic**, and Arabic is a genuine right-to-left
interface: the entire layout mirrors, including menus, drawers, sheets, and
dropdown alignment. Switching language is instant and is remembered.

Two deliberate choices are worth knowing about:

- **Numbers stay Western** (`142`, not `١٤٢`), so an issue key reads the same in
  both languages.
- **The roadmap's time axis stays left-to-right** even in Arabic. A mirrored
  timeline reads as time running backwards; the sidebar, labels, and every
  control around it still mirror. Charts behave the same way for the same reason.

## 17. Administration

Global-admin only.

**`/admin/users`** — the people directory for the whole installation. Provision a
new user, promote or demote a global admin, reset a password, force-log-out every
session a user has, and deactivate or reactivate an account. Deactivating
immediately invalidates every token that user holds, including any live realtime
connection. You cannot lock yourself out: the actions that would apply to your
own account are disabled.

**`/admin/telemetry`** — FlowBoard's own analytics, computed from its own
database, with no third-party service involved.

- The **overview** shows traffic, latency percentiles, and the server-error rate.
- **`/admin/telemetry/events`** lists product events (what people actually did).
- **`/admin/telemetry/requests`** charts HTTP traffic over time, the busiest
  endpoints, and latency distribution.

Both pages take a time range and a bucket size.

## 18. The diagnostics drawer

Global-admin only. Press **Ctrl+J** anywhere.

A dev-tools-style log viewer opens as a **non-modal drawer** — you keep using the
app while it is open, which is the whole point. It shows the server's most recent
log lines, live.

- **Dock it to any of the four edges** with Ctrl+Shift+J, and drag its edge to
  resize.
- **Filter by level**, **pause** the stream, and **copy everything as JSONL** for
  pasting into a bug report.
- It **sticks to the bottom** as new lines arrive, and releases the moment you
  scroll up to read something.
- If the API restarts underneath you, the drawer notices and resets rather than
  freezing.

## 19. Keyboard shortcuts

Press **`?`** anywhere to see this list in the app. The global half of that dialog
is generated from the live shortcut registry, so it cannot go stale.

### Global

| Keys                   | Does                          | Available                 |
| ---------------------- | ----------------------------- | ------------------------- |
| **Ctrl+K** / ⌘K        | Open the command palette      | Anywhere, signed in       |
| **?**                  | Open this shortcuts sheet     | Signed in, no dialog open |
| **C**                  | Create a task                 | Inside a project          |
| **Ctrl+J** / ⌘J        | Toggle the diagnostics drawer | Global admins             |
| **Ctrl+Shift+J** / ⌘⇧J | Cycle the drawer's dock edge  | Global admins             |
| **Esc**                | Close whatever is on top      | Anywhere                  |

`Ctrl+K` and `Ctrl+J` work even while you are typing in a field. Single-letter
shortcuts deliberately do not — a `c` must be able to reach the comment box.

### On the board

| Keys        | Does                     |
| ----------- | ------------------------ |
| **Space**   | Pick up the focused card |
| **← → ↑ ↓** | Move the picked-up card  |
| **Space**   | Drop it                  |
| **Esc**     | Cancel the drag          |
| **Enter**   | Open the focused card    |

### In the table

| Keys               | Does                            |
| ------------------ | ------------------------------- |
| **← → ↑ ↓**        | Move between cells              |
| **Enter** / **F2** | Edit the focused cell           |
| **PgUp / PgDn**    | Page through rows               |
| **Home / End**     | Jump to the first / last column |

### On the roadmap

| Keys            | Does                          |
| --------------- | ----------------------------- |
| **← →**         | Nudge the focused bar's dates |
| **Shift + ← →** | Resize the focused bar        |
| **Enter**       | Open the focused issue        |

---

## Where to next

- [README.md](../README.md) — installing and running FlowBoard.
- [docker-guide.md](./docker-guide.md) — what the containers actually do.
- [AGENTS.md](../AGENTS.md) — the developer and agent guide, and the entry point
  to the full documentation tree.
