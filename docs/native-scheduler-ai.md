# Native Scheduler AI

The Native Scheduler AI is a scheduler-specific intelligence layer implemented inside this repository. It does not call OpenAI, Vercel AI Gateway, Ollama, or another model/inference service.

## Architecture

Manager message -> `/api/ai/native` -> deterministic date/time normalization -> Native Scheduler AI intent planner -> provider-neutral scheduler tool executor -> scheduler validation/database logic -> deterministic result formatter.

The existing scheduler, templates, historical patterns, safety checks, database, and audit behavior remain authoritative.

## Phase 1 coverage

- day/work-week generation
- Minimal Fix / repair
- staff call-outs
- direct break add/remove
- bulk staff/client replacement
- template listing/application
- Unplaced inspection
- schedule health checks
- free-staff queries
- staff schedule lookup
- client coverage lookup
- staff/break summaries
- client/nap/speech summaries
- day schedule summaries

Unknown scheduler questions use live day-schedule evidence rather than inventing an answer.

## Safety

Native AI uses the existing validated scheduler rules and database APIs through provider-neutral TypeScript tool executors. Locked/manual and rule override flags are false on first attempts. Bulk replacement keeps its occupied-target confirmation behavior. Minimal Fix uses the existing deterministic repair engine.

The Native endpoint does not import Vercel AI Gateway, OpenAI model code, the AI SDK tool adapter, or the Paid AI route. It does not make an external model/inference request.

Screenshot understanding is deliberately disabled in Native AI so images are never silently sent to an external AI service.

## Independent endpoints

- Free / Native AI: `/api/ai/native`
- Paid / Gateway AI: `/api/ai/paid`

The UI chooses the endpoint directly. There is no global provider environment switch and no shared provider dispatcher. The two AI implementations share only scheduler infrastructure such as date parsing, database models, validation rules, and provider-neutral scheduler executors.

The Paid AI implementation may be removed later without changing the Native endpoint or Native planner. The Native dependency graph is regression-tested so it may not import the `ai` package, `routeBase.ts`, the Paid endpoint, or the Paid tool adapter.

## Testing

Run `npm run test:native-ai` for Native intent coverage and `npm run test:native-ai-isolation` for provider-independence checks.

The main `npm run test:scheduler` suite includes both Native behavior and isolation regression tests.

## Next phases

1. Expand conversational follow-up state and more natural phrasings.
2. Add native historical/template retrieval and manager-preference scoring.
3. Build evaluation datasets from accepted/corrected scheduler interactions.
4. Build safe screenshot/table extraction without an external AI service.
5. Compare native decisions against historical schedules before making native mode the default.


## Storage and conversation lifecycle

The Native Scheduler AI engine itself is TypeScript/Node.js application code. It does not store model weights in MongoDB and does not need a separate AI database.

It uses the same MongoDB connection configured by `MONGODB_URI` as the rest of the scheduler. Historical intelligence reads existing operational collections such as schedules, staff, clients, templates, and manager feedback. Native-specific persistent state is intentionally small:

- `NativeAiPendingAction`: short-lived pending confirmation records. These expire automatically and are also cleared when the user ends a conversation.
- `AITrainingExample`: request/response, selected-tool, manager feedback, and Native shadow-evaluation records used to improve and evaluate the scheduler assistant.

The visible chat transcript is held in the browser component state and is sent back only as recent conversation context. It is not stored as a separate full chat-history database. When a completed assistant response asks "Is there anything else you'd like me to do?" and the user answers with an end phrase such as "done", "no", or "no thanks", the UI clears the visible transcript and calls the authenticated session-reset API to remove outstanding Native pending-action state.

Training/evaluation examples are not deleted by ending the visible chat because they are learning/evaluation records rather than conversation-session state.
