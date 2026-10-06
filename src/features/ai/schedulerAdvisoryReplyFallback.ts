type JsonRecord = Record<string, any>;

type ToolEvidence = {
  toolName: string;
  output: unknown;
};

type Options = {
  date: string;
  toolEvidence: ToolEvidence[];
};

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is JsonRecord =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
      )
    : [];
}

function latestOutput(toolEvidence: ToolEvidence[], toolName: string): JsonRecord | null {
  const match = [...toolEvidence].reverse().find((entry) => entry.toolName === toolName);
  return asRecord(match?.output);
}

function displayTime(time: unknown): string {
  const value = String(time ?? "");
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return value || "unknown time";
  const hour = Number(match[1]);
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${match[2]} ${suffix}`;
}

function buildReplacementReply(output: JsonRecord, date: string): string {
  if (output.ok === false) {
    return String(output.error ?? "I could not analyze that client replacement.");
  }

  if (output.scheduleAvailable === false) {
    return `The schedule for ${date} has not been generated yet. Would you like me to generate the schedule for ${date}?`;
  }

  const source = String(output.sourceClient ?? "the current client");
  const replacement = String(output.replacementClient ?? "the replacement client");
  const replaceable = records(output.replaceable);
  const blocked = records(output.blocked);
  const lines: string[] = [];

  if (replaceable.length === 0) {
    lines.push(
      `I checked both ${source} and ${replacement} on ${date}. I did not find any directly replaceable ${source} slots for ${replacement}.`
    );
  } else {
    lines.push(`I checked both ${source} and ${replacement} on ${date}. These slots are directly replaceable:`);
    for (const slot of replaceable) {
      const impact = slot.sourceWillBecomeUncovered === true
        ? `; ${source} would lose coverage at this time unless we cover it elsewhere`
        : "";
      const protectedText = slot.protectedCell === true ? "; the current cell is protected/manual" : "";
      lines.push(
        `• ${displayTime(slot.startTime)}–${displayTime(slot.endTime)} with ${String(
          slot.staffName ?? "the current staff"
        )}${impact}${protectedText}`
      );
    }
  }

  if (blocked.length > 0) {
    lines.push("Not replaceable:");
    for (const slot of blocked.slice(0, 12)) {
      lines.push(`• ${displayTime(slot.startTime)}: ${String(slot.reason ?? "blocked")}`);
    }
    if (blocked.length > 12) {
      lines.push(`• ${blocked.length - 12} more blocked slot(s)`);
    }
  }

  if (replaceable.length > 0) {
    lines.push(`Would you like to proceed with these replacement slots on ${date}?`);
  }

  return lines.join("\n");
}

function buildSuggestionsReply(output: JsonRecord, date: string): string {
  if (output.scheduleAvailable === false) {
    return `The schedule for ${date} has not been generated yet. Would you like me to generate the schedule for ${date}?`;
  }

  const coverage = records(output.coverageSuggestions);
  const breaks = records(output.breakSuggestions);
  const lines: string[] = [
    `Based on the analyzed schedule for ${date}, these are the changes I would recommend. These are suggestions only; I have not changed the schedule.`,
  ];

  if (coverage.length > 0) {
    lines.push("Coverage recommendations:");
    for (const suggestion of coverage.slice(0, 10)) {
      const kind = String(suggestion.kind ?? "");
      const clientCode = String(suggestion.clientCode ?? "client");
      const time = displayTime(suggestion.startTime);
      if (kind === "DIRECT_COVERAGE") {
        const names = Array.isArray(suggestion.recommendedStaff)
          ? suggestion.recommendedStaff.map(String)
          : [];
        lines.push(
          `• ${clientCode} at ${time}: use ${names.join(", ") || "an available staff member"}.`
        );
      } else if (kind === "REASSIGNMENT_CHAIN") {
        const option = records(suggestion.options)[0];
        if (option) {
          lines.push(
            `• ${clientCode} at ${time}: move ${String(option.moveClient)} from ${String(
              option.fromStaff
            )} to ${String(option.toStaff)}, then use ${String(option.withStaff)} for ${String(
              option.thenCoverClient
            )}.`
          );
        } else {
          lines.push(`• ${clientCode} at ${time}: a reassignment chain is needed.`);
        }
      } else {
        lines.push(`• ${clientCode} at ${time}: no simple direct or two-step coverage option was found.`);
      }
    }
    if (coverage.length > 10) {
      lines.push(`• ${coverage.length - 10} more coverage recommendation(s)`);
    }
  } else {
    lines.push("Coverage recommendations: no uncovered required client slots were found in the analyzed range.");
  }

  if (breaks.length > 0) {
    lines.push("Break recommendations:");
    for (const suggestion of breaks.slice(0, 10)) {
      const kind = String(suggestion.kind ?? "");
      const staffName = String(suggestion.staffName ?? "staff member");
      if (kind === "DIRECT_BREAK") {
        lines.push(`• ${staffName}: add a break at ${displayTime(suggestion.startTime)}.`);
      } else if (kind === "REASSIGN_FOR_BREAK") {
        const option = records(suggestion.options)[0];
        if (option) {
          lines.push(
            `• ${staffName}: at ${displayTime(option.startTime)}, move ${String(
              option.clientCode
            )} to ${String(option.moveTo)}, then give ${staffName} the break.`
          );
        } else {
          lines.push(`• ${staffName}: a client handoff is needed to create a break.`);
        }
      } else {
        lines.push(`• ${staffName}: no simple free break slot or one-step handoff was found.`);
      }
    }
    if (breaks.length > 10) {
      lines.push(`• ${breaks.length - 10} more break recommendation(s)`);
    }
  } else {
    lines.push("Break recommendations: no missing-break recommendation was needed in the analyzed range.");
  }

  lines.push(
    "If you want me to apply any of these recommendations, I can run the actual scheduler edit. The scheduler will validate the change; if it requires an override, I will show you the exact conflict and ask for permission before overriding it."
  );
  return lines.join("\n");
}

export function buildSchedulerAdvisoryReplyFallback({
  date,
  toolEvidence,
}: Options): string | null {
  const replacement = latestOutput(toolEvidence, "analyze_client_replacement");
  if (replacement) return buildReplacementReply(replacement, date);

  const suggestions = latestOutput(toolEvidence, "suggest_schedule_improvements");
  if (suggestions) return buildSuggestionsReply(suggestions, date);

  return null;
}
