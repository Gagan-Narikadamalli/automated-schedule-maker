# Automatic Scheduler AI

## Provider and configuration

AI Generate and the cloud Schedule Assistant use Gemini directly through `@ai-sdk/google`. AI SDK is the application library, not a model provider or AI Gateway route. The default model is `gemini-3.6-flash`; set `GEMINI_SCHEDULER_MODEL` to override it. The development branch can use a branch-specific model without changing production configuration. `GEMINI_SCHEDULER_PLANNING_MODEL` optionally selects a stronger Gemini model only for full-day design while chat uses a lighter model.

Set server-only `GOOGLE_GENERATIVE_AI_API_KEY` (or `GEMINI_API_KEY`) in each intended Vercel environment and redeploy. Never use a `NEXT_PUBLIC_` key or commit credentials. `SCHEDULER_AI_AUTONOMOUS_WRITES=true` enables the controlled website write tools; false keeps the assistant advisory.

OpenAI is optional: set `SCHEDULER_AI_PROVIDER=openai`, `OPENAI_API_KEY` and optionally `OPENAI_SCHEDULER_MODEL` (default `gpt-6.1-sol`). This calls the Responses API directly with `store:false`; this setting is not a claim of zero retention. Providers never silently fall back to one another. Free/Native AI has its own endpoint and does not import the cloud model stack.

## Linked generation and conversation

AI Generate opens the Schedule Assistant, selects the cloud provider and submits a date-specific `GENERATE_DAY` intent in the same conversation. The server dispatches the shared `generate_schedule` tool directly. Ordinary natural-language generation uses that same tool. Both paths reach `/api/schedule/ai-generate`; subsequent questions can inspect the saved day through website tools.

Ordinary questions expose only read tools, use low reasoning, a concise website prompt, six recent messages and a summary of the selected day. They do not create feedback-training records. Explicit commands or confirmations of pending commands enable action tools. Greetings and thanks are answered locally without any provider request.

The cloud assistant is limited to this website: schedules, staff, clients, attendance, events, templates, rules, supervision and website help. A scope classifier rejects unrelated or mixed unrelated requests. It has no web-search, shell or generic database tool. The explicit Generate button does not need a separate intent classification call.

## Independent scheduling and validation

The model receives required client/time cells, eligible staff candidate groups, availability, restrictions, nap and speech windows, compressed same-weekday templates and historical pairing summaries. It chooses every staff assignment, nap and break. The deterministic auto-generation engine does not supply its placements.

The structured response contains nap times, break times and one ordered staff array per time column. Local conversion translates those choices to website rows without filling missing placements. A separate validator checks availability, call-outs, attendance, eligibility, overlaps, fixed events, exactly one nap per eligible client, one break per available staff, clinical rotation limits and daily/weekly hour limits.

Team preferences, continuity, historical pairings and target staff/client counts guide the model's judgment. The assistant returns concise decision reasons and tradeoffs, not private internal chain-of-thought. These are explanations; independent validation determines whether a proposal can be saved.

A proposal receives at most one full validation repair. Gemini structured planning uses medium reasoning and a 120-second limit per call. Planning and scope classification retry a transient provider failure once within their existing deadlines. Exhausted retries retain the provider status, so a busy service is reported accurately.

Only valid proposals can be saved. Missing coverage is disclosed and added to Unplaced when an otherwise valid partial schedule is saved. Protected manual/template/locked rows require explicit manager permission via `allowProtectedReplacement:true` before a full-day rebuild. Availability, rules, events and saved assignments are checked again before saving to reject stale plans. Replacement writes preserve the old day if an empty or invalid proposal is returned.

## Numbered identities and data handling

Cloud requests use request-local numbered aliases such as Staff1, Client1, Team1 and Location1. The server retains the mapping and resolves tool identifiers locally. Replies restore website names locally. Names, database IDs, contact details, notes, insurance details and source file names are excluded or replaced before prompts and tool results reach the provider.

Cloud screenshot uploads are disabled until local image redaction is available. Numbered scheduling data still contains times, dates and roles: this is pseudonymization, not a guarantee against re-identification.

History and templates provide inference-time guidance; the Gemini model has not been fine-tuned. Ordinary assistant interactions can be recorded locally as `AITrainingExample` feedback. Helpful/correction feedback does not automatically retrain a provider model. Direct Generate responses do not create a training example.

## Verification

`/api/ai/connection` checks provider access using constant data without roster, calendar or tool access. `/api/ai/paid` accepts `readOnly:true` to omit every action tool and skip training-log writes. `/api/schedule/ai-generate` accepts `save:false` for a validated preview.

Focused tests cover direct Google and OpenAI routing, structured model output, bounded retries, provider error status, website scope, tool-call round trips, alias removal/restoration, read-only enforcement, Native/cloud import isolation and independent schedule validation. Run TypeScript and the production build after changes. Mocked provider tests establish application behavior; a real provider response and database read-back are required to claim a successful live generation/save.

## Interrupted requests and provider quotas

Google controls project-level quotas and service availability; the application cannot promise unlimited Gemini requests. It limits model steps and output, uses a smaller read-only prompt and retries transient requests once. A quota/availability interruption returns a usable chat reply, not an unhandled limit error. During an outage, narrow staff/client lookups can still answer directly from authenticated website data and are labeled as website responses.

The tool adapter records completed tool outputs before returning them to the model. If the next model call fails, the response reports the confirmed completed actions, rejected actions and unfinished steps; a confirmed write still sets `changed:true` so the calendar refreshes. Completed mutations are never automatically replayed. This does not make a sequence of independent tools one database transaction: an interrupted multi-step request can have completed steps, which are explicitly reported rather than hidden or claimed as rolled back.

Full-day generation finishes model planning and independent validation before starting replacement writes. A provider failure or invalid proposal at that stage leaves the saved day unchanged. `test:ai-chat-continuity` simulates quota exhaustion before work, after a successful write and after a rejected write, and verifies no duplicate mutation or extra synthesis call.
