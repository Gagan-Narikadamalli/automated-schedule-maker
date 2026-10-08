# SOS Automated Schedule Maker

A multi-location scheduling workspace for Success On The Spectrum. The application keeps the familiar Excel-style clinic workflow while adding automatic day/week generation, coverage validation, staff breaks, Speech/Nap handling, call-outs, templates, historical workbook learning, manual drag-and-drop editing, Unplaced Assignments, supervision tools, Excel export, and two independent Scheduler AI modes.

The current UI is intentionally scheduler-first. There is no standalone login page blocking the workspace. API/session authorization helpers remain in the server routes so scheduler data and writes can still be scoped by location and role when that layer is enabled.

## Main workflow

The Scheduling Workspace has two synchronized views of the same saved day:

- **Staff Schedule** — columns are staff first names. Each configured staff color appears as a dot and top accent on the staff header. Client/activity blocks remain color-coded in the grid.
- **Client Schedule** — columns are client display codes. The client color is the coverage-card background and the assigned staff member's configured color is shown as a left accent and dot. Nap and Speech are displayed explicitly so they do not look like missing coverage. A red **Needs coverage** card represents real unresolved coverage; a truly blank cell means there is no saved coverage/event to display for that client/time.
- **Unplaced Assignments** — unresolved required client blocks are preserved here rather than silently disappearing.
- **Manual Mode / Scratch** — managers can select one cell or ranges, copy/cut/paste, drag blocks, move through Scratch columns, delete cells, add Break/Nap/Speech presets, and confirm protected overrides with in-website dialogs.
- **Minimal Fix / Repair** — repairs an existing day with the smallest practical changes, prioritizing Unplaced and uncovered work before required breaks.
- **Generate Day / Generate Week** — rebuilds automatic assignments from the clinic's current staffing, client requirements, rules, events, templates, and historical learning.

Client calendar display codes are derived from the first two letters of the first name and first two letters of the last name, for example **Zion Boston → ZiBo**. Full client names remain in profile/configuration screens rather than the live scheduling grid.

## How Auto Generate works

Auto Generate is a deterministic scheduling engine with hard safety rules plus soft historical/template learning. The Native AI or Paid AI can decide to invoke generation, explain it, or make validated follow-up edits, but the AI model itself does **not** freely invent each schedule cell.

### Generate Day order

For a selected date the server performs this pipeline:

1. **Load the live clinic inputs.**
   - Active staff, staff roles, recurring shifts, service setting, weekly-hour limits, teams, colors, and staff call-outs.
   - Active clients, attendance, support/rotation settings, service setting, teams, staff preferences/restrictions, and client attendance changes.
   - Existing saved assignments and manager/manual locks.
   - Clinic scheduling rules.
   - Fixed Speech sessions.
   - All active templates for that weekday.
   - Up to eight previous saved schedules for the same weekday.
   - Earlier client hours in the current week for weekly-hour balancing.

2. **Resolve fixed client events before 1:1 coverage.**
   - **Speech is always one client for one fixed 30-minute appointment.**
   - **Nap is a flexible placement window.** The current configured nap duration is used to select the actual nap slot inside that client's allowed window.
   - Livingston's normal Nap placement window is 11:30 AM-2:00 PM.
   - Speech/Nap slots are removed from required 1:1 coverage, so they are not treated as uncovered client time.

3. **Load historical/template learning.**
   - Exact active same-weekday templates are used as soft reference assignments.
   - Learning-only workbook templates contribute scheduling-style preferences without blindly copying cells.
   - Previous same-weekday live schedules contribute stability/pairing references.
   - Imported historical workbook records contribute staff/client pairing frequency, exact-time patterns, and historical break patterns.
   - Livingston workbook learning profiles contribute continuity, handoff, compactness, and preferred client/staff mix guidance.

4. **Preserve protected work.**
   - Manual/locked assignments are retained when the clinic's preserve-manual setting is enabled.
   - Unavailable/fixed protected cells remain boundaries.
   - Automatic breaks are rebuilt so they can adapt to the newly generated coverage.

5. **Build client coverage first, chronologically.**
   - The day is solved in 30-minute order.
   - At the same time slot, established/continuing client pairings are considered before brand-new arrivals.
   - Clients with fewer eligible staff are handled before highly flexible clients.
   - Higher-support/rotation requirements are considered before ordinary tie-breaks.

6. **Reject invalid staff candidates using hard constraints.**
   A candidate cannot be used when it would violate current availability/call-outs, double booking, client attendance, service-location compatibility, hard staff/client restrictions, active-date rules, configured hour limits, fixed events, or the applicable maximum continuous client/staff duration.

