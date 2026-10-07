import type { NativeSchedulerPlan } from "./schedulerNativeAi";

type TimeRange = { startTime?: string; endTime?: string };

function visible(message: string): string {
  return message.split(/\n\n\[SCHEDULER TIME NORMALIZATION:/i)[0].trim();
}

function clean(value: string): string {
  return value.replace(/^[\s"']+|[\s"',.!?]+$/g, "").replace(/\s+/g, " ").trim();
}

function clarification(message: string): NativeSchedulerPlan {
  return { intent: "CLARIFICATION", toolName: "__native_clarification__", input: { message }, confidence: 1, explanation: message };
}

function roleFrom(message: string):
  | "BT" | "RBT" | "INTERN" | "BCBA" | "OFFICE_MANAGER" | "OTHER" | undefined {
  if (/\boffice\s+manager\b/i.test(message)) return "OFFICE_MANAGER";
  if (/\brbt\b/i.test(message)) return "RBT";
  if (/\bbcba\b/i.test(message)) return "BCBA";
  if (/\bintern\b/i.test(message)) return "INTERN";
  if (/\bbt\b/i.test(message)) return "BT";
  if (/\bother\b/i.test(message)) return "OTHER";
  return undefined;
}

function employeeTypeFrom(message: string): "FULL_TIME" | "PART_TIME" | undefined {
  if (/\bfull[- ]?time\b/i.test(message)) return "FULL_TIME";
  if (/\bpart[- ]?time\b/i.test(message)) return "PART_TIME";
  return undefined;
}

function serviceSettingFrom(message: string): "IN_CENTER" | "IN_HOME" | "BOTH" | undefined {
  if (/\b(?:in[- ]?center|center)\b/i.test(message)) return "IN_CENTER";
  if (/\b(?:in[- ]?home|home)\b/i.test(message)) return "IN_HOME";
  if (/\bboth\b/i.test(message)) return "BOTH";
  return undefined;
}

function supportLevelFrom(message: string):
  | "STANDARD" | "ONE_TO_ONE" | "ROTATION" | "HIGH_SUPPORT" | undefined {
  if (/\bhigh[- ]?support\b/i.test(message)) return "HIGH_SUPPORT";
  if (/\b(?:one[- ]?to[- ]?one|1\s*:\s*1|1[- ]?to[- ]?1)\b/i.test(message)) return "ONE_TO_ONE";
  if (/\brotation\b/i.test(message)) return "ROTATION";
  if (/\bstandard\b/i.test(message)) return "STANDARD";
  return undefined;
}

function explicitIsoDate(message: string): string | undefined {
  return message.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
}

function creationDate(message: string, resolvedDate?: string): string | undefined {
  const iso = explicitIsoDate(message);
  if (iso) return iso;
  if (
    resolvedDate &&
    /\b(?:starting|starts?|start\s+date|from)\s+(?:today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(message)
  ) return resolvedDate;
  return undefined;
}

function hexColor(message: string): string | undefined {
  return message.match(/#[0-9a-f]{6}\b/i)?.[0];
}

function numberNear(message: string, pattern: RegExp): number | undefined {
  const match = message.match(pattern);
  if (!match?.[1]) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function toggleValue(message: string): boolean | undefined {
  if (
    /\b(?:disable|disabled|turn\s+off|do\s+not\s+use|don't\s+use|false)\b/i.test(message) ||
    /\bturn\b[\s\S]*\boff\b/i.test(message)
  ) {
    return false;
  }
  if (
    /\b(?:enable|enabled|turn\s+on|use|yes|true)\b/i.test(message) ||
    /\bturn\b[\s\S]*\bon\b/i.test(message)
  ) {
    return true;
  }
  return undefined;
}

function teamReference(message: string): string | null {
  const match = message.match(/\bteam\s+(.+?)(?=\s+(?:starting|start\s+date|from|support|color|in[- ]?center|in[- ]?home|both)\b|[,.!?]|$)/i);
  return match?.[1] ? clean(match[1]) : null;
}

function eventClient(message: string, kind: "nap" | "speech"): string | null {
  const source1 = "\\b(?:add|schedule|create|remove|delete)\\s+(?:a\\s+)?" + kind +
    "\\s+(?:event\\s+|session\\s+)?(?:for\\s+)?(.+?)(?=\\s+(?:from|between|at|today|tomorrow|on|every)\\b|[?.!,]|$)";
  const source2 = "\\b" + kind +
    "\\s+(?:event\\s+|session\\s+)?(?:for\\s+)?(.+?)(?=\\s+(?:from|between|at|today|tomorrow|on|every)\\b|[?.!,]|$)";
  for (const pattern of [new RegExp(source1, "i"), new RegExp(source2, "i")]) {
    const match = message.match(pattern);
    if (match?.[1]) return clean(match[1]);
  }
  return null;
}

function weekdays(message: string): string[] {
  const values: Array<[RegExp, string]> = [
    [/\bmonday\b/i, "MONDAY"], [/\btuesday\b/i, "TUESDAY"], [/\bwednesday\b/i, "WEDNESDAY"],
    [/\bthursday\b/i, "THURSDAY"], [/\bfriday\b/i, "FRIDAY"], [/\bsaturday\b/i, "SATURDAY"],
    [/\bsunday\b/i, "SUNDAY"],
  ];
  return values.filter(([pattern]) => pattern.test(message)).map(([, day]) => day);
}

export function planNativeManagementAction(args: {
  message: string;
  date?: string;
  times: TimeRange;
}): NativeSchedulerPlan | null {
  const raw = visible(args.message);

  if (/\b(?:list|show|view|what\s+are)\b[\s\S]*\bteams?\b/i.test(raw)) {
    return { intent: "CONFIGURATION", toolName: "get_scheduler_configuration", input: { area: "TEAMS" }, confidence: 0.98, explanation: "Read active scheduler teams." };
  }
  if (/\b(?:show|list|view)\b[\s\S]*\b(?:staff\s+profiles?|client\s+profiles?|people\s+profiles?|people)\b/i.test(raw)) {
    return { intent: "CONFIGURATION", toolName: "get_scheduler_configuration", input: { area: "PEOPLE" }, confidence: 0.96, explanation: "Read scheduler people configuration." };
  }
  if (/\b(?:show|view|what\s+are)\b[\s\S]*\b(?:scheduler\s+rules|scheduling\s+rules|scheduler\s+settings)\b/i.test(raw)) {
    return { intent: "CONFIGURATION", toolName: "get_scheduler_configuration", input: { area: "RULES" }, confidence: 0.98, explanation: "Read scheduler rules." };
  }
  if (/\b(?:show|list|view)\b[\s\S]*\b(?:nap|speech)\s+(?:events?|sessions?)\b/i.test(raw)) {
    return { intent: "CONFIGURATION", toolName: "get_scheduler_configuration", input: { area: "EVENTS" }, confidence: 0.98, explanation: "Read nap/speech events." };
  }
  if (/\b(?:show|list|view)\b[\s\S]*\bclient\s+(?:attendance|call[- ]?outs?|call[- ]?ins?)\b/i.test(raw)) {
    return { intent: "CONFIGURATION", toolName: "get_scheduler_configuration", input: { area: "ATTENDANCE" }, confidence: 0.98, explanation: "Read client attendance changes." };
  }
  if (/\b(?:show|list|view)\b[\s\S]*\bsupervision\b/i.test(raw)) {
    const month = raw.match(/\b(20\d{2}-\d{2})\b/)?.[1];
    return { intent: "CONFIGURATION", toolName: "get_scheduler_configuration", input: { area: "SUPERVISION", ...(month ? { month } : {}) }, confidence: 0.97, explanation: "Read supervision records." };
  }

  if (/\b(?:create|add)\s+(?:a\s+)?(?:new\s+)?staff(?:\s+member)?\b/i.test(raw)) {
    const nameMatch = raw.match(/\b(?:create|add)\s+(?:a\s+)?(?:new\s+)?staff(?:\s+member)?\s+(.+?)(?=\s+(?:as\s+)?(?:rbt|bt|intern|bcba|office\s+manager|other)\b|\s+(?:full[- ]?time|part[- ]?time)\b|\s+(?:starting|start\s+date|from)\b|[,.!?]|$)/i);
    const fullName = nameMatch?.[1] ? clean(nameMatch[1]) : "";
    const role = roleFrom(raw);
    const employeeType = employeeTypeFrom(raw);
    const startDate = creationDate(raw, args.date);
    if (!fullName || !role || !employeeType || !startDate) {
      return clarification("Creating a staff member requires the full name, role (BT/RBT/INTERN/BCBA/OFFICE_MANAGER/OTHER), full-time or part-time status, and start date.");
    }
    return {
      intent: "STAFF_MANAGEMENT", toolName: "manage_staff",
      input: {
        action: "CREATE", fullName, role, employeeType, startDate,
        ...(teamReference(raw) ? { team: teamReference(raw) } : {}),
        ...(hexColor(raw) ? { color: hexColor(raw) } : {}),
        ...(serviceSettingFrom(raw) ? { serviceSetting: serviceSettingFrom(raw) } : {}),
      },
      confidence: 0.97, explanation: "Create a scheduler staff profile.",
    };
  }

  const archiveStaff = raw.match(/\b(?:archive|deactivate|remove)\s+staff(?:\s+member)?\s+(.+?)(?:[?.!,]|$)/i);
  if (archiveStaff?.[1]) return {
    intent: "STAFF_MANAGEMENT", toolName: "manage_staff", input: { action: "ARCHIVE", staff: clean(archiveStaff[1]) },
    confidence: 0.98, explanation: "Archive a scheduler staff profile.",
  };

  const roleUpdate = raw.match(/\b(?:set|change|update)\s+(.+?)(?:'s)?\s+role\s+(?:to|as)\s+(rbt|bt|intern|bcba|office\s+manager|other)\b/i);
  if (roleUpdate?.[1]) return {
    intent: "STAFF_MANAGEMENT", toolName: "manage_staff",
    input: { action: "UPDATE", staff: clean(roleUpdate[1]), role: roleFrom(roleUpdate[2])! },
    confidence: 0.97, explanation: "Update a staff role.",
  };

  const staffTeam = raw.match(/\b(?:move|assign|set)\s+staff\s+(.+?)\s+(?:to|into)\s+team\s+(.+?)(?:[?.!,]|$)/i);
  if (staffTeam?.[1] && staffTeam?.[2]) return {
    intent: "STAFF_MANAGEMENT", toolName: "manage_staff",
    input: { action: "UPDATE", staff: clean(staffTeam[1]), team: clean(staffTeam[2]) },
    confidence: 0.97, explanation: "Move a staff member to a scheduler team.",
  };

  const staffHours = raw.match(/\b(?:set|change|update)\s+(.+?)(?:'s)?\s+target\s+weekly\s+hours\s+(?:to\s+)?(\d+(?:\.\d+)?)\b/i);
  if (staffHours?.[1]) return {
    intent: "STAFF_MANAGEMENT", toolName: "manage_staff",
    input: { action: "UPDATE", staff: clean(staffHours[1]), targetWeeklyHours: Number(staffHours[2]) },
    confidence: 0.97, explanation: "Update staff target weekly hours.",
  };

  if (/\b(?:create|add)\s+(?:a\s+)?(?:new\s+)?client\b/i.test(raw)) {
    const match = raw.match(/\b(?:create|add)\s+(?:a\s+)?(?:new\s+)?client\s+(.+?)\s+(?:with\s+)?(?:code|display\s+code)\s+([A-Za-z0-9_-]+)\b/i);
    const fullName = match?.[1] ? clean(match[1]) : "";
    const displayCode = match?.[2] ? clean(match[2]) : "";
    const startDate = creationDate(raw, args.date);
    if (!fullName || !displayCode || !startDate) {
      return clarification("Creating a client requires the full name, display code, and start date.");
    }
    return {
      intent: "CLIENT_MANAGEMENT", toolName: "manage_client",
      input: {
        action: "CREATE", fullName, displayCode, startDate,
        ...(teamReference(raw) ? { team: teamReference(raw) } : {}),
        ...(supportLevelFrom(raw) ? { supportLevel: supportLevelFrom(raw) } : {}),
        ...(serviceSettingFrom(raw) ? { serviceSetting: serviceSettingFrom(raw) } : {}),
        ...(hexColor(raw) ? { color: hexColor(raw) } : {}),
      },
      confidence: 0.97, explanation: "Create a scheduler client profile.",
    };
  }

  const archiveClient = raw.match(/\b(?:archive|deactivate|remove)\s+client\s+(.+?)(?:[?.!,]|$)/i);
  if (archiveClient?.[1]) return {
    intent: "CLIENT_MANAGEMENT", toolName: "manage_client", input: { action: "ARCHIVE", client: clean(archiveClient[1]) },
    confidence: 0.98, explanation: "Archive a scheduler client profile.",
  };

  const supportUpdate = raw.match(/\b(?:set|change|update)\s+client\s+(.+?)(?:'s)?\s+support\s+level\s+(?:to\s+)?(.+?)(?:[?.!,]|$)/i);
  if (supportUpdate?.[1]) {
    const level = supportLevelFrom(supportUpdate[2]);
    if (!level) return clarification("Client support level must be STANDARD, ONE_TO_ONE, ROTATION, or HIGH_SUPPORT.");
    return {
      intent: "CLIENT_MANAGEMENT", toolName: "manage_client",
      input: { action: "UPDATE", client: clean(supportUpdate[1]), supportLevel: level },
      confidence: 0.97, explanation: "Update a client's support level.",
    };
  }

  const clientTeam = raw.match(/\b(?:move|assign|set)\s+client\s+(.+?)\s+(?:to|into)\s+team\s+(.+?)(?:[?.!,]|$)/i);
  if (clientTeam?.[1] && clientTeam?.[2]) return {
    intent: "CLIENT_MANAGEMENT", toolName: "manage_client",
    input: { action: "UPDATE", client: clean(clientTeam[1]), team: clean(clientTeam[2]) },
    confidence: 0.97, explanation: "Move a client to a scheduler team.",
  };

  const createTeam = raw.match(/\b(?:create|add)\s+(?:a\s+)?(?:new\s+)?team\s+(.+?)(?=\s+color\s+#[0-9a-f]{6}\b|[?.!,]|$)/i);
  if (createTeam?.[1]) return {
    intent: "TEAM_MANAGEMENT", toolName: "manage_team",
    input: { action: "CREATE", name: clean(createTeam[1]), ...(hexColor(raw) ? { color: hexColor(raw) } : {}) },
    confidence: 0.98, explanation: "Create a scheduler team.",
  };

  const archiveTeam = raw.match(/\b(?:archive|deactivate|remove)\s+team\s+(.+?)(?:[?.!,]|$)/i);
  if (archiveTeam?.[1]) return {
    intent: "TEAM_MANAGEMENT", toolName: "manage_team", input: { action: "ARCHIVE", team: clean(archiveTeam[1]) },
    confidence: 0.98, explanation: "Archive a scheduler team.",
  };

  const renameTeam = raw.match(/\brename\s+team\s+(.+?)\s+to\s+(.+?)(?:[?.!,]|$)/i);
  if (renameTeam?.[1] && renameTeam?.[2]) return {
    intent: "TEAM_MANAGEMENT", toolName: "manage_team",
    input: { action: "UPDATE", team: clean(renameTeam[1]), name: clean(renameTeam[2]) },
    confidence: 0.98, explanation: "Rename a scheduler team.",
  };

  const recolorTeam = raw.match(/\b(?:set|change|update)\s+team\s+(.+?)\s+color\s+(?:to\s+)?(#[0-9a-f]{6})\b/i);
  if (recolorTeam?.[1]) return {
    intent: "TEAM_MANAGEMENT", toolName: "manage_team",
    input: { action: "UPDATE", team: clean(recolorTeam[1]), color: recolorTeam[2] },
    confidence: 0.98, explanation: "Update a scheduler team color.",
  };

  for (const eventType of ["NAP", "SPEECH"] as const) {
    const kind = eventType.toLowerCase() as "nap" | "speech";
    if (new RegExp("\\b" + kind + "\\b", "i").test(raw) && /\b(?:add|schedule|create|remove|delete)\b/i.test(raw)) {
      const client = eventClient(raw, kind);
      const action = /\b(?:remove|delete)\b/i.test(raw) ? "REMOVE" : "ADD";
      if (!client) return clarification((eventType === "NAP" ? "Nap" : "Speech") + " event changes require a client reference.");
      if (action === "ADD" && (!args.times.startTime || !args.times.endTime)) {
        return clarification("Adding a " + kind + " event requires both a start time and end time.");
      }
      const recurringDays = /\b(?:every|recurr|weekly)\b/i.test(raw) ? weekdays(raw) : [];
      const seriesEndDate = raw.match(/\b(?:until|through)\s+(20\d{2}-\d{2}-\d{2})\b/i)?.[1];
      return {
        intent: "EVENT_MANAGEMENT", toolName: "manage_scheduler_event",
        input: {
          action, eventType, client,
          ...(args.times.startTime ? { startTime: args.times.startTime } : {}),
          ...(args.times.endTime ? { endTime: args.times.endTime } : {}),
          ...(action === "ADD" && args.date ? { date: args.date } : {}),
          ...(recurringDays.length ? { seriesStartDate: args.date, ...(seriesEndDate ? { seriesEndDate } : {}), daysOfWeek: recurringDays } : {}),
          ...(/\byounger\b/i.test(raw) ? { priorityCategory: "YOUNGER" } : /\bolder\b/i.test(raw) ? { priorityCategory: "OLDER" } : {}),
        },
        confidence: 0.96, explanation: (action === "ADD" ? "Add" : "Remove") + " a " + kind + " scheduler event.",
      };
    }
  }

  const clientAttendance = raw.match(/\bclient\s+(.+?)\s+(?:called\s+out|called\s+in|is\s+calling\s+out|is\s+calling\s+in)\b/i);
  const attendanceFor = raw.match(/\b(?:add|record|remove|delete)\s+client\s+(?:call[- ]?out|call[- ]?in)\s+(?:for\s+)?(.+?)(?=\s+(?:from|between|at|today|tomorrow|on)\b|[?.!,]|$)/i);
  if (clientAttendance?.[1] || attendanceFor?.[1]) {
    const client = clean(clientAttendance?.[1] || attendanceFor?.[1] || "");
    const remove = /\b(?:remove|delete)\b/i.test(raw);
    const changeType = /\bcall(?:ed)?\s+in\b|\bcall[- ]?in\b/i.test(raw) ? "CALL_IN" : "CALL_OUT";
    return {
      intent: "ATTENDANCE", toolName: "manage_client_attendance",
      input: {
        action: remove ? "REMOVE" : "ADD", client,
        ...(!remove ? {
          changeType,
          ...(args.times.startTime ? { startTime: args.times.startTime } : {}),
          ...(args.times.endTime ? { endTime: args.times.endTime } : {}),
          note: "Recorded by Native Scheduler AI",
        } : {}),
      },
      confidence: 0.97, explanation: "Update client attendance.",
    };
  }

  const ruleChanges: Record<string, unknown> = {};
  if (/\bbreak\s+window\b/i.test(raw) && args.times.startTime && args.times.endTime) {
    ruleChanges.breakWindowStart = args.times.startTime;
    ruleChanges.breakWindowEnd = args.times.endTime;
  }
  const breakEligibility = numberNear(raw, /\bbreak\s+eligibility(?:\s+to|\s+at|\s+is)?\s+(\d+(?:\.\d+)?)\s*hours?\b/i);
  if (breakEligibility !== undefined) ruleChanges.breakEligibilityHours = breakEligibility;
  const defaultBreak = numberNear(raw, /\bdefault\s+break(?:\s+length|\s+minutes)?(?:\s+to|\s+at|\s+is)?\s+(\d+(?:\.\d+)?)\s*(?:minutes?|mins?)?\b/i);
  if (defaultBreak !== undefined) ruleChanges.defaultBreakMinutes = defaultBreak;
  const minPairMinutes = numberNear(raw, /\bminimum\s+(?:client[- ]staff\s+)?assignment(?:\s+length|\s+time)?(?:\s+to|\s+at|\s+is)?\s+(\d+(?:\.\d+)?)\s*(?:minutes?|mins?)\b/i);
  if (minPairMinutes !== undefined) ruleChanges.minimumClientStaffAssignmentMinutes = minPairMinutes;
  const maxConsecutive = numberNear(raw, /\bmaximum\s+(?:client[- ]staff\s+)?(?:consecutive|continuous)(?:\s+time|\s+hours?)?(?:\s+to|\s+at|\s+is)?\s+(\d+(?:\.\d+)?)\s*hours?\b/i);
  if (maxConsecutive !== undefined) ruleChanges.maximumClientStaffConsecutiveHours = maxConsecutive;
  if (/\bschedule\s+hours?\b/i.test(raw) && args.times.startTime && args.times.endTime) {
    ruleChanges.scheduleStartTime = args.times.startTime;
    ruleChanges.scheduleEndTime = args.times.endTime;
  }
  const toggles: Array<[RegExp, string]> = [
    [/\bhistorical\s+patterns?\b/i, "autoUseHistoricalPatterns"],
    [/\bweekday\s+templates?\b/i, "autoUseWeekdayTemplate"],
    [/\bprevious\s+weekday\s+schedule\b/i, "autoUsePreviousWeekdaySchedule"],
    [/\bpreserve\s+manual\s+overrides?\b/i, "preserveManualOverrides"],
    [/\bminimal\s+fix[\s\S]*\bprotected\s+relocation\b/i, "minimalFixAllowProtectedRelocation"],
    [/\bminimal\s+fix[\s\S]*\bbreak\s+relocation\b/i, "minimalFixAllowBreakRelocation"],
  ];
  for (const [pattern, field] of toggles) {
    if (pattern.test(raw)) {
      const value = toggleValue(raw);
      if (value !== undefined) ruleChanges[field] = value;
    }
  }
  if (Object.keys(ruleChanges).length && /\b(?:set|change|update|enable|disable|turn|use|do\s+not)\b/i.test(raw)) {
    return { intent: "RULES", toolName: "update_scheduler_rules", input: ruleChanges, confidence: 0.95, explanation: "Update scheduler rules." };
  }

  const createTemplate = raw.match(/\b(?:create|save)\s+(?:a\s+)?(?:schedule\s+)?template\s+(.+?)(?=\s+(?:from|using)\s+(?:the\s+)?(?:schedule\s+)?(?:on\s+|for\s+)?(?:20\d{2}-\d{2}-\d{2}|today|tomorrow|selected\s+day)\b|[?.!,]|$)/i);
  if (createTemplate?.[1]) {
    const sourceDate = explicitIsoDate(raw) || args.date;
    return {
      intent: "TEMPLATE", toolName: "manage_schedule_template",
      input: { action: "CREATE", name: clean(createTemplate[1]), ...(sourceDate ? { sourceDate } : {}) },
      confidence: 0.96, explanation: "Create a reusable template from a saved schedule day.",
    };
  }

  const archiveTemplate = raw.match(/\b(?:archive|delete|remove)\s+(?:schedule\s+)?template\s+(.+?)(?:[?.!,]|$)/i);
  if (archiveTemplate?.[1]) return {
    intent: "TEMPLATE", toolName: "manage_schedule_template",
    input: { action: "ARCHIVE", template: clean(archiveTemplate[1]) },
    confidence: 0.98, explanation: "Archive a scheduler template.",
  };

  const placeUnplaced = raw.match(/\b(?:place|put|assign)\s+(?:the\s+)?(?:unplaced|unassigned)\s+(?:client\s+)?(.+?)\s+(?:with|to)\s+(.+?)\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i);
  if (placeUnplaced?.[1] && placeUnplaced?.[2] && args.times.startTime) return {
    intent: "UNPLACED_PLACE", toolName: "place_unplaced_assignment",
    input: { client: clean(placeUnplaced[1]), staff: clean(placeUnplaced[2]), startTime: args.times.startTime, allowLockedOverride: false, allowRuleOverride: false },
    confidence: 0.97, explanation: "Place an unresolved Unplaced client block.",
  };

  if (/\bsupervision\b/i.test(raw) && /\b(?:save|record|set|update)\b/i.test(raw)) {
    const staffMatch = raw.match(/\b(?:for|staff)\s+(.+?)(?=\s+(?:with|service|for\s+month|month)\b|[,.!?]|$)/i);
    const serviceHours = numberNear(raw, /\b(\d+(?:\.\d+)?)\s+service\s+hours?\b/i);
    const supervisionHours = numberNear(raw, /\b(\d+(?:\.\d+)?)\s+supervision\s+hours?\b/i);
    if (!staffMatch?.[1] || serviceHours === undefined || supervisionHours === undefined) {
      return clarification("Saving supervision requires the BT/RBT staff name, service hours, and supervision hours.");
    }
    const supervisor = raw.match(/\b(?:with|supervisor)\s+(.+?)(?=\s+(?:for\s+month|month|with\s+\d|service\s+hours|supervision\s+hours)\b|[,.!?]|$)/i)?.[1];
    const month = raw.match(/\b(20\d{2}-\d{2})\b/)?.[1];
    return {
      intent: "SUPERVISION", toolName: "save_supervision_record",
      input: { staff: clean(staffMatch[1]), serviceHours, supervisionHours, ...(supervisor ? { supervisor: clean(supervisor) } : {}), ...(month ? { month } : {}) },
      confidence: 0.94, explanation: "Save monthly supervision planning data.",
    };
  }

  if (/\b(?:create|add|update|change|archive|deactivate)\b[\s\S]*\b(?:staff|client|team)\b/i.test(raw)) {
    return clarification("I understand this is a scheduler profile/configuration change, but I do not have enough structured information to apply it safely. Please include the person/team and the exact field/value you want changed.");
  }

  return null;
}
