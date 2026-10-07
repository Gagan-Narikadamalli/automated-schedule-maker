import { DAILY_TIME_SLOTS } from "./constants";

type Staff = {
  id: string;
  name: string;
  role?: string;
  color?: string;
  availableSlots?: string[];
};

type Client = {
  _id?: string;
  id?: string;
  displayCode?: string;
  fullName?: string;
  color?: string;
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
  clientColor?: string | null;
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

type StyleSpec = {
  fill?: string;
  fontColor?: string;
  bold?: boolean;
  fontSize?: number;
  border?: boolean;
  horizontal?: "left" | "center";
  vertical?: "center";
  wrap?: boolean;
};

type BaseStyles = {
  title: number;
  header: number;
  metaValue: number;
  body: number;
  time: number;
  section: number;
  break: number;
  breakNap: number;
  breakSpeech: number;
  nap: number;
  speech: number;
  unavailable: number;
  unplaced: number;
};

type ZipEntry = {
  name: string;
  data: Uint8Array;
  crc: number;
  offset: number;
};

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

class StyleCatalog {
  private readonly specs: StyleSpec[] = [{}];
  private readonly styleByKey = new Map<string, number>([["{}", 0]]);

  add(spec: StyleSpec): number {
    const key = JSON.stringify(spec);
    const existing = this.styleByKey.get(key);
    if (existing !== undefined) return existing;
    const nextIndex = this.specs.length;
    this.specs.push(spec);
    this.styleByKey.set(key, nextIndex);
    return nextIndex;
  }

  all(): StyleSpec[] {
    return this.specs;
  }
}

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

function normalizeHexColor(value: string | null | undefined, fallback?: string): string | undefined {
  const candidate = (value || fallback || "").trim();
  const short = /^#?([0-9a-f]{3})$/i.exec(candidate);
  if (short) {
    return `#${short[1].split("").map((part) => `${part}${part}`).join("").toUpperCase()}`;
  }
  const full = /^#?([0-9a-f]{6})$/i.exec(candidate);
  return full ? `#${full[1].toUpperCase()}` : fallback;
}

function excelRgb(color: string): string {
  return `FF${(normalizeHexColor(color, "#FFFFFF") || "#FFFFFF").slice(1)}`;
}

function textColorForFill(color: string): string {
  const normalized = normalizeHexColor(color, "#FFFFFF") || "#FFFFFF";
  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance > 0.58 ? "#17344A" : "#FFFFFF";
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
    case "BREAK_NAP": return "Break/Nap";
    case "BREAK_SPEECH": return "Break/Speech";
    case "NAP": return `${code} Nap`;
    case "SPEECH": return `${code} Speech`;
    case "UNAVAILABLE": return "";
    case "OPEN": return "";
    default: return assignment.assignmentType.replaceAll("_", " ");
  }
}

function createBaseStyles(catalog: StyleCatalog): BaseStyles {
  return {
    title: catalog.add({ fontColor: "#0D315F", bold: true, fontSize: 16, vertical: "center" }),
    header: catalog.add({ fill: "#D7E6F3", fontColor: "#102F46", bold: true, border: true, horizontal: "center", vertical: "center", wrap: true }),
    metaValue: catalog.add({ border: true, vertical: "center", wrap: true }),
    body: catalog.add({ border: true, vertical: "center", wrap: true }),
    time: catalog.add({ fill: "#F4F9FC", fontColor: "#153650", bold: true, border: true, vertical: "center", wrap: true }),
    section: catalog.add({ fill: "#EAF7FD", fontColor: "#0D315F", bold: true, fontSize: 13, border: true, vertical: "center" }),
    break: catalog.add({ fill: "#FFF5D9", fontColor: "#79520F", bold: true, border: true, horizontal: "center", vertical: "center", wrap: true }),
    breakNap: catalog.add({ fill: "#FFF3D6", fontColor: "#704D15", bold: true, border: true, horizontal: "center", vertical: "center", wrap: true }),
    breakSpeech: catalog.add({ fill: "#E4F1FA", fontColor: "#2E5C73", bold: true, border: true, horizontal: "center", vertical: "center", wrap: true }),
    nap: catalog.add({ fill: "#F4EFE3", fontColor: "#5C5136", bold: true, border: true, horizontal: "center", vertical: "center", wrap: true }),
    speech: catalog.add({ fill: "#E2DAFB", fontColor: "#553D85", bold: true, border: true, horizontal: "center", vertical: "center", wrap: true }),
    unavailable: catalog.add({ fill: "#76838F", fontColor: "#FFFFFF", bold: true, border: true, horizontal: "center", vertical: "center", wrap: true }),
    unplaced: catalog.add({ fill: "#FFF3DC", fontColor: "#704D15", bold: true, border: true, vertical: "center", wrap: true }),
  };
}

