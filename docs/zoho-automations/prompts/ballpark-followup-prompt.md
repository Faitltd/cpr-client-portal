# Prompt: Implement Ballpark Needed Follow-Up Task Automation in Zoho CRM

## Role & Context

You are a Zoho CRM automation expert implementing a follow-up task automation for **CPR (Custom Professional Renovations)**. You have full admin access to the Zoho CRM org. The Deals module uses a Blueprint on the Stage field. All IDs and field API names below are verified against the live CRM instance — use them exactly as written.

## Objective

When a Deal enters the **"Ballpark Needed"** Blueprint stage, automatically create three sequential follow-up tasks assigned to **Mary Sue Mugge**. If the Deal moves out of "Ballpark Needed" at any point, cancel all remaining open follow-up tasks.

---

## Verified CRM Data (Do Not Change These Values)

```
USERS:
  Mary Sue Mugge (MSM)
    User ID:  6162061000000865001
    Email:    marysue@homecpr.pro
    Role:     Manager

DEAL STAGE PICKLIST VALUES (exact strings):
  "Ballpark Needed"         — trigger stage (sequence 1, probability 10%)
  "Ballpark Review Needed"  — intermediate stage (sequence 3)
  "Ballpark Review Booked"  — target exit stage (sequence 4, probability 40%)
  "Lost"                    — closed-lost exit
  "On Hold"                 — paused exit

TASK MODULE FIELD API NAMES:
  Subject               — text (picklist suggestions: "Call", "Follow Up", "BP")
  Due_Date              — date (format: yyyy-MM-dd)
  Owner                 — ownerlookup (accepts User ID string)
  What_Id               — lookup to Deals (Related To)
  Who_Id                — lookup to Contacts (Contact Name)
  Status                — picklist: "Not Started", "In Progress", "Completed", "Cancelled", "Deferred", "Open", "In Review", "On Hold", "Delayed - Material", "Delayed - Permitting", "Waiting for input"
  Priority              — picklist: "Highest", "High", "Normal", "Low", "Lowest"
  Description           — textarea
  Tag                   — array of {name: "string"}
  Send_Notification_Email — boolean

DEAL MODULE FIELD API NAMES:
  Stage                 — picklist (Blueprint-controlled)
  Deal_Name             — text
  Contact_Name          — lookup to Contacts (returns object with "id" and "name")
```

---

## What to Build (4 Components)

### Component 1: Custom Function — `createBallparkFollowUpTask`

**Location:** Setup → Automation → Actions → Custom Functions → + Configure Custom Function → A New Function from Scratch

**Configuration:**
- Function Name: `createBallparkFollowUpTask`
- Module: Deals
- Return Type: void
- Parameters:
  - `dealId` — Type: String
  - `taskNumber` — Type: String

**Deluge Code — paste exactly:**

```java
// createBallparkFollowUpTask
// Creates one follow-up task for Mary Sue linked to the Deal.
// Guard-checks that the Deal is still in "Ballpark Needed" before creating.

msmUserId = "6162061000000865001";
tagName   = "Ballpark Follow-Up";

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

// Guard: re-check Deal stage (defense-in-depth)
dealRecord = zoho.crm.getRecordById("Deals", dealId.toLong());
currentStage = dealRecord.get("Stage");

if(currentStage != "Ballpark Needed")
{
    info "Deal " + dealId + " is no longer in Ballpark Needed (current: " + currentStage + "). Skipping task " + taskNumber + ".";
    return;
}

taskConfig = taskMap.get(taskNumber);
if(taskConfig == null)
{
    info "Invalid taskNumber: " + taskNumber;
    return;
}

dueDate = zoho.currentdate.addDay(taskConfig.get("dayOffset"));

taskRecord = Map();
taskRecord.put("Subject", taskConfig.get("subject"));
taskRecord.put("Due_Date", dueDate.toString("yyyy-MM-dd"));
taskRecord.put("Status", "Not Started");
taskRecord.put("Priority", taskConfig.get("priority"));
taskRecord.put("Owner", msmUserId);
taskRecord.put("What_Id", dealId.toLong());
taskRecord.put("Description",
    "Auto-created by Ballpark Needed workflow.\n" +
    "Task " + taskNumber + " of 3.\n" +
    "Deal: " + dealRecord.get("Deal_Name") + "\n" +
    "Stage at creation: " + currentStage
);
taskRecord.put("Tag", [{name: tagName}]);
taskRecord.put("Send_Notification_Email", true);

contactInfo = dealRecord.get("Contact_Name");
if(contactInfo != null)
{
    contactId = contactInfo.get("id");
    if(contactId != null)
    {
        taskRecord.put("Who_Id", contactId);
    }
}

createResponse = zoho.crm.createRecord("Tasks", taskRecord);
info "Task " + taskNumber + " created for Deal " + dealId + ": " + createResponse;
```

