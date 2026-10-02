export const LIVINGSTON_TRIAL_DATASET_KEY =
  "livingston-workbook-trial-2026-10-05";

export const LIVINGSTON_TRIAL_START_DATE = "2026-10-05";
export const LIVINGSTON_TRIAL_END_DATE = "2026-10-08";

export const LIVINGSTON_TRIAL_DATES = {
  monday: "2026-10-05",
  tuesday: "2026-10-06",
  wednesday: "2026-10-07",
  copyDay: "2026-10-08",
} as const;

export const LIVINGSTON_TRIAL_TEAMS = [
  {
    key: "ocean",
    name: "TRIAL Ocean Team",
    color: "#BFE7F2",
  },
  {
    key: "coral",
    name: "TRIAL Coral Team",
    color: "#F6CEC7",
  },
  {
    key: "navy",
    name: "TRIAL Navy Team",
    color: "#D4DDED",
  },
] as const;

export type TrialStaffRole =
  | "BT"
  | "RBT"
  | "INTERN"
  | "OFFICE_MANAGER"
  | "BCBA";

export type TrialStaffConfig = {
  name: string;
  role: TrialStaffRole;
  employeeType: "FULL_TIME" | "PART_TIME";
  teamKey: "ocean" | "coral" | "navy";
  color: string;
  minimumWeeklyHours: number;
  targetWeeklyHours: number;
  maximumWeeklyHours: number;
  shifts: Array<{
    name: string;
    days: string[];
    startTime: string;
    endTime: string;
  }>;
};