function staffHeaderStyle(member: Staff, catalog: StyleCatalog, fallbackStyle: number): number {
  const fill = normalizeHexColor(member.color);
  if (!fill) return fallbackStyle;
  return catalog.add({
    fill,
    fontColor: textColorForFill(fill),
    bold: true,
    border: true,
    horizontal: "center",
    vertical: "center",
    wrap: true,
  });
}

function clientColorStyle(color: string | null | undefined, catalog: StyleCatalog, fallbackStyle: number): number {
  const fill = normalizeHexColor(color);
  if (!fill) return fallbackStyle;
  return catalog.add({
    fill,
    fontColor: textColorForFill(fill),
    bold: true,
    border: true,
    vertical: "center",
    wrap: true,
  });
}

function assignmentStyle(assignment: Assignment, catalog: StyleCatalog, styles: BaseStyles): number {
  switch (assignment.assignmentType) {
    case "CLIENT_1_TO_1": {
      const fill = normalizeHexColor(clientOf(assignment)?.color, "#D9F4EE") || "#D9F4EE";
      return catalog.add({
        fill,
        fontColor: textColorForFill(fill),
        bold: true,
        border: true,
        vertical: "center",
        wrap: true,
      });
    }
    case "BREAK": return styles.break;
    case "BREAK_NAP": return styles.breakNap;
    case "BREAK_SPEECH": return styles.breakSpeech;
    case "NAP": return styles.nap;
    case "SPEECH": return styles.speech;
    case "UNAVAILABLE": return styles.unavailable;
    case "OPEN": return styles.body;
    default: return styles.body;
  }
}

function buildRows(
  locationName: string,
  date: string,
  staff: Staff[],
  assignments: Assignment[],
  unplaced: Unplaced[],
  catalog: StyleCatalog,
  styles: BaseStyles
): Cell[][] {
  const byCell = new Map(
    assignments.map((assignment) => [`${assignment.staffId}:${assignment.startTime}`, assignment])
  );
  const staffById = new Map(staff.map((member) => [member.id, member]));

  const rows: Cell[][] = [
    [{ value: "SOS Daily Schedule", style: styles.title }],
    [{ value: "Location", style: styles.header }, { value: locationName, style: styles.metaValue }],
    [{ value: "Date", style: styles.header }, { value: date, style: styles.metaValue }],
    [],
    [
      { value: "Time", style: styles.header },
      ...staff.map((member) => ({
        value: member.name,
        style: staffHeaderStyle(member, catalog, styles.header),
      })),
    ],
  ];

  for (const timeSlot of DAILY_TIME_SLOTS) {
    rows.push([
      { value: timeSlot.label, style: styles.time },
      ...staff.map((member) => {
        const assignment = byCell.get(`${member.id}:${timeSlot.startTime}`);
        const unavailable = Array.isArray(member.availableSlots) && !member.availableSlots.includes(timeSlot.startTime);
        return {
          value: unavailable ? "" : assignment ? assignmentLabel(assignment) : "",
          style: unavailable
            ? styles.unavailable
            : assignment
              ? assignmentStyle(assignment, catalog, styles)
              : styles.body,
        };
      }),
    ]);
  }

  rows.push([], [{ value: "Assignment Details", style: styles.section }]);
  rows.push(
    ["Start", "End", "Staff", "Role", "Client", "Type", "Source", "Protected", "Note"].map(
      (value) => ({ value, style: styles.header })
    )
  );
  for (const assignment of [...assignments].sort(
    (a, b) => a.startTime.localeCompare(b.startTime) || a.staffId.localeCompare(b.staffId)
  )) {
    const member = staffById.get(assignment.staffId);
    const client = clientOf(assignment);
    rows.push([
      { value: formatTime(assignment.startTime), style: styles.body },
      { value: formatTime(assignment.endTime), style: styles.body },
      { value: member?.name || assignment.staffId, style: styles.body },
      { value: member?.role || "", style: styles.body },
      { value: client?.displayCode || client?.fullName || "", style: clientColorStyle(client?.color, catalog, styles.body) },
      { value: assignment.assignmentType.replaceAll("_", " "), style: assignmentStyle(assignment, catalog, styles) },
      { value: assignment.source || "", style: styles.body },
      { value: assignment.locked || assignment.manuallyOverridden ? "Yes" : "No", style: styles.body },
      { value: assignment.note || "", style: styles.body },
    ]);
  }

  rows.push([], [{ value: "Unplaced Assignments", style: styles.section }]);
  rows.push(
    ["Client", "Original Time", "Original Staff ID", "Reason", "Origin"].map(
      (value) => ({ value, style: styles.header })
    )
  );
  if (unplaced.length === 0) {
    rows.push([{ value: "No unplaced assignments for this date.", style: styles.body }]);
  } else {
    for (const item of unplaced) {
      const clientStyle = clientColorStyle(item.clientColor, catalog, styles.unplaced);
      rows.push([
        { value: item.clientCode || item.displayText || "Client", style: clientStyle },
        { value: item.originalStartTime ? formatTime(item.originalStartTime) : "", style: styles.unplaced },
        { value: item.originalStaffId || "", style: styles.unplaced },
        { value: item.reason || "", style: styles.unplaced },
        { value: item.origin || "", style: styles.unplaced },
      ]);
    }
  }

  return rows;
}

