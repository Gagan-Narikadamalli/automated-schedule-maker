import { generateText } from "ai";
import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api/auth";
import { getSchedulerCloudProvider, getSchedulerModel, schedulerModelOptions } from "@/features/ai/schedulerModelProvider";

export const maxDuration = 90;

/** A constant-data connection check: no roster, calendar, prompt or tool access. */
export async function POST() {
  const auth = await requireApiSession();
  if (auth.error) return auth.error;
  const started = Date.now();
  const provider = getSchedulerCloudProvider();
  try {
    const model = getSchedulerModel();
    if (provider === "gemini") {
      // This read-only metadata request also distinguishes network/key access
      // from model generation latency. The key stays in a server-only header.
      const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim() || "";
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", {
        headers:{"x-goog-api-key":apiKey},signal:AbortSignal.timeout(15000),cache:"no-store",
      });
      console.info("Gemini model access check", {status:response.status,elapsedMs:Date.now()-started});
      if (!response.ok) return NextResponse.json({ok:false,provider,providerStatus:response.status,
        elapsedMs:Date.now()-started,error:"Gemini rejected the server API key or project access."},{status:503});
      const listing = await response.json() as {models?:Array<{name?:string}>};
      if (!listing.models?.some(item=>item.name===`models/${model.modelId}`)) {
        return NextResponse.json({ok:false,provider,model:model.modelId,error:"The configured Gemini model is not available to this API key."},{status:503});
      }
    }
    const result = await generateText({model,providerOptions:schedulerModelOptions(false,"low"),
      prompt:"Reply with exactly OK. This is a connection check; no user data is included.",
      maxOutputTokens:1000,maxRetries:0,timeout:{totalMs:60000}});
    return NextResponse.json({ok:!!result.text.trim(),provider,model:model.modelId,
      elapsedMs:Date.now()-started,finishReason:result.finishReason,
      reply:result.text.trim().slice(0,20)});
  } catch (error) {
    const problem = error as {name?:string;statusCode?:number;message?:string;cause?:{code?:string}};
    // Never include request headers, provider response bodies or credentials.
    const name = problem.name ?? "Error";
    const status = problem.statusCode;
    console.error("Scheduler provider connection check failed", {provider,name,status,
      elapsedMs:Date.now()-started,cause:problem.cause?.code});
    return NextResponse.json({ok:false,provider,errorType:name,providerStatus:status,
      elapsedMs:Date.now()-started,error:status===429 ? "Provider quota/rate limit reached." :
        status===401||status===403 ? "Provider rejected this API key or its permissions." :
        status===404 ? "Configured model is unavailable for this provider project." :
        /timeout|abort/i.test(name) ? "Provider connection timed out." :
        "Provider connection could not complete. Check server configuration and provider access."},{status:503});
  }
}
