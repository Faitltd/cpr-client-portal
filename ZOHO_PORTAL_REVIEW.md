# CPR — Zoho + Portal Review (v2, expanded)

Reviewed June 16, 2026. Verified against `origin/main` (local repo in sync) and a live pull of the Zoho CRM org.

## Corrections from v1

I re-checked the portal against the code. Three v1 items were wrong and are removed:

- **Invoices/financials** — fully built. `/dashboard` shows a Financials section with quoted total, amount paid, balance, and separates change orders from regular invoices; `/api/invoices` feeds it, designer financials, and the bot. `books.ts` is a working module (customer lookup, estimate/invoice listing, draft creation, file attach), not a stub.
- **Calendar/schedule** — built and in nav for both admin (`/admin/schedule`) and designer (`/designer/schedule`): collapsible week-grid calendar, list view, week nav, person filter. The Connecteam integration has a UI.
- **`portal_session` cookie "collision"** — intentional. Client and designer deliberately share one cookie, resolved through a single `getPortalPrincipal()` that returns whichever principal matches. Trade uses its own `trade_session`. This is good consolidation, not a bug.

Everything below is verified against current code or a live Zoho pull.

---

## A. Zoho: consolidate the automation sprawl

The deal pipeline has 74 workflow rules (63 active) and 81 custom functions, accreted in layers. Many do the same job under different names. This is the highest-value cleanup, and also the riskiest, because these rules fire on live deals — so each item below includes how to change it safely.

> **Safe-execution rule for all of Section A:** never hard-delete first. Deactivate the rule (or unhook the function), watch one full deal move through that stage, confirm the surviving path fired, then delete. Better: clone the org to a Zoho sandbox and stage the merges there first.

### 1. Collapse the duplicate project / WorkDrive / Cliq creation chains
**What:** Project creation runs through five overlapping pieces — `Create and Sync Project to Deal`, `Sync Zoho Projects ID`, `CPR_Create_Project_And_WorkDrive`, `Sync Project to Creator and Send Portal Invitation`, `Create client in zoho creator`. The last two are **legacy Zoho Creator portal** code, superseded by the SvelteKit portal.
**Benefit:** One path means one place to debug when a project or folder fails to spawn. Kills the dead Creator dependency, so an unmaintained app can't silently create half-records or fire stale portal invites.
**Risk of changing:** Project creation is load-bearing — if you retire the wrong function, new deals stop getting projects/folders. Mitigate by tracing which function the live "Project Created" stage actually calls before cutting the others.
**Risk of leaving it:** Race conditions (two functions creating two folders), and confusion every time someone debugs the pipeline.
**Effort:** Medium (half day to map, then incremental).

### 2. One WorkDrive "move folder on completion," not four
**What:** `Move Folder on Completion`, `Deal Completed — Move WorkDrive Folder`, `Move WorkDrive Folder to Previous Projects`, and `moveWorkDriveFolderOnCompletion2` all move the folder when a deal closes. The `2` suffix is an orphaned iteration.
**Benefit:** Removes the chance of a folder being moved twice or to the wrong parent, and eliminates "which one is real?" guessing.
**Risk of changing:** Low — pick the one currently wired to the completion stage, deactivate the rest, watch one completion.
**Risk of leaving it:** Folders occasionally land in the wrong place; future edits get applied to a dead copy.
**Effort:** Low (1–2 hours).

### 3. One Cliq channel provisioner
**What:** Channel creation is spread across `Create Internal and External Cliq Channels at PDA Signed`, `Cliq Channels Safety Net - Design Needed`, `Cliq Intro`, `Create_Cliq_Channels_for_Deal1`, `PDAN_External_Cliq`, `bpr_external_cliq`, plus two copies of `Lead Qualified: Create External Cliq Channel for Deal` (one on Leads, one on Deals). The `_Deal1` suffix is another orphaned copy.
**Benefit:** Stops duplicate or ghost channels, which are the usual cause of the "two channels for one job" complaints. One function keyed off stage is far easier to reason about.
**Risk of changing:** Medium — the "safety net" rule exists because the primary one sometimes missed. Keep a single fallback path; don't remove the safety net until the primary is proven reliable.
**Risk of leaving it:** Channel clutter, members added to the wrong channel, and the field-update Cliq posts (which must include the job name) landing in the wrong place.
**Effort:** Medium.

