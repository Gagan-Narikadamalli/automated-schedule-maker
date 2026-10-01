# Livingston workbook scheduling observations

This document records aggregate scheduling behavior observed from the uploaded Livingston workbook without committing staff names, client initials, or the workbook itself to the public repository.

## Trial window used

The initial behavior profile uses the five recent weekday schedules around September 28 through October 2, 2026. The separate `TEM` sheet was also reviewed as a roster/availability template shell.

The real workbook remains outside GitHub. This prevents clinic-identifying roster information from being copied into the public source repository.

## Aggregate observations

- Five weekday schedules were used for the initial trial profile.
- The recent week contained 28 normalized staff header names after case-only duplicates were collapsed.
- The recent week contained 19 distinct client schedule codes.
- The analyzed weekday cells contained 1,063 normal `1:1` assignment blocks.
- Staff/client runs were usually intentionally continuous rather than randomly shuffled. The median uninterrupted run was 4 half-hour blocks, or about 2 hours.
- The workbook still changes staff/client pairings during the day, especially around lunch and fixed events, so continuity is a preference rather than a hard rule.
- Break placement was strongly concentrated inside the clinic lunch window:
  - 11:30 AM: 9 observed break-type blocks
  - 12:00 PM: 30 observed break-type blocks
  - 12:30 PM: 8 observed break-type blocks
  - 1:00 PM: 27 observed break-type blocks
- Break/Nap is common and should remain a first-class assignment type rather than being flattened into a normal break.
- Speech/Break also appears in the workbook and should remain supported as a combined event.
- Multiple employees can take a break in the same half-hour when remaining staff capacity is still above client demand.
- Historical staff/client pairings repeat often enough that recent same-weekday history is useful guidance, but it must never override hard restrictions, staff availability, client attendance, call-outs, weekly maximums, or the role coverage order.
- Recent sheets include shadow/training notes. These should not be interpreted as ordinary 1:1 client coverage.
- The workbook contains after-care/late-day activity beyond the main daytime block, which supports retaining the application grid through 8:00 PM.

## Scheduler behavior derived from the workbook

The automatic scheduler should therefore use this order of reasoning:

1. Apply hard constraints and protected manual assignments.
2. Preserve fixed nap/speech events and staff call-outs.
3. Cover clients with BT/RBT staff first, then interns, then manager relief, and BCBAs only as the final coverage tier.
4. Prefer repeated valid weekday-template and recent-history pairings within the same eligible staffing tier.
5. Prefer continuity for standard clients so unnecessary half-hour switching is avoided.
6. Enforce rotation configuration for higher-support clients instead of allowing historical continuity to defeat rotation.
7. Reserve breaks only when client demand remains coverable, using historically common break times as a tie-breaker.
8. If complete coverage is mathematically impossible, keep every safe assignment already produced and return uncovered blocks for manager completion.

## Privacy rule for trial data

Do not commit the raw Livingston workbook, real staff roster, or client codes as source-code fixtures. Workbook-derived regression tests should use synthetic identifiers while preserving the observed scheduling structure and aggregate behavior.
