"use client";

import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";

import {
  assistantInvitedMoreSchedulerWork,
  isSchedulerConversationEndReply,
} from "@/features/ai/schedulerConversationLifecycle";

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
type SchedulerAiProviderMode = "native" | "gateway";
type SchedulerAiThinkingLevel = "low" | "high";

type SchedulerAiResponse = {
  reply?: string;
  trainingExampleId?: string | null;
  toolsUsed?: string[];
  writeToolsUsed?: string[];
  changed?: boolean;
  mode?: SchedulerAiMode;
  provider?: SchedulerAiProviderMode;
  thinkingLevel?: SchedulerAiThinkingLevel;
  effectiveDate?: string;
  attachmentAnalysis?: string;
  attachmentNames?: string[];
  attachmentPreviewOnly?: boolean;
  error?: string;
};

type ChatAttachment = {
  name: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  dataUrl: string;
  size: number;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  trainingExampleId?: string | null;
  effectiveDate?: string;
  feedback?: "accepted" | "corrected";
  attachments?: Pick<ChatAttachment, "name" | "dataUrl">[];
  attachmentContext?: string;
  attachmentNames?: string[];
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

const MAX_SCREENSHOT_ATTACHMENTS = 3;
const MAX_SCREENSHOT_TOTAL_BYTES = 3 * 1024 * 1024;
const ALLOWED_SCREENSHOT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("The screenshot could not be read."));
    reader.onerror = () => reject(new Error("The screenshot could not be read."));
    reader.readAsDataURL(file);
  });
}

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
    title: "Analyze & what-if",
    prompts: [
      "Audit [day/date] for coverage gaps, excessive client handoffs, fragmented staff schedules, break problems, repeated pair exceptions, and rule conflicts. Suggest the smallest improvements without changing anything.",
      "If [staff name] becomes unavailable from [start time] to [end time] on [day/date], who would be the best replacements and why? Do not make changes.",
      "Which staff/client pairings on [day/date] are closest to the maximum continuous-time rule, and where should rotation happen next?",
      "Find avoidable idle gaps for staff on [day/date] and suggest schedule moves that keep every client covered.",
      "Explain why [client code] is assigned to [staff name] at [time] on [day/date] using availability, relationships, rotation, team, workload, and scheduler rules.",
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
      "Set the handoff reduction priority to [value] and compact staff schedule priority to [value], then explain the tradeoff.",
      "Keep Minimal Fix allowed to move breaks but do not let it move protected manual assignments.",
      "Show me which scheduling rules are hard constraints, which are soft preferences, and which can be used only as last-resort exceptions.",
    ],
  },
  {
    title: "Templates",
    prompts: [
      "Show me the active schedule templates for this clinic.",
      "Save [source date] as a template named [template name].",
      "Apply template [template name] to [target date], revalidate it, and tell me which blocks were skipped or changed.",
      "Archive template [template name] after confirming you matched the correct template.",
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

export function ScheduleAssistant({ onScheduleChanged }: ScheduleAssistantProps) {
  const [open, setOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [locationId, setLocationId] = useState("");
  const [date, setDate] = useState(getTodayForDateInput);
  const [dateSelectionExplicit, setDateSelectionExplicit] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState("Connected to the Automatic Scheduler website");
  const [mode, setMode] = useState<SchedulerAiMode | null>(null);
  const [provider, setProvider] = useState<SchedulerAiProviderMode>("native");
  const [correctionFor, setCorrectionFor] = useState<string | null>(null);
  const [correction, setCorrection] = useState("");

  const locationName = useMemo(
    () => locations.find((location) => location.id === locationId)?.name ?? "Clinic",
    [locations, locationId]
  );

  useEffect(() => {
    const savedProvider = window.localStorage.getItem("scheduler-ai-provider");
    if (savedProvider === "native" || savedProvider === "gateway") {
      setProvider(savedProvider);
    }
  }, []);

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
    setAttachments([]);
    setShowHelp(false);
    setMode(null);
    setCorrectionFor(null);
    setCorrection("");
    setWorking(false);
    setStatus(
      provider === "native"
        ? "New Free AI conversation ready."
        : "New Paid AI conversation ready with high reasoning."
    );
  }

  async function clearPendingAiState(
    conversationLocationId: string
  ): Promise<boolean> {
    if (!conversationLocationId || conversationLocationId.startsWith("demo-")) {
      return true;
    }

    try {
      const response = await fetch("/api/ai/session/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId: conversationLocationId }),
      });
      if (response.ok) return true;

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      console.error(
        "Scheduler AI session reset warning:",
        data.error || "Server reset request failed."
      );
      return false;
    } catch (error) {
      console.error("Scheduler AI session reset warning:", error);
      return false;
    }
  }

  async function changeProvider(nextProvider: SchedulerAiProviderMode) {
    if (working || nextProvider === provider) return;

    const requestContext = getRequestContext();

    if (!(await clearPendingAiState(requestContext.locationId))) {
      setStatus(
        "AI mode was not changed because the previous Native confirmation state could not be cleared safely. Try again."
      );
      return;
    }

    setProvider(nextProvider);
    window.localStorage.setItem("scheduler-ai-provider", nextProvider);
    setMessages([]);
    setInput("");
    setAttachments([]);
    setShowHelp(false);
    setMode(null);
    setCorrectionFor(null);
    setCorrection("");

    setStatus(
      nextProvider === "native"
        ? "Free AI selected — Native Scheduler AI uses local deterministic reasoning and no paid model tokens."
        : "Paid AI selected — Gateway AI uses high reasoning and may consume paid AI credits."
    );
  }

  async function completeConversation(
    message: string,
    conversationLocationId: string
  ) {
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
    setAttachments([]);
    setShowHelp(false);
    setStatus("Conversation complete. Clearing chat and pending Native AI state...");

    await clearPendingAiState(conversationLocationId);
    window.setTimeout(resetConversation, 500);
  }

  function chooseSavedPrompt(prompt: string) {
    setInput(prompt);
    setShowHelp(false);
    setStatus("Saved prompt loaded. Edit any [bracketed] details, or replace it with your own wording.");
  }

  async function handleAttachmentSelection(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (files.length === 0) return;

    if (provider === "native") {
      setStatus(
        "Free AI does not send screenshots to an external model. Switch to Paid AI to analyze screenshots."
      );
      return;
    }

    if (attachments.length + files.length > MAX_SCREENSHOT_ATTACHMENTS) {
      setStatus(`Attach no more than ${MAX_SCREENSHOT_ATTACHMENTS} screenshots at once.`);
      return;
    }
    if (files.some((file) => !ALLOWED_SCREENSHOT_TYPES.has(file.type))) {
      setStatus("Only PNG, JPG/JPEG, and WebP screenshots are supported.");
      return;
    }

    const totalBytes =
      attachments.reduce((sum, attachment) => sum + attachment.size, 0) +
      files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > MAX_SCREENSHOT_TOTAL_BYTES) {
      setStatus("Keep the total screenshot upload under 3 MB.");
      return;
    }

    try {
      const nextAttachments = await Promise.all(
        files.map(async (file): Promise<ChatAttachment> => ({
          name: file.name.slice(0, 120),
          mimeType: file.type as ChatAttachment["mimeType"],
          dataUrl: await readFileAsDataUrl(file),
          size: file.size,
        }))
      );
      setAttachments((current) => [...current, ...nextAttachments]);
      setStatus(
        "Screenshot attached. The next run will analyze and preview it first; it will not make changes until you confirm the proposed import."
      );
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "The screenshot could not be attached."
      );
    }
  }

  async function askScheduler(event?: FormEvent) {
    event?.preventDefault();
    const selectedAttachments = attachments;
    const message =
      input.trim() ||
      (selectedAttachments.length > 0
        ? "Analyze the attached scheduler screenshot and tell me what it contains. Do not make changes yet."
        : "");
    const requestContext = getRequestContext();
    if (!message || !requestContext.locationId || working) return;

    const latestAssistant = [...messages]
      .reverse()
      .find((entry) => entry.role === "assistant");
    if (
      isSchedulerConversationEndReply(message) &&
      latestAssistant &&
      assistantInvitedMoreSchedulerWork(latestAssistant.text)
    ) {
      void completeConversation(message, requestContext.locationId);
      return;
    }

    const history = messages.slice(-12).map((entry) => ({
      role: entry.role,
      text: entry.text,
      effectiveDate: entry.effectiveDate,
      attachmentContext: entry.attachmentContext,
      attachmentNames: entry.attachmentNames,
    }));

    const userMessage: ChatMessage = {
      id: makeId("user"),
      role: "user",
      text: message,
      attachments: selectedAttachments.map((attachment) => ({
        name: attachment.name,
        dataUrl: attachment.dataUrl,
      })),
      attachmentNames: selectedAttachments.map((attachment) => attachment.name),
    };

    setMessages((current) => [...current, userMessage]);
    setInput("");
    setAttachments([]);
    setShowHelp(false);
    setWorking(true);
    setStatus(
      selectedAttachments.length > 0
        ? "Paid AI is reading the screenshot, comparing it with the live scheduler, and preparing a preview. No changes will be made on this upload turn."
        : provider === "native"
          ? "Free AI is resolving the date and analyzing scheduler rules, staff, clients, coverage, breaks, events, and Unplaced work..."
          : "Paid AI is using high reasoning with the live scheduler context..."
    );

    try {
      const endpoint =
        provider === "native" ? "/api/ai/native" : "/api/ai/paid";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          locationId: requestContext.locationId,
          locationName: requestContext.locationName,
          date: requestContext.date,
          dateSelectionExplicit: requestContext.dateSelectionExplicit,
          history,
          attachments: selectedAttachments.map((attachment) => ({
            name: attachment.name,
            mimeType: attachment.mimeType,
            dataUrl: attachment.dataUrl,
          })),
        }),
      });
      const data = (await response.json()) as SchedulerAiResponse;
      if (!response.ok) throw new Error(data.error || "Scheduler AI could not complete the request.");

      setMode(data.mode ?? null);
      if (data.provider) {
        setProvider(data.provider);
        window.localStorage.setItem("scheduler-ai-provider", data.provider);
      }
      setMessages((current) => [
        ...current.map((entry) =>
          entry.id === userMessage.id && data.attachmentAnalysis
            ? {
                ...entry,
                attachmentContext: data.attachmentAnalysis,
                attachmentNames:
                  data.attachmentNames?.length
                    ? data.attachmentNames
                    : entry.attachmentNames,
              }
            : entry
        ),
        {
          id: makeId("assistant"),
          role: "assistant",
          text: data.reply || "No scheduler result was returned.",
          trainingExampleId: data.trainingExampleId ?? null,
          effectiveDate: data.effectiveDate,
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
          data.attachmentPreviewOnly
            ? "Screenshot analysis complete. Review the proposed import and confirm it in chat before Scheduler AI makes any changes."
            : data.toolsUsed?.length
              ? `${data.provider === "native" ? "Free AI" : "Paid AI"} · ${data.thinkingLevel === "high" ? "high thinking" : "low compute"} · ${data.mode === "AUTONOMOUS" ? "Autonomous" : "Read-only"} · tools: ${data.toolsUsed.join(", ")}`
              : `${data.provider === "native" ? "Free AI" : "Paid AI"} response complete. Continue naturally if it asked for a date, clarification, or confirmation.`
        );
      }
    } catch (error) {
      const messageText =
        error instanceof Error && error.message.trim()
          ? error.message
          : "Scheduler AI is temporarily unavailable. You can continue using the rest of the scheduler normally and try AI again later.";
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

          <div className={styles.providerSection}>
            <div
              className={styles.providerToggle}
              role="group"
              aria-label="Scheduler AI mode"
            >
              <button
                type="button"
                className={provider === "native" ? styles.providerActive : ""}
                aria-pressed={provider === "native"}
                disabled={working}
                onClick={() => void changeProvider("native")}
              >
                <strong>Free AI</strong>
                <small>Native · Low compute</small>
              </button>
              <button
                type="button"
                className={provider === "gateway" ? styles.providerActive : ""}
                aria-pressed={provider === "gateway"}
                disabled={working}
                onClick={() => void changeProvider("gateway")}
              >
                <strong>Paid AI</strong>
                <small>Gateway · High thinking</small>
              </button>
            </div>
            <span className={styles.providerNote}>
              {provider === "native"
                ? "Runs the built-in Scheduler AI without paid model tokens. Text scheduling only."
                : "Uses the paid AI Gateway with high reasoning. Screenshot analysis is available in this mode."}
            </span>
          </div>

          <div className={styles.promptHint}>
            <span>
              Ask naturally — capitalization and normal typos are okay. {provider === "gateway"
                ? "Paid AI can also analyze schedule screenshots before you confirm changes."
                : "Free AI handles text scheduling locally; switch to Paid AI for screenshots."} Use Saved prompts for more examples.
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
                {provider === "native" ? "Free AI" : "Paid AI"} is ready. Ask a question or request a change in normal language. You can create or update staff, clients, teams, templates, attendance, events, rules, and supervision through conversation. The assistant resolves the exact date before acting and asks for clarification instead of guessing.
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
                  {message.attachments && message.attachments.length > 0 && (
                    <div className={styles.messageAttachments}>
                      {message.attachments.map((attachment) => (
                        <figure key={attachment.name} className={styles.messageAttachment}>
                          <img src={attachment.dataUrl} alt={attachment.name} />
                          <figcaption>{attachment.name}</figcaption>
                        </figure>
                      ))}
                    </div>
                  )}

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
                {provider === "native"
                  ? "Free AI is working through the scheduler…"
                  : "Paid AI is using high reasoning on the scheduler context…"}
              </div>
            )}
          </div>

          <form className={styles.composer} onSubmit={(event) => void askScheduler(event)}>
            {attachments.length > 0 && (
              <div className={styles.attachmentTray}>
                {attachments.map((attachment, index) => (
                  <div
                    key={`${attachment.name}-${index}`}
                    className={styles.attachmentChip}
                  >
                    <img src={attachment.dataUrl} alt="" />
                    <span title={attachment.name}>{attachment.name}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${attachment.name}`}
                      onClick={() =>
                        setAttachments((current) =>
                          current.filter((_, currentIndex) => currentIndex !== index)
                        )
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className={styles.composerRow}>
              <input
                id="scheduler-ai-screenshot-input"
                className={styles.hiddenFileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                disabled={
                  working ||
                  provider === "native" ||
                  !locationId ||
                  attachments.length >= MAX_SCREENSHOT_ATTACHMENTS
                }
                onChange={(event) => void handleAttachmentSelection(event)}
              />
              <label
                className={styles.attachButton}
                htmlFor="scheduler-ai-screenshot-input"
                title={
                  provider === "native"
                    ? "Switch to Paid AI to analyze screenshots"
                    : "Attach schedule screenshot"
                }
                aria-label={
                  provider === "native"
                    ? "Screenshot analysis requires Paid AI"
                    : "Attach schedule screenshot"
                }
              >
                +
              </label>
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
                placeholder={
                  provider === "native"
                    ? "Ask the Free AI about the schedule..."
                    : "Ask the Paid AI, or attach a screenshot to analyze..."
                }
                aria-keyshortcuts="Enter"
              />
              <button
                className={styles.sendButton}
                type="submit"
                disabled={
                  working ||
                  !locationId ||
                  (!input.trim() && attachments.length === 0)
                }
              >
                {working ? "Working…" : "Run"}
              </button>
            </div>
            <small className={styles.attachmentHint}>
              {provider === "native"
                ? "Free AI: text-only, no paid model tokens. Switch to Paid AI for screenshots."
                : "Paid AI: high reasoning. Screenshots support PNG/JPG/WebP, up to 3 images and 3 MB total; uploads stay preview-only until you confirm."}
            </small>
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
