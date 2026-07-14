# Trade Partner Portal — SOP

**Audience: subcontractors (framers, plumbers, electricians, tile setters, etc.). Route: `/trade/dashboard`.**

---

## 1. Purpose and users

The Trade Partner Portal is the subcontractor's window into the CPR projects they're assigned to. A trade partner can see their projects, update Zoho Projects task status, work QC checklists, submit field updates and issues and change-order requests, upload job-site photos, browse scope and design documents, and ask a scoped AI assistant. It deliberately hides all pricing and financial data.

## 2. How they log in

- **Entry:** `/auth/trade`, email + password.
- **Seed password:** the phone number on file. On first login the phone is accepted, then hashed and stored.
- **Session:** a `trade_session` cookie (httpOnly, strict, 7-day), backed by Supabase `trade_sessions`.
- **Password change:** at `/trade/account` (min 8 chars).

**How a partner is linked to their work:** the `trade_partners` row carries a `zoho_trade_partner_id`. The app finds their deals by matching that id against the Deal's **Portal_Trade_Partners** lookup (fast path), related linking modules, or the **Assigned_Subs** field (fallback). A partner never picks deals manually — they see whatever they're linked to.

## 3. Layout

The hub is `/trade/dashboard` with a deal selector and tabs: **Details, Tasks, Field Updates, Change Orders**. Other pages:

- `/trade/projects` and `/trade/projects/[projectId]` — projects list and detail (tasks + QC subtasks + designs + activity).
- `/trade/checklists/[projectId]` — standalone QC checklist page.
- `/trade/field-update` — the unified submission form.
- `/trade/photos` — progress-photo gallery.
- `/trade/beforeafter` — an on-device before/after photo tool.
- `/trade/bot` — the Trade Assistant.
- `/trade/account` — email + password change.

`/trade/daily-log` and `/trade/report-issue` are deprecated and redirect to the field-update form.

## 4. Features

**Projects and project detail.** The projects list comes from the partner's linked Zoho Deals (cached briefly). Project detail shows Zoho Projects **tasks** grouped by task list, **Designs** (from the Deal), and **Recent Activity**. If a Deal has no linked Zoho project, the task list is empty. Access is authorized against the partner's own deals — a project id they aren't linked to returns 403.

**Updating task status.** Each task has a status select — Not Started (0%), In Progress (50%), Completed (100%). "Submit Changes" batches all edits in one call and writes them to Zoho Projects, returning per-task success/failure.

**QC checklists (subtasks).** Under each task, a nested checklist of quality-control items shows a done/total count. Ticking a box saves to Supabase (`task_subtasks`) and records who checked it. These are visible only in the trade portal — the client never sees them. (See §5.)

**Field Updates.** One form, five types: Field Update (progress), Report a Problem (issue), Materials (delivery), Schedule Change, and **Change Order Request**. Each submission:

- Creates a Zoho CRM **Field_Updates** record (photos attach to both the record and the Deal; videos queue for transcoding).
- Writes a Supabase backup row.
- Posts a Cliq card to the deal channel.
- The **Field Update** type also accepts a separate **client-gallery** photo set that is mirrored to WorkDrive `Client Portal/Photos` — these are the only field-update photos the homeowner sees.
- The **Change Order** type has only a **Scope** textarea (no cost field — it was removed) and additionally creates a Zoho CRM review **Task** assigned to Mary Sue, mentioning Jeff, due +2 days.

Drafts auto-save to the browser per deal.

**Photos.** Uploads go directly to Supabase Storage (`trade-photos`) via a short-lived signed URL, which avoids proxy timeouts on large videos. Images are normalized (HEIC→JPEG, resized, thumbnailed). The gallery reads progress photos from WorkDrive, grouped by project; if a deal exposes an external WorkDrive share, the page redirects there.

**Before/After.** Entirely on-device: capture a before and an after image, stored in the browser's IndexedDB. No server upload.

**Trade Assistant.** A chat scoped hard to the partner's deals. Retrieval is restricted to Designs-family WorkDrive files, CRM fields, external Cliq, Zoho Projects tasks/activity, and crew shifts; pricing/bid/quote/contract content is blocked and **financials are hidden**. Even an admin opening the trade bot inherits these restrictions.

**SOW, Scope, and Designs.** Endpoints resolve the WorkDrive "SOW/Scopes" and "Designs" folders and mint view links, or fall back to a URL stored on the Deal. Scope tasks can also be listed per trade from Supabase.

## 5. How QC checklists are generated

Checklist **items are authored by CPR**, not by AI. The library in `src/lib/server/checklists/trade-checklists.ts` holds 15 trades (Demolition, Concrete, Framing, Windows/Exterior Doors, HVAC, Plumbing, Electrical, Insulation, Drywall, Flooring, Cabinetry, Tile, Doors & Millwork, Interior Paint, Exterior Paint), each with a fixed list of items.

Generation works like this: an admin action pulls all of a project's Zoho tasks, and `gpt-4o-mini` classifies each task to the single best trade (or none). For each matched task, that trade's full item list is inserted as subtasks in Supabase (`task_subtasks`), idempotently. The AI only decides *which checklist applies* — it never writes the items. Trades then check items off in the portal.

There is also a second, parallel QC system (`qc_trades` / `qc_items` / `qc_checklist_status`) behind the standalone `/trade/checklists/[projectId]` page. Don't confuse the two — different tables, endpoints, and UI.

## 6. Data sources

Zoho CRM (Deals, Field_Updates, Tasks, Attachments), Zoho Projects (tasks, activities, status writes), Zoho WorkDrive (designs, SOW, photos), Zoho Cliq (field-update cards). Supabase: `trade_partners`, `trade_sessions`, `task_subtasks`, the `qc_*` tables, `scope_tasks`, daily-logs, field-issues, field-update backups, `bot_documents`, and the `trade-photos` storage bucket. OpenAI for trade classification and the assistant.

## 7. Gotchas

1. **Stage filtering is currently disabled** on the trade deal list — a partner may see deals in any stage, not just active ones. The stage helpers exist but aren't applied (there's a TODO to re-enable).
2. **Two QC systems coexist** (`task_subtasks` vs `qc_*`). Keep them straight.
3. **Two authorization styles** for project scoping (one uses the Deal's linked project ids, another parses `Project_ID`/`Zoho_Projects_ID`); a deal linked one way but not the other can authorize inconsistently.
4. **Change Order has no cost field** — Scope textarea only.
5. **A staffer who is also a trade partner** keeps full internal access on internal endpoints (they resolve before the trade session), but on `/trade/*` routes the trade session takes precedence.
6. **Side effects fail soft.** The Supabase backup, Cliq post, WorkDrive archive, and change-order task are best-effort; the Zoho Field_Updates record is the source of truth, and a failure there returns an error.
7. **WorkDrive share resolution is fragile.** If nothing resolves, an admin must paste a manual share link onto the Deal.
8. **First login needs a phone on file.** A partner with no phone and no password can't log in.
9. **Deprecated pages** (`daily-log`, `report-issue`) redirect to the field-update form, though their APIs still work.
