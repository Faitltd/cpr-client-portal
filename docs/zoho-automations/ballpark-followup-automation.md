# CPR Ballpark Needed — Follow-Up Task Automation

## Overview

When a Deal enters the **Ballpark Needed** Blueprint stage, automatically create three sequential follow-up tasks assigned to **Mary Sue Mugge (MSM)**. If the Deal advances out of "Ballpark Needed" (e.g., to "Ballpark Review Needed" or "Ballpark Review Booked"), all remaining open tasks are automatically cancelled.

---

## Architecture Decision: Workflow Rule + Scheduled Actions vs. Custom Function

### Recommended Approach: Workflow Rule with Scheduled Actions (Primary) + Cleanup Custom Function (Safety Net)

**Why Scheduled Actions are the best-practice primary mechanism:**

Zoho CRM Workflow Rules with **Scheduled Actions** have a built-in cancellation behavior: if the record no longer matches the workflow's criteria at the time a scheduled action is due to execute, **the action is automatically skipped**. This means:

- Task 1 (Day 1) fires immediately — no cancellation needed
- Task 2 (Day 3) only fires if the Deal **still** has `Stage = Ballpark Needed` on Day 3
- Task 3 (Day 5) only fires if the Deal **still** has `Stage = Ballpark Needed` on Day 5

If Mary Sue books the Ballpark Review and the Deal moves to "Ballpark Review Booked" on Day 2, the Day 3 and Day 5 scheduled actions never execute.

**Why we also add a cleanup function:**

Task 1 fires immediately on Day 1. If the meeting is booked on Day 2, Task 1 already exists but is now unnecessary. A secondary Workflow Rule on stage change runs a **cleanup Custom Function** that marks any open "Ballpark Follow-Up" tasks as "Cancelled."

---

## Verified CRM Reference Data

| Entity | Value |
|--------|-------|
| **Deal Stage (trigger)** | `Ballpark Needed` |
| **Deal Stage (exit — cancels tasks)** | Any stage ≠ `Ballpark Needed` (e.g., `Ballpark Review Needed`, `Ballpark Review Booked`, `Lost`, `On Hold`) |
| **Mary Sue Mugge User ID** | `6162061000000865001` |
| **Mary Sue Email** | `marysue@homecpr.pro` |
| **Task Subject API** | `Subject` |
| **Task Due Date API** | `Due_Date` |
| **Task Owner API** | `Owner` |
| **Task Related To (Deal) API** | `What_Id` |
| **Task Contact API** | `Who_Id` |
| **Task Status API** | `Status` |
| **Task Status — Cancelled value** | `Cancelled` |
| **Task Priority API** | `Priority` |
| **Task Tag API** | `Tag` |
| **Stage field** | `Stage` (Blueprint-supported) |

---

## Part 1: Workflow Rule — "Ballpark Needed: Create Follow-Up Tasks"

### Configuration (Setup → Automation → Workflow Rules → + Create Rule)

| Setting | Value |
|---------|-------|
| **Module** | Deals |
| **Rule Name** | `Ballpark Needed – MSM Follow-Up Tasks` |
| **Description** | Creates 3 sequential follow-up tasks for Mary Sue when a Deal enters Ballpark Needed. Scheduled actions auto-cancel if Deal leaves this stage. |
| **When** | `On a field update` → Field: **Stage** |
| **Condition** | `Stage is Ballpark Needed` |
| **Repeat** | `Every time the condition is met` (handles re-entry if a Deal cycles back) |

### Immediate Action — Task 1 (Day 1)

| Setting | Value |
|---------|-------|
| **Action Type** | Custom Function |
| **Function Name** | `createBallparkFollowUpTask` |
| **Parameters** | `dealId` = `${Deals.Deals Id}`, `taskNumber` = `1` |

### Scheduled Action 1 — Task 2 (Day 3)

| Setting | Value |
|---------|-------|
| **Execute After** | 2 days after Rule Trigger Time |
| **Action Type** | Custom Function |
| **Function Name** | `createBallparkFollowUpTask` |
| **Parameters** | `dealId` = `${Deals.Deals Id}`, `taskNumber` = `2` |

> **Auto-cancellation:** If the Deal's Stage is no longer "Ballpark Needed" on Day 3, this scheduled action is **automatically skipped** by Zoho.

