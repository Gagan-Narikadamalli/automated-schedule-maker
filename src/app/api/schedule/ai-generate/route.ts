import { NextResponse } from "next/server";
import {
  forbiddenResponse,
  requireApiSession,
  sessionCanAccessLocation,
  sessionHasAnyRole,
  SCHEDULE_WRITE_ROLES,
} from "@/lib/api/auth";
import { buildDaySchedulerInput } from "@/features/scheduler/server/buildDaySchedulerInput";
import { persistScheduleReplacementSafely } from "@/features/scheduler/server/persistScheduleReplacementSafely";
import { getEndTimeForSlot } from "@/features/scheduler/engine/dateUtils";
import { connectToDatabase } from "@/lib/db";

type Candidate = {
  staffId: string;
  clientId?: string | null;
  startTime: string;
  assignmentType: "CLIENT_1_TO_1" | "NAP" | "SPEECH" | "BREAK" | "BREAK_NAP" | "BREAK_SPEECH";
};
type ResponseBody = { assignments?: Candidate[]; explanation?: string; message?: string; failureCode?: string; uncoveredRequirements?: unknown[]; hardViolations?: string[]; success?: boolean };

function invalid(message: string, status = 422) {
  return NextResponse.json({ error: message }, { status });
}
function validatePreview(input: Awaited<ReturnType<typeof buildDaySchedulerInput>>["input"], values: Candidate[]) {
  const staff = new Map(input.staff.map(s => [s.id, s]));
  const clients = new Map(input.clients.map(c => [c.id, c]));
  const staffSlots = new Set<string>();
  const clientSlots = new Set<string>();
  const breakCount = new Map<string, number>();
  const allTimes = new Set([...input.staff.flatMap(s => s.availableSlots), ...input.clients.flatMap(c => c.requiredSlots)]);
  const calledOut = new Set(input.callOutStaffIds);
  const problems: string[] = [];
  const allowedTypes = new Set(["CLIENT_1_TO_1", "NAP", "SPEECH", "BREAK", "BREAK_NAP", "BREAK_SPEECH"]);
  for (const [index, row] of values.entries()) {
    if (!row || typeof row !== "object" || !allowedTypes.has(row.assignmentType) ||
        typeof row.staffId !== "string" || typeof row.startTime !== "string" ||
        !/^\d{2}:\d{2}$/.test(row.startTime) || !allTimes.has(row.startTime)) {
      problems.push(`Invalid assignment at index ${index}`);
      continue;
    }
    const member = staff.get(row.staffId);
    if (!member || calledOut.has(row.staffId) || !member.availableSlots.includes(row.startTime)) {
      problems.push(`Staff unavailable at ${row.startTime}: ${row.staffId}`);
      continue;
    }
    const sk = `${row.staffId}|${row.startTime}`;
    if (staffSlots.has(sk)) problems.push(`Staff double-booked: ${sk}`);
    staffSlots.add(sk);
    if (["BREAK", "BREAK_NAP", "BREAK_SPEECH"].includes(row.assignmentType)) {
      if (row.assignmentType === "BREAK" && row.clientId) problems.push(`Break must not have a client: ${sk}`);
      if (row.assignmentType !== "BREAK" && !row.clientId) problems.push(`Linked break missing client: ${sk}`);
      breakCount.set(row.staffId, (breakCount.get(row.staffId) ?? 0) + 1);
      if ((breakCount.get(row.staffId) ?? 0) > 1) problems.push(`Duplicate break: ${row.staffId}`);
      if (row.assignmentType === "BREAK") continue;
    }
    const client = row.clientId ? clients.get(row.clientId) : null;
    const event = ["NAP", "SPEECH", "BREAK_NAP", "BREAK_SPEECH"].includes(row.assignmentType);
    const eventSlots = row.assignmentType.endsWith("NAP") || row.assignmentType === "NAP" ? client?.napSlots : client?.speechSlots;
    if (!client || (event ? !(eventSlots ?? []).includes(row.startTime) : !client.requiredSlots.includes(row.startTime))) {
      problems.push(`Client unavailable/unknown at ${row.startTime}: ${row.clientId ?? "none"}`);
      continue;
    }
    const ck = `${row.clientId}|${row.startTime}`;
    if (clientSlots.has(ck)) problems.push(`Client double-booked: ${ck}`);
    clientSlots.add(ck);
    if (client.staffRelationships[row.staffId] === "HARD_RESTRICTION") {
      problems.push(`Hard relationship restriction: ${row.staffId} / ${row.clientId}`);
    }
    const ss = member.serviceSetting, cs = client.serviceSetting;
    if (ss && cs && ss !== "BOTH" && cs !== "BOTH" && ss !== cs) {
      problems.push(`Service-setting mismatch: ${row.staffId} / ${row.clientId}`);
    }
  }
  for (const person of input.staff) {
    if (calledOut.has(person.id) || person.availableSlots.length === 0) continue;
    const count = breakCount.get(person.id) ?? 0;
    if (count !== 1) problems.push(`Staff requires exactly one 30-minute break: ${person.id} (${count})`);
  }
  for (const row of values) {
    if (row?.assignmentType?.startsWith("BREAK")) {
      const [h,m] = row.startTime.split(":").map(Number);
      const minute = h * 60 + m;
      if (minute < 660 || minute >= 840) problems.push(`Break outside 11:00-14:00: ${row.staffId}`);
    }
  }
  const missing = input.clients.flatMap(c => c.requiredSlots
    .filter(slot => !clientSlots.has(`${c.id}|${slot}`))
    .map(slot => ({ clientId: c.id, clientCode: c.displayCode, startTime: slot })));
  return { problems, missing, covered: clientSlots.size,
    required: input.clients.reduce((sum,c) => sum + c.requiredSlots.length, 0) };
}

