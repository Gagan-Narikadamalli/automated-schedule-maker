import assert from "node:assert/strict";

import * as XLSX from "xlsx";

import {
  detectDateFromSheetName,
  inspectWorkbookTemplate,
  parseWorkbookTemplateSheet,
} from "../src/features/templates/workbookTemplateImport";

const rows = [
  ["", "Areyana", "Anias", "", "Danna", "Bella (wil)"],
  ["Availability", "", "", "", "", ""],
  ["8:00 - 8:30", "MaHa 1:1", "JeMa 1:1", "", "", ""],
  ["8:30 - 9:00", "MaHa 1:1", "JeMa 1:1", "", "CaGr 1:1", ""],
  ["11:30 - 12:00", "Break", "JeMa 1:1", "", "CaGr 1:1", "ReMa 1:1"],
  ["12:00 - 12:30", "CaGr 1:1", "Break", "", "JeMa 1:1", "BRK/NAP"],
  ["12:30 - 1:00", "CaGr 1:1", "CaMe 1:1", "", "JeMa 1:1", "MiSm 1:2"],
];

const sheet = XLSX.utils.aoa_to_sheet(rows);
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, sheet, "Wed Oct 7 2026");
const bytes = XLSX.write(workbook, {
  type: "buffer",
  bookType: "xlsx",
});

const staff = [
  { id: "s-areyana", fullName: "Areyana Prince" },
  { id: "s-anias", fullName: "Anias Jenkins" },
  { id: "s-danna", fullName: "Danna" },
  { id: "s-bella", fullName: "Bella Wiltshire" },
];
const clients = [
  { id: "c-maha", displayCode: "MaHa" },
  { id: "c-jema", displayCode: "JeMa" },
  { id: "c-cagr", displayCode: "CaGr" },
  { id: "c-rema", displayCode: "ReMa" },
  { id: "c-came", displayCode: "CaMe" },
  { id: "c-mism", displayCode: "MiSm" },
];

const inspections = inspectWorkbookTemplate(
  new Uint8Array(bytes),
  staff,
  clients
);

assert.equal(inspections.length, 1);
const inspection = inspections[0];

assert.equal(inspection.sheetName, "Wed Oct 7 2026");
assert.equal(inspection.detectedDate, "2026-10-07");
assert.equal(inspection.detectedDayOfWeek, "WEDNESDAY");

assert.equal(
  detectDateFromSheetName("MON 1005", 2026),
  "2026-10-05"
);
assert.equal(
  detectDateFromSheetName("WED 930", 2026),
  "2026-09-30"
);
assert.equal(
  detectDateFromSheetName("WED 99", 2026),
  "2026-09-09"
);
assert.equal(
  detectDateFromSheetName("MON 831", 2026),
  "2026-08-31"
);
assert.equal(inspection.matchedStaffCount, 4);
assert.equal(inspection.unmatchedStaffHeaders.length, 0);
assert.equal(inspection.unmatchedClientCodes.length, 0);
assert.ok(
  inspection.assignmentCount >= 15,
  "Workbook parser should map client and break cells from the selected sheet."
);

const parsed = parseWorkbookTemplateSheet(
  new Uint8Array(bytes),
  "Wed Oct 7 2026",
  staff,
  clients
);

const exactAniasMorning = parsed.assignments.filter(
  (assignment) =>
    assignment.staffId === "s-anias" &&
    assignment.clientId === "c-jema" &&
    ["08:00", "08:30", "11:30"].includes(assignment.startTime)
);
assert.equal(exactAniasMorning.length, 3);

const breakNap = parsed.assignments.find(
  (assignment) =>
    assignment.staffId === "s-bella" &&
    assignment.startTime === "12:00"
);
assert.equal(
  breakNap?.assignmentType,
  "BREAK",
  "Workbook BRK/NAP cells should import as a plain staff break; client naps are manual."
);

const afternoon = parsed.assignments.find(
  (assignment) =>
    assignment.staffId === "s-bella" &&
    assignment.startTime === "12:30"
);
assert.equal(afternoon?.clientId, "c-mism");
assert.equal(afternoon?.endTime, "13:00");

console.log("Workbook template import regression scenarios passed.");