### 4. Rationalize the follow-up rules and naming
**What:** Competing, inconsistently-named follow-up tracks for the same stages: PDA (`3. PDA Sent: Send 1 Follow Up`, `PDA Sent - FU 4 days`), Ballpark (`BP Follow-Up 1/2/3`, `BP Needed follow up 1`, `BP Review needed follow up 2`, `Ballpark Needed – MSM Follow-Up Tasks`), Estimate/Quote (`Estimate/Quote Follow-Up 1/2`, `Estimate review needed follow up 1/2`, `8. Quote Sent: Follow Up`). Numbering is broken — two rules start with `8.`, and numbered/unnumbered are mixed. (The PDA follow-up loop was already capped at 5 — keep that cap.)
**Benefit:** A client gets one coherent follow-up cadence per stage instead of overlapping emails/tasks. Consistent naming (`[Stage] FU [n] – [delay] – [channel]`) makes the rule list self-documenting and lets you reorder execution predictably.
**Risk of changing:** Medium — over-pruning could drop a follow-up a salesperson relies on. Map current cadence per stage first, get sign-off on the target cadence, then consolidate.
**Risk of leaving it:** Clients receive duplicate nudges (looks unprofessional); reps can't tell which rule sent what.
**Effort:** Medium (the mapping is the work; edits are quick).

