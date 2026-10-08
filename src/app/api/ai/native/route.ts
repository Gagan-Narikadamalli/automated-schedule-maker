import { NextResponse } from "next/server";

import {
  createSchedulerBulkTools,
  SCHEDULER_BULK_WRITE_TOOL_NAMES,
} from "@/features/ai/schedulerBulkTools";
import { createSchedulerAdvisoryTools } from "@/features/ai/schedulerAdvisoryTools";
import {
  ensureSchedulerConversationClosing,
} from "@/features/ai/schedulerConversationLifecycle";
import { resolveSchedulerDateContext } from "@/features/ai/schedulerDateResolution";
import {
  analyzeNaturalTimeRange,
  naturalTimeConfirmationQuestion,
} from "@/features/ai/naturalTime";
import { runNativeSchedulerAi } from "@/features/ai/schedulerNativeAi";
import { createSchedulerReadOnlyTools } from "@/features/ai/schedulerTools";
import {
  createSchedulerWebsiteTools,
  isSchedulerWebsiteWriteInvocation,
} from "@/features/ai/schedulerWebsiteTools";
import {
  createSchedulerWriteTools,
  SCHEDULER_WRITE_TOOL_NAMES,
} from "@/features/ai/schedulerWriteTools";
import type {
  SchedulerAiContext,
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

const NATIVE_MODEL_NAME = "native/scheduler-v0.1";
const MAX_MESSAGE_LENGTH = 5000;
const MAX_HISTORY_MESSAGES = 12;

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
      effectiveDate:
        typeof entry.effectiveDate === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(entry.effectiveDate)
          ? entry.effectiveDate
          : undefined,
      attachmentContext:
        typeof entry.attachmentContext === "string"
          ? entry.attachmentContext.trim().slice(0, 14_000)
          : undefined,
      attachmentNames: Array.isArray(entry.attachmentNames)
        ? entry.attachmentNames
            .filter((name): name is string => typeof name === "string")
            .map((name) => name.trim().slice(0, 120))
            .filter(Boolean)
            .slice(0, 3)
        : undefined,
    }))
    .filter((entry) => entry.text.length > 0);
}