### Scheduled Action 2 — Task 3 (Day 5)

| Setting | Value |
|---------|-------|
| **Execute After** | 4 days after Rule Trigger Time |
| **Action Type** | Custom Function |
| **Function Name** | `createBallparkFollowUpTask` |
| **Parameters** | `dealId` = `${Deals.Deals Id}`, `taskNumber` = `3` |

> **Auto-cancellation:** Same behavior — skipped if Stage ≠ "Ballpark Needed" on Day 5.

---

## Part 2: Custom Function — `createBallparkFollowUpTask`

### Setup (Setup → Automation → Actions → Custom Functions → + Configure Custom Function)

| Setting | Value |
|---------|-------|
| **Function Name** | `createBallparkFollowUpTask` |
| **Module** | Deals |
| **Return Type** | void |
| **Parameters** | `dealId` (String), `taskNumber` (String) |

### Deluge Code

```java
// ============================================================
// createBallparkFollowUpTask
// Called by Workflow Scheduled Actions on Deals module.
// Creates a single follow-up task for Mary Sue (MSM) linked
// to the Deal. Includes a guard check — if the Deal has
// already left "Ballpark Needed," no task is created.
// ============================================================

// --- Configuration ---
msmUserId   = "6162061000000865001";  // Mary Sue Mugge
tagName     = "Ballpark Follow-Up";

// --- Task definitions by number ---
taskMap = Map();

task1 = Map();
task1.put("subject", "Call client to schedule ballpark review");
task1.put("dayOffset", 0);
task1.put("priority", "High");
taskMap.put("1", task1);

task2 = Map();
task2.put("subject", "Second follow-up call – ballpark review");
task2.put("dayOffset", 2);
task2.put("priority", "High");
taskMap.put("2", task2);

task3 = Map();
task3.put("subject", "Final follow-up call – ballpark review");
task3.put("dayOffset", 4);
task3.put("priority", "Highest");
taskMap.put("3", task3);

// --- Guard: Re-check the Deal stage ---
// Scheduled Actions already skip if criteria don't match, but
// this is a defense-in-depth check for edge cases (race conditions,
// manual re-triggers, etc.)
dealRecord = zoho.crm.getRecordById("Deals", dealId.toLong());
currentStage = dealRecord.get("Stage");

if(currentStage != "Ballpark Needed")
{
    info "Deal " + dealId + " is no longer in Ballpark Needed (current: " + currentStage + "). Skipping task " + taskNumber + ".";
    return;
}

// --- Get task config ---
taskConfig = taskMap.get(taskNumber);
if(taskConfig == null)
{
    info "Invalid taskNumber: " + taskNumber;
    return;
}

// --- Calculate due date ---
dueDate = zoho.currentdate.addDay(taskConfig.get("dayOffset"));

// --- Build the task record ---
taskRecord = Map();
taskRecord.put("Subject", taskConfig.get("subject"));
taskRecord.put("Due_Date", dueDate.toString("yyyy-MM-dd"));
taskRecord.put("Status", "Not Started");
taskRecord.put("Priority", taskConfig.get("priority"));
taskRecord.put("Owner", msmUserId);
taskRecord.put("What_Id", dealId.toLong());  // Related To = Deal
taskRecord.put("Description",
    "Auto-created by Ballpark Needed workflow.\n" +
    "Task " + taskNumber + " of 3.\n" +
    "Deal: " + dealRecord.get("Deal_Name") + "\n" +
    "Stage at creation: " + currentStage
);
taskRecord.put("Tag", [{name: tagName}]);
taskRecord.put("Send_Notification_Email", true);

// --- Also link to the Deal's Contact if present ---
contactInfo = dealRecord.get("Contact_Name");
if(contactInfo != null)
{
    contactId = contactInfo.get("id");
    if(contactId != null)
    {
        taskRecord.put("Who_Id", contactId);
    }
}

// --- Create the task ---
createResponse = zoho.crm.createRecord("Tasks", taskRecord);
info "Task " + taskNumber + " created for Deal " + dealId + ": " + createResponse;
```

---

## Part 3: Cleanup Workflow Rule — "Ballpark Stage Exit: Cancel Follow-Up Tasks"

