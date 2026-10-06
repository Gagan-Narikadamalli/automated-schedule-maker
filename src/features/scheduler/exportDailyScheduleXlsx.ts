type ExportStaff = {
  id: string;
  name: string;
  role?: string;
  color?: string;
  availableSlots?: string[];
};

type ExportClient = {
  _id?: string;
  id?: string;
  displayCode?: string;
  fullName?: string;
  color?: string;
};

type ExportAssignment = {
  id?: string;
  staffId: string;
  clientId: string | ExportClient | null;
  startTime: string;
  endTime: string;
  assignmentType: string;
  source?: string;
  locked?: boolean;
  manuallyOverridden?: boolean;
  note?: string;
};

type ExportUnplaced = {
  id?: string;
  clientId?: string | null;
  clientCode?: string | null;
  displayText?: string;
  originalStaffId?: string | null;
  originalStartTime?: string;
  reason?: string;
  origin?: string;
};

type ScheduleResponse = {
  staff?: ExportStaff[];
  assignments?: ExportAssignment[];
  error?: string;
};

type UnplacedResponse = {
  unplacedAssignments?: ExportUnplaced[];
  error?: string;
};

type ExportDailyScheduleOptions = {
  locationId: string;
  locationName: string;
  date: string;
};

type CellValue = {
  value: string;
  style?: number;
};

type WorksheetDefinition = {
  name: string;
  rows: CellValue[][];
  widths: number[];
  freezeRows?: number;
  autoFilterRow?: number;
};

type ZipEntry = {
  name: string;
  data: Uint8Array;
  crc: number;
  offset: number;
};

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function escapeXml(value: unknown): string {
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
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${minute} ${suffix}`;
}

function clientFromAssignment(assignment: ExportAssignment): ExportClient | null {
  return assignment.clientId && typeof assignment.clientId === "object"
    ? assignment.clientId
    : null;
}

function assignmentText(assignment: ExportAssignment): string {
  const client = clientFromAssignment(assignment);
  const clientCode = client?.displayCode || "Client";
  switch (assignment.assignmentType) {
    case "CLIENT_1_TO_1":
      return `${clientCode} 1:1`;
    case "BREAK":
      return "Break";
    case "BREAK_NAP":
      return `${client?.displayCode ? `${clientCode} ` : ""}Break/Nap`;
    case "BREAK_SPEECH":
      return `${client?.displayCode ? `${clientCode} ` : ""}Break/Speech`;
    case "NAP":
      return `${client?.displayCode ? `${clientCode} ` : ""}Nap`;
    case "SPEECH":
      return `${client?.displayCode ? `${clientCode} ` : ""}Speech`;
    case "UNAVAILABLE":
      return "Unavailable";
    case "OPEN":
      return "Open";
    default:
      return assignment.assignmentType.replaceAll("_", " ");
  }
}

function styleForAssignment(assignment: ExportAssignment | undefined, unavailable: boolean): number {
  if (unavailable) return 5;
  if (!assignment) return 3;
  if (assignment.assignmentType === "BREAK" || assignment.assignmentType === "BREAK_NAP" || assignment.assignmentType === "BREAK_SPEECH") {
    return 4;
  }
  return 3;
}

function worksheetXml(sheet: WorksheetDefinition): string {
  const maxColumns = Math.max(1, ...sheet.rows.map((row) => row.length));
  const columns = sheet.widths
    .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
    .join("");
  const rows = sheet.rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, columnIndex) => {
          const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
          const style = cell.style ?? 0;
          return `<c r="${reference}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${escapeXml(cell.value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  const lastCell = `${columnName(maxColumns - 1)}${Math.max(sheet.rows.length, 1)}`;
  const freezeRows = sheet.freezeRows ?? 0;
  const pane = freezeRows > 0
    ? `<pane ySplit="${freezeRows}" topLeftCell="A${freezeRows + 1}" activePane="bottomLeft" state="frozen"/>`
    : "";
  const autoFilter = sheet.autoFilterRow
    ? `<autoFilter ref="A${sheet.autoFilterRow}:${columnName(maxColumns - 1)}${sheet.autoFilterRow}"/>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastCell}"/>
  <sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${columns}</cols>
  <sheetData>${rows}</sheetData>
  ${autoFilter}
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

function workbookXml(sheets: WorksheetDefinition[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews>
  <sheets>${sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets>
</workbook>`;
}

