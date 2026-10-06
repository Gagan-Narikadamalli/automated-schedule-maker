type ToolEvidence = {
  toolName: string;
  output: unknown;
};

type FallbackOptions = {
  date: string;
  locationName?: string;
  toolEvidence: ToolEvidence[];
  writeToolsUsed: string[];
};

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function arrayRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((entry): entry is JsonRecord => Boolean(entry))
    : [];
}

function evidenceOutput(toolEvidence: ToolEvidence[], toolName: string): JsonRecord | null {
  const match = [...toolEvidence].reverse().find((entry) => entry.toolName === toolName);
  return asRecord(match?.output);
}

function humanIssue(issue: string): string {
  if (issue === "MISSING_BREAK") return "missing a required break";
  if (issue === "MULTIPLE_BREAKS") return "has multiple breaks";
  return issue.toLowerCase().replaceAll("_", " ");
}

function writeErrors(toolEvidence: ToolEvidence[], writeToolsUsed: string[]): string[] {
  const writeNames = new Set(writeToolsUsed);
  return toolEvidence.flatMap((entry) => {
    if (!writeNames.has(entry.toolName)) return [];
    const output = asRecord(entry.output);
    if (!output) return [];
    const failed = output.ok === false || (typeof output.status === "number" && output.status >= 400);
    if (!failed) return [];
    const error = asString(output.error) || asString(output.message);
    return error ? [error] : [`${entry.toolName} did not complete successfully.`];
  });
}

export function buildSchedulerReplyFallback({
  date,
  locationName,
  toolEvidence,
  writeToolsUsed,
}: FallbackOptions): string {
  const clinic = locationName?.trim() || "the selected clinic";
  const errors = writeErrors(toolEvidence, writeToolsUsed);
  const wrote = writeToolsUsed.length > 0;
  const sentences: string[] = [];

  if (errors.length > 0) {
    sentences.push(`I could not complete every requested scheduler change for ${date}: ${errors.join(" ")}`);
  } else if (wrote) {
    sentences.push(`I completed the requested scheduler action for ${date}.`);
  } else {
    sentences.push(`I checked ${clinic} for ${date}.`);
  }

  const health = evidenceOutput(toolEvidence, "check_schedule");
  if (health) {
    const required = asNumber(health.requiredClientSlots);
    const covered = asNumber(health.coveredClientSlots);
    const uncovered = asNumber(health.uncoveredClientSlots);

    if (required !== null && covered !== null) {
      sentences.push(`${covered}/${required} required client blocks are covered${uncovered !== null ? `, with ${uncovered} uncovered` : ""}.`);
    }

    const uncoveredRequirements = arrayRecords(health.uncoveredRequirements);
    if (uncoveredRequirements.length > 0) {
      const examples = uncoveredRequirements.slice(0, 8).map((record) => {
        const code = asString(record.clientCode) || "client";
        const time = asString(record.startTime) || "unknown time";
        return `${code} at ${time}`;
      });
      const suffix = uncoveredRequirements.length > examples.length
        ? `, plus ${uncoveredRequirements.length - examples.length} more`
        : "";
      sentences.push(`Coverage still needs attention for ${examples.join(", ")}${suffix}.`);
    }

    const breakProblems = arrayRecords(health.staffBreakProblems);
    if (breakProblems.length > 0) {
      const details = breakProblems.slice(0, 6).map((record) => {
        const staffName = asString(record.staffName) || "A staff member";
        const issue = asString(record.issue) || "break issue";
        const breakSlots = Array.isArray(record.breakSlots)
          ? record.breakSlots.filter((slot): slot is string => typeof slot === "string")
          : [];
        return `${staffName} ${humanIssue(issue)}${breakSlots.length ? ` (${breakSlots.join(", ")})` : ""}`;
      });
      sentences.push(`Break review: ${details.join("; ")}.`);
    }

    const unplacedCount = asNumber(health.unplacedCount);
    if (unplacedCount !== null) {
      sentences.push(unplacedCount === 0
        ? "There are no unresolved Unplaced assignments."
        : `${unplacedCount} assignment${unplacedCount === 1 ? " remains" : "s remain"} in Unplaced.`);
    }

    if ((uncovered ?? 0) === 0 && breakProblems.length === 0 && (unplacedCount ?? 0) === 0) {
      sentences.push("The main coverage, break, and Unplaced checks look clear.");
    }
  } else {
    const day = evidenceOutput(toolEvidence, "get_day_schedule");
    const unplaced = evidenceOutput(toolEvidence, "get_unplaced_assignments");
    const assignmentCount = asNumber(day?.assignmentCount);
    const required = asNumber(day?.requiredClientSlots);
    const unplacedCount = asNumber(unplaced?.count);

    if (assignmentCount !== null) {
      sentences.push(`The saved day currently contains ${assignmentCount} assignment${assignmentCount === 1 ? "" : "s"}${required !== null ? ` for ${required} required client blocks` : ""}.`);
    }
    if (unplacedCount !== null) {
      sentences.push(unplacedCount === 0
        ? "There are no unresolved Unplaced assignments."
        : `${unplacedCount} assignment${unplacedCount === 1 ? " remains" : "s remain"} in Unplaced.`);
    }
  }

  if (!wrote) {
    sentences.push("I did not make any schedule changes.");
  } else if (errors.length === 0 && !health) {
    sentences.push("The scheduler write completed, but no final health-check result was available in this run.");
  }

  return sentences.join(" ");
}
