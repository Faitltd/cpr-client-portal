# Prompt: PDA Signed → Client Portal Invitation Email

## Role & Context

You are a Zoho CRM automation expert implementing a client portal invitation workflow for **CPR (Custom Professional Renovations)**. You have full admin access to the Zoho CRM org. The Deals module uses a Blueprint on the Stage field. All IDs and field API names below are verified against the live CRM instance — use them exactly as written.

CPR has a **standalone client portal** (not a Zoho Portal) at **https://portal.homecpr.pro**. It is a custom SvelteKit application. When a client signs their PDA (Pre-Design Agreement), we want to send them an email inviting them to the portal with their login credentials.

## Objective

When a Deal's **PDA is signed** (the `PDA_Approved` boolean flips to `true`, which happens via a ZohoSign webhook when the PDA document is completed), send the Deal's primary Contact an **email template** inviting them to the CPR client portal. The email should include:

- A welcome message explaining they now have access to their project portal
- The portal URL: **https://portal.homecpr.pro/auth/client**
- Their login credentials: **email** (their email on file) and **initial password** (their phone number on file)
- A prompt to change their password after first login
- CPR branding and a professional tone

---

## Verified CRM Data (Do Not Change These Values)

```
DEAL FIELDS:
  Stage                   — picklist (Blueprint-controlled)
    "PDA Sent"            — stage when PDA is sent for signing
    "Design Needed"       — stage after PDA is signed (next stage)
  PDA_Approved            — boolean (flips to true when PDA is signed via ZohoSign)
  PDA_Sent_Date           — date (labeled "PDA Follow Up Date")
  Deal_Name               — text
  Contact_Name            — lookup to Contacts (object with "id" and "name")
  Email_1                 — email (Deal-level email)
  Phone                   — phone (Deal-level phone)
  Client_Portal_Folder    — website (URL field for WorkDrive external link)

CONTACT FIELDS:
  Email                   — primary email
  Phone                   — primary phone
  First_Name              — text
  Last_Name               — text

USERS:
  Mary Sue Mugge (MSM)
    User ID:  6162061000000865001
    Email:    marysue@homecpr.pro

  Ray Kinne
    User ID:  6162061000000862001
    Email:    ray@homecpr.pro

PORTAL LOGIN DETAILS:
  URL:              https://portal.homecpr.pro/auth/client
  Username:         Client's email address (from Contact record)
  Initial Password: Client's phone number (digits only, from Contact record)
  Password Change:  Clients can change password at https://portal.homecpr.pro/account
```

---

## What to Build (3 Components)

### Component 1: Email Template — "Welcome to Your CPR Client Portal"

**Location:** Setup → Customization → Email Templates → + New Template

**Configuration:**
- Module: Deals
- Template Name: `CPR Client Portal Invitation`
- Folder: (your preference, e.g., "CPR Automations")

**Email Template Content:**

Subject: `Welcome to Your CPR Project Portal — ${Deals.Deal_Name}`