7. **Score the remaining valid staff candidates using soft preferences.**
   The score can include:
   - preferred staff relationship;
   - same team;
   - current client/staff continuity;
   - reduced unnecessary client handoffs;
   - staff schedule compactness (fewer random idle holes);
   - rotation diversity for Rotation/High Support clients;
   - weekly target hours;
   - role coverage preferences;
   - exact weekday-template matches;
   - prior same-weekday live schedule matches;
   - imported historical staff/client pairings and exact-time patterns.

8. **Fill a long continuous run when safe.**
   Once a staff/client pairing starts, the generator tries to continue that pairing through as much of the uninterrupted client attendance segment as legally possible, up to the configured maximum continuous duration (normally up to four hours). Nap, Speech, staff availability, a hard restriction, or another real boundary stops the run.

9. **Repair remaining coverage before giving up.**
   - Retry normal non-repeat pairings.
   - Try a one-step valid staff swap.
   - If enabled, use a same-day staff/client repeat only after the normal options are exhausted.
   - As a final coverage-first fallback, use a valid single 30-minute assignment rather than leave a client uncovered merely because the preferred grouping could not be maintained.
   - If no valid option exists, the block is reported as uncovered and synchronized into **Unplaced Assignments**.

10. **Place staff breaks after client coverage is built.**
    - The normal break window is 11:00 AM-2:00 PM.
    - Fixed Speech opportunities are considered first for **Break + Speech**.
    - Nap opportunities are then considered for **Break + Nap**.
    - Remaining staff receive an ordinary Break where possible.
    - If a staff member still needs a break, Auto Generate can move that client's AUTO block to a free eligible relief staff member for the 30-minute break and keep coverage intact.

11. **Human-style cleanup.**
    The post-processing pass reduces one-block islands, unnecessary handoffs, and highly fragmented days. It prefers long recognizable blocks and roughly two or three clients per staff when the current clinic constraints make that practical. This is a soft optimization, not a reason to sacrifice coverage.

12. **Final audit and save.**
    - Recheck required client coverage.
    - Recheck reserved staff breaks.
    - Label Break + Nap / Break + Speech.
    - Preserve protected manager work.
    - Save the new automatic assignments.
    - Sync any true remaining gaps to the manager Unplaced tray.
    - Return coverage, break, history/template, and warning diagnostics.

### Generate Work Week

Work-week generation does **not** copy Monday across the week. Each Monday-Friday date is generated independently through the complete day pipeline above. That means Tuesday can use different staff shifts, attendance, call-outs, Speech/Nap events, Wednesday templates, previous-Wednesday history, and workbook learning than Monday.

The range generator supports one to fourteen calendar days and skips weekends for normal work-week generation.

## Hard rules versus templates/history

The scheduler always treats live safety/validity rules as more important than an old template.

**Hard constraints win:** current staff availability and call-outs, client attendance/call-ins/call-outs, no double booking, service setting, hard relationships, active dates, weekly/daily limits, maximum continuous pairing, fixed Speech/Nap, and protected manager cells.

**Coverage is the primary scheduling objective:** the generator tries to cover every required client block before optimizing appearance.

**Templates and history are advisory:** they increase or decrease candidate scores and can adjust soft priorities, but they cannot make an otherwise illegal assignment valid.

This means an old Wednesday workbook can teach the scheduler that a long ZiBo block with one staff member followed by one clean handoff is typical, but if that staff member is called out this Wednesday, the generator must choose another valid plan.

## Livingston workbook learning

Livingston can learn from several sources simultaneously:

- all active templates for the target weekday;
- learning-only workbook templates that describe the historical scheduling style;
- exact saved template cells when current staff/client records still match;
- up to eight previous saved schedules for the same weekday;
- imported HistoricalScheduleAssignment workbook rows;
- manager feedback collected through Scheduler AI;
- the Livingston workbook trial profile where enabled.

Multiple active templates for a weekday contribute together rather than only the newest template being used. Learning-only workbook profiles receive meaningful weight even though they intentionally contain no cells to copy.

The workbook learning focuses on structure: long continuous client/staff runs, natural handoffs around Speech/Nap/breaks, reduced fragmentation, a practical number of different clients per staff member, and a practical number of staff handoffs per long-day client. The current day's real requirements always remain authoritative.

## Break, Nap, and Speech behavior

- **Speech:** one client, fixed 30 minutes, starts on a 30-minute scheduler boundary, protected before ordinary scheduling decisions.
- **Nap:** one 30-minute nap per client under the current Livingston configuration, selected inside a flexible shared window such as 11:30 AM-2:00 PM. A single Nap event can apply the same window to multiple clients; Auto Generate may stagger their actual nap cells.
- **Staff Break:** normally 30 minutes and constrained to 11:00 AM-2:00 PM. Every scheduled staff member working in the eligible window should receive a break whenever a legal placement exists.
- **Break + Speech / Break + Nap:** preferred ways to create staff breaks without losing client coverage.

