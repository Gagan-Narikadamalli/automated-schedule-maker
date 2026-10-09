import { NextResponse } from "next/server";

import {
  inspectWorkbookTemplate,
  parseWorkbookTemplateSheet,
  type WorkbookTemplateClient,
  type WorkbookTemplateStaff,
} from "@/features/templates/workbookTemplateImport";
import {
  forbiddenResponse,
  requireApiSession,
  SCHEDULE_WRITE_ROLES,
  sessionCanAccessLocation,
  sessionHasAnyRole,
} from "@/lib/api/auth";
import { writeAuditLog } from "@/lib/api/audit";
import { connectToDatabase } from "@/lib/db";
import { Client } from "@/models/Client";
import { ScheduleTemplate } from "@/models/ScheduleTemplate";
import { Staff } from "@/models/Staff";

const MAX_WORKBOOK_BYTES = 15 * 1024 * 1024;
const VALID_DAYS = new Set([
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
]);

type PlainRecord = Record<string, any>;

function textField(
  form: FormData,
  key: string
): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function isWorkbookFile(value: FormDataEntryValue | null): value is File {
  return (
    value !== null &&
    typeof value !== "string" &&
    typeof value.arrayBuffer === "function"
  );
}

function cleanFileName(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").trim().slice(0, 180);
}

async function loadMappingData(locationId: string) {
  const [staffRows, clientRows] = await Promise.all([
    Staff.find({ locationId, active: true })
      .select("_id fullName")
      .sort({ fullName: 1 })
      .lean(),
    Client.find({ locationId, active: true })
      .select("_id displayCode")
      .sort({ displayCode: 1 })
      .lean(),
  ]);

  const staff: WorkbookTemplateStaff[] = (
    staffRows as unknown as PlainRecord[]
  ).map((member) => ({
    id: String(member._id),
    fullName: String(member.fullName ?? ""),
  }));

  const clients: WorkbookTemplateClient[] = (
    clientRows as unknown as PlainRecord[]
  ).map((client) => ({
    id: String(client._id),
    displayCode: String(client.displayCode ?? ""),
  }));

  return { staff, clients };
}

function serializeInspection(
  inspection: ReturnType<typeof parseWorkbookTemplateSheet>
) {
  return {
    sheetName: inspection.sheetName,
    detectedDate: inspection.detectedDate,
    detectedDayOfWeek: inspection.detectedDayOfWeek,
    headerRowNumber: inspection.headerRowNumber,
    timeRowCount: inspection.timeRowCount,
    matchedStaffCount: inspection.matchedStaffCount,
    totalStaffHeaders: inspection.totalStaffHeaders,
    mappedClientAssignmentCount:
      inspection.mappedClientAssignmentCount,
    mappedBreakCount: inspection.mappedBreakCount,
    assignmentCount: inspection.assignmentCount,
    unmatchedStaffHeaders: inspection.unmatchedStaffHeaders,
    unmatchedClientCodes: inspection.unmatchedClientCodes,
  };
}

