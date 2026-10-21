import type { SchedulerInput } from "@/features/scheduler/engine/types";
import { validateOpenAIPlan } from "./validateOpenAIPlan";

export type AiCandidateRow = {
  staffId: string;
  clientId?: string | null;
  startTime: string;
  assignmentType: "CLIENT_1_TO_1" | "NAP" | "SPEECH" | "BREAK" | "BREAK_NAP" | "BREAK_SPEECH";
};
export type AiCandidateQuality = {
  valid: boolean;
  hardViolations: number;
  covered: number;
  required: number;
  handoffs: number;
  shortRuns: number;
  preferredPairs: number;
  sameTeam: number;
  frontline1to1: number;
  templateMatches: number;
  historicalPairingEvidence: number;
  softScore: number;
};

/**
 * Independent comparison of two MODEL-DESIGNED schedules.
 * Coverage always outranks every soft preference, and no invalid candidate
 * can win over a safe one. This does not generate a schedule or make placements.
 */
export function assessAiCandidate(input: SchedulerInput, rows: AiCandidateRow[]): AiCandidateQuality {
  const audit = validateOpenAIPlan(input, rows);
  const people = new Map(input.staff.map(person => [person.id, person]));
  const clients = new Map(input.clients.map(client => [client.id, client]));
  const historyCells = new Set(input.referenceAssignments
    .filter(row => row.assignmentType === "CLIENT_1_TO_1")
    .map(row => [row.clientId, row.startTime, row.staffId].join("|")));
  const byClient = new Map<string, AiCandidateRow[]>();
  let sameTeam = 0, preferredPairs = 0, frontline1to1 = 0, templateMatches = 0;
  let historicalPairingEvidence = 0;
  for (const row of rows) {
    if (!row.clientId || !["CLIENT_1_TO_1","BREAK_NAP"].includes(row.assignmentType)) continue;
    const patient = clients.get(row.clientId), member = people.get(row.staffId);
    if (!patient || !member) continue;
    byClient.set(row.clientId, [...(byClient.get(row.clientId) ?? []), row]);
    if (row.assignmentType !== "CLIENT_1_TO_1") continue;
    if (patient.teamId && patient.teamId === member.teamId) sameTeam++;
    if (patient.staffRelationships[member.id] === "PREFERRED") preferredPairs++;
    if (member.role === "BT" || member.role === "RBT") frontline1to1++;
    if (historyCells.has([patient.id, row.startTime, member.id].join("|"))) templateMatches++;
    historicalPairingEvidence += Math.min(10,Math.max(0,input.historicalPatterns?.pairingScores[member.id+"|"+patient.id] ?? 0));
  }
  let handoffs = 0, shortRuns = 0;
  for (const clientRows of byClient.values()) {
    clientRows.sort((a,b)=>a.startTime.localeCompare(b.startTime));
    let run = 0, lastStaff = "", lastMinute = -1;
    for (const row of clientRows) {
      const [hour,minute] = row.startTime.split(":").map(Number);
      const now = hour*60+minute;
      if (run && (now !== lastMinute+input.rules.slotLengthMinutes || row.staffId !== lastStaff)) {
        if (now === lastMinute+input.rules.slotLengthMinutes && row.staffId !== lastStaff) handoffs++;
        if (run < 4) shortRuns++;
        run = 0;
      }
      run++;lastMinute = now;lastStaff = row.staffId;
    }
    if (run > 0 && run < 4) shortRuns++;
  }
  // History/templates are WEAK tie-break evidence, never a quota or an
  // incentive to recreate yesterday's workbook. Compare covered client
  // requirements BEFORE any soft quality score (see compareAiCandidates).
  // Prefer coherent runs over historical cell-for-cell similarity.
  const referenceHint=Math.min(12,templateMatches*0.1);
  const historyHint=Math.min(12,historicalPairingEvidence/20);
  const softScore = frontline1to1*4+preferredPairs*2+sameTeam*0.75+
    referenceHint+historyHint-
    handoffs*12-shortRuns*7;
  return {
    valid:audit.problems.length===0, hardViolations:audit.problems.length,
    covered:audit.covered, required:audit.required,
    handoffs,shortRuns,preferredPairs,sameTeam,frontline1to1,
    templateMatches,historicalPairingEvidence,softScore,
  };
}

export function compareAiCandidates(
  previous: AiCandidateQuality, next: AiCandidateQuality
): "previous"|"next" {
  if (previous.valid !== next.valid) return previous.valid ? "previous" : "next";
  if (!previous.valid && !next.valid && previous.hardViolations !== next.hardViolations)
    return previous.hardViolations < next.hardViolations ? "previous" : "next";
  if (previous.covered !== next.covered) return previous.covered > next.covered ? "previous" : "next";
  if (previous.valid && next.valid && previous.softScore !== next.softScore)
    return previous.softScore > next.softScore ? "previous" : "next";
  if (previous.hardViolations !== next.hardViolations)
    return previous.hardViolations < next.hardViolations ? "previous" : "next";
  return "previous"; // avoid trading a safe or equally good plan for a regression
}
