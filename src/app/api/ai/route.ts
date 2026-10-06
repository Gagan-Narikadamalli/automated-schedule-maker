import { ToolLoopAgent, generateText, stepCountIs } from "ai";
import { NextResponse } from "next/server";

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
const MAX_TOOL_EVIDENCE_LENGTH = 24_000;

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
  for (const entry of [...history].slice(-4).reverse()) {
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

  if (isAffirmativeContinuation(message)) {
    const conversationDate = recentConversationDate(history, selectedDate);
    if (conversationDate) {
      return { date: conversationDate, source: "CONVERSATION" };
    }
  }

  if (dateSelectionExplicit) {
    return { date: selectedDate, source: "SELECTED_DAY" };
  }

  return { date: selectedDate, source: "PASSIVE_SELECTION" };
}

function buildConversationPrompt(
  history: SchedulerAiHistoryMessage[],
  message: string
): string {
  if (history.length === 0) return message;
  const transcript = history
    .map((entry) => `${entry.role === "user" ? "User" : "Scheduler AI"}: ${entry.text}`)
    .join("\n");
  return `Conversation so far:\n${transcript}\n\nUser's latest message:\n${message}`;
}

function safeToolEvidence(value: unknown): string {
  try {
    const serialized = JSON.stringify(value, null, 2);
    if (!serialized) return "No structured tool output was available.";
    return serialized.slice(0, MAX_TOOL_EVIDENCE_LENGTH);
  } catch {
    return "The scheduler tools completed, but their structured output could not be serialized.";
  }
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
    const context = {
      locationId,
      locationName,
      date: resolvedDate.date,
      selectedDate,
      todayDate,
      dateSource: resolvedDate.source,
      dateSelectionExplicit,
      userId: auth.session.userId,
    };

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

    const agent = new ToolLoopAgent({
      model,
      instructions: buildSchedulerAiInstructions(context, {
        autonomousWrites,
      }),
      tools,
      toolChoice: "auto",
      stopWhen: stepCountIs(20),
      maxOutputTokens: 2400,
    });

    const result = await agent.generate({
      prompt: buildConversationPrompt(history, message),
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
    const toolEvidence = result.steps.flatMap((step) =>
      step.toolResults.map((toolResult) => ({
        toolName: toolResult.toolName,
        input: toolResult.input,
        output: toolResult.output,
      }))
    );

    let reply = result.text.trim();

    if (!reply && toolsUsed.length > 0) {
      try {
        const synthesis = await generateText({
          model,
          instructions: `You are the final-response writer for the Automatic Schedule Maker assistant. Write a concise, natural answer to the user's scheduler request using ONLY the supplied scheduler tool evidence. Do not call tools. Do not invent names, coverage, conflicts, or changes. Clearly say what date was checked or changed. If the evidence says scheduleAvailable=false, state that the schedule has not been generated for that date and ask whether the user wants you to generate it; do not infer staff availability from an ungenerated schedule. If the evidence contains detailed schedule segments, answer with those names/codes and time ranges instead of a generic assignment count. If the evidence shows uncovered work or break problems, state them. If no write tool was used, do not imply that anything was changed. If a write tool was used, distinguish completed changes from remaining problems. Sound like a helpful scheduling assistant rather than a system log.`,
          prompt: `Clinic: ${locationName || "Clinic"}\nEffective date: ${resolvedDate.date}\nOriginal user request: ${message}\nWrite tools used: ${writeToolsUsed.join(", ") || "none"}\n\nScheduler tool evidence:\n${safeToolEvidence(toolEvidence)}`,
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

    if (!reply) {
      reply =
        "I'm unable to understand that request yet. Please explain or elaborate what you want me to check or change in the scheduler.";
    }

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
            : "Scheduler AI could not complete this request.",
      },
      { status: configurationProblem ? 503 : timeoutProblem ? 504 : 500 }
    );
  }
}
