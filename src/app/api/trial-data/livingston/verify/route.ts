import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/db";
import { Client } from "@/models/Client";
import { Location } from "@/models/Location";
import { Staff } from "@/models/Staff";
import { SupervisionRecord } from "@/models/SupervisionRecord";
import { Team } from "@/models/Team";

type PlainRecord = Record<string, unknown>;

const TRIAL_LOCATION_CODE = "LIVINGSTON_TRIAL_VERIFY";
const TRIAL_LOCATION_NAME = "Livingston Trial Verification";
const TRIAL_TEAM_NAME = "Trial Blue";
const TRIAL_BT_NAME = "Areyana";
const TRIAL_BCBA_NAME = "Stephanie";
const TRIAL_CLIENT_CODE = "CaGr";
const TRIAL_MONTH = "2026-10";

const ATTEMPT_COLORS = [
  "#2563EB",
  "#0EA5A4",
  "#7C3AED",
  "#DB2777",
  "#0284C7",
];

function parseAttempt(request: Request): number {
  const url = new URL(request.url);
  const attempt = Number(url.searchParams.get("attempt"));
  const confirmation = url.searchParams.get("confirm");

  if (confirmation !== "run") {
    return 0;
  }

  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 5) {
    return 0;
  }

  return attempt;
}

export async function GET(request: Request) {
  const attempt = parseAttempt(request);

  if (attempt === 0) {
    return NextResponse.json(
      {
        error:
          "Use attempt=1 through attempt=5 together with confirm=run to execute this isolated trial verification.",
      },
      { status: 400 }
    );
  }

  try {
    await connectToDatabase();

    const color = ATTEMPT_COLORS[attempt - 1];
    const staffTargetHours = 35 + attempt;
    const supervisionHours = attempt * 0.5;
    const serviceHours = 40 + attempt;
    const verificationMarker = `TRIAL VERIFY ATTEMPT ${attempt}`;

    const location = await Location.findOneAndUpdate(
      { code: TRIAL_LOCATION_CODE },
      {
        $set: {
          name: TRIAL_LOCATION_NAME,
          timezone: "America/New_York",
          active: true,
        },
        $setOnInsert: {
          code: TRIAL_LOCATION_CODE,
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    const team = await Team.findOneAndUpdate(
      {
        locationId: location._id,
        name: TRIAL_TEAM_NAME,
      },
      {
        $set: {
          color,
          active: true,
        },
        $setOnInsert: {
          locationId: location._id,
          name: TRIAL_TEAM_NAME,
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    const bt = await Staff.findOneAndUpdate(
      {
        locationId: location._id,
        fullName: TRIAL_BT_NAME,
      },
      {
        $set: {
          startDate: new Date("2026-09-01T12:00:00.000Z"),
          endDate: null,
          role: "BT",
          employeeType: "FULL_TIME",
          teamId: team._id,
          color,
          serviceSetting: "IN_CENTER",
          minimumWeeklyHours: 30,
          targetWeeklyHours: staffTargetHours,
          maximumWeeklyHours: 45,
          shiftPatterns: [
            {
              name: "Trial weekday shift",
              days: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
              startTime: "08:00",
              endTime: "17:00",
            },
          ],
          active: true,
        },
        $setOnInsert: {
          locationId: location._id,
          fullName: TRIAL_BT_NAME,
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    const bcba = await Staff.findOneAndUpdate(
      {
        locationId: location._id,
        fullName: TRIAL_BCBA_NAME,
      },
      {
        $set: {
          startDate: new Date("2026-09-01T12:00:00.000Z"),
          endDate: null,
          role: "BCBA",
          employeeType: "FULL_TIME",
          teamId: team._id,
          color: "#0F766E",
          serviceSetting: "IN_CENTER",
          minimumWeeklyHours: 30,
          targetWeeklyHours: 40,
          maximumWeeklyHours: 45,
          shiftPatterns: [
            {
              name: "Trial BCBA weekday shift",
              days: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
              startTime: "08:00",
              endTime: "18:00",
            },
          ],
          active: true,
        },
        $setOnInsert: {
          locationId: location._id,
          fullName: TRIAL_BCBA_NAME,
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    const client = await Client.findOneAndUpdate(
      {
        locationId: location._id,
        displayCode: TRIAL_CLIENT_CODE,
      },
      {
        $set: {
          fullName: "Carter Green Trial",
          startDate: new Date("2026-09-01T12:00:00.000Z"),
          endDate: null,
          teamId: team._id,
          color,
          serviceSetting: "IN_CENTER",
          supportLevel: "ROTATION",
          maxConsecutiveBlocksWithSameStaff: 6,
          desiredDifferentStaffPerDay: 2,
          insurancePlan: verificationMarker,
          assignedBcbaId: bcba._id,
          assignedInternIds: [],
          attendancePatterns: [
            {
              name: "Trial weekday attendance",
              days: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
              startTime: "08:30",
              endTime: "16:00",
            },
          ],
          napPatterns: [
            {
              name: "Trial nap",
              days: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
              startTime: "12:00",
              endTime: "12:30",
            },
          ],
          staffRelationships: [
            {
              staffId: bt._id,
              relationship: "PREFERRED",
            },
          ],
          active: true,
        },
        $setOnInsert: {
          locationId: location._id,
          displayCode: TRIAL_CLIENT_CODE,
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    const supervision = await SupervisionRecord.findOneAndUpdate(
      {
        locationId: location._id,
        staffId: bt._id,
        month: TRIAL_MONTH,
      },
      {
        $set: {
          supervisorStaffId: bcba._id,
          serviceHours,
          supervisionHours,
          planningTargetPercent: 5,
          note: `Database reflection verification attempt ${attempt} of 5.`,
        },
        $setOnInsert: {
          locationId: location._id,
          staffId: bt._id,
          month: TRIAL_MONTH,
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    const reflectedLocation = (await Location.findById(location._id).lean()) as
      | PlainRecord
      | null;
    const reflectedTeam = (await Team.findById(team._id).lean()) as
      | PlainRecord
      | null;
    const reflectedBt = (await Staff.findById(bt._id).lean()) as
      | PlainRecord
      | null;
    const reflectedClient = (await Client.findById(client._id).lean()) as
      | PlainRecord
      | null;
    const reflectedSupervision = (await SupervisionRecord.findById(
      supervision._id
    ).lean()) as PlainRecord | null;

    const verified = Boolean(
      reflectedLocation &&
        reflectedTeam &&
        reflectedBt &&
        reflectedClient &&
        reflectedSupervision &&
        String(reflectedTeam.color) === color &&
        Number(reflectedBt.targetWeeklyHours) === staffTargetHours &&
        String(reflectedClient.insurancePlan) === verificationMarker &&
        Number(reflectedSupervision.supervisionHours) === supervisionHours
    );

    return NextResponse.json({
      success: true,
      verified,
      attempt,
      totalAttempts: 5,
      isolatedTrialLocation: {
        id: String(location._id),
        name: TRIAL_LOCATION_NAME,
        code: TRIAL_LOCATION_CODE,
      },
      reflected: {
        team: {
          id: String(team._id),
          name: TRIAL_TEAM_NAME,
          color: String(reflectedTeam?.color ?? ""),
        },
        staff: {
          id: String(bt._id),
          name: TRIAL_BT_NAME,
          role: "BT",
          targetWeeklyHours: Number(reflectedBt?.targetWeeklyHours ?? 0),
        },
        bcba: {
          id: String(bcba._id),
          name: TRIAL_BCBA_NAME,
          role: "BCBA",
        },
        client: {
          id: String(client._id),
          displayCode: TRIAL_CLIENT_CODE,
          insurancePlan: String(reflectedClient?.insurancePlan ?? ""),
        },
        supervision: {
          id: String(supervision._id),
          month: TRIAL_MONTH,
          serviceHours: Number(reflectedSupervision?.serviceHours ?? 0),
          supervisionHours: Number(reflectedSupervision?.supervisionHours ?? 0),
          note: String(reflectedSupervision?.note ?? ""),
        },
      },
      message: verified
        ? `Attempt ${attempt} wrote to MongoDB and the values were read back successfully.`
        : `Attempt ${attempt} completed, but the read-back verification did not match the expected values.`,
    });
  } catch (error) {
    console.error("Livingston isolated database verification failed:", error);

    return NextResponse.json(
      {
        success: false,
        verified: false,
        attempt,
        error:
          error instanceof Error
            ? error.message
            : "The isolated Livingston database verification failed.",
      },
      { status: 500 }
    );
  }
}
