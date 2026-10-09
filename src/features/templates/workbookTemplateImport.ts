import * as XLSX from "xlsx";

export type WorkbookTemplateStaff = {
  id: string;
  fullName: string;
};

export type WorkbookTemplateClient = {
  id: string;
  displayCode: string;
};

export type WorkbookTemplateAssignment = {
  startTime: string;
  endTime: string;
  staffId: string;
  clientId: string | null;
  assignmentType:
    | "CLIENT_1_TO_1"
    | "BREAK"
    | "BREAK_NAP"
    | "BREAK_SPEECH"
    | "NAP"
    | "SPEECH";
  locked: boolean;
};

export type WorkbookSheetInspection = {
  sheetName: string;
  detectedDate: string | null;
  detectedDayOfWeek: string | null;
  headerRowNumber: number | null;
  timeRowCount: number;
  matchedStaffCount: number;
  totalStaffHeaders: number;
  mappedClientAssignmentCount: number;
  mappedBreakCount: number;
  assignmentCount: number;
  unmatchedStaffHeaders: string[];
  unmatchedClientCodes: string[];
  assignments: WorkbookTemplateAssignment[];
};

const DAYS = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
] as const;

function normalize(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function staffKeys(fullName: string): string[] {
  const clean = normalizeHeader(fullName);
  const first = clean.split(/\s+/)[0] ?? "";
  return [...new Set([normalize(clean), normalize(first)].filter(Boolean))];
}

function buildStaffLookup(staff: WorkbookTemplateStaff[]) {
  const candidates = new Map<string, WorkbookTemplateStaff[]>();

  for (const member of staff) {
    for (const key of staffKeys(member.fullName)) {
      candidates.set(key, [...(candidates.get(key) ?? []), member]);
    }
  }

  return candidates;
}

function matchStaff(
  header: unknown,
  lookup: Map<string, WorkbookTemplateStaff[]>
): WorkbookTemplateStaff | null {
  const clean = normalizeHeader(header);
  const first = clean.split(/\s+/)[0] ?? "";
  const keys = [normalize(clean), normalize(first)].filter(Boolean);

  for (const key of keys) {
    const matches = lookup.get(key) ?? [];
    if (matches.length === 1) return matches[0];
  }

  return null;
}

function buildClientLookup(clients: WorkbookTemplateClient[]) {
  return new Map(
    clients.map((client) => [normalize(client.displayCode), client] as const)
  );
}

function parseClockToken(
  value: string,
  fallbackPeriod: "AM" | "PM"
): number | null {
  const match = value
    .trim()
    .match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  const explicitPeriod = match[3]?.toUpperCase() as
    | "AM"
    | "PM"
    | undefined;

  if (explicitPeriod) {
    if (hour > 12 || hour === 0) return null;
    if (explicitPeriod === "AM") {
      hour = hour === 12 ? 0 : hour;
    } else {
      hour = hour === 12 ? 12 : hour + 12;
    }
  } else if (hour <= 12) {
    const period =
      hour >= 8 && hour <= 11
        ? "AM"
        : hour === 12
          ? "PM"
          : fallbackPeriod;
    if (period === "PM" && hour !== 12) hour += 12;
    if (period === "AM" && hour === 12) hour = 0;
  }

  return hour * 60 + minute;
}

function formatMinutes(minutes: number): string {
  const normalizedMinutes = ((minutes % 1440) + 1440) % 1440;
  const hour = Math.floor(normalizedMinutes / 60);
  const minute = normalizedMinutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(
    2,
    "0"
  )}`;
}

function parseTimeRange(value: unknown): {
  startTime: string;
  endTime: string;
} | null {
  const raw = String(value ?? "")
    .replace(/[–—]/g, "-")
    .replace(/\bto\b/gi, "-")
    .replace(/\s+/g, " ")
    .trim();

  if (!raw.includes("-")) return null;

  const [leftRaw, rightRaw] = raw.split("-").map((part) => part.trim());
  if (!leftRaw || !rightRaw) return null;

  const startPeriod: "AM" | "PM" =
    /\bPM\b/i.test(leftRaw) || /^\s*(?:12|[1-7])(?::|\b)/.test(leftRaw)
      ? "PM"
      : "AM";
  const start = parseClockToken(leftRaw, startPeriod);
  if (start === null) return null;

  const endPeriod: "AM" | "PM" =
    /\bAM\b/i.test(rightRaw)
      ? "AM"
      : /\bPM\b/i.test(rightRaw)
        ? "PM"
        : start >= 12 * 60
          ? "PM"
          : "AM";
  let end = parseClockToken(rightRaw, endPeriod);
  if (end === null) return null;

  if (end <= start) {
    end += 12 * 60;
  }

  if (end - start <= 0 || end - start > 180) return null;

  return {
    startTime: formatMinutes(start),
    endTime: formatMinutes(end),
  };
}

function dateFromParts(
  year: number,
  month: number,
  day: number
): string | null {
  const candidate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
    2,
    "0"
  )}`;
}

