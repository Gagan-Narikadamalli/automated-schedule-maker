# Private AI Generate service (work in progress)

The new **AI Generate (Preview)** is separate from the original **Auto Generate Day**. The private deployment target is a Python OR-Tools CP-SAT service; it does **not** need an Ollama API key to produce schedules.

## Status
The Next.js preview endpoint and UI button are on this branch. This service directory currently contains deployment scaffolding only. The Python solver/server implementation is being tested separately and **must be added and validated before building this Dockerfile**. Do not deploy this branch as a complete optimizer.

## Required server-only configuration
On the optimizer server: `OPTIMIZER_BEARER_TOKEN` — a random secret, 32+ characters.
On the Next.js server: `AI_SCHEDULER_OPTIMIZER_URL` — HTTPS URL to the private `/solve` endpoint and `AI_SCHEDULER_OPTIMIZER_TOKEN` — corresponding secret.

## Ollama API key
An Ollama Cloud key is an **optional** second integration for explanations, schedule analysis, and conversational assistance, not a substitute for a constraint solver. Store it only in the protected backend secret store as `OLLAMA_API_KEY`. Choose and verify a supported Ollama Cloud model/API endpoint, then add a separate server-side explanation adapter. Never send identifiable clients/staff data to Ollama without organizational privacy approval, and never place the key in frontend environment variables or source control.

## Production gates
- Exhaustive input validation and a rule-parity audit
- Complete event, template, qualifications, break and maximum-hours handling
- Independent output audit + preview review + explicit manager approval
- Transaction-safe persistence, rollback, concurrency protection and audit trails
- Load tests for 20 clients/26 staff across weekday/call-out scenarios