This handles the case where Task 1 was already created (Day 1, immediate) but the Deal moves out of "Ballpark Needed" before Tasks 2 and 3 fire. The scheduled actions for Tasks 2/3 auto-cancel, but Task 1 may still be sitting as "Not Started."

### Configuration (Setup → Automation → Workflow Rules → + Create Rule)

| Setting | Value |
|---------|-------|
| **Module** | Deals |
| **Rule Name** | `Ballpark Exit – Cancel Follow-Up Tasks` |
| **Description** | When a Deal leaves "Ballpark Needed," cancel all open Ballpark Follow-Up tasks. |
| **When** | `On a field update` → Field: **Stage** |
| **Condition** | `Stage is not Ballpark Needed` |
| **Additional Criteria** | None (fires on any stage change away from Ballpark Needed) |

### Immediate Action — Custom Function

| Setting | Value |
|---------|-------|
| **Action Type** | Custom Function |
| **Function Name** | `cancelBallparkFollowUpTasks` |
| **Parameters** | `dealId` = `${Deals.Deals Id}` |

### Deluge Code — `cancelBallparkFollowUpTasks`

```java
// ============================================================
// cancelBallparkFollowUpTasks
// Fires when a Deal leaves "Ballpark Needed."
// Searches for any open Tasks tagged "Ballpark Follow-Up"
// related to this Deal and sets them to "Cancelled."
// ============================================================

dealIdLong = dealId.toLong();

// --- Search for open tasks related to this Deal with the tag ---
// Use COQL (CRM Object Query Language) for precise filtering
query = "select id, Subject, Status, Tag from Tasks where What_Id = " + dealIdLong + " and Status not in ('Completed', 'Cancelled')";
taskSearch = zoho.crm.invokeConnector("crm.searchrecords", {"query": query});

// --- Alternative: Use search API if COQL is not enabled ---
// Fallback search by criteria
searchCriteria = "((What_Id:equals:" + dealIdLong + ") and (Status:not_equal:Completed) and (Status:not_equal:Cancelled))";
taskList = zoho.crm.searchRecords("Tasks", searchCriteria, 1, 200);

cancelledCount = 0;

for each task in taskList
{
    taskSubject = task.get("Subject");
    taskTags    = task.get("Tag");
    isBallparkTask = false;

    // --- Check if this task is a Ballpark Follow-Up ---
    // Method 1: Check tag
    if(taskTags != null)
    {
        for each tag in taskTags
        {
            if(tag.get("name") == "Ballpark Follow-Up")
            {
                isBallparkTask = true;
            }
        }
    }

    // Method 2: Check subject pattern as backup
    if(isBallparkTask == false)
    {
        if(taskSubject.containsIgnoreCase("ballpark review") || taskSubject.containsIgnoreCase("follow-up call"))
        {
            isBallparkTask = true;
        }
    }

    if(isBallparkTask)
    {
        taskId = task.get("id");
        updateMap = Map();
        updateMap.put("Status", "Cancelled");
        updateMap.put("Description",
            task.get("Description") + "\n\n--- Auto-cancelled ---\n" +
            "Reason: Deal moved out of Ballpark Needed.\n" +
            "Cancelled at: " + zoho.currenttime.toString("yyyy-MM-dd HH:mm:ss")
        );

        updateResp = zoho.crm.updateRecord("Tasks", taskId, updateMap);
        info "Cancelled task " + taskId + " (" + taskSubject + "): " + updateResp;
        cancelledCount = cancelledCount + 1;
    }
}

info "Ballpark follow-up cleanup complete. " + cancelledCount + " task(s) cancelled for Deal " + dealId;
```

---

## Part 4: Blueprint Integration

Since the Stage field is Blueprint-controlled, you need to ensure the **Blueprint transitions** allow these functions to execute. Two options:

### Option A: Blueprint Transition Buttons (Recommended)

Add custom buttons on the Blueprint transition **out of** "Ballpark Needed":

1. **Go to** Setup → Automation → Blueprint → Deals Blueprint
2. **Find the transition** from "Ballpark Needed" → "Ballpark Review Needed" (or "Ballpark Review Booked")
3. In the transition's **After** section, add the `cancelBallparkFollowUpTasks` function as a **During Transition** action
4. This guarantees the cleanup runs the instant someone clicks the transition button

### Option B: Blueprint "Before" Transition on Entry

