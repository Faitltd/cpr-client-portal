# Designer / Staff Portal — SOP

**Audience: internal CPR staff (designer, ops, finance). Route: `/designer`.**

---

## 1. Purpose and users

The Designer Portal (branded "CPR Portal," labeled "Staff views") is CPR's internal staff dashboard. It's a thin, editable window onto Zoho CRM Deals, Zoho Books financials, Zoho Projects tasks, and the Connecteam crew schedule. Homeowners and trade partners are redirected out.

There are three staff sub-roles — `designer`, `ops`, `finance` — plus `admin`, who sees everything. The sub-role controls which tabs appear.

## 2. How they log in

- **Entry:** `/auth/portal`, email + password. Staff are rows in the Supabase `designers` table (active + hashed password).
- **Landing:** `finance` lands on `/designer/finance`; `designer`/`ops` land on `/designer`.
- **Session:** the `portal_session` cookie (7-day). Admins logging in also get an `admin_session` plus a seeded designer session, so they see this dashboard with extra amber admin tabs.
- **Dual-role seeding:** if a staffer's email is also a trade partner, login additionally creates a `trade_session`. This is required for the Field Update and Field Dashboard tabs, which embed the trade-side pages in an iframe.

## 3. Tabs (gated by role)

| Tab | Route | Visible to |
|-----|-------|------------|
| Field Dashboard | `/designer/trade-dashboard` | admin, ops |
| Field Update | `/designer/field-update` | staff who also have a trade record |
| Finance | `/designer/finance` | admin, finance |
| CRM | `/designer` | everyone |
| Tasks | `/designer/tasks` | admin, designer, ops |
| Financials | `/designer/financials` | admin, ops, finance |
| Schedule | `/designer/schedule` | designer, ops (non-admin) |
| CPR Assistant | `/designer/chat` | whitelisted emails |
| Admin group (amber) | `/admin/*` | admin only |

## 4. Features

**CRM / Projects / On-Hold (the deal board).** The core view. Deal cards pulled live from Zoho CRM (via the shared admin token). The CRM tab has an in-page view selector — Project Created, Active Deals, On Hold, Lost. Each card lets a staffer:

- Inline-edit **Ball in court** and **Ball in court note** in the card header (saves on blur/Enter).
- Expand to add a **note**, view note history, edit the full **Deal fields** form (grouped Core / Scope / Address / Access / System), and open the WorkDrive folder.
- **Push to Zoho** if an inline edit saved locally but the Zoho write failed.

Edits are written through to Supabase first (a `designer_notes` cache), then pushed to Zoho — so an edit survives a Zoho outage and can be retried. Only fields explicitly marked editable ever reach Zoho; Stage, lookups, and audit fields are dropped.

**Tasks.** Per-deal cards showing completed/total from Zoho Projects, with a task list. Read-only; sorted by most incomplete work first.

**Schedule.** The crew's week from Connecteam (imported iCalendar feed, not the Connecteam API), rendered in Mountain time with week navigation and a person filter. Read-only.

**Finance.** Finance-only. An org-wide Zoho Books view: outstanding balance, overdue, open count, invoiced/paid in the last 30 days, a full invoice table, and recent payments. Display-only.

**Financials.** A per-deal contract-vs-Books rollup. SSR shows contract amounts by deal; on mount it enriches each deal with Books quoted/invoiced/paid/balance (matched by contact email, deduped by customer so multi-deal clients aren't double-counted). Clicking a deal drills into its invoices.

**Field Update / Field Dashboard.** For non-admin staff these embed the trade-side pages (`/trade/field-update`, `/trade/dashboard`) in an iframe, authenticated by the seeded `trade_session`. For admins they show oversight lists (latest field updates; field projects) read-only.

**CPR Assistant (`/designer/chat`).** A whitelisted designer picks a deal and asks about its emails, Cliq messages, invoices, WorkDrive files, and transcripts. Whitelisted designers get **admin-level bot data access** (full financials, all deals); those also in the admin bot list are elevated to the Master and Comms bots. Treat the whitelist as sensitive.

**Deal notes — two mechanisms.**

1. **Zoho CRM Notes** — real notes on the Deal. Because staff have no Zoho identity, writes go through the admin token and the author is stashed in the note title ("Designer Note: {name}").
2. **Ball-in-court sync cache** — inline BIC edits are cached in Supabase before the Zoho write, marked pushed on success or error on failure. The "Push to Zoho" button retries pending edits.

## 5. Data sources

Zoho CRM (Deals, Contacts, Notes) via the shared admin token; Zoho Books (invoices, payments, estimates, matched by email); Zoho Projects (task summaries). Supabase: `designers`, `designer_sessions`, `designer_notes`. Connecteam (ICS feed) for the schedule. The chat reuses the admin bot backend.

## 6. Gotchas

1. **All Zoho writes are attributed to the admin user**, not the logged-in staffer. Author identity is a convention (note title / `designer_notes.edited_by`), not Zoho ownership.
2. **No admin OAuth = the whole portal degrades.** Deals/notes/financials return an error and the board shows a warning rather than crashing.
3. **BIC edits are optimistic but durable** — an edit can save locally yet fail to reach Zoho. Until pushed, the portal shows the newer local value while Zoho still has the old one.
4. **Stage names are normalized and hardcoded.** A new CRM stage name that isn't in the code silently won't match a view/filter.
5. **Deal fetch caps at ~30 pages**, truncating to most-recently-modified; very old deals can fall off a list.
6. **The Field Update / Field Dashboard tabs depend on the dual-role trade session.** If a staffer's email has no trade record, the tab is hidden or the iframe won't authenticate.
7. **The chat whitelist grants admin-level data access.** Guard `BOT_CHAT_ALLOWED_EMAILS` carefully.