export function detectDateFromSheetName(
  sheetName: string,
  fallbackYear = new Date().getFullYear()
): string | null {
  const iso = sheetName.match(/\b(20\d{2})[-_.](\d{1,2})[-_.](\d{1,2})\b/);
  if (iso) {
    return dateFromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const numeric = sheetName.match(
    /\b(\d{1,2})[\/.\-_](\d{1,2})(?:[\/.\-_](20\d{2}|\d{2}))?\b/
  );
  if (numeric) {
    const rawYear = numeric[3];
    const year = rawYear
      ? Number(rawYear.length === 2 ? `20${rawYear}` : rawYear)
      : fallbackYear;
    return dateFromParts(year, Number(numeric[1]), Number(numeric[2]));
  }

  // Historical Livingston sheets commonly use compact month/day names such
  // as "MON 1005", "WED 930", "WED 99", or "MON 831". Treat those as
  // MMDD / MDD using the workbook-year fallback so upload can select the
  // correct original date automatically.
  const compact = sheetName.match(
    /\b(?:sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:s|nesday)?|thu(?:rs|rsday)?|fri(?:day)?|sat(?:urday)?)\s+(\d{2,4})\b/i
  );
  if (compact) {
    const digits = compact[1];

    const candidates: Array<{ month: number; day: number }> = [];

    if (digits.length === 4) {
      candidates.push({
        month: Number(digits.slice(0, 2)),
        day: Number(digits.slice(2)),
      });
    } else if (digits.length === 3) {
      candidates.push(
        {
          month: Number(digits.slice(0, 1)),
          day: Number(digits.slice(1)),
        },
        {
          month: Number(digits.slice(0, 2)),
          day: Number(digits.slice(2)),
        }
      );
    } else if (digits.length === 2) {
      candidates.push({
        month: Number(digits.slice(0, 1)),
        day: Number(digits.slice(1)),
      });
    }

    for (const candidate of candidates) {
      const parsed = dateFromParts(
        fallbackYear,
        candidate.month,
        candidate.day
      );
      if (parsed) return parsed;
    }
  }

  const monthNames: Record<string, number> = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  };
  const named = sheetName.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*[-_. ]?\s*(\d{1,2})(?:\s*,?\s*(20\d{2}))?\b/i
  );
  if (named) {
    const month = monthNames[named[1].toLowerCase()];
    return dateFromParts(
      Number(named[3] ?? fallbackYear),
      month,
      Number(named[2])
    );
  }

  return null;
}

export function detectDayOfWeekFromSheetName(
  sheetName: string,
  detectedDate: string | null
): string | null {
  if (detectedDate) {
    const date = new Date(`${detectedDate}T12:00:00Z`);
    if (!Number.isNaN(date.getTime())) {
      return DAYS[date.getUTCDay()];
    }
  }

  const match = sheetName.match(
    /\b(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs|rsday)?|fri(?:day)?|sat(?:urday)?)\b/i
  );
  if (!match) return null;

  const token = match[1].slice(0, 3).toUpperCase();
  const byPrefix: Record<string, string> = {
    SUN: "SUNDAY",
    MON: "MONDAY",
    TUE: "TUESDAY",
    WED: "WEDNESDAY",
    THU: "THURSDAY",
    FRI: "FRIDAY",
    SAT: "SATURDAY",
  };
  return byPrefix[token] ?? null;
}