1. On the transition **into** "Ballpark Needed" (e.g., from Lead Conversion or a prior stage):
2. In the **After** section of that transition, add `createBallparkFollowUpTask` with `taskNumber = 1`
3. This fires the first task immediately on Blueprint entry, synchronized with the transition

### Recommended Hybrid Setup

| Trigger Point | Action | Method |
|---------------|--------|--------|
| **Enter "Ballpark Needed"** (Blueprint After-transition) | Create Task 1 immediately | Blueprint After-transition → `createBallparkFollowUpTask(dealId, "1")` |
| **Day 3 while still in "Ballpark Needed"** | Create Task 2 | Workflow Rule Scheduled Action → `createBallparkFollowUpTask(dealId, "2")` |
| **Day 5 while still in "Ballpark Needed"** | Create Task 3 | Workflow Rule Scheduled Action → `createBallparkFollowUpTask(dealId, "3")` |
| **Exit "Ballpark Needed"** (any transition out) | Cancel all open follow-up tasks | Blueprint After-transition → `cancelBallparkFollowUpTasks(dealId)` **AND** Workflow Rule (backup) |

> **Note:** Using both Blueprint After-transitions AND the Workflow Rule provides double coverage. The Custom Function is idempotent — if a task is already cancelled, re-running the cleanup is harmless.

---

## Part 5: Setup Walkthrough (Click-by-Click)

### Step 1: Create the Custom Functions

1. Go to **Setup** → **Automation** → **Actions** → **Custom Functions**
2. Click **+ Configure Custom Function**
3. Choose **A New Function from Scratch**
4. **Function Name:** `createBallparkFollowUpTask`
5. **Module:** Deals
6. **Return Type:** void
7. Add parameters:
   - `dealId` → Type: String
   - `taskNumber` → Type: String
8. Paste the code from Part 2 above
9. Click **Save & Close**
10. Repeat for `cancelBallparkFollowUpTasks` with parameter `dealId` (String)

### Step 2: Create the Primary Workflow Rule

1. Go to **Setup** → **Automation** → **Workflow Rules**
2. Click **+ Create Rule**
3. **Module:** Deals
4. **Rule Name:** `Ballpark Needed – MSM Follow-Up Tasks`
5. **When should this rule be triggered?** → `On a field update` → Select **Stage**
6. **Condition:** Stage **is** `Ballpark Needed`
7. **Do you want to execute the actions when the conditions are met every time, or just for the first time?** → **Every time**

#### Add Immediate Action:
8. Under **Instant Actions** → Click **Custom Function**
9. Select `createBallparkFollowUpTask`
10. Map: `dealId` = Deals > Deals Id, `taskNumber` = Static value `1`

#### Add Scheduled Action — Day 3:
11. Click **+ Scheduled Actions**
12. **Schedule Name:** `Day 3 – Second Follow-Up`
13. **Execute After:** `2 days` after `Rule Trigger Time`
14. Add action → **Custom Function** → `createBallparkFollowUpTask`
15. Map: `dealId` = Deals > Deals Id, `taskNumber` = Static value `2`

#### Add Scheduled Action — Day 5:
16. Click **+ Scheduled Actions**
17. **Schedule Name:** `Day 5 – Final Follow-Up`
18. **Execute After:** `4 days` after `Rule Trigger Time`
19. Add action → **Custom Function** → `createBallparkFollowUpTask`
20. Map: `dealId` = Deals > Deals Id, `taskNumber` = Static value `3`
21. Click **Save**

### Step 3: Create the Cleanup Workflow Rule

1. Go to **Setup** → **Automation** → **Workflow Rules**
2. Click **+ Create Rule**
3. **Module:** Deals
4. **Rule Name:** `Ballpark Exit – Cancel Follow-Up Tasks`
5. **When:** `On a field update` → Select **Stage**
6. **Condition:** Stage **is not** `Ballpark Needed`
7. **Every time**
8. **Instant Action:** Custom Function → `cancelBallparkFollowUpTasks`
9. Map: `dealId` = Deals > Deals Id
10. Click **Save**

### Step 4: Add Blueprint Transitions (Optional but Recommended)

