import { suggestClientDisplayCode } from "./schedulerNativeManagement";
import type { SchedulerAiHistoryMessage } from "./types";

function last(history: SchedulerAiHistoryMessage[], role: "user" | "assistant"): string {
  return [...history].reverse().find((entry) => entry.role === role)?.text.trim() || "";
}

function seedIndex(history: SchedulerAiHistoryMessage[], pattern: RegExp): number {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (entry.role === "user" && pattern.test(entry.text)) return index;
  }
  return -1;
}

function recent(history: SchedulerAiHistoryMessage[], pattern: RegExp): string {
  const index = seedIndex(history, pattern);
  return index >= 0 ? history[index].text.trim() : "";
}

function repliesSince(
  history: SchedulerAiHistoryMessage[],
  pattern: RegExp,
  current: string
): string[] {
  const index = seedIndex(history, pattern);
  if (index < 0) return [current];
  return [
    ...history.slice(index + 1)
      .filter((entry) => entry.role === "user")
      .map((entry) => entry.text.trim())
      .filter(Boolean),
    current,
  ];
}

function clean(value: string): string {
  return value.replace(/^[\s"'.,;:]+|[\s"'.,;:!?]+$/g, "").replace(/\s+/g, " ").trim();
}

function normalize(value: string): string {
  const visible = value
    .split(/\n\n\[SCHEDULER TIME NORMALIZATION:/i)[0]
    .trim();

  return visible
    .replace(/\bfull[- _0]*time\b/gi, "full-time")
    .replace(/\bpart[- _0]*time\b/gi, "part-time")
    .replace(/\boffice[- _]*manager\b/gi, "office manager")
    .replace(/\s+/g, " ")
    .trim();
}

function dateToken(value: string): string {
  return value.match(
    /\b(20\d{2}-\d{2}-\d{2}|today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i
  )?.[1] || "";
}

function clockToken(value: string): string {
  return value.match(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i)?.[0] || "";
}

function looksLikeNewCommand(value: string): boolean {
  if (/^(?:set|change|move|make|use)\s+(?:it|that|this)\b/i.test(value.trim())) {
    return false;
  }
  return /^(?:create|add|archive|deactivate|remove|delete|show|list|view|generate|repair|fix|copy|save|set|change|update|move|replace|record|schedule|place|put|assign|turn|enable|disable)\b/i.test(
    value.trim()
  );
}

function openClarification(value: string): boolean {
  return /\b(?:requires?|need(?:s|ed)?|please include|please provide|not enough structured information|choose a different|needs? clarification)\b/i.test(
    value
  );
}

function parts(values: string[]): string[] {
  return values
    .flatMap((value) => normalize(value).split(/[,;]+/))
    .map(clean)
    .filter(Boolean);
}

function nameCandidate(values: string[], excluded: RegExp): string {
  for (const value of parts(values)) {
    if (
      excluded.test(value) ||
      /^(?:today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|20\d{2}-\d{2}-\d{2})$/i.test(value)
    ) continue;
    if (/^[A-Za-z][A-Za-z' -]{1,80}$/.test(value)) return value;
  }
  return "";
}

function staffCreate(
  current: string,
  history: SchedulerAiHistoryMessage[],
  assistant: string
): string | null {
  if (!/creating a staff member requires the full name, role/i.test(assistant)) {
    return null;
  }

  const seedPattern =
    /\b(?:create|add)\s+(?:a\s+)?(?:new\s+)?staff(?:\s+member)?\b/i;
  const seed = recent(history, seedPattern);
  if (!seed) return null;

  const replies = repliesSince(history, seedPattern, current);
  const normalizedReplies = replies.map(normalize).filter(Boolean);
  const aggregate = normalize([seed, ...normalizedReplies].join(" ; "));

  const role =
    aggregate.match(/\b(office manager|rbt|bt|intern|bcba|other)\b/i)?.[1] || "";
  const employeeType =
    aggregate.match(/\b(full-time|part-time)\b/i)?.[1] || "";
  const date = dateToken(aggregate);

  const seedName = seed.match(
    /\bstaff(?:\s+member)?(?:\s+named)?\s+(.+?)(?=\s+(?:as\s+)?(?:office\s+manager|rbt|bt|intern|bcba|other)\b|\s+(?:full[- ]?time|part[- ]?time)\b|\s+(?:starting|start\s+date|from)\b|[,.!?]|$)/i
  )?.[1];

  const candidates = [
    ...(seedName ? [clean(seedName)] : []),
    ...parts(replies).filter(
      (value) =>
        /^[A-Za-z][A-Za-z' -]{1,80}$/.test(value) &&
        !/^(?:office manager|rbt|bt|intern|bcba|other|full-time|part-time|today|tomorrow|yesterday|weekdays?|weekends?|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i.test(
          value
        ) &&
        !/\b(?:from|between|at)\s+\d/i.test(value)
    ),
  ];

  const fullName =
    candidates
      .map(clean)
      .filter(Boolean)
      .sort(
        (left, right) =>
          right.split(/\s+/).length - left.split(/\s+/).length ||
          right.length - left.length
      )[0] || "";

  const scheduleDetails = normalizedReplies.filter(
    (value) =>
      /\b(?:weekdays?|weekends?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|every\s+day)\b/i.test(
        value
      ) ||
      /\b(?:from|between)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/i.test(value)
  );

  if (fullName && role && employeeType && date) {
    return [
      "create a new staff member " +
        fullName +
        " as " +
        role +
        " " +
        employeeType +
        " starting " +
        date,
      ...scheduleDetails,
    ]
      .filter(Boolean)
      .join(" ");
  }

  return [seed, ...normalizedReplies].filter(Boolean).join(" ");
}

function clientCreate(
  current: string,
  history: SchedulerAiHistoryMessage[],
  assistant: string
): string | null {
  if (!/creating a client requires the full name, display code/i.test(assistant)) {
    return null;
  }

  const seedPattern =
    /\b(?:create|add)\s+(?:a\s+)?(?:new\s+)?client\b/i;
  const seed = recent(history, seedPattern);
  if (!seed) return null;

  const replies = repliesSince(history, seedPattern, current);
  const normalizedReplies = replies.map(normalize).filter(Boolean);
  const aggregate = normalize([seed, ...normalizedReplies].join(" ; "));
  const date = dateToken(aggregate);

  const autoCode =
    /\b(?:(?:code|display\s+code)\s+(?:anything(?:\s+you\s+like)?|whatever(?:\s+you\s+like)?|any\s+code|your\s+choice|you\s+(?:choose|pick|decide))|(?:choose|pick)\s+(?:(?:the|a)\s+)?(?:display\s+)?code)\b/i.test(
      aggregate
    );
  const explicitCode = aggregate.match(
    /\b(?:code|display\s+code)(?:\s+is|\s*:)?\s+(?!anything\b|whatever\b|your\b|you\b|choose\b|pick\b|any\b)([A-Za-z0-9_-]+)\b/i
  )?.[1];

  const currentName = normalize(current).match(
    /^(.+?)(?=\s+(?:and\s+)?(?:with\s+)?(?:code|display\s+code)\b)/i
  )?.[1];
  const seedName = seed.match(
    /\bclient(?:\s+named)?\s+(.+?)(?=\s+(?:with\s+)?(?:code|display\s+code)\b|\s+(?:starting|start\s+date|from)\b|[,.!?]|$)/i
  )?.[1];

  const replyNames = parts(replies)
    .map((value) =>
      value
        .replace(
          /\s+and\s+(?:with\s+)?(?:code|display\s+code)\b.*$/i,
          ""
        )
        .trim()
    )
    .filter(
      (value) =>
        /^[A-Za-z][A-Za-z' -]{1,80}$/.test(value) &&
        !/^(?:code|display code|choose|pick|anything|whatever|today|tomorrow|yesterday|weekdays?|weekends?|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i.test(
          value
        ) &&
        !/\b(?:from|between|at)\s+\d/i.test(value)
    );

  const fullName =
    [currentName || "", ...replyNames, seedName || ""]
      .map((value) => clean(value).replace(/\s+and\s+then$/i, ""))
      .filter(Boolean)
      .sort(
        (left, right) =>
          right.split(/\s+/).length - left.split(/\s+/).length ||
          right.length - left.length
      )[0] || "";

  const positionalCode =
    parts(replies).find(
      (value) =>
        /^[A-Za-z][A-Za-z0-9_-]{1,11}$/.test(value) &&
        value.toLowerCase() !== fullName.toLowerCase() &&
        !/^(?:today|tomorrow|yesterday|weekdays?|weekends?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|code|choose|pick|anything|whatever)$/i.test(
          value
        )
    ) || "";

  const displayCode =
    explicitCode ||
    positionalCode ||
    (fullName && autoCode ? suggestClientDisplayCode(fullName) : "");

  const attendanceDetails = normalizedReplies.filter(
    (value) =>
      /\b(?:weekdays?|weekends?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|every\s+day)\b/i.test(
        value
      ) ||
      /\b(?:from|between)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/i.test(value)
  );

  if (fullName && displayCode && date) {
    return [
      "create a new client " +
        fullName +
        " with display code " +
        displayCode +
        " starting " +
        date,
      ...attendanceDetails,
    ]
      .filter(Boolean)
      .join(" ");
  }

  return [seed, ...normalizedReplies].filter(Boolean).join(" ");
}

function eventFollowUp(
  current: string,
  history: SchedulerAiHistoryMessage[],
  assistant: string
): string | null {
  const kind=assistant.match(/\b(nap|speech)\b/i)?.[1]?.toLowerCase();
  if (!kind) return null;
  const seedPattern=new RegExp("\\b(?:add|schedule|create|remove|delete)\\b[\\s\\S]*\\b"+kind+"\\b","i");
  const seed=recent(history,seedPattern);
  const previous=last(history,"user");
  const value=normalize(current);
  if (/event changes require a client reference/i.test(assistant)) {
    return `${/\b(?:remove|delete)\b/i.test(seed)?"remove":"add"} ${kind} for ${value}`;
  }
  if (/requires both a start time and end time/i.test(assistant)) {
    let base=seed || `add ${kind} for ${clean(previous)}`;
    if (!/\bfor\s+\S+/i.test(base) && previous!==seed) {
      base=base.replace(/[?.!]+$/g,"")+` for ${clean(previous)}`;
    }
    return base.replace(/[?.!]+$/g,"")+" "+(/^(?:from|between|at)\b/i.test(value)?value:`from ${value}`);
  }
  if (/recurring .* needs weekday information/i.test(assistant) && seed) {
    return seed.replace(/[?.!]+$/g,"")+" "+value;
  }
  return null;
}

function supervisionFollowUp(
  current: string,
  history: SchedulerAiHistoryMessage[],
  assistant: string
): string | null {
  if (!/saving supervision requires the bt\/rbt staff name, service hours, and supervision hours/i.test(assistant)) return null;
  const seedPattern=/\bsupervision\b/i;
  const seed=recent(history,seedPattern);
  const replies=repliesSince(history,seedPattern,current);
  const aggregate=normalize(replies.join(" ; "));
  const service=aggregate.match(/\b(\d+(?:\.\d+)?)\s+service\s+hours?\b/i)?.[1] || "";
  const supervision=aggregate.match(/\b(\d+(?:\.\d+)?)\s+supervision\s+hours?\b/i)?.[1] || "";
  const bare=parts(replies).filter((part)=>/^\d+(?:\.\d+)?$/.test(part));
  const staff=nameCandidate(replies,/^(?:\d+(?:\.\d+)?|20\d{2}-\d{2}|service\b|supervision\b)/i);
  const serviceHours=service || bare[0] || "";
  const supervisionHours=supervision || bare[1] || "";
  if (!staff || !serviceHours || !supervisionHours) {
    return seed ? seed.replace(/[?.!]+$/g,"")+" "+normalize(current) : null;
  }
  return `record supervision for ${staff}, ${serviceHours} service hours ${supervisionHours} supervision hours`;
}

function breakFollowUp(
  current: string,
  history: SchedulerAiHistoryMessage[],
  assistant: string
): string | null {
  if (!/a break change requires the staff member and start time/i.test(assistant)) return null;
  const seedPattern=/\b(?:set|move|change|add|give|schedule|remove|delete|clear)\b[\s\S]*\bbreak\b/i;
  const seed=recent(history,seedPattern);
  if (!seed) return null;
  const replies=repliesSince(history,seedPattern,current);
  const action=/\b(?:remove|delete|clear)\b/i.test(seed)?"remove":"set";
  const staffFromSeed=seed.match(
    /\b(?:set|move|change|add|give|schedule|remove|delete|clear)\s+(.+?)(?:'s)?\s+break\b/i
  )?.[1];
  const staff=clean(staffFromSeed || "") || nameCandidate(replies,/^(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)|at\b|from\b)/i);
  const time=replies.map(clockToken).find(Boolean) || clockToken(seed);
  return staff && time ? `${action} ${staff} break at ${time}` : null;
}

function unplacedFollowUp(
  current: string,
  history: SchedulerAiHistoryMessage[],
  assistant: string
): string | null {
  if (!/placing an unplaced assignment requires/i.test(assistant)) return null;
  const seedPattern=/\b(?:place|put|assign)\b[\s\S]*\b(?:unplaced|unassigned)\b/i;
  const seed=recent(history,seedPattern);
  if (!seed) return null;
  const replies=repliesSince(history,seedPattern,current);
  const aggregate=normalize([seed,...replies].join(" ; "));
  const client=seed.match(/\b(?:unplaced|unassigned)\s+(?:client\s+)?(.+?)(?=\s+(?:with|to|at)\b|[?.!,]|$)/i)?.[1];
  const staff=aggregate.match(/\b(?:with|to)\s+(.+?)(?=\s+at\b|[;,!?]|$)/i)?.[1] ||
    nameCandidate(replies,/^(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)|at\b|from\b|with\b|to\b)/i);
  const time=replies.map(clockToken).find(Boolean) || clockToken(seed);
  return client && staff && time ? `place unplaced ${clean(client)} with ${clean(staff)} at ${time}` : null;
}

function attendanceFollowUp(
  current: string,
  history: SchedulerAiHistoryMessage[],
  assistant: string
): string | null {
  if (!/client attendance change requires/i.test(assistant)) return null;
  const seedPattern=/\b(?:record|add|remove|delete)\b[\s\S]*\bclient\b[\s\S]*\b(?:call[- ]?out|call[- ]?in|attendance)\b/i;
  const seed=recent(history,seedPattern);
  if (!seed) return null;
  const replies=repliesSince(history,seedPattern,current);
  const aggregate=normalize([seed,...replies].join(" ; "));
  const changeType=/\bcall[- ]?in\b/i.test(aggregate)?"call-in":/\bcall[- ]?out\b/i.test(aggregate)?"call-out":"";
  const client=nameCandidate(replies,/^(?:call[- ]?(?:out|in)|attendance\b|\d{1,2}(?::\d{2})?\s*(?:am|pm)|from\b|between\b|at\b)/i);
  if (!client || !changeType) return null;
  return `${/\b(?:remove|delete)\b/i.test(seed)?"remove":"record"} client ${changeType} for ${client}`;
}

function copyFollowUp(
  current: string,
  history: SchedulerAiHistoryMessage[],
  assistant: string
): string | null {
  if (!/copying a schedule requires the source day or date/i.test(assistant)) return null;
  if (!recent(history,/\b(?:copy|use)\b[\s\S]*\bschedule\b/i)) return null;
  const source=normalize(current).replace(/^(?:from|use)\s+/i,"");
  return `copy ${source} schedule`;
}

function ruleFollowUp(
  current: string,
  history: SchedulerAiHistoryMessage[],
  assistant: string
): string | null {
  if (!/scheduler rule change is missing its value or time range/i.test(assistant)) return null;
  const seed=recent(
    history,
    /\b(?:set|change|update)\b[\s\S]*\b(?:break\s+eligibility|default\s+break|break\s+window|schedule\s+hours?|minimum\s+(?:client[- ]staff\s+)?assignment|maximum\s+(?:client[- ]staff\s+)?(?:consecutive|continuous))\b/i
  );
  if (!seed) return null;
  const value=normalize(current);
  if (/\b(?:break\s+window|schedule\s+hours?)\b/i.test(seed)) {
    return seed.replace(/[?.!]+$/g,"")+" "+(/^(?:from|between)\b/i.test(value)?value:`from ${value}`);
  }
  return seed.replace(/[?.!]+$/g,"")+` to ${value}`;
}

function profileUpdateFollowUp(
  current: string,
  history: SchedulerAiHistoryMessage[],
  assistant: string
): string | null {
  if (!/scheduler profile\/configuration change/i.test(assistant)) return null;
  const value=normalize(current);
  const staffSeed=recent(history,/\b(?:update|change|set)\s+staff\s+(.+?)(?:[?.!,]|$)/i);
  if (staffSeed) {
    const staff=staffSeed.match(/\b(?:update|change|set)\s+staff\s+(.+?)(?:[?.!,]|$)/i)?.[1] || "";
    const combined=normalize(repliesSince(history,/\b(?:update|change|set)\s+staff\s+/i,current).join(" ; "));
    const role=combined.match(/\b(rbt|bt|intern|bcba|office\s+manager|other)\b/i)?.[1];
    if (/\brole\b/i.test(combined) && role) return `change ${clean(staff)}'s role to ${role}`;
  }
  const clientSeed=recent(history,/\b(?:update|change|set)\s+client\s+(.+?)(?:[?.!,]|$)/i);
  if (clientSeed) {
    const client=clientSeed.match(/\b(?:update|change|set)\s+client\s+(.+?)(?:[?.!,]|$)/i)?.[1] || "";
    const combined=normalize(repliesSince(history,/\b(?:update|change|set)\s+client\s+/i,current).join(" ; "));
    const support=combined.match(/\b(standard|one[- ]?to[- ]?one|1\s*:\s*1|rotation|high[- ]?support)\b/i)?.[1];
    if (/\bsupport\s+level\b/i.test(combined) && support) {
      return `set client ${clean(client)} support level to ${support}`;
    }
  }
  const teamSeed=recent(history,/\b(?:update|change|set)\s+team\s+(.+?)(?:[?.!,]|$)/i);
  if (teamSeed) {
    const team=teamSeed.match(/\b(?:update|change|set)\s+team\s+(.+?)(?:[?.!,]|$)/i)?.[1] || "";
    const color=value.match(/#[0-9a-f]{6}\b/i)?.[0];
    if (color) return `set team ${clean(team)} color to ${color}`;
  }
  return null;
}

function genericFollowUp(current: string, previous: string, assistant: string): string | null {
  if (!openClarification(assistant)) return null;
  const value=normalize(current);
  if (
    /\b(?:start time|end time|time range)\b/i.test(assistant) &&
    /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.test(value)
  ) {
    return previous.replace(/[?.!]+$/g,"")+" "+(/^(?:from|between|at)\b/i.test(value)?value:`from ${value}`);
  }
  return previous.replace(/[?.!]+$/g,"")+" "+value;
}

export function expandNativeClarificationFollowUp(
  message: string,
  history: SchedulerAiHistoryMessage[]
): string | null {
  const current=message.trim();
  const assistant=last(history,"assistant");
  const previous=last(history,"user");
  if (!current || !assistant || !previous || looksLikeNewCommand(current)) return null;

  return (
    staffCreate(current,history,assistant) ||
    clientCreate(current,history,assistant) ||
    (/creating a team requires a team name/i.test(assistant)?`create a new team ${normalize(current)}`:null) ||
    (/creating a schedule template requires a template name/i.test(assistant)?`save schedule template ${normalize(current)}`:null) ||
    (/schedule template change requires the template name/i.test(assistant)?`apply template ${normalize(current)}`:null) ||
    eventFollowUp(current,history,assistant) ||
    supervisionFollowUp(current,history,assistant) ||
    breakFollowUp(current,history,assistant) ||
    unplacedFollowUp(current,history,assistant) ||
    attendanceFollowUp(current,history,assistant) ||
    copyFollowUp(current,history,assistant) ||
    ruleFollowUp(current,history,assistant) ||
    profileUpdateFollowUp(current,history,assistant) ||
    genericFollowUp(current,previous,assistant)
  );
}
