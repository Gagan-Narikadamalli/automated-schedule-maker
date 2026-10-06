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
};

type ScheduleAssistantProps = {
  onScheduleChanged?: () => void;
};

const SUGGESTIONS = [
  "Check the schedule and fix anything safely fixable.",
  "Who is missing a break?",
  "Repair the schedule after the current call-outs.",
  "Generate this day and verify all required coverage.",
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
  return { locationId, locationName, date };
}

export function ScheduleAssistant({ onScheduleChanged }: ScheduleAssistantProps) {
  const [open, setOpen] = useState(false);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [locationId, setLocationId] = useState("");
  const [date, setDate] = useState(getTodayForDateInput);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState("Connected to the Automatic Scheduler");
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
      return workspaceContext;
    }

    return {
      locationId,
      locationName,
      date,
    };
  }

  async function askScheduler(event?: FormEvent) {
    event?.preventDefault();
    const message = input.trim();
    const requestContext = getRequestContext();
    if (!message || !requestContext.locationId || working) return;

    const userMessage: ChatMessage = {
      id: makeId("user"),
      role: "user",
      text: message,
    };

    setMessages((current) => [...current, userMessage]);
    setInput("");
    setWorking(true);
    setStatus("Scheduler AI is checking the live schedule and deciding what to do...");

    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          locationId: requestContext.locationId,
          locationName: requestContext.locationName,
          date: requestContext.date,
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
        onScheduleChanged?.();
        setStatus(
          data.writeToolsUsed?.length
            ? `Schedule updated and calendar refreshed. Actions: ${data.writeToolsUsed.join(", ")}`
            : "Schedule updated and calendar refreshed."
        );
      } else {
        setStatus(
          data.toolsUsed?.length
            ? `${data.mode === "AUTONOMOUS" ? "Autonomous" : "Read-only"} scheduler run used: ${data.toolsUsed.join(", ")}`
            : "Scheduler AI request complete."
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
            <button
              type="button"
              className={styles.closeButton}
              aria-label="Close Schedule Assistant"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>

          <div className={styles.readOnlyNotice}>
            <strong>
              {mode === "AUTONOMOUS"
                ? "Autonomous scheduler mode"
                : mode === "READ_ONLY"
                  ? "Read-only scheduler mode"
                  : "Scheduler control mode"}
            </strong>
            <span>
              {mode === "AUTONOMOUS"
                ? "Can inspect and safely execute scheduling actions with the existing scheduler rules."
                : mode === "READ_ONLY"
                  ? "Can inspect the scheduler but write actions are disabled."
                  : "Linked to the live calendar. Write capability is checked when you send a request."}
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
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
          </div>

          <div className={styles.suggestions}>
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                disabled={working || !locationId}
                onClick={() => setInput(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>

          <div className={styles.messages} aria-live="polite">
            {messages.length === 0 ? (
              <div className={styles.emptyState}>
                Ask the AI to inspect, generate, repair, move, place, delete, or explain schedule blocks. It stays limited to the Automatic Scheduler.
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
                Inspecting and working on the scheduler…
              </div>
            )}
          </div>

          <form className={styles.composer} onSubmit={(event) => void askScheduler(event)}>
            <textarea
              value={input}
              maxLength={3000}
              disabled={working || !locationId}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Tell the Automatic Scheduler AI what you want checked or changed..."
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
