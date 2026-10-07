"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import styles from "./ScheduleAssistant.module.css";

type LocationOption = {
  id: string;
  name: string;
  code: string;
};

type LocationsResponse = {
  locations?: LocationOption[];
  error?: string;
};

type SchedulerAiMode = "READ_ONLY" | "AUTONOMOUS";

type SchedulerAiResponse = {
  reply?: string;
  trainingExampleId?: string | null;
  toolsUsed?: string[];
  writeToolsUsed?: string[];
  changed?: boolean;
  mode?: SchedulerAiMode;
  effectiveDate?: string;
  error?: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  trainingExampleId?: string | null;
  feedback?: "accepted" | "corrected";
};

type WorkspaceContext = {
  locationId: string;
  locationName: string;
  date: string;
  dateSelectionExplicit: boolean;
};

type ScheduleAssistantProps = {
  onScheduleChanged?: (effectiveDate?: string) => void;
};

type SavedPromptGroup = {
  title: string;
  prompts: string[];
};

const SAVED_PROMPT_GROUPS: SavedPromptGroup[] = [
  {
    title: "Check & understand",
    prompts: [
      "Check [day/date] and tell me about uncovered clients, Unplaced assignments, missing or duplicate breaks, and any schedule conflicts.",
      "Show [staff name]'s schedule on [day/date], including client blocks, breaks, and free time.",
      "Who is free between [start time] and [end time] on [day/date]?",
      "What changes would you recommend for [day/date] to improve coverage while making as few moves as possible?",
    ],
  },
  {
    title: "Generate, copy & minimal fix",
    prompts: [
      "Minimal Fix [day/date]. Resolve Unplaced first, cover every client, fix required breaks, and make only the minimum necessary changes.",
      "Generate [day/date] with the automatic scheduler and tell me what could not be scheduled.",
      "Generate the work week starting [date] and summarize any incomplete days, uncovered blocks, or Unplaced work.",
      "Copy the schedule from [source date] to [target date], revalidate it, and tell me what had to change.",
    ],
  },
  {
    title: "Move, replace & Unplaced",
    prompts: [
      "Move [client code] at [time] on [day/date] to [staff name] and keep client coverage valid.",
      "Replace [staff name] with [replacement staff] from [start time] to [end time] on [day/date]. Tell me about occupied clashes before replacing them.",
      "Replace all [source client code] blocks with [replacement client code] on [day/date] and report anything that ends up in Unplaced.",
      "Place the Unplaced [client code] block at [time] with [staff name]. If another client is displaced, preserve that work in Unplaced.",
      "Delete [staff name]'s block at [time] on [day/date]. If client coverage is displaced, keep it in Unplaced and tell me what remains.",
    ],
  },
  {
    title: "Call-outs & attendance",
    prompts: [
      "Mark [staff name] called out from [start time] to [end time] on [day/date] and repair the schedule.",
      "Remove [staff name]'s call-out on [day/date] and rebuild coverage while preserving manual or locked work.",
      "Mark [client code] called out from [start time] to [end time] on [day/date], then repair the affected coverage.",
      "Mark [client code] called in from [start time] to [end time] on [day/date] and update the schedule if coverage changes.",
    ],
  },
  {
    title: "Staff profiles",
    prompts: [
      "Create staff member [full name], role [role], employee type [type], start date [date], and team [team name]. Ask me for anything required that I did not provide.",
      "Change [staff name]'s target weekly hours to [hours] and maximum weekly hours to [hours].",
      "Update [staff name]'s shift pattern to [weekdays] from [start time] to [end time].",
      "Move [staff name] to team [team name] and show me the updated staff profile.",
      "Archive [staff name] after confirming I selected the correct person.",
    ],
  },
  {
    title: "Client profiles",
    prompts: [
      "Create client [full name] with code [client code], start date [date], and team [team name]. Ask me for anything required that I did not provide.",
      "Set [client code]'s support level to [level], maximum consecutive blocks with the same staff to [number], and desired different staff per day to [number].",
      "Update [client code]'s regular attendance pattern to [weekdays] from [start time] to [end time].",
      "Set [client code] to prefer [staff name] and avoid [staff name], then show me the saved relationships.",
      "Assign [BCBA name] as [client code]'s BCBA and [intern names] as assigned interns.",
    ],
  },
  {
    title: "Nap, speech & recurring events",
    prompts: [
      "Add a nap for [client code] on [day/date] from [start time] to [end time] and repair the schedule if needed.",
      "Add speech for [client code] on [day/date] from [start time] to [end time] and repair the schedule if needed.",
      "Create a recurring nap for [client code] every [weekdays] from [start time] to [end time] between [start date] and [end date].",
      "Create recurring speech for [client code] every [weekdays] from [start time] to [end time] between [start date] and [end date].",
      "Remove [client code]'s [nap/speech] at [time] on [day/date]. If it belongs to a recurring series, ask whether I mean one occurrence or the series.",
    ],
  },
  {
    title: "Teams & scheduler rules",
    prompts: [
      "Create a team named [team name] with color [color].",
      "Rename team [current team name] to [new team name] and change its color to [color].",
      "Show me the current scheduling rules and explain which settings affect coverage, breaks, continuity, and rotation.",
      "Change the break window to [start time]-[end time] and break eligibility to [hours] hours, then tell me what the change means.",
      "Change the scheduler's rotation or continuity priority to [value] and explain how that will affect future automatic schedules.",
    ],
  },
  {
    title: "Supervision",
    prompts: [
      "Show me the supervision plan for [month] and identify staff who are below target or missing records.",
      "Record [staff name]'s [month] supervision with [service hours] service hours and [supervision hours] supervision hours under [BCBA name].",
      "Update [staff name]'s supervision record for [month] to [service hours] service hours and [supervision hours] supervision hours.",
      "Summarize supervision status for all BT/RBT staff for [month] and tell me who needs attention first.",
    ],
  },
];