### 5. One contract-sent SMS path
**What:** Three things send the contract-sent text: rule `Contract Sent - SMS Notification`, function `Contract Sent SMS Notification` (Deals), and function `SendContractSentSMS` (on the ZohoSign module). Route them all through the shared `SMS_Send_From_Deal` function.
**Benefit:** One sender = no double-texting the client, and one place to fix the failing Twilio flow when it's repaired.
**Risk of changing:** Low-to-medium given telephony is already unstable (ZDialer #160094506, Twilio flow failing, ghost Voice billing #153680060). Don't rebuild on Voice — just dedupe the senders. Test against one deal.
**Risk of leaving it:** Duplicate texts now; three places to patch later.
**Effort:** Low.

### 6. Centralize phone normalization
**What:** Phone cleanup is reimplemented in `Normalize Contact Phones`, `Normalize Lead Phones`, `Call_Phone_Resolver`, `SMS Phone Resolver`, **and** in the portal (`client-password.ts`, since clients log in by phone). At least five implementations.
**Benefit:** One normalizer removes a whole class of "client can't log in" and "SMS went to a malformed number" bugs caused by the implementations disagreeing on formatting (+1, parens, spaces).
**Risk of changing:** Low in CRM (make the others call one canonical function). The portal copy must stay byte-compatible with the CRM one or logins break — align the formats explicitly.
**Risk of leaving it:** Intermittent login and SMS-delivery failures that are painful to diagnose because the logic lives in five places.
**Effort:** Low-to-medium.

### 7. Delete the dead weight
**What:** 11 rules are dormant. Retire the clearly stale ones: `June Task - Deposit Invoice`, `June Task - PDA Needed` (temporary monthly tasks), `Send Portal Invitation` and `PDA Signed: Send Client Portal Invitation` (Creator-era), `Auto Archive Closed Deals`, `Client Email - Jobsite Details`, `Deals_ZohoFlow_Deal Updated – Precon PDF to WorkDr`, `Start Date Determines Material Orders 2 Weeks Prior`, `Estimate review needed follow up 1/2`. Rename junk-named functions: `xdmvc`, `Create_Cliq_Channels_for_Deal1`, `moveWorkDriveFolderOnCompletion2`.
**Benefit:** A shorter list is faster to scan and audit; nobody wastes time wondering whether a disabled rule is supposed to be on.
**Risk of changing:** Low — they're already off. Before deleting, confirm none are referenced by an active function or a saved view.
**Risk of leaving it:** Pure clutter; raises the odds someone re-enables the wrong rule.
**Effort:** Low. Target: ~74 → ~40 rules, ~81 → ~65 functions.

---

## B. Portal: consolidate and clean up

### 8. Merge the two migration directories
**What:** `/migrations` (19 files) and `/supabase/migrations` (24 files) run on **two parallel, date-interleaved timelines** (both span 2026-02 → 2026-06). `designer_notes_cache` is defined in both (`20260603` and `20260611`) — a real duplicate. The Supabase CLI reads only `/supabase/migrations` by default, so which folder actually deploys is ambiguous. `supabase-schema.sql` is an obsolete snapshot defining legacy `projects`/`project_documents` tables nothing uses.
**Benefit:** A single ordered migration history means a fresh environment (or a new dev) can rebuild the database deterministically. Removes the risk of schema drift between what's coded and what's live.
**Risk of changing:** Medium — you must first reconcile against the **actual production schema** (the DB is the source of truth now). Don't re-run merged migrations against prod; mark them as already-applied. Get this wrong and a migration tries to recreate an existing table.
**Risk of leaving it:** A rebuild or disaster-recovery would not reproduce the real schema; the duplicate `designer_notes_cache` can already apply twice.
**Effort:** Medium (the reconciliation is the work).

### 9. Extract one `ensureValidZohoToken()` helper — highest-leverage refactor
**What:** The exact same 12-line block — `getZohoTokens()` → check `expires_at` → `refreshAccessToken()` → `upsertZohoTokens()` → use `access_token` — is copy-pasted across **73 files** (verified). There is no shared helper; only the low-level `refreshAccessToken()` exists.
**Benefit:** One helper becomes the single place to add retry on 401, rate-limit backoff, structured logging, and the multi-user/primary-token selection. It also shrinks every route handler and removes 70+ chances for the refresh logic to drift out of sync. This unblocks reliability work you can't currently do because there's no chokepoint.
**Risk of changing:** Low if done mechanically — the helper returns the same `accessToken` the inline code produced. Do it in batches by folder, lean on existing tests (`auth-guards.test.ts`, route tests already call this path), and keep the signature dead simple.
**Risk of leaving it:** Any token-handling fix (e.g. handling a revoked refresh token) has to be applied 73 times; miss one and that route breaks intermittently in production.
**Effort:** Medium (mechanical but broad). Best single investment in the portal.

### 10. Delete the redirect-only trade routes
**What:** `/trade/daily-log` and `/trade/report-issue` each contain only `throw redirect(302, '/trade/field-update')` — both deprecated in favor of the unified field-update flow.
**Benefit:** Fewer dead routes for the next person to trip over; cleaner route map.
**Risk of changing:** Low — but check for hardcoded links/bookmarks first and 301 them at the edge if any external links exist.
**Risk of leaving it:** Negligible, but it's free to clean.
**Effort:** Trivial (30 min).

### 11. Split the three mega-files
**What:** `projects.ts` (3,335 lines), `db.ts` (1,952), `auth.ts` (1,599) hold ~90 exported functions between them.
**Benefit:** Faster onboarding and code review; smaller blast radius per change; easier to find the right function. Splitting `projects.ts` into API / cache / portal-discovery also exposes the in-memory caching for the fix in #13.
**Risk of changing:** Medium — large refactors can introduce import cycles or subtle behavior changes. Keep the public export surface identical (re-export from the old path), move in small commits, and lean on existing tests (`projects.test.ts`, `db.test.ts`, `auth.test.ts` all exist).
**Risk of leaving it:** Slower development and higher bug risk as the files keep growing; merge conflicts concentrate here.
**Effort:** Medium-to-high. Lower priority than #8/#9 — do it when touching these files anyway.

### 12. Decide and document the diagnostics endpoints
**What:** Live debug endpoints (`zprojects/diagnostics`, `photos-diagnostics`, `trade-debug`, `deals-permission-test`, `client-login-diagnostics`, `client-dashboard-diagnostics`). `/admin/zprojects` already links the zprojects ones; the rest are code-search-only. (Correction from v1: they aren't all orphaned.)
**Benefit:** Either a documented `/admin/diagnostics` index makes field troubleshooting fast, or removing the stale ones shrinks the surface. Both beat the current half-linked state.
**Risk of changing:** Low. If you keep them, confirm each requires an admin session (they touch tokens and deal data); an unguarded diagnostics route leaks CRM data.
**Risk of leaving it:** Mostly discoverability — but verify the auth guards regardless, since that's a real exposure.
**Effort:** Low.

---

## C. Build out (the seam between Zoho and portal)

### 13. Shared cache for multi-instance hosting
**What:** The portal's hot caches (portal discovery, deals, task strategy) live in process memory in `projects.ts`. If Render runs more than one instance, each holds its own copy and they diverge. A DB-backed `api_response_cache` table already exists.
**Benefit:** Consistent data across instances, fewer redundant Zoho calls (helps with rate limits), and cache survives a restart. Lets you scale horizontally without weird per-user inconsistencies.
**Risk of changing:** Low-to-medium — moving a cache to the DB adds latency per lookup and needs sane TTLs/invalidation. Start with the highest-churn cache, keep an in-memory layer in front if needed.
**Risk of leaving it:** Fine on a single instance; becomes a real bug the day you scale to two.
**Effort:** Medium.

### 14. Make the Zoho ↔ portal boundary explicit
**What:** Logic lives on both sides (phone normalization in #6; payment schedules; portal invitations). There's no written rule for what belongs where.
**Benefit:** A one-page boundary doc — "Zoho owns pipeline state and automations; the portal reads, caches, and presents" — stops new automations from forking logic again, and tells you which system to change for a given bug.
**Risk of changing:** None (it's documentation). The risk is in not having it: the duplication in #1–#6 is exactly what happens without an agreed boundary.
**Effort:** Low.

### 15. Confirm the bot's per-deal sync is exposed
**What:** Both `/api/admin/bot/sync` (per-deal) and `/api/admin/bot/sync-all` exist, but I didn't find a per-deal "sync now / last synced" control in the admin bot UI. (Correction from v1: the endpoint exists; the question is UI surfacing.)
**Benefit:** A per-deal sync button with a "last synced X min ago" stamp makes the bot debuggable and trustworthy — when an answer looks stale, you re-sync that deal instead of re-running everything.
**Risk of changing:** Low — the endpoint is already there; this is a UI add.
**Risk of leaving it:** Admins fall back to global `sync-all`, which is slow and wasteful, or distrust the bot.
**Effort:** Low.

---

## Prioritized punch list

**Do first — high impact, low risk**
1. Extract `ensureValidZohoToken()` — collapses 73 duplicated blocks into one chokepoint (#9)
2. Zoho dead-weight pass — kill 11 dormant rules + rename junk functions (#7)
3. Decommission the legacy Zoho Creator portal path (#1)
4. Delete redirect-only trade routes; verify diagnostics auth guards (#10, #12)

**Do next — medium effort, real payoff**
5. Merge migration dirs against the live schema; delete `supabase-schema.sql` (#8)
6. Collapse duplicate WorkDrive-move and Cliq-creation chains (#2, #3)
7. Rationalize follow-up rule naming/cadence with sales sign-off (#4)
8. One phone normalizer (#6), one contract-SMS sender (#5)

**Build out / when already in the code**
9. Shared cache for multi-instance (#13)
10. Split the mega-files (#11)
11. Per-deal bot sync button + status (#15)
12. Write the Zoho ↔ portal boundary doc (#14)

**Note on sequencing:** Do #9 (token helper) before #8 (migrations) and #11 (file splits) — both touch the same files, and having the chokepoint in place makes those refactors cleaner. For all of Section A, stage in a Zoho sandbox or deactivate-and-watch before deleting; these rules fire on live deals.
