import { ToolLoopAgent, generateText, stepCountIs } from "ai";
import { NextResponse } from "next/server";

import { buildSchedulerDateContextSnapshot } from "@/features/ai/schedulerDateContext";
import { buildSchedulerAiInstructions } from "@/features/ai/schedulerPrompt";
import { buildSchedulerReplyFallback } from "@/features/ai/schedulerReplyFallback";
import { createSchedulerReadOnlyTools } from "@/features/ai/schedulerTools";
import {
  createSchedulerWebsiteTools,
  SCHEDULER_WEBSITE_WRITE_TOOL_NAMES,
} from "@/features/ai/schedulerWebsiteTools";
import {
  createSchedulerWriteTools,
  SCHEDULER_WRITE_TOOL_NAMES,
} from "@/features/ai/schedulerWriteTools";
import type {
  SchedulerAiContext,
  SchedulerAiDateSource,
  SchedulerAiHistoryMessage,
  SchedulerAiRequest,
  SchedulerAiResponse,
} from "@/features/ai/types";
import {
  forbiddenResponse,
  requireApiSession,
  sessionCanAccessLocation,
} from "@/lib/api/auth";
import { connectToDatabase } from "@/lib/db";
import { AITrainingExample } from "@/models/AITrainingExample";

export const maxDuration = 300;

const DEFAULT_SCHEDULER_AI_MODEL = "openai/gpt-5-nano";
const MAX_MESSAGE_LENGTH = 5000;
const MAX_HISTORY_MESSAGES = 12;
const MAX_TOOL_EVIDENCE_LENGTH = 32_000;
const MAX_DATE_CONTEXT_LENGTH = 42_000;
const CLOSING_QUESTION = "Is there anything else you'd like help with?";

function cleanLocationName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[\r\n\t]+/g, " ").trim().slice(0, 120);
  return cleaned || undefined;
}