/**
 * Independent AI Generate preview. Does not import or call the existing
 * generateSchedule function. Writes only after complete independent validation
 * The optimizer endpoint must be configured by the deployment administrator.
 * Language-model output is untrusted and is independently checked here.
 */
export async function POST(request: Request) {
  const auth = await requireApiSession();
  if (auth.error) return auth.error;
  if (!sessionHasAnyRole(auth.session, SCHEDULE_WRITE_ROLES)) return forbiddenResponse();
  try {
    const body = await request.json() as { locationId?: string; date?: string; save?: boolean };
    const locationId = body.locationId?.trim();
    const date = body.date?.trim();
    if (!locationId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return invalid("A locationId and date (YYYY-MM-DD) are required.", 400);
    }
    if (!sessionCanAccessLocation(auth.session, locationId)) return forbiddenResponse();
    const endpoint = process.env.AI_SCHEDULER_OPTIMIZER_URL?.trim();
    const token = process.env.AI_SCHEDULER_OPTIMIZER_TOKEN?.trim();
    if (!endpoint || !token) return invalid(
      "AI Generate is not configured yet. Set AI_SCHEDULER_OPTIMIZER_URL and AI_SCHEDULER_OPTIMIZER_TOKEN on the server.",
      503
    );
    const parsed = new URL(endpoint);
    if (parsed.protocol !== "https:" && !(parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost")) {
      return invalid("AI scheduler service must use HTTPS (except localhost).", 503);
    }
    const dayData = await buildDaySchedulerInput(locationId, date);
    // Only pseudonymous schedule structure reaches Ollama; no names or database credentials.
    // Ollama advises scheduling strategy. The independent CP-SAT solver remains responsible
    // for assignments, and the local validator is the final authority.
    let ollamaPlan: { priorities?: string[]; rationale?: string } | undefined;
    let ollamaUsed = false;
    const ollamaKey = process.env.OLLAMA_API_KEY?.trim();
    const ollamaModel = (process.env.OLLAMA_SCHEDULER_MODEL || process.env.SCHEDULER_AI_MODEL)?.trim();
    if (ollamaKey && ollamaModel) {
      const roster = dayData.input;
      const sanitized = {
        date,
        staff: roster.staff.map((staff, i) => ({
          ref: `S${i}`, availableSlots: staff.availableSlots,
          serviceSetting: staff.serviceSetting, role: staff.role,
          maximumDailyHours: staff.maximumDailyHours,
        })),
        clients: roster.clients.map((client, i) => ({
          ref: `C${i}`, requiredSlots: client.requiredSlots,
          napSlots: client.napSlots, speechSlots: client.speechSlots,
          supportLevel: client.supportLevel, serviceSetting: client.serviceSetting,
        })),
        absentStaffCount: roster.callOutStaffIds.length,
      };
      try {
        const promptController = new AbortController();
        const promptTimeout = setTimeout(() => promptController.abort(), 12000);
        let aiResponse: Response;
        try {
          aiResponse = await fetch("https://ollama.com/api/chat", {
            method: "POST",
            headers: { Authorization: `Bearer ${ollamaKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: ollamaModel, stream: false, format: "json",
              messages: [
                { role: "system", content: "You are a specialized staff-client scheduling planner. Review the given anonymized day. Return only JSON with keys priorities (array of at most 5 concise scheduling priorities) and rationale (short string). Prioritize complete eligible client supervision, one 30-minute staff break in the 11:00-14:00 window, 30-minute naps in provided windows, fixed speech sessions, no double booking. Do not propose unsafe or imaginary assignments. Do not output names, credentials, or code." },
                { role: "user", content: JSON.stringify(sanitized) },
              ],
              options: { temperature: 0 },
            }),
            signal: promptController.signal, cache: "no-store",
          });
        } finally {
          clearTimeout(promptTimeout);
        }
        if (aiResponse.ok) {
          const output = await aiResponse.json() as { message?: { content?: string } };
          const parsedPlan = JSON.parse(output.message?.content || "{}") as { priorities?: unknown; rationale?: unknown };
          if (Array.isArray(parsedPlan.priorities) && typeof parsedPlan.rationale === "string") {
            ollamaPlan = {
              priorities: parsedPlan.priorities.filter((x): x is string => typeof x === "string").slice(0, 5).map(x => x.slice(0, 200)),
              rationale: parsedPlan.rationale.slice(0, 1000),
            };
            ollamaUsed = true;
          }
        } else {
          console.warn("AI Generate Ollama planning request failed", aiResponse.status);
        }
      } catch {
        console.warn("AI Generate Ollama planning unavailable; continuing with deterministic optimizer");
      }
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    let result: Response;
    try {
      result = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ date, locationId, input: dayData.input, rules: dayData.extendedRules, aiPlan: ollamaPlan }),
        signal: controller.signal,
        cache: "no-store",
      });
    } finally {
      clearTimeout(timeout);
    }
    const data = await result.json() as ResponseBody;
    if (!result.ok || data.success === false) {
      const humanMessage = data.failureCode === "INSUFFICIENT_STAFF_COVERAGE"
        ? "Unable to generate today's complete schedule: more client coverage is required than available eligible staff can provide. Human scheduling decision needed."
        : (data.message || "AI optimizer cannot produce a feasible complete schedule for today's staffing and mandatory rules.");
      return NextResponse.json({
        success: false, previewOnly: true, code: data.failureCode || "SCHEDULE_INFEASIBLE",
        error: humanMessage, uncoveredRequirements: data.uncoveredRequirements ?? [],
        violations: data.hardViolations ?? [],
      }, { status: 422 });
    }
    if (!Array.isArray(data.assignments) || data.assignments.length > 10000) {
      return invalid("AI optimizer returned an invalid assignments array.", 502);
    }
    const audit = validatePreview(dayData.input, data.assignments);
    const complete = audit.missing.length === 0;
    const valid = audit.problems.length === 0 && complete;
    let saved = false;
    let regenerationSummary: Record<string, number> | undefined;
    if (body.save === true) {
      if (!valid) {
        return NextResponse.json({
          success:false, saved:false, error:complete
            ? "AI schedule failed independent validation; no changes saved."
            : "Unable to generate today's complete schedule: more client coverage is required than available eligible staff can provide. Human scheduling decision needed.",
          violations:audit.problems, uncoveredRequirements:audit.missing,
        },{status:422});
      }
      if (process.env.SCHEDULER_AI_AUTONOMOUS_WRITES !== "true") {
        return invalid("AI schedule saving is disabled by server configuration; no schedule was changed.",503);
      }
      await connectToDatabase();
      const replacements = data.assignments.map((assignment) => ({
        locationId,date,
        staffId:assignment.staffId,
        clientId:assignment.clientId || null,
        startTime:assignment.startTime,
        endTime:getEndTimeForSlot(assignment.startTime),
        assignmentType:assignment.assignmentType,
        source:"AUTO",locked:false,manuallyOverridden:false,
        note:"AI Generate",
      }));
      const outcome = await persistScheduleReplacementSafely({
        locationId,date,replacements,replaceableFilter:{}
      });
      if (outcome.blockedEmptyReplacement) {
        return invalid("AI Generate refused an empty replacement; existing schedule preserved.",409);
      }
      saved = true;
      regenerationSummary = {
        added:outcome.addedCount,
        changed:outcome.changedCount,
        unchanged:outcome.unchangedCount,
        removed:outcome.removedStaleCount,
      };
    }
    return NextResponse.json({
      success: valid,
      previewOnly: !saved,
      saved,
      regenerationSummary,
      ollamaUsed,
      aiPlan: ollamaPlan,
      date, locationId,
      assignments: audit.problems.length === 0 ? data.assignments : [],
      metrics: { requiredClientSlots: audit.required, coveredClientSlots: audit.covered,
        uncoveredClientSlots: audit.missing.length,
        coveragePercent: audit.required ? 100 * audit.covered / audit.required : 100 },
      violations: audit.problems,
      uncoveredRequirements: audit.missing,
      explanation: typeof data.explanation === "string" ? data.explanation.slice(0, 4000) : "",
      error: !complete ? "Unable to generate today's complete schedule: more client coverage is required than available eligible staff can provide. Human scheduling decision needed." : undefined,
      message: saved ? "Complete AI schedule validated and saved." : "Validated AI schedule preview; no schedule was overwritten.",
    }, { status: audit.problems.length || !complete ? 422 : 200 });
  } catch (error) {
    console.error("AI Schedule preview error:", error);
    return invalid("AI Generate preview failed. The existing schedule was not changed.", 500);
  }
}
