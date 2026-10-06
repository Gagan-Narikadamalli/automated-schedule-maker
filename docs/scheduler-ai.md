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

The app uses Vercel AI SDK and AI Gateway. The default model is `openai/gpt-5.6-luna`, configurable with `SCHEDULER_AI_MODEL`.

Production on Vercel should use the project's AI Gateway/OIDC configuration. For local development, use Vercel OIDC or set `AI_GATEWAY_API_KEY` in `.env.local`. Never commit the real key.

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