function writeResultChanged(output: unknown): boolean {
  const record =
    output && typeof output === "object" && !Array.isArray(output)
      ? (output as Record<string, unknown>)
      : null;
  if (!record) return true;
  if (record.changed === true || record.success === true) return true;
  if (record.changed === false) return false;
  if (
    record.ok === false ||
    record.requiresConfirmation === true ||
    record.requiresClarification === true ||
    record.requiresLockedOverride === true ||
    record.requiresOccupiedReplacementConfirmation === true ||
    (typeof record.status === "number" && record.status >= 400)
  ) {
    return false;
  }
  return record.ok === true;
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

    if (Array.isArray(body.attachments) && body.attachments.length > 0) {
      return NextResponse.json(
        {
          error:
            "Free AI is text-only and does not use the paid screenshot model. Switch to Paid AI only when you want screenshot analysis.",
        },
        { status: 422 }
      );
    }

    if (!message || !locationId || !selectedDate) {
      return NextResponse.json(
        { error: "message, locationId, and date are required." },
        { status: 400 }
      );
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json(
        {
          error: `Free AI messages are limited to ${MAX_MESSAGE_LENGTH} characters.`,
        },
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
        { error: "Free AI is available only for live clinic data." },
        { status: 400 }
      );
    }

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this scheduler location.");
    }

    const autonomousWrites =
      process.env.SCHEDULER_AI_AUTONOMOUS_WRITES?.trim().toLowerCase() ===
      "true";
    const writeToolsEnabled = autonomousWrites;
    const todayDate = dateInNewYork();
    const resolvedDate = resolveSchedulerDateContext({
      message,
      selectedDate,
      todayDate,
      dateSelectionExplicit,
      history,
    });

    if (resolvedDate.error) {
      return NextResponse.json({ error: resolvedDate.error }, { status: 400 });
    }

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

    const naturalTime = analyzeNaturalTimeRange(message);
    if (naturalTime.status === "CONFIRM") {
      const response: SchedulerAiResponse = {
        reply: naturalTimeConfirmationQuestion(naturalTime),
        trainingExampleId: null,
        toolsUsed: [],
        writeToolsUsed: [],
        changed: false,
        mode: autonomousWrites ? "AUTONOMOUS" : "READ_ONLY",
        provider: "native",
        thinkingLevel: "low",
        effectiveDate: resolvedDate.date,
      };
      return NextResponse.json(response);
    }

    const normalizedMessage =
      naturalTime.status === "PARSED"
        ? `${message}\n\n[SCHEDULER TIME NORMALIZATION: The user's intended time range was deterministically parsed as ${naturalTime.normalizedText} (${naturalTime.startTime}-${naturalTime.endTime}). Use these exact times for scheduler lookups and tool calls.]`
        : message;

    const readTools = createSchedulerReadOnlyTools(context);
    const advisoryTools = createSchedulerAdvisoryTools(context);
    const websiteTools = createSchedulerWebsiteTools(context);
    const schedulerTools = writeToolsEnabled
      ? {
          ...readTools,
          ...advisoryTools,
          ...websiteTools,
          ...createSchedulerWriteTools(context),
          ...createSchedulerBulkTools(context),
        }
      : {
          ...readTools,
          ...advisoryTools,
          get_scheduler_configuration:
            websiteTools.get_scheduler_configuration,
        };

    const nativeResult = await runNativeSchedulerAi({
      message: normalizedMessage,
      history,
      tools: schedulerTools,
      date: resolvedDate.date,
      locationId,
      userId: auth.session.userId,
      writeToolsEnabled,
    });

    const toolsUsed = [
      ...new Set(
        nativeResult.steps.flatMap((step) =>
          step.toolCalls.map((toolCall) => toolCall.toolName)
        )
      ),
    ];
    const writeToolsUsed = [
      ...new Set(
        nativeResult.steps.flatMap((step) =>
          step.toolCalls
            .filter(
              (toolCall) =>
                SCHEDULER_WRITE_TOOL_NAMES.has(toolCall.toolName) ||
                isSchedulerWebsiteWriteInvocation(
                  toolCall.toolName,
                  toolCall.input
                ) ||
                SCHEDULER_BULK_WRITE_TOOL_NAMES.has(toolCall.toolName)
            )
            .map((toolCall) => toolCall.toolName)
        )
      ),
    ];
    const writeOutputs = nativeResult.steps.flatMap((step) =>
      step.toolResults
        .filter((result) => writeToolsUsed.includes(result.toolName))
        .map((result) => result.output)
    );
    const changed =
      writeToolsEnabled && writeOutputs.some((output) => writeResultChanged(output));

    const reply = ensureSchedulerConversationClosing(
      nativeResult.text.trim() ||
        "I couldn't generate a reliable answer from the available scheduler information. Please try again with a different date, person, client, time, or more detail."
    );

    let trainingExampleId: string | null = null;
    try {
      await connectToDatabase();
      const example = await AITrainingExample.create({
        locationId,
        date: resolvedDate.date,
        userId: auth.session.userId,
        request: message,
        assistantResponse: reply,
        model: NATIVE_MODEL_NAME,
        mode: autonomousWrites ? "AUTONOMOUS" : "READ_ONLY",
        toolsSelected: toolsUsed,
        managerAccepted: null,
        managerCorrection: "",
      });
      trainingExampleId = String(example._id);
    } catch (trainingError) {
      console.error(
        "Free AI training example could not be stored:",
        trainingError
      );
    }

    const response: SchedulerAiResponse = {
      reply,
      trainingExampleId,
      toolsUsed,
      writeToolsUsed,
      changed,
      mode: autonomousWrites ? "AUTONOMOUS" : "READ_ONLY",
      provider: "native",
      thinkingLevel: "low",
      effectiveDate: resolvedDate.date,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Free AI request failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message
            ? `Free AI could not complete this request: ${error.message}`
            : "Free AI could not complete this request right now.",
      },
      { status: 500 }
    );
  }
}