function dateInNewYork(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function formatLocalDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftDate(dateText: string, days: number): string {
  const value = new Date(`${dateText}T12:00:00`);
  value.setDate(value.getDate() + days);
  return formatLocalDate(value);
}

function weekdayDate(anchorDate: string, weekday: number, weekShift = 0): string {
  const value = new Date(`${anchorDate}T12:00:00`);
  const currentDay = value.getDay();
  const mondayOffset = currentDay === 0 ? -6 : 1 - currentDay;
  value.setDate(value.getDate() + mondayOffset + weekday + weekShift * 7);
  return formatLocalDate(value);
}

function parseNamedOrNumericDate(message: string, anchorDate: string): string | null {
  const slash = message.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}|\d{2}))?\b/);
  if (slash) {
    const [, monthText, dayText, yearText] = slash;
    const anchorYear = Number(anchorDate.slice(0, 4));
    const year = yearText
      ? Number(yearText.length === 2 ? `20${yearText}` : yearText)
      : anchorYear;
    const month = Number(monthText);
    const day = Number(dayText);
    const candidate = new Date(year, month - 1, day, 12, 0, 0);
    if (
      candidate.getFullYear() === year &&
      candidate.getMonth() === month - 1 &&
      candidate.getDate() === day
    ) {
      return formatLocalDate(candidate);
    }
  }

  const monthNames =
    "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";
  const named = message.match(
    new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})(?:,?\\s+(20\\d{2}))?\\b`, "i")
  );
  if (named) {
    const parsed = new Date(
      `${named[1]} ${named[2]}, ${named[3] || anchorDate.slice(0, 4)} 12:00:00`
    );
    if (!Number.isNaN(parsed.getTime())) return formatLocalDate(parsed);
  }
  return null;
}

function cleanHistory(value: unknown): SchedulerAiHistoryMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is SchedulerAiHistoryMessage =>
        Boolean(entry) &&
        typeof entry === "object" &&
        ((entry as SchedulerAiHistoryMessage).role === "user" ||
          (entry as SchedulerAiHistoryMessage).role === "assistant") &&
        typeof (entry as SchedulerAiHistoryMessage).text === "string"
    )
    .slice(-MAX_HISTORY_MESSAGES)
    .map((entry) => ({
      role: entry.role,
      text: entry.text.trim().slice(0, 2200),
    }))
    .filter((entry) => entry.text.length > 0);
}

function isAffirmativeContinuation(message: string): boolean {
  const normalized = message
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ");
  return /^(yes|yeah|yep|sure|ok|okay|yes please|please do|go ahead|proceed|do it|generate it|create it|make it)$/.test(
    normalized
  );
}

function recentConversationDate(
  history: SchedulerAiHistoryMessage[],
  anchorDate: string
): string | null {
  for (const entry of [...history].slice(-6).reverse()) {
    const isoDate = entry.text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
    if (isoDate) return isoDate;
    const namedOrNumeric = parseNamedOrNumericDate(entry.text, anchorDate);
    if (namedOrNumeric) return namedOrNumeric;
  }
  return null;
}

function resolveDateContext(
  message: string,
  selectedDate: string,
  todayDate: string,
  dateSelectionExplicit: boolean,
  history: SchedulerAiHistoryMessage[]
): { date: string; source: SchedulerAiDateSource } {
  const normalized = message.toLowerCase();
  const isoDate = message.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  if (isoDate) return { date: isoDate, source: "EXPLICIT_DATE" };

  const namedOrNumeric = parseNamedOrNumericDate(message, selectedDate);
  if (namedOrNumeric) {
    return { date: namedOrNumeric, source: "EXPLICIT_DATE" };
  }

  if (/\b(today|current date|right now|now)\b/.test(normalized)) {
    return { date: todayDate, source: "TODAY" };
  }
  if (/\btomorrow\b/.test(normalized)) {
    return { date: shiftDate(todayDate, 1), source: "RELATIVE_DATE" };
  }
  if (/\byesterday\b/.test(normalized)) {
    return { date: shiftDate(todayDate, -1), source: "RELATIVE_DATE" };
  }

  const weekdays = [
    { names: ["monday", "mon"], offset: 0 },
    { names: ["tuesday", "tue", "tues"], offset: 1 },
    { names: ["wednesday", "wed"], offset: 2 },
    { names: ["thursday", "thu", "thur", "thurs"], offset: 3 },
    { names: ["friday", "fri"], offset: 4 },
    { names: ["saturday", "sat"], offset: 5 },
    { names: ["sunday", "sun"], offset: 6 },
  ];

  for (const weekday of weekdays) {
    const pattern = new RegExp(`\\b(${weekday.names.join("|")})\\b`, "i");
    if (!pattern.test(message)) continue;
    const weekShift = /\bnext\b/i.test(message)
      ? 1
      : /\b(last|previous)\b/i.test(message)
        ? -1
        : 0;
    return {
      date: weekdayDate(selectedDate, weekday.offset, weekShift),
      source: "WEEKDAY",
    };
  }

  if (
    /\b(this|current|the)\s+(work\s+)?week\b/.test(normalized) ||
    /\b(generate|build|make|fix|repair)\s+(the\s+)?(work\s+)?week\b/.test(normalized)
  ) {
    return { date: selectedDate, source: "SELECTED_WEEK" };
  }

  if (
    /\b(this|selected)\s+day\b/.test(normalized) ||
    /\b(current|this)\s+schedule\b/.test(normalized)
  ) {
    return { date: selectedDate, source: "SELECTED_DAY" };
  }

  const conversationDate = recentConversationDate(history, selectedDate);
  const latestAssistant = [...history]
    .reverse()
    .find((entry) => entry.role === "assistant")?.text.toLowerCase();
  if (
    conversationDate &&
    (isAffirmativeContinuation(message) ||
      Boolean(latestAssistant?.includes("which day")) ||
      Boolean(latestAssistant?.includes("what date")) ||
      Boolean(latestAssistant?.includes("would you like me to generate")))
  ) {
    return { date: conversationDate, source: "CONVERSATION" };
  }

  if (dateSelectionExplicit) {
    return { date: selectedDate, source: "SELECTED_DAY" };
  }

  return { date: selectedDate, source: "PASSIVE_SELECTION" };
}

function stringifyLimited(value: unknown, maxLength: number): string {
  try {
    const serialized = JSON.stringify(value, null, 2);
    if (!serialized) return "No structured scheduler data was available.";
    return serialized.slice(0, maxLength);
  } catch {
    return "The scheduler data was available, but it could not be serialized.";
  }
}

function buildConversationPrompt(
  history: SchedulerAiHistoryMessage[],
  message: string,
  dateContext: unknown | null
): string {
  const transcript = history.length
    ? history
        .map((entry) => `${entry.role === "user" ? "User" : "Scheduler AI"}: ${entry.text}`)
        .join("\n")
    : "No previous conversation.";

  const contextSection = dateContext
    ? `\n\nAUTHORITATIVE DATE CONTEXT\nThe following snapshot was loaded directly from the scheduler for the effective date. Treat it as authoritative scheduler data. Use it to understand staff availability, saved assignments, client required time, breaks, naps/speech, call-outs, unplaced work, and uncovered coverage. You may call tools for additional detail or actions, but do not contradict this snapshot unless a later successful write/tool result changes it.\n${stringifyLimited(
        dateContext,
        MAX_DATE_CONTEXT_LENGTH
      )}`
    : "";

  return `Conversation so far:\n${transcript}${contextSection}\n\nUser's latest message:\n${message}`;
}

