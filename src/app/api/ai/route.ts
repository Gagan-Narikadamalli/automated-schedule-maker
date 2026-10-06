import { ToolLoopAgent, stepCountIs } from "ai";
import { NextResponse } from "next/server";

import { buildSchedulerAiInstructions } from "@/features/ai/schedulerPrompt";
import { createSchedulerReadOnlyTools } from "@/features/ai/schedulerTools";
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

const DEFAULT_SCHEDULER_AI_MODEL = "openai/gpt-5.6-luna";
const MAX_MESSAGE_LENGTH = 3000;

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
    const context = {
      locationId,
      locationName,
      date,
      userId: auth.session.userId,
    };

    const tools = createSchedulerReadOnlyTools(context);
    const agent = new ToolLoopAgent({
      model,
      instructions: buildSchedulerAiInstructions(context),
      tools,
      toolChoice: "auto",
      stopWhen: stepCountIs(6),
      maxOutputTokens: 1400,
    });

    const result = await agent.generate({
      prompt: message,
      timeout: {
        totalMs: 45_000,
        stepMs: 15_000,
      },
    });

    const reply = result.text.trim() || "I could not produce a scheduler analysis for that request.";
    const toolsUsed = [
      ...new Set(
        result.steps.flatMap((step) =>
          step.toolCalls.map((toolCall) => toolCall.toolName)
        )
      ),
    ];

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
        mode: "READ_ONLY",
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
      mode: "READ_ONLY",
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Scheduler AI request failed:", error);
    const message = error instanceof Error ? error.message : "";
    const configurationProblem =
      /gateway|api.?key|oidc|unauthorized|authentication|credit/i.test(message);

    return NextResponse.json(
      {
        error: configurationProblem
          ? "Scheduler AI is not connected to an AI Gateway yet. Enable Vercel AI Gateway/OIDC for the project or set AI_GATEWAY_API_KEY for local development."
          : "Scheduler AI could not analyze this request.",
      },
      { status: configurationProblem ? 503 : 500 }
    );
  }
}
