import { ToolLoopAgent, stepCountIs } from "ai";
import { NextResponse } from "next/server";

import { buildSchedulerAiInstructions } from "@/features/ai/schedulerPrompt";
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

function cleanLocationName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[\r\n\t]+/g, " ").trim().slice(0, 120);
  return cleaned || undefined;
}

export async function POST(request: Request) {
  const auth = await requireApiSession();
  if (auth.error) return auth.error;

  try {
    const body = (await request.json()) as SchedulerAiRequest;
    const message = body.message?.trim() ?? "";
    const locationId = body.locationId?.trim() ?? "";
    const date = body.date?.trim() ?? "";
    const locationName = cleanLocationName(body.locationName);

    if (!message || !locationId || !date) {
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

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
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
    const context = {
      locationId,
      locationName,
      date,
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
      prompt: message,
      timeout: {
        totalMs: 260_000,
        stepMs: 65_000,
      },
    });

    const reply =
      result.text.trim() ||
      "I could not produce a scheduler result for that request.";
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

    let trainingExampleId: string | null = null;
    try {
      await connectToDatabase();
      const example = await AITrainingExample.create({
        locationId,
        date,
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