function getTodayForDateInput(): string {
  const now = new Date();
  const localTime = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return localTime.toISOString().slice(0, 10);
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readWorkspaceContext(): WorkspaceContext | null {
  if (typeof document === "undefined") return null;

  const container = document.querySelector(".schedule-context-controls");
  if (!container) return null;

  const select = container.querySelector("select") as HTMLSelectElement | null;
  const dateInput = container.querySelector(
    'input[type="date"]'
  ) as HTMLInputElement | null;

  const locationId = select?.value?.trim() ?? "";
  const locationName =
    select?.selectedOptions?.[0]?.textContent?.trim() || "Clinic";
  const date = dateInput?.value?.trim() ?? "";

  if (!locationId || !date || locationId.startsWith("demo-")) return null;
  return {
    locationId,
    locationName,
    date,
    dateSelectionExplicit: dateInput?.dataset.aiDateExplicit === "true",
  };
}

function normalizeShortReply(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ");
}

function isConversationEndReply(value: string): boolean {
  const normalized = normalizeShortReply(value);
  return /^(no|nope|nah|no thanks|no thank you|nothing else|that's all|thats all|all done|done|i'm done|im done|that is all)$/.test(
    normalized
  );
}

function assistantInvitedMoreHelp(messages: ChatMessage[]): boolean {
  const latestAssistant = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");
  if (!latestAssistant) return false;
  return /is there anything else (you('|’)d|you would) like help with\??/i.test(
    latestAssistant.text
  );
}

export function ScheduleAssistant({ onScheduleChanged }: ScheduleAssistantProps) {
  const [open, setOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [locationId, setLocationId] = useState("");
  const [date, setDate] = useState(getTodayForDateInput);
  const [dateSelectionExplicit, setDateSelectionExplicit] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState("Connected to the Automatic Scheduler website");
  const [mode, setMode] = useState<SchedulerAiMode | null>(null);
  const [correctionFor, setCorrectionFor] = useState<string | null>(null);
  const [correction, setCorrection] = useState("");

  const locationName = useMemo(
    () => locations.find((location) => location.id === locationId)?.name ?? "Clinic",
    [locations, locationId]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadLocations() {
      try {
        const response = await fetch("/api/locations", { cache: "no-store" });
        const data = (await response.json()) as LocationsResponse;
        if (!response.ok) throw new Error(data.error || "Locations could not be loaded.");
        if (cancelled) return;
        const nextLocations = data.locations ?? [];
        setLocations(nextLocations);

        const workspaceContext = readWorkspaceContext();
        if (workspaceContext) {
          setLocationId(workspaceContext.locationId);
          setDate(workspaceContext.date);
          setDateSelectionExplicit(workspaceContext.dateSelectionExplicit);
        } else if (nextLocations.length > 0) {
          setLocationId(nextLocations[0].id);
        }
      } catch (error) {
        if (cancelled) return;
        setStatus(error instanceof Error ? error.message : "Locations could not be loaded.");
      }
    }

    void loadLocations();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const workspaceContext = readWorkspaceContext();
    if (!workspaceContext) return;
    setLocationId(workspaceContext.locationId);
    setDate(workspaceContext.date);
    setDateSelectionExplicit(workspaceContext.dateSelectionExplicit);
    setStatus(
      `Connected to ${workspaceContext.locationName}. Date context follows the scheduler conversation and selected calendar day.`
    );
  }, [open]);

  function getRequestContext(): WorkspaceContext {
    const workspaceContext = readWorkspaceContext();
    if (workspaceContext) {
      if (workspaceContext.locationId !== locationId) {
        setLocationId(workspaceContext.locationId);
      }
      if (workspaceContext.date !== date) {
        setDate(workspaceContext.date);
      }
      setDateSelectionExplicit(workspaceContext.dateSelectionExplicit);
      return workspaceContext;
    }

    return {
      locationId,
      locationName,
      date,
      dateSelectionExplicit,
    };
  }

  function resetConversation() {
    const workspaceContext = readWorkspaceContext();
    if (workspaceContext) {
      setLocationId(workspaceContext.locationId);
      setDate(workspaceContext.date);
      setDateSelectionExplicit(workspaceContext.dateSelectionExplicit);
    }
    setMessages([]);
    setInput("");
    setShowHelp(false);
    setMode(null);
    setCorrectionFor(null);
    setCorrection("");
    setWorking(false);
    setStatus("New Scheduler AI conversation ready.");
  }

  function completeConversation(message: string) {
    const userMessage: ChatMessage = {
      id: makeId("user"),
      role: "user",
      text: message,
    };
    const closingMessage: ChatMessage = {
      id: makeId("assistant-complete"),
      role: "assistant",
      text: "Okay. Conversation complete — starting a fresh Scheduler AI chat.",
      trainingExampleId: null,
    };
    setMessages((current) => [...current, userMessage, closingMessage]);
    setInput("");
    setShowHelp(false);
    setStatus("Conversation complete. Refreshing chat...");
    window.setTimeout(resetConversation, 850);
  }

  function chooseSavedPrompt(prompt: string) {
    setInput(prompt);
    setShowHelp(false);
    setStatus("Saved prompt loaded. Edit any [bracketed] details, or replace it with your own wording.");
  }

  async function askScheduler(event?: FormEvent) {
    event?.preventDefault();
    const message = input.trim();
    const requestContext = getRequestContext();
    if (!message || !requestContext.locationId || working) return;

    if (isConversationEndReply(message) && assistantInvitedMoreHelp(messages)) {
      completeConversation(message);
      return;
    }

    const history = messages
      .slice(-12)
      .map((entry) => ({ role: entry.role, text: entry.text }));

    const userMessage: ChatMessage = {
      id: makeId("user"),
      role: "user",
      text: message,
    };

    setMessages((current) => [...current, userMessage]);
    setInput("");
    setShowHelp(false);
    setWorking(true);
    setStatus(
      "Scheduler AI is resolving the date and loading the relevant staff, client, availability, break, coverage, event, and unplaced information..."
    );

    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          locationId: requestContext.locationId,
          locationName: requestContext.locationName,
          date: requestContext.date,
          dateSelectionExplicit: requestContext.dateSelectionExplicit,
          history,
        }),
      });
      const data = (await response.json()) as SchedulerAiResponse;
      if (!response.ok) throw new Error(data.error || "Scheduler AI could not complete the request.");

      setMode(data.mode ?? null);
      setMessages((current) => [
        ...current,
        {
          id: makeId("assistant"),
          role: "assistant",
          text: data.reply || "No scheduler result was returned.",
          trainingExampleId: data.trainingExampleId ?? null,
        },
      ]);

      if (data.changed) {
        onScheduleChanged?.(data.effectiveDate);
        if (data.effectiveDate) {
          setDate(data.effectiveDate);
          setDateSelectionExplicit(true);
        }
        setStatus(
          data.writeToolsUsed?.length
            ? `Scheduler website updated for ${data.effectiveDate || requestContext.date}. Actions: ${data.writeToolsUsed.join(", ")}`
            : `Scheduler website updated for ${data.effectiveDate || requestContext.date}.`
        );
      } else {
        setStatus(
          data.toolsUsed?.length
            ? `${data.mode === "AUTONOMOUS" ? "Autonomous" : "Read-only"} scheduler analysis used: ${data.toolsUsed.join(", ")}`
            : "Scheduler AI response complete. Continue naturally if it asked for a date, clarification, or confirmation."
        );
      }
    } catch (error) {
      const messageText =
        error instanceof Error
          ? error.message
          : "Scheduler AI could not complete the request. Please try again with different or more specific scheduler information.";
      setMessages((current) => [
        ...current,
        {
          id: makeId("assistant-error"),
          role: "assistant",
          text: messageText,
          trainingExampleId: null,
        },
      ]);
      setStatus(messageText);
    } finally {
      setWorking(false);
    }
  }

  async function saveFeedback(
    message: ChatMessage,
    accepted: boolean,
    correctionText = ""
  ) {
    if (!message.trainingExampleId) return;

    try {
      const response = await fetch("/api/ai/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trainingExampleId: message.trainingExampleId,
          accepted,
          correction: correctionText,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Feedback could not be saved.");

      setMessages((current) =>
        current.map((entry) =>
          entry.id === message.id
            ? { ...entry, feedback: accepted ? "accepted" : "corrected" }
            : entry
        )
      );
      setCorrectionFor(null);
      setCorrection("");
      setStatus(
        accepted
          ? "Saved as an accepted scheduler training example."
          : "Saved your correction for future scheduler AI training."
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Feedback could not be saved.");
    }
  }

  return (
    <div className={styles.assistantRoot}>
      {open && (
        <section className={styles.panel} aria-label="Automatic Scheduler AI">
          <div className={styles.header}>
            <div>
              <span className={styles.eyebrow}>AUTOMATIC SCHEDULER AI</span>
              <h2>Schedule Assistant</h2>
            </div>
            <div className={styles.headerActions}>
              <button
                type="button"
                className={styles.helpButton}
                aria-expanded={showHelp}
                onClick={() => setShowHelp((current) => !current)}
              >
                Help
              </button>
              <button
                type="button"
                className={styles.closeButton}
                aria-label="Close Schedule Assistant"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>
          </div>

          <div className={styles.readOnlyNotice}>
            <strong>
              {mode === "AUTONOMOUS"
                ? "Autonomous scheduler assistant"
                : mode === "READ_ONLY"
                  ? "Read-only scheduler assistant"
                  : "Scheduler conversation"}
            </strong>
            <span>
              {mode === "AUTONOMOUS"
                ? "Can answer schedule questions, ask follow-ups, inspect date-specific context, and make scheduler changes through the existing rules and APIs."
                : mode === "READ_ONLY"
                  ? "Can inspect the scheduler website and answer schedule questions, but write actions are disabled."
                  : "Ask any scheduler-related question naturally. The assistant will ask for a day/date when one is required instead of guessing."}
            </span>
          </div>

          <div className={styles.contextRow}>
            <label>
              Clinic
              <select
                value={locationId}
                disabled={working}
                onChange={(event) => setLocationId(event.target.value)}
              >
                {locations.length === 0 && <option value="">No live locations</option>}
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className={styles.promptHint}>
            <span>
              Ask naturally — schedule checks, generation, Minimal Fix, moves/replacements, Unplaced work, staff/client profiles, call-outs, attendance, naps/speech, teams, rules, supervision, or planning. Use Saved prompts for realistic examples.
            </span>
            <button
              type="button"
              disabled={working}
              onClick={() => setShowHelp((current) => !current)}
            >
              {showHelp ? "Hide saved prompts" : "Saved prompts"}
            </button>
          </div>

          {showHelp && (
            <div className={styles.helpPanel}>
              <div className={styles.helpIntro}>
                <strong>Saved prompts</strong>
                <span>These are realistic examples for the main AI capabilities. Click one to load it, replace the [bracketed] details, and edit the wording however you want before running it.</span>
              </div>
              {SAVED_PROMPT_GROUPS.map((group) => (
                <div key={group.title} className={styles.promptGroup}>
                  <span>{group.title}</span>
                  <div>
                    {group.prompts.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        disabled={working || !locationId}
                        onClick={() => chooseSavedPrompt(prompt)}
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className={styles.messages} aria-live="polite">
            {messages.length === 0 ? (
              <div className={styles.emptyState}>
                Ask a question or request a change in normal language. For a clear date, Scheduler AI loads that day's staff availability, client requirements, saved assignments, breaks, events, call-outs, unplaced work, and coverage before answering. If a day is unclear, it will ask which day. If the requested day has no generated schedule, it will offer to generate it.
              </div>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={message.role === "user" ? styles.userMessage : styles.aiMessage}
                >
                  <span className={styles.messageRole}>
                    {message.role === "user" ? "You" : "Scheduler AI"}
                  </span>
                  <p>{message.text}</p>

                  {message.role === "assistant" &&
                    message.trainingExampleId &&
                    !message.feedback && (
                      <div className={styles.feedbackRow}>
                        <span>Was this correct?</span>
                        <button
                          type="button"
                          onClick={() => void saveFeedback(message, true)}
                        >
                          Helpful
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCorrectionFor(message.id);
                            setCorrection("");
                          }}
                        >
                          Needs correction
                        </button>
                      </div>
                    )}

                  {message.feedback && (
                    <small className={styles.savedFeedback}>
                      {message.feedback === "accepted"
                        ? "Accepted training example"
                        : "Correction saved"}
                    </small>
                  )}

                  {correctionFor === message.id && (
                    <div className={styles.correctionBox}>
                      <label>
                        What should the AI have done, said, or checked?
                        <textarea
                          value={correction}
                          maxLength={4000}
                          onChange={(event) => setCorrection(event.target.value)}
                          placeholder="Describe the manager correction."
                        />
                      </label>
                      <div>
                        <button
                          type="button"
                          disabled={!correction.trim()}
                          onClick={() =>
                            void saveFeedback(message, false, correction.trim())
                          }
                        >
                          Save correction
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCorrectionFor(null);
                            setCorrection("");
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
            {working && (
              <div className={styles.thinking}>
                Loading the relevant date context and working through the scheduler…
              </div>
            )}
          </div>

          <form className={styles.composer} onSubmit={(event) => void askScheduler(event)}>
            <textarea
              value={input}
              maxLength={5000}
              disabled={working || !locationId}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void askScheduler();
                }
              }}
              placeholder="Ask anything related to this scheduler website in your own words..."
              aria-keyshortcuts="Enter"
            />
            <button type="submit" disabled={working || !locationId || !input.trim()}>
              {working ? "Working…" : "Run"}
            </button>
          </form>

          <div className={styles.status}>{status}</div>
        </section>
      )}

      <button
        type="button"
        className={styles.launchButton}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">AI</span>
        Schedule Assistant
      </button>
    </div>
  );
}