1. Go to **Setup** → **Automation** → **Blueprint**
2. Open the **Deals** Blueprint
3. For each transition **into** "Ballpark Needed":
   - Click the transition arrow
   - In **After Transition** → **Custom Functions** → Add `createBallparkFollowUpTask` with `taskNumber = "1"`
4. For each transition **out of** "Ballpark Needed":
   - Click the transition arrow
   - In **After Transition** → **Custom Functions** → Add `cancelBallparkFollowUpTasks`
5. Save the Blueprint

> **Important:** If you configure Blueprint After-transitions for Task 1, you may want to remove the Immediate Action from the Workflow Rule to avoid duplicate Task 1 creation. Choose one trigger point for Task 1 — either Blueprint or Workflow Rule, not both.

---

## Part 6: Testing Checklist

| # | Test Case | Expected Result | Pass? |
|---|-----------|-----------------|-------|
| 1 | Move a Deal to "Ballpark Needed" | Task 1 created immediately, assigned to MSM, Due = today, tagged "Ballpark Follow-Up" | |
| 2 | Wait 2+ days (or use Developer Console time-travel) | Task 2 created, Due = Day 3, same tag | |
| 3 | Move Deal to "Ballpark Review Booked" before Day 3 | Task 1 status → "Cancelled", Scheduled Action for Task 2 is skipped | |
| 4 | Move Deal to "Ballpark Review Booked" between Day 3 and Day 5 | Tasks 1 & 2 → "Cancelled", Task 3 scheduled action is skipped | |
| 5 | Deal stays in "Ballpark Needed" for 5+ days | All 3 tasks created sequentially | |
| 6 | Deal moves to "Lost" from "Ballpark Needed" | All open tasks → "Cancelled" | |
| 7 | Deal enters "Ballpark Needed," exits, then re-enters | New set of 3 tasks created (old ones already cancelled) | |
| 8 | Check Task 1 has correct Contact linked | `Who_Id` matches the Deal's `Contact_Name` | |
| 9 | Check MSM receives notification email | `Send_Notification_Email = true` triggers email to MSM | |

---

## Sequence Diagram

```
Day 0: Deal → "Ballpark Needed"
  ├─ Workflow Rule fires immediately
  │   └─ createBallparkFollowUpTask(dealId, "1")
  │       ├─ Guard check: Stage == "Ballpark Needed" ✓
  │       └─ Creates Task 1: "Call client to schedule ballpark review"
  │          Due: Today, Owner: MSM, Priority: High, Tag: Ballpark Follow-Up
  │
Day 2: Scheduled Action check
  │   └─ Is Stage still "Ballpark Needed"?
  │       ├─ YES → createBallparkFollowUpTask(dealId, "2")
  │       │         Creates Task 2: "Second follow-up call"
  │       │         Due: Day 3, Priority: High
  │       └─ NO  → Scheduled action auto-skipped by Zoho
  │
Day 4: Scheduled Action check
  │   └─ Is Stage still "Ballpark Needed"?
  │       ├─ YES → createBallparkFollowUpTask(dealId, "3")
  │       │         Creates Task 3: "Final follow-up call"
  │       │         Due: Day 5, Priority: Highest
  │       └─ NO  → Scheduled action auto-skipped by Zoho
  │
[At any point] Deal exits "Ballpark Needed"
  └─ Cleanup Workflow fires
      └─ cancelBallparkFollowUpTasks(dealId)
          └─ All open Ballpark Follow-Up tasks → Status: "Cancelled"
```

---

## Notes

- **Idempotency:** The cleanup function checks both Tag and Subject patterns, so even manually created ballpark tasks get caught.
- **Re-entry:** If a Deal cycles back into "Ballpark Needed" (e.g., after a revision), the workflow fires again and creates a fresh set of 3 tasks. The old set was already cancelled on exit.
- **Blueprint field locking:** Since Stage is Blueprint-controlled, the Workflow Rule triggers on the Blueprint transition. You previously solved similar Blueprint field-lock issues using Zoho Flow. Both approaches work here.
- **Task 1 due date:** Due "today" (Day 1 = same day the Deal enters the stage), giving MSM an immediate action item.
- **Notification:** `Send_Notification_Email = true` ensures MSM gets an email for each new task.
- **Tag-based filtering:** The `Ballpark Follow-Up` tag lets MSM filter her task view and lets the cleanup function target only these auto-generated tasks.