function parseAssignmentCell(
  value: unknown,
  clientLookup: Map<string, WorkbookTemplateClient[] | WorkbookTemplateClient>
): {
  assignmentType:
    | "CLIENT_1_TO_1"
    | "BREAK"
    | "BREAK_NAP"
    | "BREAK_SPEECH"
    | "NAP"
    | "SPEECH";
  client: WorkbookTemplateClient | null;
  unmatchedClientCode: string | null;
} | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const normalized = normalize(raw);
  if (!normalized) return null;

  if (
    /^(?:brk|break)(?:nap|andnap|napbreak)|^(?:brknap|breaknap)/i.test(
      normalized
    )
  ) {
    return {
      assignmentType: "BREAK",
      client: null,
      unmatchedClientCode: null,
    };
  }

  if (
    /^(?:brk|break)(?:speech|andspeech)|^(?:brkspeech|breakspeech)/i.test(
      normalized
    )
  ) {
    return {
      assignmentType: "BREAK",
      client: null,
      unmatchedClientCode: null,
    };
  }

  if (/^(?:break|brk)$/i.test(normalized)) {
    return {
      assignmentType: "BREAK",
      client: null,
      unmatchedClientCode: null,
    };
  }

  if (/^nap$/i.test(normalized)) {
    // Workbook nap labels are imported as staff breaks only. Client naps are
    // created separately in Manual mode rather than inferred from a template.
    return {
      assignmentType: "BREAK",
      client: null,
      unmatchedClientCode: null,
    };
  }

  if (/^speech$/i.test(normalized)) {
    return {
      assignmentType: "SPEECH",
      client: null,
      unmatchedClientCode: null,
    };
  }

  const withoutRatio = raw
    .replace(/\s*1\s*:\s*\d+\s*$/i, "")
    .replace(/\s+/g, "")
    .trim();
  const codeKey = normalize(withoutRatio);
  const found = clientLookup.get(codeKey);
  const client = Array.isArray(found) ? found[0] ?? null : found ?? null;

  if (client) {
    return {
      assignmentType: "CLIENT_1_TO_1",
      client,
      unmatchedClientCode: null,
    };
  }

  if (
    /^(?:availability|off|pto|out|unavailable|mroff|na)$/i.test(normalized)
  ) {
    return null;
  }

  return {
    assignmentType: "CLIENT_1_TO_1",
    client: null,
    unmatchedClientCode: raw,
  };
}

function sheetRows(
  workbook: XLSX.WorkBook,
  sheetName: string
): unknown[][] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];

  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });
}

