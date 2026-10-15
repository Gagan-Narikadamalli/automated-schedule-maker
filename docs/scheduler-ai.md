# Automatic Scheduler AI

This AI is intentionally limited to the Automatic Schedule Maker. It does not receive database credentials, Vercel tokens, GitHub access, shell access, or generic database tools.

## Current phase: read-only foundation

The Schedule Assistant can inspect only the currently selected live clinic/date through controlled scheduler tools:

- `get_day_schedule`
- `get_staff`
- `get_clients`
- `get_unplaced_assignments`
- `check_schedule`

It cannot generate, repair, move, delete, create call-outs, or otherwise modify a schedule yet. When asked to make a change, it should explain the appropriate scheduler action without executing it.

## Runtime setup

Paid AI calls the OpenAI Responses API directly through `@ai-sdk/openai` and `/api/ai/paid`. Its default model is `gpt-6.1-sol`, configurable with `OPENAI_SCHEDULER_MODEL`. AI SDK is the application library, not a model provider or Gateway route. Free/Native AI uses the separate `/api/ai/native` endpoint and does not import or call the paid model stack.

Set server-only `OPENAI_API_KEY` in the Vercel Preview and Production environments and redeploy. For local use, set it in `.env.local`. Never commit the key. Optional `OPENAI_SCHEDULER_VISION_MODEL` controls screenshots; otherwise the same default model is used. Missing credentials return an explicit 503 setup error without model or scheduling fallback.

## Training data already collected

Every successful Scheduler AI interaction attempts to create an `AITrainingExample` containing:

- clinic/location ID and date
- manager request
- assistant answer
- model used
- scheduler tools selected
- read-only mode marker
- manager acceptance or correction when feedback is submitted

The UI exposes `Helpful` and `Needs correction` feedback. Corrections are more useful than raw conversations because they show the desired scheduler behavior.

## What to collect before custom-model training

1. Use the assistant on real scheduling questions covering breaks, coverage, naps, speech, call-outs already reflected in the day, locked/manual blocks, unplaced assignments, and incomplete schedules.
2. Mark correct answers as Helpful.
3. For incorrect answers, save a specific correction describing what the AI should have checked or said.
4. Keep examples that represent edge cases, not only easy days.
5. Build a separate evaluation set that is never included in training. It should test coverage, duplicate/missing breaks, locked/manual preservation, naps, speech, unplaced work, ambiguous requests, and attempts to operate outside the scheduler.
6. Review the stored examples before exporting them. Remove unnecessary identifying text and never include credentials or secrets.

## Recommended next phases

### Phase 2: preview actions

Add write-capable scheduler tools behind a preview/confirmation boundary. The AI may propose a call-out, repair, generation, move, or deletion, but the manager must see the planned changes and choose Apply or Cancel.

Record whether the manager accepted the proposed plan and any correction they made.

### Phase 3: controlled execution

Only after preview behavior has been evaluated should approved scheduler tools execute changes. Every write should reuse the existing scheduler business logic, preserve locked/manual assignments and fixed events, run validation afterward, update the Unplaced tray, and write an audit record.

### Phase 4: training dataset

Export high-quality accepted/corrected examples into a versioned dataset. Keep training and evaluation datasets separate. Track the scheduler version/rules version used for each export so old examples can be identified when scheduling policy changes.

### Phase 5: specialized model

Fine-tune or otherwise specialize a model only after the tool-based assistant is reliable and the dataset has enough manager-reviewed examples. The custom model should replace only the language-model layer; the scheduler tools and deterministic scheduling engine remain the authority.

## Important boundary

The AI should learn how to understand manager intent, select scheduler operations, and explain results. It should not replace deterministic constraints, coverage calculations, break rules, repair logic, or database validation with learned behavior.


## Linked OpenAI generation and assistant

AI Generate opens the existing assistant and submits a date-specific generation request in the same thread. Follow-up questions share that thread and the effective date. The paid assistant's `generate_schedule` tool invokes the same `/api/schedule/ai-generate` endpoint. Free Native mode remains available independently; AI Generate selects OpenAI explicitly.

OpenAI independently designs continuous assignment segments from anonymized staff/client aliases, current shifts, attendance, restrictions, nap/speech windows, templates and historical patterns. It does not receive placements from the deterministic auto-generation engine. The website expands segments into grid cells and validates hard eligibility, double booking, fixed events, one nap per eligible client, one break per staff, clinical rotation limits, and daily/weekly hours. Invalid results receive one bounded correction attempt; provider failure never silently uses Ollama or deterministic generation. Protected manual/template assignments block full-day replacement. Availability/rules/events are checked again before saving. Missing coverage is disclosed and sent to Unplaced when an otherwise valid partial schedule is saved.

Team matching, continuity, historical pairings, target staff/client counts and general consecutive-hour preferences are guidelines for the model's judgment. Clinical restrictions and availability remain enforced. The model returns a concise explanation, main decision reasons and tradeoffs, not private internal chain-of-thought. These explanations describe model decisions and are not proof that a validation check passed; only independent validator results establish that.

A website-scope classification runs before paid website tools or database reads. Unrelated and mixed unrelated requests are declined. The assistant has only the website's controlled tools; no external web-search or general-purpose execution tools. OpenAI calls use `store:false`; conversation history is supplied by the application. This setting is not a claim of zero retention.

Validation: `npm run test:openai` uses a mocked OpenAI Responses endpoint and synthetic roster data; it checks direct routing, scope decisions, plan parsing, decision summaries, hard-rule rejection and flexible preferences. A real API smoke test still requires a configured OpenAI key and account model access.
