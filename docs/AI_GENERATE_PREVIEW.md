# Independent AI Generate: integration status and requirements

This is a **development preview**, not a finished AI scheduler. The existing Auto Generate route (`/api/schedule/generate`) remains completely unchanged.

## Implemented in this branch
- A separate **AI Generate (Preview)** button next to Auto Generate Day.
- Authenticated, location-scoped `POST /api/schedule/ai-generate`.
- Server-side, env-configured optimizer HTTP endpoint, bearer token and 60-second timeout.
- A structural audit rejecting staff/client double-booking, unavailable staff and clients, hard staff/client restrictions, conflicting service settings and duplicate break cells.
- Coverage-gap reporting and a preview-only response. Nothing is written to MongoDB.
- No model provider or paid AI dependency. This endpoint is intentionally independent of the existing native and paid AI components.

## Still required before production use
1. Deploy the optimizer independently using a deterministic constraint solver such as OR-Tools CP-SAT. Ollama/LM Studio may optionally interpret rules or explain decisions, but the solver and validator must enforce assignments.
2. Supply a secure reachable URL for the optimizer and set these **server-side** environment variables:
   - `AI_SCHEDULER_OPTIMIZER_URL=https://<private-optimizer-endpoint>/solve`
   - `AI_SCHEDULER_OPTIMIZER_TOKEN=<random-strong-secret>`
3. Implement solver-side rules and a second independent audit for hard relationship restrictions, client events, break *duration*, qualifications, minimum contiguous blocks, maximum consecutive time, staff/client daily and weekly limits, scheduling window boundaries, template locks and precedence, and coverage scarcity.
4. Build a UI for inspecting each previewed staff/client block and uncovered gap. Only after testing should an explicit manager approval trigger a transactionally safe save with optimistic concurrency and rollback.
5. Run regression tests with de-identified historical data and simulated call-outs. Never send identifiable client records to an unapproved external model or service.
6. Record optimization status, algorithm version, violations, reason codes, runtime and changes compared with Auto Generate.

## Optimizer request
```json
{
  "date": "2026-10-12",
  "locationId": "LOCATION_ID",
  "input": {
    "staff": [],
    "clients": [],
    "existingAssignments": [],
    "referenceAssignments": [],
    "callOutStaffIds": [],
    "rules": {}
  },
  "rules": {}
}
```
`input` is the repository's existing `SchedulerInput` object, whose arrays are populated server-side. The optimizer must never treat historical assignments as hard locks unless explicitly marked and authorized. The remote service must verify the bearer token.

## Optimizer response
```json
{
  "assignments": [
    { "staffId": "STAFF_ID", "clientId": "CLIENT_ID", "startTime": "08:00", "assignmentType": "CLIENT_1_TO_1" },
    { "staffId": "STAFF_ID_2", "startTime": "11:30", "assignmentType": "BREAK" }
  ],
  "explanation": "Optimization status, constraints and uncovered gaps."
}
```
The API returns candidate assignments to the caller only when the initial audit finds no blocking violations. Partial coverage may be reported and must not be mistaken for completion.

## Required decisions from project owner
- Where will the independent optimizer run (local clinic Windows server, private cloud VM, or campus experimentation only)? Public deployments cannot call an ordinary laptop's `localhost`.
- Which staff must receive breaks, for exactly how long, and within what window? Which rules are legal/contractual hard constraints?
- Confirm whether fixed nap and speech sessions must always be respected, even when imported templates differ.
- Approve the priority order: coverage vs break eligibility vs exact templates vs minimum session lengths.
- Provide **de-identified** examples: 20 clients/26 staff, daily timing windows, hard restrictions, call-outs, desired outputs and edge cases.

This branch should be reviewed and tested before merging. No automatic production deployment should be inferred.