function parseWorkbookObjectSheet(
  workbook: XLSX.WorkBook,
  sheetName: string,
  staff: WorkbookTemplateStaff[],
  clients: WorkbookTemplateClient[]
): WorkbookSheetInspection {
  const rows = sheetRows(workbook, sheetName);
  const staffLookup = buildStaffLookup(staff);
  const clientLookup = buildClientLookup(clients);
  const detectedDate = detectDateFromSheetName(sheetName);
  const detectedDayOfWeek = detectDayOfWeekFromSheetName(
    sheetName,
    detectedDate
  );

  const timeRows: Array<{
    rowIndex: number;
    timeColumn: number;
    startTime: string;
    endTime: string;
  }> = [];

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    for (let columnIndex = 0; columnIndex < Math.min(row.length, 6); columnIndex += 1) {
      const range = parseTimeRange(row[columnIndex]);
      if (!range) continue;
      timeRows.push({
        rowIndex,
        timeColumn: columnIndex,
        ...range,
      });
      break;
    }
  }

  const firstTimeRow = timeRows[0]?.rowIndex ?? -1;
  const timeColumn = timeRows[0]?.timeColumn ?? 0;
  let headerRowIndex = -1;
  let bestMatched = -1;
  let bestNonEmpty = -1;

  if (firstTimeRow > 0) {
    const start = Math.max(0, firstTimeRow - 7);
    for (let rowIndex = start; rowIndex < firstTimeRow; rowIndex += 1) {
      const row = rows[rowIndex] ?? [];
      let matched = 0;
      let nonEmpty = 0;

      for (
        let columnIndex = timeColumn + 1;
        columnIndex < row.length;
        columnIndex += 1
      ) {
        const header = String(row[columnIndex] ?? "").trim();
        if (!header) continue;
        nonEmpty += 1;
        if (matchStaff(header, staffLookup)) matched += 1;
      }

      if (
        matched > bestMatched ||
        (matched === bestMatched && nonEmpty > bestNonEmpty)
      ) {
        bestMatched = matched;
        bestNonEmpty = nonEmpty;
        headerRowIndex = rowIndex;
      }
    }
  }

  const headerRow = headerRowIndex >= 0 ? rows[headerRowIndex] ?? [] : [];
  const staffByColumn = new Map<number, WorkbookTemplateStaff>();
  const unmatchedStaffHeaders: string[] = [];
  let totalStaffHeaders = 0;

  for (
    let columnIndex = timeColumn + 1;
    columnIndex < headerRow.length;
    columnIndex += 1
  ) {
    const rawHeader = String(headerRow[columnIndex] ?? "").trim();
    if (!rawHeader) continue;

    const member = matchStaff(rawHeader, staffLookup);
    if (member) {
      staffByColumn.set(columnIndex, member);
      totalStaffHeaders += 1;
    } else if (
      !/^(?:availability|time|notes?|schedule)$/i.test(rawHeader)
    ) {
      totalStaffHeaders += 1;
      unmatchedStaffHeaders.push(rawHeader);
    }
  }

  const assignments: WorkbookTemplateAssignment[] = [];
  const unmatchedClientCodes = new Set<string>();
  let mappedClientAssignmentCount = 0;
  let mappedBreakCount = 0;

  for (const timeRow of timeRows) {
    const row = rows[timeRow.rowIndex] ?? [];

    for (const [columnIndex, member] of staffByColumn) {
      const parsed = parseAssignmentCell(row[columnIndex], clientLookup);
      if (!parsed) continue;

      if (
        parsed.assignmentType === "CLIENT_1_TO_1" &&
        !parsed.client
      ) {
        if (parsed.unmatchedClientCode) {
          unmatchedClientCodes.add(parsed.unmatchedClientCode);
        }
        continue;
      }

      if (parsed.assignmentType === "CLIENT_1_TO_1") {
        mappedClientAssignmentCount += 1;
      } else if (
        parsed.assignmentType === "BREAK" ||
        parsed.assignmentType === "BREAK_NAP" ||
        parsed.assignmentType === "BREAK_SPEECH"
      ) {
        mappedBreakCount += 1;
      }

      assignments.push({
        startTime: timeRow.startTime,
        endTime: timeRow.endTime,
        staffId: member.id,
        clientId: parsed.client?.id ?? null,
        assignmentType: parsed.assignmentType,
        locked: false,
      });
    }
  }

  return {
    sheetName,
    detectedDate,
    detectedDayOfWeek,
    headerRowNumber: headerRowIndex >= 0 ? headerRowIndex + 1 : null,
    timeRowCount: timeRows.length,
    matchedStaffCount: staffByColumn.size,
    totalStaffHeaders,
    mappedClientAssignmentCount,
    mappedBreakCount,
    assignmentCount: assignments.length,
    unmatchedStaffHeaders: [...new Set(unmatchedStaffHeaders)].sort(),
    unmatchedClientCodes: [...unmatchedClientCodes].sort(),
    assignments,
  };
}

export function inspectWorkbookTemplate(
  data: Uint8Array,
  staff: WorkbookTemplateStaff[],
  clients: WorkbookTemplateClient[]
): WorkbookSheetInspection[] {
  const workbook = XLSX.read(data, {
    type: "array",
    cellDates: true,
  });

  return workbook.SheetNames.map((sheetName) =>
    parseWorkbookObjectSheet(workbook, sheetName, staff, clients)
  );
}

export function parseWorkbookTemplateSheet(
  data: Uint8Array,
  sheetName: string,
  staff: WorkbookTemplateStaff[],
  clients: WorkbookTemplateClient[]
): WorkbookSheetInspection {
  const workbook = XLSX.read(data, {
    type: "array",
    cellDates: true,
  });

  if (!workbook.SheetNames.includes(sheetName)) {
    throw new Error(`Workbook sheet "${sheetName}" was not found.`);
  }

  return parseWorkbookObjectSheet(workbook, sheetName, staff, clients);
}