export const LIVINGSTON_TRIAL_STAFF: TrialStaffConfig[] = [
  {
    name: "Areyana",
    role: "RBT",
    employeeType: "FULL_TIME",
    teamKey: "ocean",
    color: "#9DE7E7",
    minimumWeeklyHours: 30,
    targetWeeklyHours: 38,
    maximumWeeklyHours: 40,
    shifts: [
      {
        name: "Mon-Wed",
        days: ["MONDAY", "TUESDAY", "WEDNESDAY"],
        startTime: "08:00",
        endTime: "17:00",
      },
    ],
  },
  {
    name: "Anias",
    role: "BT",
    employeeType: "FULL_TIME",
    teamKey: "coral",
    color: "#EFB2B4",
    minimumWeeklyHours: 30,
    targetWeeklyHours: 36,
    maximumWeeklyHours: 40,
    shifts: [
      {
        name: "Mon-Wed",
        days: ["MONDAY", "TUESDAY", "WEDNESDAY"],
        startTime: "08:00",
        endTime: "16:30",
      },
    ],
  },
  {
    name: "Ariana",
    role: "BT",
    employeeType: "PART_TIME",
    teamKey: "ocean",
    color: "#C7EEEE",
    minimumWeeklyHours: 0,
    targetWeeklyHours: 18,
    maximumWeeklyHours: 24,
    shifts: [
      {
        name: "Tue-Wed",
        days: ["TUESDAY", "WEDNESDAY"],
        startTime: "08:00",
        endTime: "14:00",
      },
    ],
  },
  {
    name: "Danna",
    role: "BT",
    employeeType: "FULL_TIME",
    teamKey: "coral",
    color: "#E9C188",
    minimumWeeklyHours: 30,
    targetWeeklyHours: 38,
    maximumWeeklyHours: 40,
    shifts: [
      {
        name: "Mon-Wed",
        days: ["MONDAY", "TUESDAY", "WEDNESDAY"],
        startTime: "08:00",
        endTime: "17:00",
      },
    ],
  },
  {
    name: "Devonyah",
    role: "RBT",
    employeeType: "FULL_TIME",
    teamKey: "navy",
    color: "#9FC4CC",
    minimumWeeklyHours: 30,
    targetWeeklyHours: 38,
    maximumWeeklyHours: 40,
    shifts: [
      {
        name: "Mon-Wed",
        days: ["MONDAY", "TUESDAY", "WEDNESDAY"],
        startTime: "08:00",
        endTime: "17:00",
      },
    ],
  },
  {
    name: "Juwell",
    role: "BT",
    employeeType: "FULL_TIME",
    teamKey: "navy",
    color: "#F3B2EA",
    minimumWeeklyHours: 30,
    targetWeeklyHours: 36,
    maximumWeeklyHours: 40,
    shifts: [
      {
        name: "Mon-Tue",
        days: ["MONDAY", "TUESDAY"],
        startTime: "08:00",
        endTime: "17:00",
      },
      {
        name: "Wednesday shorter",
        days: ["WEDNESDAY"],
        startTime: "08:00",
        endTime: "16:00",
      },
    ],
  },
  {
    name: "Keila",
    role: "RBT",
    employeeType: "FULL_TIME",
    teamKey: "ocean",
    color: "#B3D7F5",
    minimumWeeklyHours: 30,
    targetWeeklyHours: 36,
    maximumWeeklyHours: 40,
    shifts: [
      {
        name: "Monday shorter",
        days: ["MONDAY"],
        startTime: "08:00",
        endTime: "16:00",
      },
      {
        name: "Tue-Wed",
        days: ["TUESDAY", "WEDNESDAY"],
        startTime: "08:00",
        endTime: "17:00",
      },
    ],
  },
  {
    name: "Lamya",
    role: "BT",
    employeeType: "FULL_TIME",
    teamKey: "coral",
    color: "#F8D9A9",
    minimumWeeklyHours: 30,
    targetWeeklyHours: 38,
    maximumWeeklyHours: 40,
    shifts: [
      {
        name: "Mon-Wed",
        days: ["MONDAY", "TUESDAY", "WEDNESDAY"],
        startTime: "08:00",
        endTime: "17:00",
      },
    ],
  },
  {
    name: "Jalani",
    role: "RBT",
    employeeType: "FULL_TIME",
    teamKey: "navy",
    color: "#C8D5F5",
    minimumWeeklyHours: 30,
    targetWeeklyHours: 38,
    maximumWeeklyHours: 40,
    shifts: [
      {
        name: "Mon-Wed",
        days: ["MONDAY", "TUESDAY", "WEDNESDAY"],
        startTime: "08:00",
        endTime: "17:00",
      },
    ],
  },
  {
    name: "Marisol",
    role: "RBT",
    employeeType: "FULL_TIME",
    teamKey: "coral",
    color: "#F4C6A5",
    minimumWeeklyHours: 30,
    targetWeeklyHours: 38,
    maximumWeeklyHours: 40,
    shifts: [
      {
        name: "Mon-Wed",
        days: ["MONDAY", "TUESDAY", "WEDNESDAY"],
        startTime: "08:00",
        endTime: "17:00",
      },
    ],
  },
  {
    name: "Siobhan",
    role: "RBT",
    employeeType: "FULL_TIME",
    teamKey: "ocean",
    color: "#B6E1D4",
    minimumWeeklyHours: 30,
    targetWeeklyHours: 38,
    maximumWeeklyHours: 40,
    shifts: [
      {
        name: "Mon-Wed",
        days: ["MONDAY", "TUESDAY", "WEDNESDAY"],
        startTime: "08:00",
        endTime: "17:00",
      },
    ],
  },
  {
    name: "Bella (wil)",
    role: "INTERN",
    employeeType: "PART_TIME",
    teamKey: "navy",
    color: "#E0D7F7",
    minimumWeeklyHours: 0,
    targetWeeklyHours: 20,
    maximumWeeklyHours: 25,
    shifts: [
      {
        name: "Mon-Wed",
        days: ["MONDAY", "TUESDAY", "WEDNESDAY"],
        startTime: "10:00",
        endTime: "18:00",
      },
    ],
  },
  {
    name: "Latoya",
    role: "OFFICE_MANAGER",
    employeeType: "FULL_TIME",
    teamKey: "coral",
    color: "#D4E7F6",
    minimumWeeklyHours: 30,
    targetWeeklyHours: 40,
    maximumWeeklyHours: 40,
    shifts: [
      {
        name: "Mon-Wed",
        days: ["MONDAY", "TUESDAY", "WEDNESDAY"],
        startTime: "08:00",
        endTime: "18:00",
      },
    ],
  },
  {
    name: "Stephanie",
    role: "BCBA",
    employeeType: "FULL_TIME",
    teamKey: "ocean",
    color: "#D8E5FA",
    minimumWeeklyHours: 30,
    targetWeeklyHours: 40,
    maximumWeeklyHours: 40,
    shifts: [
      {
        name: "Mon-Wed",
        days: ["MONDAY", "TUESDAY", "WEDNESDAY"],
        startTime: "09:00",
        endTime: "17:00",
      },
    ],
  },
];

export type TrialClientConfig = {
  code: string;
  fullName: string;
  teamKey: "ocean" | "coral" | "navy";
  color: string;
  supportLevel: "STANDARD" | "ONE_TO_ONE" | "ROTATION" | "HIGH_SUPPORT";
  maxConsecutiveBlocksWithSameStaff?: number;
  desiredDifferentStaffPerDay?: number;
  startTime: string;
  endTime: string;
  nap?: {
    startTime: string;
    endTime: string;
  };
  preferredStaff: string[];
};