## Templates

Templates support two primary creation workflows:

- **Capture a saved day.** Choose a populated saved schedule date and a template name. The weekday is derived from the date automatically. After capture, the isolated Template Editor opens so the copied schedule can be changed without modifying the live scheduling calendar.
- **Upload an Excel workbook.** Upload an `.xlsx`, `.xls`, or `.xlsm` file, then select a sheet from the workbook. The importer detects the date/weekday when possible, finds the time rows, maps staff column names to current clinic staff, maps client display codes such as `MaHa` / `ZiBo` to current clients, recognizes Break and Break/Nap cells, previews unmatched values, and saves the selected sheet as an exact reusable template. The isolated editor opens immediately after the import.

Every exact template now has a **View / Edit** action. The editor has its own grid and **Save Template Changes** button; it writes only to the template record and cannot change the live day schedule. A production smoke test verifies that editing a template leaves the source live schedule byte-for-byte unchanged.

Auto Generate does **not** require the Apply button. For each date, it automatically selects the newest exact active template for that weekday as its primary reusable schedule reference. The Templates table marks that record with **Auto Generate primary**. Exact staff/client/time pairings are attempted first after hard eligibility checks. A fallback client whose original staff is absent is not allowed to steal another staff member away from a still-valid exact template pairing while an unreserved eligible fallback is available.

Current-day rules remain authoritative: staff availability and call-outs, client attendance/call-outs, Speech, Nap, required breaks, restrictions, service setting, hour limits, protected manager cells, and coverage safety can all override an old template.

The **Apply** action is an optional manual copy workflow. Clicking Apply opens an in-app date dialog for that template; there is no global apply-date field. Direct application revalidates staff availability, client attendance, Speech/Nap-resolved coverage slots, protected cells, and duplicate client coverage before writing anything.

Learning-only workbook profiles still exist for historical style guidance, but they contain no exact cells and therefore cannot be directly edited/applied like exact templates.

The scheduler regression suite includes five weekday exact-template simulations plus one-staff, two-staff, one-client, and two-client call-out simulations. Feasible exact pairings are required to remain matched while uncovered/fallback work is reassigned around them.

## Manual editing and safety

Schedule edits are sent through validated server routes rather than treated as unverified UI state. Manual range operations can still be blocked by:

- staff unavailable;
- client outside attendance or currently in a fixed event;
- client/staff hard restriction;
- double booking;
- protected/locked manager work;
- invalid/inactive staff or clients;
- configured scheduler rules.

When a requested edit would displace client coverage, the displaced work is preserved in Unplaced when the workflow supports that operation.

Browser-native confirm/alert/prompt dialogs are intentionally avoided in the scheduler workflow. Confirmations and status messages should be presented inside the website.

## Scheduler AI

The application contains **two independent AI paths**. Deleting/disabling the Paid AI implementation does not remove the Native Scheduler AI logic.

### Native Scheduler AI

Native AI is the fast, text-first scheduler assistant implemented inside this repository. It does not require the paid model to understand its supported scheduler commands. It uses deterministic intent/date/time parsing plus the same validated website/scheduler tools used by the rest of the app.

Native AI can currently work with these 24 scheduler tools:

1. schedule lookup;
2. day schedule;
3. staff/day state;
4. client/day state;
5. Unplaced Assignments;
6. schedule health validation;
7. generate day/work week;
8. Minimal Fix / repair;
9. copy schedule day;
10. staff call-outs;
11. direct validated cell edits;
12. bulk staff/client block replacement;
13. direct Unplaced placement;
14. scheduler configuration;
15. staff create/update/archive;
16. client create/update/archive;
17. team create/update/archive;
18. Nap/Speech event management;
19. client attendance call-in/call-out management;
20. scheduling-rule updates;
21. schedule template management;
22. supervision records;
23. client replacement analysis;
24. schedule-improvement / continuity recommendations.

It also understands historical/workbook questions and uses same-weekday scheduler history, templates, workbook learning profiles, and saved AI manager feedback as advisory memory.

Native AI is **text-only**. It intentionally rejects image uploads instead of depending on the Paid AI vision path.

### Paid Scheduler AI

Paid AI uses an external reasoning model through the AI gateway (the current default in code is GPT-5.6 Sol, configurable with environment variables). It has the same authoritative scheduler tools/validations, but it can perform richer multi-step natural-language planning and can analyze screenshots with the configured vision model.