Body (HTML):

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: #333333;
      margin: 0;
      padding: 0;
      background-color: #f5f5f5;
    }
    .wrapper {
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .card {
      background: #ffffff;
      border-radius: 8px;
      padding: 40px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
    }
    .header h1 {
      color: #222222;
      font-size: 24px;
      margin: 0 0 8px 0;
    }
    .header p {
      color: #666666;
      font-size: 14px;
      margin: 0;
    }
    .credentials {
      background: #f8f9fa;
      border: 1px solid #e9ecef;
      border-radius: 6px;
      padding: 20px;
      margin: 24px 0;
    }
    .credentials p {
      margin: 8px 0;
      font-size: 15px;
    }
    .credentials strong {
      display: inline-block;
      min-width: 100px;
    }
    .credentials code {
      background: #e9ecef;
      padding: 2px 8px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 14px;
    }
    .cta {
      text-align: center;
      margin: 30px 0;
    }
    .cta a {
      display: inline-block;
      background: #0066cc;
      color: #ffffff;
      text-decoration: none;
      padding: 14px 32px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 16px;
    }
    .features {
      margin: 24px 0;
      padding: 0;
    }
    .features li {
      margin: 8px 0;
      font-size: 15px;
      color: #444444;
    }
    .note {
      background: #fff8e1;
      border-left: 4px solid #ffc107;
      padding: 12px 16px;
      margin: 24px 0;
      border-radius: 0 6px 6px 0;
      font-size: 14px;
      color: #555555;
    }
    .footer {
      text-align: center;
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #e9ecef;
      font-size: 13px;
      color: #999999;
    }
    .footer a {
      color: #0066cc;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="header">
        <h1>Welcome to Your Project Portal</h1>
        <p>${Deals.Deal_Name}</p>
      </div>

      <p>Hi ${Deals.Contact_Name.First_Name},</p>

      <p>Thank you for signing your Pre-Design Agreement. We're excited to get started on your project. As part of our process, you now have access to your personal <strong>CPR Client Portal</strong> — a secure space where you can track your project from start to finish.</p>

      <div class="cta">
        <a href="https://portal.homecpr.pro/auth/client">Log In to Your Portal</a>
      </div>

      <div class="credentials">
        <p><strong>Portal URL:</strong> <a href="https://portal.homecpr.pro/auth/client">portal.homecpr.pro</a></p>
        <p><strong>Username:</strong> Your email address on file</p>
        <p><strong>Password:</strong> Your phone number (digits only)</p>
      </div>

      <div class="note">
        <strong>Security tip:</strong> We recommend changing your password after your first login. You can do this from your Account page inside the portal.
      </div>

      <p>Here's what you can do in your portal:</p>
      <ul class="features">
        <li>View your project timeline and current status</li>
        <li>Review and approve design documents</li>
        <li>See progress photos from the job site</li>
        <li>Access invoices and payment history</li>
        <li>Review and sign contracts and change orders</li>
        <li>Communicate with your project team</li>
      </ul>

      <p>If you have any trouble logging in, just reply to this email or call us and we'll get you sorted out.</p>

      <p>Looking forward to building something great together.</p>

      <p>
        Warm regards,<br>
        <strong>The CPR Team</strong><br>
        Custom Professional Renovations
      </p>

      <div class="footer">
        <p>Custom Professional Renovations<br>
        <a href="https://homecpr.pro">homecpr.pro</a> · <a href="https://portal.homecpr.pro">portal.homecpr.pro</a></p>
      </div>
    </div>
  </div>
</body>
</html>
```

**Important merge field notes:**
- `${Deals.Deal_Name}` — pulls the Deal name into the subject line and header
- `${Deals.Contact_Name.First_Name}` — pulls the Contact's first name for the greeting
- If the Contact First Name merge field doesn't resolve in your Zoho edition, replace it with `${Deals.Contact_Name}` (full name) and adjust the greeting to "Hi ${Deals.Contact_Name},"
- The password is described generically as "your phone number" rather than exposing the actual phone number in the email for security

**Save** the template.

---

### Component 2: Workflow Rule — "PDA Signed – Send Portal Invitation"

**Location:** Setup → Automation → Workflow Rules → + Create Rule

**Step-by-step configuration:**

1. **Module:** Deals
2. **Rule Name:** `PDA Signed – Send Portal Invitation`
3. **Description:** `When PDA is signed (PDA_Approved = true), send the client an email inviting them to the CPR client portal at portal.homecpr.pro.`
4. **When should this rule be triggered?** → Select `On a field update` → Choose field **PDA_Approved**
5. **Which records should this rule apply to?** → `Records matching certain conditions`
6. **Condition:**
   - `PDA_Approved` **is** `true`
7. **Do you want to execute the actions every time or just the first time?** → Select **Only the first time** (prevents duplicate emails if PDA_Approved is toggled)

**Immediate Action #1 — Send Email:**
8. Click **Instant Actions** → **Email Notification**
9. Configure:
   - **To:** Select **Contact associated with the Deal** (this uses the Contact_Name lookup)
   - **From:** `notifications@homecpr.pro` (or your org's default sender)
   - **Template:** Select `CPR Client Portal Invitation`
10. Save the action

**Immediate Action #2 — (Optional) Create a Task for MSM to verify portal access:**
11. Click **Instant Actions** → **Task**
12. Configure:
    - **Subject:** `Verify client portal access – ${Deals.Deal_Name}`
    - **Due Date:** 1 day after Rule Trigger Time
    - **Status:** Not Started
    - **Priority:** Normal
    - **Assigned To:** Mary Sue Mugge
    - **Description:** `PDA has been signed. Verify that the client can log into portal.homecpr.pro. Contact them if they need help with their initial login.`
13. Save the action

14. **Save the entire Workflow Rule**

---

### Component 3: Blueprint Integration (Recommended)

Since the Deal progresses through Blueprint stages, you can also attach this email send to the Blueprint transition itself.

**Option A — Attach to the PDA_Approved field update (already handled by Component 2)**

If your ZohoSign webhook updates `PDA_Approved` directly (not via Blueprint transition), the Workflow Rule in Component 2 is sufficient. No Blueprint change needed.

**Option B — Attach to the Blueprint transition from "PDA Sent" → "Design Needed"**

If the PDA signing triggers a Blueprint transition (e.g., an automated transition that moves the Deal from "PDA Sent" to "Design Needed" when PDA_Approved = true):

1. Go to **Setup → Automation → Blueprint** → Open the **Deals** Blueprint
2. Find the transition from **"PDA Sent"** → **"Design Needed"**
3. Click the transition arrow
4. In **After Transition** → **Email Notification** → Select the `CPR Client Portal Invitation` template
5. Recipient: Contact associated with the Deal
6. Save the Blueprint

> **Choose one trigger, not both.** If the ZohoSign webhook flips PDA_Approved AND that triggers a Blueprint transition, the Workflow Rule (Component 2) plus a Blueprint After-transition would send the email twice. Use either the Workflow Rule OR the Blueprint transition, not both.

---

## Important Considerations

### Client Account Must Exist Before They Log In

The portal uses a Supabase `clients` table. Clients are synced from Zoho CRM Contacts via the admin panel ("Sync Clients from Zoho" in `/admin/clients`). Ensure one of the following:

**Option A (Manual):** An admin clicks "Sync Clients from Zoho" in the portal admin panel before or shortly after the PDA is signed. This pulls the Contact into the `clients` table with `portal_active = true`.

**Option B (Automated — recommended):** Add a Custom Function to the same Workflow Rule (or Blueprint transition) that calls the portal's sync endpoint or directly provisions the client in Supabase. This is a future enhancement — for now, the portal's phone-number reconciliation flow (`reconcileClientPhoneLogin` in `client-login.ts`) handles first-time logins automatically by looking up the Contact in Zoho CRM and creating the Supabase record on-the-fly.

### Password Security

The email intentionally does NOT include the client's actual phone number. It says "Your phone number (digits only)" as a hint. The client already knows their own phone number. This avoids exposing PII in email.

### Deduplication

The Workflow Rule is set to **"Only the first time"** for PDA_Approved = true. This prevents:
- Duplicate emails if someone unchecks and rechecks PDA_Approved
- Duplicate emails if the ZohoSign webhook fires multiple times

### Reply-To Address

Configure the email's **From** address to be a monitored inbox (e.g., `info@homecpr.pro` or `marysue@homecpr.pro`) so clients can reply if they have login trouble.

---

## Verification Checklist

| # | Test | Expected Result |
|---|------|-----------------|
| 1 | Set PDA_Approved = true on a test Deal | Portal invitation email sent to the Deal's Contact |
| 2 | Check email content | Deal name in subject, Contact first name in greeting, portal URL correct, no exposed phone number |
| 3 | Click the portal link in the email | Navigates to https://portal.homecpr.pro/auth/client |
| 4 | Log in with Contact email + phone number | Successful login, redirects to /dashboard |
| 5 | Toggle PDA_Approved off then on again | No second email sent (first-time-only rule) |
| 6 | Check MSM received the verification task (if configured) | Task appears with correct due date and Deal association |
| 7 | Verify email From/Reply-To | Replies go to a monitored CPR inbox |