export const LIVINGSTON_TRIAL_CLIENTS: TrialClientConfig[] = [
  {
    code: "MiSm",
    fullName: "Trial Client MiSm",
    teamKey: "ocean",
    color: "#AEE7F2",
    supportLevel: "ONE_TO_ONE",
    startTime: "08:00",
    endTime: "16:00",
    nap: { startTime: "12:30", endTime: "13:30" },
    preferredStaff: ["Keila", "Jalani"],
  },
  {
    code: "CaGr",
    fullName: "Trial Client CaGr",
    teamKey: "ocean",
    color: "#D49A9D",
    supportLevel: "HIGH_SUPPORT",
    maxConsecutiveBlocksWithSameStaff: 3,
    desiredDifferentStaffPerDay: 4,
    startTime: "09:00",
    endTime: "17:00",
    preferredStaff: ["Areyana", "Danna"],
  },
  {
    code: "ZiBo",
    fullName: "Trial Client ZiBo",
    teamKey: "navy",
    color: "#75DDE5",
    supportLevel: "ROTATION",
    maxConsecutiveBlocksWithSameStaff: 4,
    desiredDifferentStaffPerDay: 3,
    startTime: "08:00",
    endTime: "16:00",
    preferredStaff: ["Devonyah", "Juwell"],
  },
  {
    code: "MaHa",
    fullName: "Trial Client MaHa",
    teamKey: "coral",
    color: "#EEC16C",
    supportLevel: "ONE_TO_ONE",
    startTime: "08:00",
    endTime: "15:00",
    preferredStaff: ["Lamya", "Areyana"],
  },
  {
    code: "IsMo",
    fullName: "Trial Client IsMo",
    teamKey: "navy",
    color: "#F3B26D",
    supportLevel: "ONE_TO_ONE",
    startTime: "09:00",
    endTime: "17:00",
    preferredStaff: ["Jalani", "Juwell"],
  },
  {
    code: "JeMa",
    fullName: "Trial Client JeMa",
    teamKey: "navy",
    color: "#C4B8E7",
    supportLevel: "ROTATION",
    maxConsecutiveBlocksWithSameStaff: 4,
    desiredDifferentStaffPerDay: 3,
    startTime: "10:00",
    endTime: "18:00",
    preferredStaff: ["Jalani", "Devonyah", "Anias"],
  },
  {
    code: "CaMe",
    fullName: "Trial Client CaMe",
    teamKey: "coral",
    color: "#93E38A",
    supportLevel: "STANDARD",
    startTime: "08:00",
    endTime: "14:00",
    preferredStaff: ["Anias", "Devonyah"],
  },
  {
    code: "ReMa",
    fullName: "Trial Client ReMa",
    teamKey: "navy",
    color: "#D3C6F1",
    supportLevel: "ONE_TO_ONE",
    startTime: "12:00",
    endTime: "18:00",
    nap: { startTime: "13:00", endTime: "13:30" },
    preferredStaff: ["Bella (wil)", "Juwell"],
  },
  {
    code: "AmAb",
    fullName: "Trial Client AmAb",
    teamKey: "ocean",
    color: "#FFE4A6",
    supportLevel: "ONE_TO_ONE",
    startTime: "08:30",
    endTime: "16:00",
    nap: { startTime: "12:00", endTime: "12:30" },
    preferredStaff: ["Siobhan"],
  },
  {
    code: "StAb",
    fullName: "Trial Client StAb",
    teamKey: "coral",
    color: "#F0B78B",
    supportLevel: "ONE_TO_ONE",
    startTime: "12:30",
    endTime: "17:00",
    preferredStaff: ["Marisol"],
  },
  {
    code: "EyNa",
    fullName: "Trial Client EyNa",
    teamKey: "coral",
    color: "#E79B9F",
    supportLevel: "STANDARD",
    startTime: "09:00",
    endTime: "15:00",
    preferredStaff: ["Lamya", "Latoya"],
  },
  {
    code: "JiMa",
    fullName: "Trial Client JiMa",
    teamKey: "ocean",
    color: "#C7DDF6",
    supportLevel: "STANDARD",
    startTime: "08:00",
    endTime: "13:00",
    preferredStaff: ["Keila", "Anias"],
  },
];

export const LIVINGSTON_TRIAL_SPEECH = [
  {
    clientCode: "CaGr",
    date: LIVINGSTON_TRIAL_DATES.tuesday,
    startTime: "11:00",
    endTime: "11:30",
    note: "TRIAL speech block from Livingston sample scenario",
  },
  {
    clientCode: "ZiBo",
    date: LIVINGSTON_TRIAL_DATES.wednesday,
    startTime: "14:00",
    endTime: "14:30",
    note: "TRIAL speech block from Livingston sample scenario",
  },
] as const;
