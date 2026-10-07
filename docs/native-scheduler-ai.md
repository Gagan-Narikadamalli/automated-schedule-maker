# Native Scheduler AI

The Native Scheduler AI is a scheduler-specific intelligence layer implemented inside this repository. It does not call OpenAI, Vercel AI Gateway, Ollama, or another model/inference service.

## Architecture

Manager message -> deterministic date/time normalization -> Native Scheduler AI intent planner -> existing scheduler tool -> scheduler validation/database logic -> deterministic result formatter.

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

Native mode still uses the existing validated scheduler tools. Locked/manual and rule override flags are false on first attempts. Bulk replacement keeps its occupied-target confirmation behavior. Minimal Fix uses the existing deterministic repair engine.

When SCHEDULER_AI_PROVIDER=native, no external AI/model inference request is made.

Screenshot understanding is deliberately disabled in native mode for Phase 1 so images are never silently sent to an external AI service.

## Configuration

Set SCHEDULER_AI_PROVIDER=native to use the built-from-scratch engine. The default remains gateway until native coverage and regression tests are sufficient to switch production safely.

## Testing

Run npm run test:native-ai.

The main npm run test:scheduler suite also includes the native AI intent tests.

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
