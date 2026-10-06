type Staff = {
  id: string;
  name: string;
  role?: string;
  availableSlots?: string[];
};

type Client = {
  _id?: string;
  id?: string;
  displayCode?: string;
  fullName?: string;
};

type Assignment = {
  staffId: string;
  clientId: string | Client | null;
  startTime: string;
  endTime: string;
  assignmentType: string;
  source?: string;
  locked?: boolean;
  manuallyOverridden?: boolean;
  note?: string;
};

type Unplaced = {
  clientCode?: string | null;
  displayText?: string;
  originalStaffId?: string | null;
  originalStartTime?: string;
  reason?: string;
  origin?: string;
};

type ScheduleResponse = {
  staff?: Staff[];
  assignments?: Assignment[];
  error?: string;
};

type UnplacedResponse = {
  unplacedAssignments?: Unplaced[];
  error?: string;
};

type ExportOptions = {
  locationId: string;
  locationName: string;
  date: string;
};

type Cell = { value: string; style?: number };

type ZipEntry = {
  name: string;
  data: Uint8Array;
  crc: number;
  offset: number;
};

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function xml(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function columnName(index: number): string {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function formatTime(time: string): string {
  if (!/^\d{2}:\d{2}$/.test(time)) return time;
  const [hourText, minute] = time.split(":");
  const hour = Number(hourText);
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? "PM" : "AM"}`;
}

function clientOf(assignment: Assignment): Client | null {
  return assignment.clientId && typeof assignment.clientId === "object"
    ? assignment.clientId
    : null;
}

function assignmentLabel(assignment: Assignment): string {
  const code = clientOf(assignment)?.displayCode || "Client";
  switch (assignment.assignmentType) {
    case "CLIENT_1_TO_1": return `${code} 1:1`;
    case "BREAK": return "Break";
    case "BREAK_NAP": return `${clientOf(assignment)?.displayCode ? `${code} ` : ""}Break/Nap`;
    case "BREAK_SPEECH": return `${clientOf(assignment)?.displayCode ? `${code} ` : ""}Break/Speech`;
    case "NAP": return `${clientOf(assignment)?.displayCode ? `${code} ` : ""}Nap`;
    case "SPEECH": return `${clientOf(assignment)?.displayCode ? `${code} ` : ""}Speech`;
    case "UNAVAILABLE": return "Unavailable";
    case "OPEN": return "Open";
    default: return assignment.assignmentType.replaceAll("_", " ");
  }
}

function buildRows(
  locationName: string,
  date: string,
  staff: Staff[],
  assignments: Assignment[],
  unplaced: Unplaced[]
): Cell[][] {
  const byCell = new Map(
    assignments.map((assignment) => [`${assignment.staffId}:${assignment.startTime}`, assignment])
  );
  const staffById = new Map(staff.map((member) => [member.id, member]));
  const startTimes = Array.from(new Set([
    ...staff.flatMap((member) => member.availableSlots ?? []),
    ...assignments.map((assignment) => assignment.startTime),
  ])).sort();

  const rows: Cell[][] = [
    [{ value: "SOS Daily Schedule", style: 1 }],
    [{ value: "Location", style: 2 }, { value: locationName, style: 3 }],
    [{ value: "Date", style: 2 }, { value: date, style: 3 }],
    [],
    [
      { value: "Time", style: 2 },
      ...staff.map((member) => ({
        value: `${member.name}${member.role ? ` (${member.role})` : ""}`,
        style: 2,
      })),
    ],
  ];

  for (const startTime of startTimes) {
    rows.push([
      { value: formatTime(startTime), style: 2 },
      ...staff.map((member) => {
        const assignment = byCell.get(`${member.id}:${startTime}`);
        const unavailable = Array.isArray(member.availableSlots) && !member.availableSlots.includes(startTime);
        return {
          value: unavailable ? "Unavailable" : assignment ? assignmentLabel(assignment) : "",
          style: unavailable ? 5 : assignment?.assignmentType.startsWith("BREAK") ? 4 : 3,
        };
      }),
    ]);
  }

  rows.push([], [{ value: "Assignment Details", style: 1 }]);
  rows.push(
    ["Start", "End", "Staff", "Role", "Client", "Type", "Source", "Protected", "Note"].map(
      (value) => ({ value, style: 2 })
    )
  );
  for (const assignment of [...assignments].sort(
    (a, b) => a.startTime.localeCompare(b.startTime) || a.staffId.localeCompare(b.staffId)
  )) {
    const member = staffById.get(assignment.staffId);
    const client = clientOf(assignment);
    rows.push([
      { value: formatTime(assignment.startTime), style: 3 },
      { value: formatTime(assignment.endTime), style: 3 },
      { value: member?.name || assignment.staffId, style: 3 },
      { value: member?.role || "", style: 3 },
      { value: client?.displayCode || client?.fullName || "", style: 3 },
      { value: assignment.assignmentType.replaceAll("_", " "), style: 3 },
      { value: assignment.source || "", style: 3 },
      { value: assignment.locked || assignment.manuallyOverridden ? "Yes" : "No", style: 3 },
      { value: assignment.note || "", style: 3 },
    ]);
  }

  rows.push([], [{ value: "Unplaced Assignments", style: 1 }]);
  rows.push(
    ["Client", "Original Time", "Original Staff ID", "Reason", "Origin"].map(
      (value) => ({ value, style: 2 })
    )
  );
  if (unplaced.length === 0) {
    rows.push([{ value: "No unplaced assignments for this date.", style: 3 }]);
  } else {
    for (const item of unplaced) {
      rows.push([
        { value: item.clientCode || item.displayText || "Client", style: 3 },
        { value: item.originalStartTime ? formatTime(item.originalStartTime) : "", style: 3 },
        { value: item.originalStaffId || "", style: 3 },
        { value: item.reason || "", style: 3 },
        { value: item.origin || "", style: 3 },
      ]);
    }
  }

  return rows;
}

function worksheetXml(rows: Cell[][], staffCount: number): string {
  const maxColumns = Math.max(staffCount + 1, 9);
  const sheetRows = rows.map((row, rowIndex) => {
    const cells = row.map((cell, columnIndex) => {
      const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
      return `<c r="${reference}" t="inlineStr" s="${cell.style ?? 0}"><is><t xml:space="preserve">${xml(cell.value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${columnName(maxColumns - 1)}${Math.max(rows.length, 1)}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>
    <col min="1" max="1" width="15" customWidth="1"/>
    <col min="2" max="${maxColumns}" width="23" customWidth="1"/>
  </cols>
  <sheetData>${sheetRows}</sheetData>
</worksheet>`;
}

function stylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="16"/><color rgb="FF0D315F"/><name val="Calibri"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDCECF7"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF3D6"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE2E5E8"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFD3E1EA"/></left><right style="thin"><color rgb="FFD3E1EA"/></right><top style="thin"><color rgb="FFD3E1EA"/></top><bottom style="thin"><color rgb="FFD3E1EA"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="6">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(target: Uint8Array, offset: number, value: number) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
}

function u32(target: Uint8Array, offset: number, value: number) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function zip(files: Array<{ name: string; content: string }>): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const entries: ZipEntry[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const header = new Uint8Array(30 + name.length);
    u32(header, 0, 0x04034b50);
    u16(header, 4, 20);
    u32(header, 14, crc);
    u32(header, 18, data.length);
    u32(header, 22, data.length);
    u16(header, 26, name.length);
    header.set(name, 30);
    localParts.push(header, data);
    entries.push({ name: file.name, data, crc, offset });
    offset += header.length + data.length;
  }

  const centralParts: Uint8Array[] = [];
  let centralSize = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const header = new Uint8Array(46 + name.length);
    u32(header, 0, 0x02014b50);
    u16(header, 4, 20);
    u16(header, 6, 20);
    u32(header, 16, entry.crc);
    u32(header, 20, entry.data.length);
    u32(header, 24, entry.data.length);
    u16(header, 28, name.length);
    u32(header, 42, entry.offset);
    header.set(name, 46);
    centralParts.push(header);
    centralSize += header.length;
  }

  const end = new Uint8Array(22);
  u32(end, 0, 0x06054b50);
  u16(end, 8, entries.length);
  u16(end, 10, entries.length);
  u32(end, 12, centralSize);
  u32(end, 16, offset);
  return concat([...localParts, ...centralParts, end]);
}

function workbookBytes(rows: Cell[][], staffCount: number): Uint8Array {
  const files = [
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Daily Schedule" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: "xl/styles.xml", content: stylesXml() },
    { name: "xl/worksheets/sheet1.xml", content: worksheetXml(rows, staffCount) },
  ];
  return zip(files);
}

function filePart(value: string): string {
  return value.trim().replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "Clinic";
}

export async function exportDailyScheduleXlsx({ locationId, locationName, date }: ExportOptions) {
  if (!locationId || !date) throw new Error("Choose a clinic and date before exporting.");
  if (locationId.startsWith("demo-")) {
    throw new Error("Excel export is available for live clinic schedules.");
  }

  const [scheduleResponse, unplacedResponse] = await Promise.all([
    fetch(`/api/schedule?locationId=${encodeURIComponent(locationId)}&date=${encodeURIComponent(date)}`, { cache: "no-store" }),
    fetch(`/api/unplaced?locationId=${encodeURIComponent(locationId)}&date=${encodeURIComponent(date)}`, { cache: "no-store" }),
  ]);
  const scheduleData = (await scheduleResponse.json()) as ScheduleResponse;
  const unplacedData = (await unplacedResponse.json()) as UnplacedResponse;
  if (!scheduleResponse.ok) throw new Error(scheduleData.error || "The schedule could not be loaded for Excel export.");
  if (!unplacedResponse.ok) throw new Error(unplacedData.error || "Unplaced assignments could not be loaded for Excel export.");

  const staff = scheduleData.staff ?? [];
  const assignments = scheduleData.assignments ?? [];
  const unplaced = unplacedData.unplacedAssignments ?? [];
  const bytes = workbookBytes(buildRows(locationName || "Clinic", date, staff, assignments, unplaced), staff.length);
  const blobBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(blobBuffer).set(bytes);
  const blob = new Blob([blobBuffer], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `SOS-Schedule_${filePart(locationName || "Clinic")}_${date}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