function workbookRelationshipsXml(sheets: WorksheetDefinition[]): string {
  const sheetRelationships = sheets
    .map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheetRelationships}
  <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function contentTypesXml(sheets: WorksheetDefinition[]): string {
  const sheetOverrides = sheets
    .map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheetOverrides}
</Types>`;
}

function rootRelationshipsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(target: Uint8Array, offset: number, value: number) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32(target: Uint8Array, offset: number, value: number) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function makeZip(files: Array<{ name: string; content: string }>): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const entries: ZipEntry[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const header = new Uint8Array(30 + nameBytes.length);
    writeUint32(header, 0, 0x04034b50);
    writeUint16(header, 4, 20);
    writeUint16(header, 6, 0);
    writeUint16(header, 8, 0);
    writeUint16(header, 10, 0);
    writeUint16(header, 12, 0);
    writeUint32(header, 14, crc);
    writeUint32(header, 18, data.length);
    writeUint32(header, 22, data.length);
    writeUint16(header, 26, nameBytes.length);
    writeUint16(header, 28, 0);
    header.set(nameBytes, 30);
    localParts.push(header, data);
    entries.push({ name: file.name, data, crc, offset });
    offset += header.length + data.length;
  }

  const centralParts: Uint8Array[] = [];
  let centralSize = 0;
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const header = new Uint8Array(46 + nameBytes.length);
    writeUint32(header, 0, 0x02014b50);
    writeUint16(header, 4, 20);
    writeUint16(header, 6, 20);
    writeUint16(header, 8, 0);
    writeUint16(header, 10, 0);
    writeUint16(header, 12, 0);
    writeUint16(header, 14, 0);
    writeUint32(header, 16, entry.crc);
    writeUint32(header, 20, entry.data.length);
    writeUint32(header, 24, entry.data.length);
    writeUint16(header, 28, nameBytes.length);
    writeUint16(header, 30, 0);
    writeUint16(header, 32, 0);
    writeUint16(header, 34, 0);
    writeUint16(header, 36, 0);
    writeUint32(header, 38, 0);
    writeUint32(header, 42, entry.offset);
    header.set(nameBytes, 46);
    centralParts.push(header);
    centralSize += header.length;
  }

  const end = new Uint8Array(22);
  writeUint32(end, 0, 0x06054b50);
  writeUint16(end, 4, 0);
  writeUint16(end, 6, 0);
  writeUint16(end, 8, entries.length);
  writeUint16(end, 10, entries.length);
  writeUint32(end, 12, centralSize);
  writeUint32(end, 16, offset);
  writeUint16(end, 20, 0);

  return concatBytes([...localParts, ...centralParts, end]);
}

function buildDailyScheduleSheet(
  locationName: string,
  date: string,
  staff: ExportStaff[],
  assignments: ExportAssignment[]
): WorksheetDefinition {
  const assignmentsByCell = new Map(
    assignments.map((assignment) => [`${assignment.staffId}:${assignment.startTime}`, assignment])
  );
  const startTimes = Array.from(
    new Set([
      ...staff.flatMap((member) => member.availableSlots ?? []),
      ...assignments.map((assignment) => assignment.startTime),
    ])
  ).sort();

  const rows: CellValue[][] = [
    [{ value: "SOS Daily Schedule", style: 1 }],
    [{ value: "Location", style: 2 }, { value: locationName, style: 3 }],
    [{ value: "Date", style: 2 }, { value: date, style: 3 }],
    [],
    [
      { value: "Time", style: 2 },
      ...staff.map((member) => ({ value: `${member.name}${member.role ? ` (${member.role})` : ""}`, style: 2 })),
    ],
  ];

  for (const startTime of startTimes) {
    rows.push([
      { value: formatTime(startTime), style: 2 },
      ...staff.map((member) => {
        const assignment = assignmentsByCell.get(`${member.id}:${startTime}`);
        const unavailable = Array.isArray(member.availableSlots) && !member.availableSlots.includes(startTime);
        return {
          value: unavailable ? "Unavailable" : assignment ? assignmentText(assignment) : "",
          style: styleForAssignment(assignment, unavailable),
        };
      }),
    ]);
  }

  return {
    name: "Daily Schedule",
    rows,
    widths: [14, ...staff.map(() => 23)],
    freezeRows: 5,
  };
}

function buildAssignmentDetailsSheet(
  staff: ExportStaff[],
  assignments: ExportAssignment[]
): WorksheetDefinition {
  const staffById = new Map(staff.map((member) => [member.id, member]));
  const rows: CellValue[][] = [
    ["Start", "End", "Staff", "Role", "Client", "Type", "Source", "Protected", "Note"].map((value) => ({ value, style: 2 })),
  ];

  for (const assignment of [...assignments].sort((a, b) => a.startTime.localeCompare(b.startTime) || a.staffId.localeCompare(b.staffId))) {
    const member = staffById.get(assignment.staffId);
    const client = clientFromAssignment(assignment);
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

  return {
    name: "Assignment Details",
    rows,
    widths: [13, 13, 22, 14, 18, 20, 14, 13, 34],
    freezeRows: 1,
    autoFilterRow: 1,
  };
}

function buildUnplacedSheet(unplaced: ExportUnplaced[]): WorksheetDefinition {
  const rows: CellValue[][] = [
    ["Client", "Original Time", "Original Staff ID", "Reason", "Origin"].map((value) => ({ value, style: 2 })),
  ];
  if (unplaced.length === 0) {
    rows.push([{ value: "No unplaced assignments for this date.", style: 3 }]);
  } else {
    for (const record of unplaced) {
      rows.push([
        { value: record.clientCode || record.displayText || "Client", style: 3 },
        { value: record.originalStartTime ? formatTime(record.originalStartTime) : "", style: 3 },
        { value: record.originalStaffId || "", style: 3 },
        { value: record.reason || "", style: 3 },
        { value: record.origin || "", style: 3 },
      ]);
    }
  }
  return {
    name: "Unplaced",
    rows,
    widths: [18, 16, 28, 48, 24],
    freezeRows: 1,
    autoFilterRow: 1,
  };
}

function createWorkbook(sheets: WorksheetDefinition[]): Uint8Array {
  const files: Array<{ name: string; content: string }> = [
    { name: "[Content_Types].xml", content: contentTypesXml(sheets) },
    { name: "_rels/.rels", content: rootRelationshipsXml() },
    { name: "xl/workbook.xml", content: workbookXml(sheets) },
    { name: "xl/_rels/workbook.xml.rels", content: workbookRelationshipsXml(sheets) },
    { name: "xl/styles.xml", content: stylesXml() },
    ...sheets.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      content: worksheetXml(sheet),
    })),
  ];
  return makeZip(files);
}

function safeFilePart(value: string): string {
  return value
    .trim()
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "Clinic";
}

export async function exportDailyScheduleXlsx({
  locationId,
  locationName,
  date,
}: ExportDailyScheduleOptions): Promise<void> {
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
  const sheets = [
    buildDailyScheduleSheet(locationName || "Clinic", date, staff, assignments),
    buildAssignmentDetailsSheet(staff, assignments),
    buildUnplacedSheet(unplaced),
  ];
  const bytes = createWorkbook(sheets);
  const blob = new Blob([bytes], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `SOS-Schedule_${safeFilePart(locationName || "Clinic")}_${date}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
