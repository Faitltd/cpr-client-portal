# Reconciliation → Zoho Books Credit Note — Detailed Handoff Packet

_Last updated: July 6, 2026_

---

## 1. The problem we solved

A **reconciliation** at CPR is a change order entered with a **negative amount** — money owed back to the client. These are keyed into Houzz Pro. We needed each reconciliation to become a **credit on that client's account in Zoho Books**, where the CPR assistant and the client's ledger can see it.

**Why we could not build a "zap."** Houzz Pro's Zapier integration is one-way and import-only. It exposes only *actions* (create a lead, create a project) — there is no Houzz Pro *trigger*, and Houzz explicitly does not support exporting data out. So Houzz cannot emit a "reconciliation was made" event to anything. The automation therefore had to **start on the Zoho side**, from data a person enters on the Deal.

**Added requirement (approval).** Reconciliations must not post automatically. Each one must be reviewed and approved by **Jeff** (final approver), with **Mary Sue** also notified, before any credit hits the client's Books account.

---

## 2. What we built (component inventory)

### A. Two fields on the Deal (Zoho CRM, Deals module)

- **Reconciliation Number** — text field (`Reconciliation_Number`)
- **Reconciliation Amount** — currency field (`Reconciliation_Amount`)

These are the two fields a person fills on the Deal card to record a reconciliation.

### B. CRM custom function — "Add Reconciliation Credit"

API name `add_reconciliation_credit`, argument `dealId` (mapped to the Deal's record Id). What it does when it runs:

1. Reads Reconciliation Number and Reconciliation Amount from the Deal (uses the absolute value of the amount).
2. Finds the client's customer record in **Zoho Books**, matched by email — the Deal's linked **Contact** email is the reliable match key.
3. Creates a **Credit Note** in Books for that customer and amount.
4. **Submits and approves** the credit note so it becomes a live, usable credit (not a draft).
5. Writes an **audit note** on the Deal recording exactly what happened (credit note number + amount, or the failure reason).
6. On success, **clears** the two Reconciliation fields so the next reconciliation can be entered.
7. **Fail-safe:** if it can't find a matching customer, it logs a "could not run" note and creates **nothing** — it never posts a wrong or partial credit.

### C. Approval gate (CRM Approval Process — "Reconciliation Approval")

- **Applies to:** Deals, on create or edit.
- **Condition:** Reconciliation Number is not empty **AND** Reconciliation Amount is not empty.
- **Approver:** **Jeff Smither** (final stamp).
- **On approval:** runs "Add Reconciliation Credit" (creates + finalizes the credit note).
- **On rejection:** clears the Reconciliation Number so the reconciliation won't re-submit and nothing posts.
- **Process admin:** Ray Kinne (added so an org admin can fast-track if needed; optional to keep).

### D. Old immediate-post workflow — deactivated

The first version of this system used a workflow ("Reconciliation Entered – Books Credit Note") that posted the credit note **the instant** the fields were entered — no approval. When we added the approval gate, we **turned that workflow off** so nothing posts without Jeff's sign-off. It is safe to delete; the credit-note function lives independently and is now driven by the Approval Process.

---

## 3. The end-to-end flow (current, approval-gated design)

1. A reconciliation is entered in **Houzz Pro** as a negative change order.
2. The same person opens the matching **Deal** in Zoho CRM and fills **Reconciliation Number** and **Reconciliation Amount** on the Deal card, then saves.
3. Saving submits the Deal to the **Reconciliation Approval** process. **Jeff is notified. Nothing is created in Books yet — it waits.**
4. **Jeff reviews and decides:**
   - **Approve →** the function runs: it finds the client's Books customer, creates a **Credit Note** for the amount, **auto-finalizes** it (so it's immediately usable — no second approval), writes an audit note on the Deal, and clears the two fields.
   - **Reject →** nothing posts; the fields clear; the Deal returns to normal.
5. The finalized credit note now sits on the **client's Zoho Books account**, reducing what they owe and visible to the CPR assistant.

In short: **enter two fields on the Deal → Jeff approves → the credit posts to the client's Books account.** No Zapier, because Houzz can't trigger anything.

---

## 4. How we verified it (what was actually tested)

- **Gate holds:** entered a test reconciliation → the Deal went to "pending approval," **no** credit note was created, and the fields stayed intact. (Zoho even blocks deleting the record while it's pending — extra proof.)
- **Fail-safe path:** a test deal with no matching customer produced a "could not run" note and created **nothing**.
- **Customer match + credit-note creation:** an early test created credit note **CN-00003** for the internal test customer (Kinne, Raymond), proving the email match and Books creation.
- **Bug found and fixed:** Books limits a credit note's reference field to **50 characters**; long deal names exceeded it. Fixed by shortening the reference to `Recon #<number>` (capped at 50) and moving the deal name into the line-item description.
- **Full approval end-to-end:** logged in as **Jeff**, approved a real test reconciliation → credit note **CN-00004** was created with status **APPROVED** and a **$1.00** balance (auto-finalized), the audit note read "created and approved," and the fields cleared. Confirmed directly in Books.
- **Cleanup:** every test deal and every test credit note (CN-00003, CN-00004) was deleted. Books is back to its prior state.

---

## 5. What is LEFT to complete

1. **Reviewer notification (in progress).** Build a notification so that when a reconciliation is entered, **both Jeff and Mary Sue** get an email that one is pending Jeff's review. Plan:
   - New Deals workflow "Reconciliation Submitted – Notify Reviewers" (built fresh, separate from the old workflow, so the credit-note function can never double-fire).
   - Trigger: Create or Edit. Condition: both Reconciliation fields not empty.
   - Instant action: Email Notification, using a short new template (subject e.g. "Reconciliation entered – pending Jeff's approval," body with deal name, reconciliation number, and amount).
   - Recipients: **Jeff** (jeff@homecpr.pro) and **Mary Sue** (MarySue@homecpr.pro).
   - Save and confirm active.
   - _Note: Jeff also receives Zoho's native approval notification as the approver; this workflow guarantees Mary Sue is looped in and gives both a clear heads-up._

2. **Delete the old deactivated workflow** ("Reconciliation Entered – Books Credit Note") — optional tidy-up. Safe to remove.

3. **Optional decisions:**
   - Keep or remove Ray as Process Admin on the approval process (recommended: keep).

4. **Record the design in project memory** so future work starts from the current state.

---

## 6. Reference details (for whoever maintains this)

- **CRM org:** 846437691 · **Books org:** 862183465
- **Deals module id:** 6162061000000002181
- **Fields:** Reconciliation_Number, Reconciliation_Amount
- **Function:** `add_reconciliation_credit` (arg `dealId` = Deals record Id)
- **Books connection name:** `zohobooks`
- **Books line item used:** Change Order item `5547048000000176202`
- **Approver:** Jeff Smither (jeff@homecpr.pro) · **Also notified:** Mary Sue Mugge (MarySue@homecpr.pro)

**Gotchas worth knowing:**

- **Houzz can't trigger anything outbound** — entry is manual on the Deal by design.
- **The customer match uses the Deal's linked Contact email.** Real deals have a client Contact, so this works. A deal with no Contact and no email will log "could not run" and post nothing.
- **Books credit notes are created as drafts** (Sales Approval is on in Books), so the function submits + approves them to finalize. Jeff's CRM approval is the real gate; the Books-side finalize is automatic.
- **Reference number is capped at 50 characters.**
- **Deluge function code must be edited in the Zoho browser code editor**, not via API.
- **"MSM" = Mary Sue Mugge**, who is distinct from Sean McMechen.