function worksheetXml(rows: Cell[][], staffCount: number): string {
  const maxColumns = Math.max(staffCount + 1, 9);
  const scheduleEndRow = 5 + DAILY_TIME_SLOTS.length;
  const sheetRows = rows.map((row, rowIndex) => {
    const cells = row.map((cell, columnIndex) => {
      const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
      return `<c r="${reference}" t="inlineStr" s="${cell.style ?? 0}"><is><t xml:space="preserve">${xml(cell.value)}</t></is></c>`;
    }).join("");
    const excelRow = rowIndex + 1;
    const height = excelRow === 1 ? 26 : excelRow === 5 ? 24 : excelRow >= 6 && excelRow <= scheduleEndRow ? 23 : 20;
    return `<row r="${excelRow}" ht="${height}" customHeight="1">${cells}</row>`;
  }).join("");

  const staffColumnsEnd = Math.max(staffCount + 1, 2);
  const extraColumns = maxColumns > staffColumnsEnd
    ? `<col min="${staffColumnsEnd + 1}" max="${maxColumns}" width="20" customWidth="1"/>`
    : "";
  const titleMerge = staffCount > 0
    ? `<mergeCells count="1"><mergeCell ref="A1:${columnName(staffCount)}1"/></mergeCells>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
  <dimension ref="A1:${columnName(maxColumns - 1)}${Math.max(rows.length, 1)}"/>
  <sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane xSplit="1" ySplit="5" topLeftCell="B6" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="20"/>
  <cols>
    <col min="1" max="1" width="24" customWidth="1"/>
    <col min="2" max="${staffColumnsEnd}" width="18" customWidth="1"/>
    ${extraColumns}
  </cols>
  <sheetData>${sheetRows}</sheetData>
  ${titleMerge}
  <pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.2" footer="0.2"/>
  <pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
}

function stylesXml(catalog: StyleCatalog): string {
  const specs = catalog.all();
  const fonts = specs.map((spec) => {
    const size = spec.fontSize ?? 11;
    const bold = spec.bold ? "<b/>" : "";
    const color = spec.fontColor ? `<color rgb="${excelRgb(spec.fontColor)}"/>` : "";
    return `<font>${bold}<sz val="${size}"/>${color}<name val="Calibri"/></font>`;
  });

  const fills = [
    `<fill><patternFill patternType="none"/></fill>`,
    `<fill><patternFill patternType="gray125"/></fill>`,
  ];
  const fillIdByStyle = specs.map(() => 0);
  specs.forEach((spec, index) => {
    if (!spec.fill) return;
    fillIdByStyle[index] = fills.length;
    fills.push(`<fill><patternFill patternType="solid"><fgColor rgb="${excelRgb(spec.fill)}"/><bgColor indexed="64"/></patternFill></fill>`);
  });

  const cellXfs = specs.map((spec, index) => {
    const fillId = fillIdByStyle[index];
    const borderId = spec.border ? 1 : 0;
    const alignmentParts = [
      spec.horizontal ? `horizontal="${spec.horizontal}"` : "",
      spec.vertical ? `vertical="${spec.vertical}"` : "",
      spec.wrap ? `wrapText="1"` : "",
    ].filter(Boolean).join(" ");
    const alignment = alignmentParts ? `<alignment ${alignmentParts}/>` : "";
    return `<xf numFmtId="0" fontId="${index}" fillId="${fillId}" borderId="${borderId}" xfId="0" applyFont="1"${fillId ? " applyFill=\"1\"" : ""}${borderId ? " applyBorder=\"1\"" : ""}${alignment ? " applyAlignment=\"1\"" : ""}>${alignment}</xf>`;
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="${fonts.length}">${fonts.join("")}</fonts>
  <fills count="${fills.length}">${fills.join("")}</fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFC4DAE7"/></left><right style="thin"><color rgb="FFC4DAE7"/></right><top style="thin"><color rgb="FFC4DAE7"/></top><bottom style="thin"><color rgb="FFC4DAE7"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="${cellXfs.length}">${cellXfs.join("")}</cellXfs>
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

function workbookBytes(rows: Cell[][], staffCount: number, catalog: StyleCatalog): Uint8Array {
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
    { name: "xl/styles.xml", content: stylesXml(catalog) },
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
  const catalog = new StyleCatalog();
  const styles = createBaseStyles(catalog);
  const rows = buildRows(locationName || "Clinic", date, staff, assignments, unplaced, catalog, styles);
  const bytes = workbookBytes(rows, staff.length, catalog);
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