**Save & Close** the function.

---

### Component 2: Custom Function — `cancelBallparkFollowUpTasks`

**Location:** Same path — Setup → Automation → Actions → Custom Functions → + Configure Custom Function

**Configuration:**
- Function Name: `cancelBallparkFollowUpTasks`
- Module: Deals
- Return Type: void
- Parameters:
  - `dealId` — Type: String

**Deluge Code — paste exactly:**

```java
// cancelBallparkFollowUpTasks
// Finds all open Tasks tagged "Ballpark Follow-Up" related to this Deal
// and sets their Status to "Cancelled."

dealIdLong = dealId.toLong();

searchCriteria = "((What_Id:equals:" + dealIdLong + ") and (Status:not_equal:Completed) and (Status:not_equal:Cancelled))";
taskList = zoho.crm.searchRecords("Tasks", searchCriteria, 1, 200);

cancelledCount = 0;

for each task in taskList
{
    taskSubject = task.get("Subject");
    taskTags    = task.get("Tag");
    isBallparkTask = false;

    // Check tag
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

    // Fallback: check subject pattern
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

**Save & Close** the function.

---

### Component 3: Workflow Rule — "Ballpark Needed – MSM Follow-Up Tasks"

**Location:** Setup → Automation → Workflow Rules → + Create Rule

**Step-by-step configuration:**

1. **Module:** Deals
2. **Rule Name:** `Ballpark Needed – MSM Follow-Up Tasks`
3. **Description:** `Creates 3 sequential follow-up tasks for Mary Sue when a Deal enters Ballpark Needed. Scheduled actions auto-cancel if Deal leaves this stage.`
4. **When should this rule be triggered?** → Select `On a field update` → Choose field **Stage**
5. **Which records should this rule apply to?** → `Records matching certain conditions`
6. **Condition:** Stage **is** `Ballpark Needed`
7. **Do you want to execute the actions every time or just the first time?** → Select **Every time**

**Immediate Action (fires Day 1):**
8. Click **Instant Actions** → **Custom Function**
9. Select `createBallparkFollowUpTask`
10. Parameter mapping:
    - `dealId` → select **Deals > Deals Id** (merge field)
    - `taskNumber` → type static value: `1`
11. Save the action

**Scheduled Action #1 (fires Day 3):**
12. Click **+ Scheduled Actions**
13. Schedule Name: `Day 3 – Second Follow-Up`
14. Execute After: `2` days after `Rule Trigger Time`
15. Add action → **Custom Function** → select `createBallparkFollowUpTask`
16. Parameter mapping:
    - `dealId` → **Deals > Deals Id**
    - `taskNumber` → static value: `2`
17. Save the scheduled action

**Scheduled Action #2 (fires Day 5):**
18. Click **+ Scheduled Actions**
19. Schedule Name: `Day 5 – Final Follow-Up`
20. Execute After: `4` days after `Rule Trigger Time`
21. Add action → **Custom Function** → select `createBallparkFollowUpTask`
22. Parameter mapping:
    - `dealId` → **Deals > Deals Id**
    - `taskNumber` → static value: `3`
23. Save the scheduled action

24. **Save the entire Workflow Rule**

> KEY BEHAVIOR: Zoho Scheduled Actions automatically skip execution if the record no longer matches the workflow criteria at the scheduled time. So if the Deal leaves "Ballpark Needed" before Day 3, the Day 3 and Day 5 actions never fire.

---

### Component 4: Workflow Rule — "Ballpark Exit – Cancel Follow-Up Tasks"

**Location:** Setup → Automation → Workflow Rules → + Create Rule

1. **Module:** Deals
2. **Rule Name:** `Ballpark Exit – Cancel Follow-Up Tasks`
3. **Description:** `When a Deal leaves Ballpark Needed, cancel all open Ballpark Follow-Up tasks.`
4. **When:** `On a field update` → Field: **Stage**
5. **Condition:** Stage **is not** `Ballpark Needed`
6. **Every time**

**Immediate Action:**
7. Click **Instant Actions** → **Custom Function**
8. Select `cancelBallparkFollowUpTasks`
9. Parameter mapping:
    - `dealId` → **Deals > Deals Id**
10. Save
11. **Save the entire Workflow Rule**

> PURPOSE: This catches Task 1 (which was already created on Day 1) and marks it "Cancelled" when the Deal exits the stage. Tasks 2 and 3 are handled by the Scheduled Action auto-skip behavior.

---

## Blueprint Integration (Do After Components 1-4)

The Stage field is Blueprint-controlled. Add the custom functions to the relevant Blueprint transitions for immediate execution on transition clicks:

1. Go to **Setup → Automation → Blueprint** → Open the **Deals** Blueprint
2. For every transition arrow that **enters** "Ballpark Needed":
   - Click the transition → go to **After Transition** → **Custom Functions**
   - Add `createBallparkFollowUpTask` with parameters: `dealId` = Deal Id, `taskNumber` = `"1"`
3. For every transition arrow that **exits** "Ballpark Needed" (to "Ballpark Review Needed", "Ballpark Review Booked", "Lost", "On Hold", or any other stage):
   - Click the transition → go to **After Transition** → **Custom Functions**
   - Add `cancelBallparkFollowUpTasks` with parameter: `dealId` = Deal Id
4. Save the Blueprint

**IMPORTANT:** If you add the Blueprint After-transition for Task 1 creation (step 2 above), go back to Workflow Rule "Ballpark Needed – MSM Follow-Up Tasks" and **remove the Immediate Action** (the instant custom function call for taskNumber=1). Otherwise Task 1 will be created twice — once by the Blueprint transition and once by the Workflow Rule. Keep only ONE trigger for Task 1. The Scheduled Actions for Tasks 2 and 3 stay on the Workflow Rule regardless.

---

## How the Cancellation Logic Works (Summary)

There are three layers of protection:

1. **Scheduled Action auto-skip (built into Zoho):** Tasks 2 and 3 are scheduled for Day 3 and Day 5. If the Deal's Stage is no longer "Ballpark Needed" when those days arrive, Zoho skips the action entirely. No code needed.

2. **Guard check in `createBallparkFollowUpTask`:** Even if a Scheduled Action somehow fires, the function re-reads the Deal record and returns early if Stage ≠ "Ballpark Needed." Defense-in-depth.

3. **Cleanup function `cancelBallparkFollowUpTasks`:** When the Deal exits "Ballpark Needed," this function finds any already-created tasks (like Task 1 from Day 1) that are still open and sets them to "Cancelled." It identifies tasks by the "Ballpark Follow-Up" tag and subject pattern matching.

---

## Verification Checklist (After Implementation)

Test with a real or test Deal:

| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Move Deal to "Ballpark Needed" | Task 1 appears immediately: Subject="Call client to schedule ballpark review", Owner=Mary Sue Mugge, Due=today, Priority=High, Tag="Ballpark Follow-Up", Related To=the Deal |
| 2 | Check the Workflow Rule's pending scheduled actions | Two scheduled actions should be queued: Day 3 and Day 5 |
| 3 | Move Deal to "Ballpark Review Booked" | Task 1 status changes to "Cancelled", description shows auto-cancelled note. Scheduled actions for Tasks 2 & 3 should show as skipped/cancelled in workflow logs |
| 4 | Move a fresh Deal to "Ballpark Needed" and leave it there 5+ days | All 3 tasks created on their respective days |
| 5 | Check Task Contact link | Who_Id should match the Deal's Contact_Name |
| 6 | Check Mary Sue received notification emails | Send_Notification_Email=true should trigger CRM task notification |
