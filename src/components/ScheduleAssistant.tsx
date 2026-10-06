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
    title: "Generate & repair",
    prompts: [
      "Check this day and fix anything safely fixable, then verify coverage and breaks.",
      "Generate this day using the automatic scheduler and verify there are no uncovered or unplaced assignments.",
      "Generate the work week and tell me what could not be scheduled.",
      "Repair the current schedule after all saved call-outs and verify the result.",
    ],
  },
  {
    title: "Schedule changes",
    prompts: [
      "Move [client code] at [time] to [staff name] and keep coverage valid.",
      "Delete the block for [staff name] at [time]. If client coverage is displaced, keep it in Unplaced.",
      "Fix duplicate or missing breaks without overriding locked/manual cells.",
      "Review the Unplaced tray and place anything that can be scheduled safely.",
    ],
  },
  {
    title: "Staff & clients",
    prompts: [
      "Mark [staff name] called out today and repair the schedule.",
      "Update [staff name]'s weekly target hours to [hours].",
      "Change [client code]'s attendance pattern to [days/times] and update the schedule if needed.",
      "Set [client code] to prefer [staff name] and regenerate the selected day if needed.",
    ],
  },
  {
    title: "Events & attendance",
    prompts: [
      "Change [client code]'s nap today to [start]-[end] and update the schedule.",
      "Add speech for [client code] at [start]-[end] today and repair the schedule.",
      "Create a recurring nap for [client code] on [weekdays] from [start]-[end] between [start date] and [end date].",
      "Mark [client code] called out from [start]-[end] today and repair coverage.",
    ],
  },
  {
    title: "Rules & planning",
    prompts: [
      "Show me the current scheduling rules and explain the break settings.",
      "Change the break window to [start]-[end] and regenerate the selected day if needed.",
      "Increase rotation priority to [value] and tell me what that changes.",
      "Review this month's supervision plan and show who is still below target.",
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

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  );
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
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
      `Linked to ${workspaceContext.locationName} on ${workspaceContext.date}.`
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

  function chooseAssistantDate(nextDate: string) {
    setDate(nextDate);
    setDateSelectionExplicit(true);
    const workspaceDateInput = document.querySelector(
      '.schedule-context-controls input[type="date"]'
    ) as HTMLInputElement | null;
    if (workspaceDateInput) {
      workspaceDateInput.dataset.aiDateExplicit = "true";
      setNativeInputValue(workspaceDateInput, nextDate);
    }
    setStatus(`Date selected for Scheduler AI: ${nextDate}.`);
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
    setStatus("Scheduler AI is analyzing the conversation, resolving the intended date, and deciding the necessary actions...");

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
            ? `${data.mode === "AUTONOMOUS" ? "Autonomous" : "Read-only"} scheduler run used: ${data.toolsUsed.join(", ")}`
            : "Scheduler AI request complete. Continue the conversation if the AI asked for a date or another required detail."
        );
      }
    } catch (error) {
      const messageText =
        error instanceof Error
          ? error.message
          : "Scheduler AI could not complete the request.";
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
                ? "Autonomous scheduler mode"
                : mode === "READ_ONLY"
                  ? "Read-only scheduler mode"
                  : "Scheduler website control"}
            </strong>
            <span>
              {mode === "AUTONOMOUS"
                ? "Can analyze normal language, ask follow-up questions, resolve dates, and operate the scheduler through its existing rules and APIs."
                : mode === "READ_ONLY"
                  ? "Can inspect the scheduler website but write actions are disabled."
                  : "Type any scheduler-related request. If a required date is missing, the AI will ask instead of guessing."}
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
            <label>
              Date
              <input
                type="date"
                value={date}
                disabled={working}
                onChange={(event) => chooseAssistantDate(event.target.value)}
              />
            </label>
          </div>

          <div className={styles.promptHint}>
            <span>Ask naturally — “Anias is out” will ask for a date; “Anias is out today” can act immediately.</span>
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
                <span>These are optional examples. Click one to load it, then edit the bracketed details before running it.</span>
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
                Type any request related to the scheduler website. The AI can inspect and change schedules, staff/client setup, call-outs, attendance, naps, speech, teams, rules, and supervision. It keeps the conversation so you can answer follow-up questions without repeating the original request.
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
                Analyzing the conversation and working through the scheduler…
              </div>
            )}
          </div>

          <form className={styles.composer} onSubmit={(event) => void askScheduler(event)}>
            <textarea
              value={input}
              maxLength={5000}
              disabled={working || !locationId}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask anything related to this scheduler website in your own words..."
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