function answerNeedsFollowUp(reply: string): boolean {
  const normalized = reply.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized.endsWith("?")) return true;
  return (
    normalized.includes("please explain or elaborate") ||
    normalized.includes("please clarify") ||
    normalized.includes("which day") ||
    normalized.includes("what date") ||
    normalized.includes("would you like me to generate")
  );
}

function ensureConversationClosing(reply: string): string {
  if (answerNeedsFollowUp(reply)) return reply;
  if (/is there anything else (you('|’)d|you would) like help with\??/i.test(reply)) {
    return reply;
  }
  return `${reply.trim()}\n\n${CLOSING_QUESTION}`;
}

export async function POST(request: Request) {
  const auth = await requireApiSession();
  if (auth.error) return auth.error;

  try {
    const body = (await request.json()) as SchedulerAiRequest;
    const message = body.message?.trim() ?? "";
    const locationId = body.locationId?.trim() ?? "";
    const selectedDate = body.date?.trim() ?? "";
    const locationName = cleanLocationName(body.locationName);
    const history = cleanHistory(body.history);
    const dateSelectionExplicit = body.dateSelectionExplicit === true;

    if (!message || !locationId || !selectedDate) {
      return NextResponse.json(
        { error: "message, locationId, and date are required." },
        { status: 400 }
      );
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json(
        { error: `Scheduler AI messages are limited to ${MAX_MESSAGE_LENGTH} characters.` },
        { status: 400 }
      );
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
      return NextResponse.json(
        { error: "Date must use YYYY-MM-DD format." },
        { status: 400 }
      );
    }

    if (locationId.startsWith("demo-")) {
      return NextResponse.json(
        { error: "Scheduler AI is available only for live clinic data." },
        { status: 400 }
      );
    }

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this scheduler location.");
    }

    const model =
      process.env.SCHEDULER_AI_MODEL?.trim() || DEFAULT_SCHEDULER_AI_MODEL;
    const autonomousWrites =
      process.env.SCHEDULER_AI_AUTONOMOUS_WRITES?.trim().toLowerCase() === "true";
    const todayDate = dateInNewYork();
    const resolvedDate = resolveDateContext(
      message,
      selectedDate,
      todayDate,
      dateSelectionExplicit,
      history
    );
    const context: SchedulerAiContext = {
      locationId,
      locationName,
      date: resolvedDate.date,
      selectedDate,
      todayDate,
      dateSource: resolvedDate.source,
      dateSelectionExplicit,
      userId: auth.session.userId,
    };

    let dateContext: Awaited<ReturnType<typeof buildSchedulerDateContextSnapshot>> | null = null;
    if (resolvedDate.source !== "PASSIVE_SELECTION") {
      try {
        dateContext = await buildSchedulerDateContextSnapshot(context);
      } catch (dateContextError) {
        console.error("Scheduler AI date context could not be loaded:", dateContextError);
      }
    }

    const readTools = createSchedulerReadOnlyTools(context);
    const websiteTools = createSchedulerWebsiteTools(context);
    const tools = autonomousWrites
      ? {
          ...readTools,
          ...websiteTools,
          ...createSchedulerWriteTools(context),
        }
      : {
          ...readTools,
          get_scheduler_configuration: websiteTools.get_scheduler_configuration,
        };

    const dateContextInstructions = `\n\nDATE-CONTEXT ANSWERING RULES\n- Whenever a date is clear, a complete scheduler snapshot for that date may be included with the user's prompt. Use that date-scoped evidence before answering factual questions.\n- Consider all relevant date information together: staff availability and call-outs, saved staff/client assignments, client required slots/attendance, breaks, nap/speech/fixed events, uncovered requirements, unplaced work, and scheduler readiness.\n- Answer whatever scheduler question the user asks from that evidence and any tool results. Do not limit yourself to call-outs or schedule generation.\n- If the available scheduler evidence does not support a reliable answer, say: \"I couldn't generate a reliable answer from the available scheduler information. Please try again with a different date, person, client, time, or more detail.\" Never invent an answer.\n- If the schedule for the requested date is not generated, say that clearly and ask whether the user wants you to generate it. Do not present profile availability as if it were the completed schedule.\n- When the user's request is fully answered or a requested action is fully completed, finish naturally. The server may append a brief offer for additional help. Do not add that offer when you are already asking a required clarification or asking permission to generate a missing schedule.`;

    const agent = new ToolLoopAgent({
      model,
      instructions:
        buildSchedulerAiInstructions(context, {
          autonomousWrites,
        }) + dateContextInstructions,
      tools,
      toolChoice: "auto",
      stopWhen: stepCountIs(20),
      maxOutputTokens: 2400,
    });

    const result = await agent.generate({
      prompt: buildConversationPrompt(history, message, dateContext),
      timeout: {
        totalMs: 260_000,
        stepMs: 65_000,
      },
    });

    const toolsUsed = [
      ...new Set(
        result.steps.flatMap((step) =>
          step.toolCalls.map((toolCall) => toolCall.toolName)
        )
      ),
    ];
    const writeToolsUsed = toolsUsed.filter(
      (toolName) =>
        SCHEDULER_WRITE_TOOL_NAMES.has(toolName) ||
        SCHEDULER_WEBSITE_WRITE_TOOL_NAMES.has(toolName)
    );
    const changed = autonomousWrites && writeToolsUsed.length > 0;
    const mode = autonomousWrites ? "AUTONOMOUS" : "READ_ONLY";
    const toolEvidence = [
      ...(dateContext
        ? [
            {
              toolName: "date_context_snapshot",
              input: { date: resolvedDate.date },
              output: dateContext,
            },
          ]
        : []),
      ...result.steps.flatMap((step) =>
        step.toolResults.map((toolResult) => ({
          toolName: toolResult.toolName,
          input: toolResult.input,
          output: toolResult.output,
        }))
      ),
    ];

    let reply = result.text.trim();

    if (!reply && toolEvidence.length > 0) {
      try {
        const synthesis = await generateText({
          model,
          instructions: `You are the final-response writer for the Automatic Schedule Maker assistant. Answer the user's actual scheduler question using ONLY the supplied date context and scheduler tool evidence. You may discuss staff availability, client attendance/requirements, assignments, who is taking care of whom, time ranges, breaks, nap/speech, call-outs, uncovered work, unplaced work, schedule health, and completed changes. Do not invent anything. If scheduleAvailable=false for a live-calendar question, state that the schedule has not been generated and ask whether the user wants it generated. If the evidence cannot support a reliable answer, say that you couldn't generate a reliable answer and ask for a different date/person/client/time or more detail. If no write tool was used, do not imply anything changed.`,
          prompt: `Clinic: ${locationName || "Clinic"}\nEffective date: ${resolvedDate.date}\nOriginal user request: ${message}\nWrite tools used: ${writeToolsUsed.join(", ") || "none"}\n\nScheduler evidence:\n${stringifyLimited(
            toolEvidence,
            MAX_TOOL_EVIDENCE_LENGTH
          )}`,
          maxOutputTokens: 1400,
          timeout: {
            totalMs: 55_000,
          },
        });
        reply = synthesis.text.trim();
      } catch (synthesisError) {
        console.error("Scheduler AI final response synthesis failed:", synthesisError);
      }
    }

    if (!reply && toolsUsed.length > 0) {
      reply = buildSchedulerReplyFallback({
        date: resolvedDate.date,
        locationName,
        toolEvidence,
        writeToolsUsed,
      });
    }

    if (!reply && dateContext && dateContext.scheduleAvailable === false) {
      reply = `The schedule for ${resolvedDate.date} has not been generated yet. Would you like me to generate the schedule for ${resolvedDate.date}?`;
    }

    if (!reply) {
      reply =
        "I couldn't generate a reliable answer from the available scheduler information. Please try again with a different date, person, client, time, or more detail.";
    }

    reply = ensureConversationClosing(reply);

    let trainingExampleId: string | null = null;
    try {
      await connectToDatabase();
      const example = await AITrainingExample.create({
        locationId,
        date: resolvedDate.date,
        userId: auth.session.userId,
        request: message,
        assistantResponse: reply,
        model,
        mode,
        toolsSelected: toolsUsed,
        managerAccepted: null,
        managerCorrection: "",
      });
      trainingExampleId = String(example._id);
    } catch (trainingError) {
      console.error("Scheduler AI training example could not be stored:", trainingError);
    }

    const response: SchedulerAiResponse = {
      reply,
      trainingExampleId,
      toolsUsed,
      writeToolsUsed,
      changed,
      mode,
      effectiveDate: resolvedDate.date,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Scheduler AI request failed:", error);
    const message = error instanceof Error ? error.message : "";
    const configurationProblem =
      /gateway|api.?key|oidc|unauthorized|authentication|credit|model.*not found/i.test(
        message
      );
    const timeoutProblem = /abort|timeout|timed out/i.test(message);

    return NextResponse.json(
      {
        error: configurationProblem
          ? "Scheduler AI is not connected to a usable AI Gateway model yet. Enable Vercel AI Gateway/OIDC for the project or set AI_GATEWAY_API_KEY for local development."
          : timeoutProblem
            ? "Scheduler AI reached its execution limit before finishing. Try splitting a very large scheduler request into two prompts."
            : "Scheduler AI could not complete this request. Please try again with different or more specific scheduler information.",
      },
      { status: configurationProblem ? 503 : timeoutProblem ? 504 : 500 }
    );
  }
}