A new screenshot upload is deliberately preview-only: the Paid AI extracts and compares the visible source data but cannot write on that upload turn. The manager must confirm the proposed import/change in a later turn.

### Native vs Paid

| Capability | Native AI | Paid AI |
| --- | --- | --- |
| Fast text scheduler commands | Yes | Yes |
| Reads live scheduler data | Yes | Yes |
| Generate / repair / edit when autonomous writes are enabled | Yes | Yes |
| Staff/client/team/events/rules/templates/supervision management | Yes | Yes |
| Workbook/history awareness | Yes | Yes |
| Deterministic specialized scheduler intent handling | Primary design | Uses model reasoning + tools |
| Multi-step open-ended reasoning | Limited/specialized | Stronger |
| Screenshot/image analysis | No | Yes |
| Requires paid model path | No | Yes |
| Independent if Paid AI is deleted | Yes | N/A |

Both modes remain bound by scheduler validation. Neither mode is allowed to invent staff/client IDs, silently bypass hard restrictions, or claim a blocked write succeeded.

### Example AI commands

Native AI supports natural variations of commands such as:

- `Generate the schedule for Thursday.`
- `Generate this work week.`
- `Repair Friday and cover the Unplaced clients.`
- `Check the schedule for uncovered coverage, Unplaced work, and staff missing breaks.`
- `Who is free from 1 PM to 2 PM?`
- `Who is covering ZiBo at 2 PM?`
- `Show Izzy's schedule today.`
- `Add a break for Dezz at 12:30 PM.`
- `Remove Dezz's break at 12:30 PM.`
- `Anias is out Thursday.`
- `Replace all Anias blocks with Areyana.`
- `Put CaMe with Areyana instead of Anias from 11 AM to 11:30 AM.`
- `Place the Unplaced CaGr block at 3 PM with Tiara.`
- `Create staff Jane Smith as RBT full-time starting 2026-10-12, weekdays from 8 AM to 4 PM.`
- `Update Izzy's availability Monday-Friday from 9 AM to 5 PM.`
- `Create client John Smith starting 2026-10-12, weekdays from 8 AM to 4 PM.`
- `Mark ZiBo called out Thursday from 1 PM to 3 PM.`
- `Add Speech for ZiBo Tuesday at 10 AM.`
- `Add a Nap window for ZiBo Thursday from 11:30 AM to 1 PM.`
- `Show the scheduling rules.`
- `Set maximum client/staff continuous time to 4 hours.`
- `List Wednesday templates.`
- `Create a Wednesday template from the workbook history.`
- `Analyze replacing CaMe with ZiBo.`
- `Suggest continuity improvements for Wednesday.`
- `What Wednesday workbook/history patterns are you using?`

When a request could overwrite a locked/manual cell or requires a specific rule override, the AI first reports the blocker and asks for explicit authorization for that exact conflict.

## Data management

The current application supports validated create/read/update/delete or archive workflows for:

- staff profiles and recurring shift patterns;
- client profiles and recurring attendance;
- teams;
- Nap sessions and recurring Nap series;
- Speech sessions and recurring Speech series;
- staff call-outs;
- client attendance call-ins/call-outs;
- templates;
- schedule cells and bulk schedule edits;
- supervision records;
- scheduling rules.

Hard deletion routes clean related scheduler references where appropriate. Other manager-facing workflows use archival when the safer product behavior is to preserve history.

## Quality checks

The repository includes regression coverage for the scheduling engine, event windows, preflight/readiness, break eligibility, call-out repair, template learning, Native AI intent/language/management/conversation/date workflows, provider isolation, and TypeScript correctness.

Useful commands:

```bash
npm install
npm run dev

# Complete scheduler + Native AI regression suite
npm run test:scheduler

# Strict TypeScript validation
npx tsc --noEmit --noUnusedLocals --noUnusedParameters

# Production build
npm run build
```

A controlled production smoke test has also been used to verify temporary create/edit/delete workflows for teams, staff, clients, Nap, Speech, attendance changes, staff call-outs, templates, and validated schedule-cell set/clear operations. Test records are removed after verification.

## AI environment options

Relevant variables include:

```text
SCHEDULER_AI_AUTONOMOUS_WRITES=true|false
SCHEDULER_AI_PAID_MODEL=<AI Gateway model>
SCHEDULER_AI_MODEL=<fallback paid model>
SCHEDULER_AI_VISION_MODEL=<vision-capable model>
```

When autonomous writes are disabled, AI operations remain read/advisory only. Native and Paid AI provider graphs are tested independently so the Native path does not import the Paid AI implementation.

## Production

Current production app:

https://automated-schedule-maker.vercel.app

GitHub repository:

https://github.com/Gagan-Narikadamalli/automated-schedule-maker