export async function POST(request: Request) {
  const auth = await requireApiSession();

  if (auth.error) {
    return auth.error;
  }

  if (!sessionHasAnyRole(auth.session, SCHEDULE_WRITE_ROLES)) {
    return forbiddenResponse();
  }

  try {
    const form = await request.formData();
    const mode = textField(form, "mode").toUpperCase();
    const locationId = textField(form, "locationId");
    const fileValue = form.get("file");

    if (!locationId || !isWorkbookFile(fileValue)) {
      return NextResponse.json(
        { error: "Location and Excel workbook are required." },
        { status: 400 }
      );
    }

    if (!sessionCanAccessLocation(auth.session, locationId)) {
      return forbiddenResponse("You do not have access to this location.");
    }

    if (fileValue.size <= 0 || fileValue.size > MAX_WORKBOOK_BYTES) {
      return NextResponse.json(
        {
          error:
            "Workbook must be larger than 0 bytes and no larger than 15 MB.",
        },
        { status: 400 }
      );
    }

    if (
      !/\.(xlsx|xls|xlsm)$/i.test(fileValue.name) &&
      ![
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
        "application/vnd.ms-excel.sheet.macroEnabled.12",
        "application/octet-stream",
      ].includes(fileValue.type)
    ) {
      return NextResponse.json(
        { error: "Upload an Excel .xlsx, .xls, or .xlsm workbook." },
        { status: 400 }
      );
    }

    await connectToDatabase();

    const { staff, clients } = await loadMappingData(locationId);
    const bytes = new Uint8Array(await fileValue.arrayBuffer());

    if (mode === "INSPECT") {
      const sheets = inspectWorkbookTemplate(bytes, staff, clients).map(
        serializeInspection
      );

      return NextResponse.json({
        fileName: cleanFileName(fileValue.name),
        sheets,
      });
    }

    if (mode === "BULK_RECENT_TWO_WEEKS") {
      // Only the ten specific dates requested. No other worksheets are written.
      const dates = [
        "2026-09-28","2026-09-29","2026-09-30","2026-10-01","2026-10-02",
        "2026-10-05","2026-10-06","2026-10-07","2026-10-08","2026-10-09",
      ];
      const inspections = inspectWorkbookTemplate(bytes, staff, clients);
      const selections = dates.map(date => ({
        date,
        sheet: inspections.find(sheet => sheet.detectedDate === date),
      }));
      const missing = selections.filter(item => !item.sheet || item.sheet.matchedStaffCount === 0 || item.sheet.mappedClientAssignmentCount === 0);
      if (missing.length) {
        return NextResponse.json({ error: "The workbook is missing usable mapped client assignments for required dates. No templates were changed.",
          missingDates:missing.map(item=>item.date),
          inspections:missing.map(item=>item.sheet ? serializeInspection(item.sheet) : {detectedDate:item.date}),
        }, {status:422});
      }
      const imported = [];
      for (const item of selections) {
        const inspection = item.sheet!;
        const name = `Livingston Excel ${item.date}`;
        const template = await ScheduleTemplate.findOneAndUpdate(
          {locationId, dayOfWeek:inspection.detectedDayOfWeek, name},
          {$set:{locationId,name,dayOfWeek:inspection.detectedDayOfWeek,
            sourceType:"HISTORICAL_WORKBOOK",sourceName:cleanFileName(fileValue.name),
            sourceDate:item.date,styleNotes:[`Exact workbook sheet: ${inspection.sheetName}.`,
              "First priority when generating this date; second priority when generating the same weekday seven days later."],
            learningOnly:false,assignments:inspection.assignments,active:true}},
          {new:true,upsert:true,runValidators:true}
        );
        imported.push({id:String(template._id),date:item.date,dayOfWeek:inspection.detectedDayOfWeek,
          sheetName:inspection.sheetName,assignmentCount:inspection.assignmentCount,
          mappedClientAssignmentCount:inspection.mappedClientAssignmentCount,
          unmatchedStaffHeaders:inspection.unmatchedStaffHeaders,unmatchedClientCodes:inspection.unmatchedClientCodes});
      }
      await writeAuditLog({locationId,userId:auth.session.userId,action:"SAVE_TEMPLATE",
        entityType:"SCHEDULE_TEMPLATE",entityId:imported[0].id,
        summary:"Imported exactly ten Livingston workbook templates for two workweeks.",
        after:{sourceName:cleanFileName(fileValue.name),imported}});
      return NextResponse.json({success:true,imported,importedCount:imported.length});
    }

    if (mode !== "CREATE") {
      return NextResponse.json(
        { error: "Workbook mode must be INSPECT or CREATE." },
        { status: 400 }
      );
    }

    const sheetName = textField(form, "sheetName");
    const templateName = textField(form, "templateName");
    const requestedDay = textField(form, "dayOfWeek").toUpperCase();
    const requestedDate = textField(form, "sourceDate");

    if (!sheetName || !templateName) {
      return NextResponse.json(
        { error: "Select a workbook sheet and enter a template name." },
        { status: 400 }
      );
    }

    const inspection = parseWorkbookTemplateSheet(
      bytes,
      sheetName,
      staff,
      clients
    );

    const dayOfWeek =
      (VALID_DAYS.has(requestedDay) ? requestedDay : null) ??
      inspection.detectedDayOfWeek;

    if (!dayOfWeek || !VALID_DAYS.has(dayOfWeek)) {
      return NextResponse.json(
        {
          error:
            "The workbook sheet weekday could not be detected. Choose the weekday before saving.",
        },
        { status: 400 }
      );
    }

    const sourceDate =
      /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
        ? requestedDate
        : inspection.detectedDate ?? "";

    if (inspection.matchedStaffCount === 0) {
      return NextResponse.json(
        {
          error:
            "No workbook staff columns matched active staff in this clinic. Check the clinic selection and staff names.",
          inspection: serializeInspection(inspection),
        },
        { status: 400 }
      );
    }

    if (inspection.assignmentCount === 0) {
      return NextResponse.json(
        {
          error:
            "No usable schedule blocks were found on the selected sheet.",
          inspection: serializeInspection(inspection),
        },
        { status: 400 }
      );
    }

    const template = await ScheduleTemplate.findOneAndUpdate(
      {
        locationId,
        dayOfWeek,
        name: templateName,
      },
      {
        $set: {
          locationId,
          name: templateName,
          dayOfWeek,
          sourceType: "HISTORICAL_WORKBOOK",
          sourceName: cleanFileName(fileValue.name),
          sourceDate,
          styleNotes: [
            `Exact workbook sheet: ${sheetName}.`,
            "Use these exact staff/client/time pairings first when they remain valid on the new day.",
            "Current-day availability, attendance, call-outs, Speech, Nap, breaks, hard restrictions, hour limits, and protected manual cells always override the workbook.",
            "If an exact workbook pairing cannot be reused, fall back to the nearest valid current-day schedule while preserving coverage.",
          ],
          learningOnly: false,
          learningProfile: {
            humanStyleBlockBalancingEnabled: true,
            preferredClientsPerStaffPerDay: 2,
            preferredStaffPerClientPerDay: 2,
            continuityPriority: 240,
            clientHandoffPenaltyPriority: 250,
            workloadBalancePriority: 10,
            staffScheduleCompactnessPriority: 25,
          },
          assignments: inspection.assignments,
          active: true,
        },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
      }
    );

    await writeAuditLog({
      locationId,
      userId: auth.session.userId,
      action: "SAVE_TEMPLATE",
      entityType: "SCHEDULE_TEMPLATE",
      entityId: String(template._id),
      summary: `Created exact template ${templateName} from workbook sheet ${sheetName}.`,
      after: {
        templateName,
        dayOfWeek,
        sourceDate,
        sourceName: cleanFileName(fileValue.name),
        sheetName,
        assignmentCount: inspection.assignmentCount,
        mappedClientAssignmentCount:
          inspection.mappedClientAssignmentCount,
        mappedBreakCount: inspection.mappedBreakCount,
        matchedStaffCount: inspection.matchedStaffCount,
        unmatchedStaffHeaders: inspection.unmatchedStaffHeaders,
        unmatchedClientCodes: inspection.unmatchedClientCodes,
      },
    });

    return NextResponse.json(
      {
        template: {
          id: String(template._id),
          locationId: String(template.locationId),
          name: String(template.name),
          dayOfWeek: String(template.dayOfWeek),
          assignmentCount: Array.isArray(template.assignments)
            ? template.assignments.length
            : inspection.assignmentCount,
          sourceType: String(template.sourceType),
          sourceName: String(template.sourceName ?? ""),
          sourceDate: String(template.sourceDate ?? ""),
          learningOnly: Boolean(template.learningOnly),
          active: Boolean(template.active),
        },
        inspection: serializeInspection(inspection),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Workbook template import failed:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Workbook could not be inspected or imported.",
      },
      { status: 500 }
    );
  }
}
