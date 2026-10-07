"use client";

import { useEffect, useState } from "react";

type LocationOption = {
  id: string;
  name: string;
};

type RulesForm = {
  scheduleStartTime: string;
  scheduleEndTime: string;
  slotLengthMinutes: number;
  fullTimeMinimumWeeklyHours: number;
  fullTimeMaximumWeeklyHours: number;
  partTimeMinimumWeeklyHours: number;
  partTimeMaximumWeeklyHours: number;
  maximumClientsPerTechPerDay: number;
  maximumTechsPerClientPerDay: number;
  minimumClientStaffAssignmentMinutes: number;
  maximumClientStaffConsecutiveHours: number;
  preventSameStaffClientRepeatSameDay: boolean;
  allowSameStaffClientRepeatForCoverageException: boolean;
  defaultBreakMinutes: number;
  breakEligibilityHours: number;
  breakWindowStart: string;
  breakWindowEnd: string;
  preferSameTeam: boolean;
  preferStaffContinuity: boolean;
  preserveManualOverrides: boolean;
  autoUseWeekdayTemplate: boolean;
  autoUsePreviousWeekdaySchedule: boolean;
  autoUseHistoricalPatterns: boolean;
  napDurationRulesEnabled: boolean;
  napMinimumMinutes: number;
  napPreferredMinutes: number;
  napMaximumMinutes: number;
  speechDurationRulesEnabled: boolean;
  speechMinimumMinutes: number;
  speechPreferredMinutes: number;
  speechMaximumMinutes: number;
  preferredStaffPriority: number;
  sameTeamPriority: number;
  continuityPriority: number;
  rotationPriority: number;
  workloadBalancePriority: number;
  historicalPairingPriority: number;
  historicalSlotPriority: number;
  historicalBreakPriority: number;
  clientHandoffPenaltyPriority: number;
  staffScheduleCompactnessPriority: number;
  minimalFixAllowProtectedRelocation: boolean;
  minimalFixAllowBreakRelocation: boolean;
  scheduleStabilityPriority: number;
  weekdayTemplatePriority: number;
  weeklyHoursPriority: number;
  btCoveragePriority: number;
  internCoveragePriority: number;
  managerCoveragePriority: number;
  bcbaCoveragePriority: number;
  otherCoveragePriority: number;
  supervisionPlanningTargetPercent: number;
};

type NumericRuleField =
  | "slotLengthMinutes"
  | "fullTimeMinimumWeeklyHours"
  | "fullTimeMaximumWeeklyHours"
  | "partTimeMinimumWeeklyHours"
  | "partTimeMaximumWeeklyHours"
  | "maximumClientsPerTechPerDay"
  | "maximumTechsPerClientPerDay"
  | "minimumClientStaffAssignmentMinutes"
  | "maximumClientStaffConsecutiveHours"
  | "defaultBreakMinutes"
  | "breakEligibilityHours"
  | "napMinimumMinutes"
  | "napPreferredMinutes"
  | "napMaximumMinutes"
  | "speechMinimumMinutes"
  | "speechPreferredMinutes"
  | "speechMaximumMinutes"
  | "preferredStaffPriority"
  | "sameTeamPriority"
  | "continuityPriority"
  | "rotationPriority"
  | "workloadBalancePriority"
  | "historicalPairingPriority"
  | "historicalSlotPriority"
  | "historicalBreakPriority"
  | "clientHandoffPenaltyPriority"
  | "staffScheduleCompactnessPriority"
  | "scheduleStabilityPriority"
  | "weekdayTemplatePriority"
  | "weeklyHoursPriority"
  | "btCoveragePriority"
  | "internCoveragePriority"
  | "managerCoveragePriority"
  | "bcbaCoveragePriority"
  | "otherCoveragePriority"
  | "supervisionPlanningTargetPercent";

type LocationsResponse = {
  locations?: LocationOption[];
  error?: string;
};

type RulesResponse = {
  rules?: Partial<RulesForm>;
  error?: string;
};

const DEFAULT_RULES: RulesForm = {
  scheduleStartTime: "08:00",
  scheduleEndTime: "20:00",
  slotLengthMinutes: 30,
  fullTimeMinimumWeeklyHours: 30,
  fullTimeMaximumWeeklyHours: 40,
  partTimeMinimumWeeklyHours: 0,
  partTimeMaximumWeeklyHours: 29,
  maximumClientsPerTechPerDay: 6,
  maximumTechsPerClientPerDay: 4,
  minimumClientStaffAssignmentMinutes: 30,
  maximumClientStaffConsecutiveHours: 4,
  preventSameStaffClientRepeatSameDay: true,
  allowSameStaffClientRepeatForCoverageException: true,
  defaultBreakMinutes: 30,
  breakEligibilityHours: 6,
  breakWindowStart: "11:00",
  breakWindowEnd: "13:30",
  preferSameTeam: true,
  preferStaffContinuity: true,
  preserveManualOverrides: true,
  autoUseWeekdayTemplate: true,
  autoUsePreviousWeekdaySchedule: true,
  autoUseHistoricalPatterns: true,
  napDurationRulesEnabled: true,
  napMinimumMinutes: 30,
  napPreferredMinutes: 30,
  napMaximumMinutes: 60,
  speechDurationRulesEnabled: false,
  speechMinimumMinutes: 30,
  speechPreferredMinutes: 30,
  speechMaximumMinutes: 60,
  preferredStaffPriority: 100,
  sameTeamPriority: 40,
  continuityPriority: 35,
  rotationPriority: 60,
  workloadBalancePriority: 10,
  historicalPairingPriority: 70,
  historicalSlotPriority: 90,
  historicalBreakPriority: 80,
  clientHandoffPenaltyPriority: 25,
  staffScheduleCompactnessPriority: 8,
  minimalFixAllowProtectedRelocation: true,
  minimalFixAllowBreakRelocation: true,
  scheduleStabilityPriority: 140,
  weekdayTemplatePriority: 75,
  weeklyHoursPriority: 12,
  btCoveragePriority: 500,
  internCoveragePriority: 300,
  managerCoveragePriority: 125,
  bcbaCoveragePriority: 25,
  otherCoveragePriority: 75,
  supervisionPlanningTargetPercent: 5,
};

function softPriorityLabel(value: number): string {
  if (value === 0) {
    return "Off";
  }

  if (value <= 25) {
    return "Low";
  }

  if (value <= 60) {
    return "Medium";
  }

  if (value <= 110) {
    return "High";
  }

  return "Very high";
}

function rolePriorityLabel(value: number): string {
  if (value < 100) {
    return "Last resort";
  }

  if (value < 250) {
    return "Relief coverage";
  }

  if (value < 450) {
    return "Secondary coverage";
  }

  return "Primary coverage";
}

export function SchedulingSettings() {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [locationId, setLocationId] = useState("");
  const [rules, setRules] = useState<RulesForm>(DEFAULT_RULES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(
    "Loading clinic scheduling rules..."
  );

  useEffect(() => {
    void loadLocations();
  }, []);

  useEffect(() => {
    if (locationId) {
      void loadRules(locationId);
    }
  }, [locationId]);

  async function loadLocations() {
    try {
      setLoading(true);

      const response = await fetch("/api/locations", {
        cache: "no-store",
      });
      const data = (await response.json()) as LocationsResponse;

      if (!response.ok) {
        throw new Error(
          data.error || "Locations could not be loaded."
        );
      }

      const nextLocations = data.locations ?? [];
      setLocations(nextLocations);

      if (nextLocations.length > 0) {
        setLocationId(nextLocations[0].id);
      } else {
        setMessage("No clinic locations are available yet.");
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Locations could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadRules(requestedLocationId: string) {
    try {
      setLoading(true);
      setMessage("Loading saved rules...");

      const response = await fetch(
        `/api/scheduling-rules?locationId=${encodeURIComponent(
          requestedLocationId
        )}`,
        {
          cache: "no-store",
        }
      );
      const data = (await response.json()) as RulesResponse;

      if (!response.ok || !data.rules) {
        throw new Error(
          data.error || "Scheduling rules could not be loaded."
        );
      }

      setRules({
        ...DEFAULT_RULES,
        ...data.rules,
      });
      setMessage("Saved clinic rules loaded from MongoDB.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Scheduling rules could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }

  function updateNumberField(
    field: NumericRuleField,
    value: string
  ) {
    setRules((currentRules) => ({
      ...currentRules,
      [field]: Number(value),
    }));
  }

  function updateBooleanField(
    field:
      | "preferSameTeam"
      | "preferStaffContinuity"
      | "preserveManualOverrides"
      | "minimalFixAllowProtectedRelocation"
      | "minimalFixAllowBreakRelocation"
      | "preventSameStaffClientRepeatSameDay"
      | "allowSameStaffClientRepeatForCoverageException"
      | "autoUseWeekdayTemplate"
      | "autoUsePreviousWeekdaySchedule"
      | "autoUseHistoricalPatterns"
      | "napDurationRulesEnabled"
      | "speechDurationRulesEnabled",
    value: boolean
  ) {
    setRules((currentRules) => ({
      ...currentRules,
      [field]: value,
    }));
  }

  async function saveRules() {
    if (!locationId) {
      setMessage("Choose a clinic location before saving.");
      return;
    }

    if (rules.scheduleEndTime <= rules.scheduleStartTime) {
      setMessage(
        "Schedule end time must be later than schedule start time."
      );
      return;
    }

    if (rules.breakWindowEnd <= rules.breakWindowStart) {
      setMessage(
        "Break window end must be later than break window start."
      );
      return;
    }

    if (
      rules.fullTimeMaximumWeeklyHours <
        rules.fullTimeMinimumWeeklyHours ||
      rules.partTimeMaximumWeeklyHours <
        rules.partTimeMinimumWeeklyHours
    ) {
      setMessage(
        "Maximum weekly hours cannot be lower than minimum weekly hours."
      );
      return;
    }

    if (rules.slotLengthMinutes !== 30) {
      setMessage(
        "The Excel-style scheduler currently requires 30-minute blocks."
      );
      return;
    }

    if (
      rules.minimumClientStaffAssignmentMinutes < 30 ||
      rules.minimumClientStaffAssignmentMinutes % 30 !== 0
    ) {
      setMessage(
        "Minimum client/staff assignment must be at least 30 minutes and use 30-minute increments."
      );
      return;
    }

    if (
      ![3, 3.5, 4].includes(
        rules.maximumClientStaffConsecutiveHours
      )
    ) {
      setMessage(
        "Maximum continuous client/staff time must be 3, 3.5, or 4 hours."
      );
      return;
    }

    if (
      rules.minimumClientStaffAssignmentMinutes >
      rules.maximumClientStaffConsecutiveHours * 60
    ) {
      setMessage(
        "Minimum client/staff assignment cannot be longer than the maximum continuous pairing time."
      );
      return;
    }

    const flexibleDurationRules = [
      {
        label: "Nap",
        enabled: rules.napDurationRulesEnabled,
        minimum: rules.napMinimumMinutes,
        preferred: rules.napPreferredMinutes,
        maximum: rules.napMaximumMinutes,
      },
      {
        label: "Speech",
        enabled: rules.speechDurationRulesEnabled,
        minimum: rules.speechMinimumMinutes,
        preferred: rules.speechPreferredMinutes,
        maximum: rules.speechMaximumMinutes,
      },
    ];

    for (const durationRule of flexibleDurationRules) {
      if (!durationRule.enabled) {
        continue;
      }

      const values = [
        durationRule.minimum,
        durationRule.preferred,
        durationRule.maximum,
      ];

      if (
        values.some(
          (value) =>
            value < 30 ||
            value > 240 ||
            value % 30 !== 0
        )
      ) {
        setMessage(
          `${durationRule.label} duration values must use 30-minute increments between 30 and 240 minutes.`
        );
        return;
      }

      if (
        durationRule.minimum > durationRule.preferred ||
        durationRule.preferred > durationRule.maximum
      ) {
        setMessage(
          `${durationRule.label} duration must satisfy minimum <= preferred <= maximum.`
        );
        return;
      }
    }

    try {
      setSaving(true);
      setMessage("Saving clinic scheduling rules...");

      const response = await fetch("/api/scheduling-rules", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          locationId,
          ...rules,
        }),
      });
      const data = (await response.json()) as RulesResponse;

      if (!response.ok || !data.rules) {
        throw new Error(
          data.error || "Scheduling rules could not be saved."
        );
      }

      setRules({
        ...DEFAULT_RULES,
        ...data.rules,
      });
      setMessage(
        "Scheduling rules saved. Auto Generate and Repair will use these priorities."
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Scheduling rules could not be saved."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="management-layout">
      <section className="section-card">
        <div className="panel-heading-row">
          <div>
            <h2>Location</h2>
            <p>
              Livingston and Parsippany use separate scheduling rules while
              sharing the same scheduler application.
            </p>
          </div>

          <label className="form-field compact-field">
            <span>Clinic location</span>
            <select
              value={locationId}
              disabled={loading || saving}
              onChange={(event) =>
                setLocationId(event.target.value)
              }
            >
              {locations.map((location) => (
                <option
                  key={location.id}
                  value={location.id}
                >
                  {location.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="section-card">
        <h2>Calendar Rules</h2>
        <p>
          The scheduler uses these boundaries for the Excel-style daily grid.
        </p>

        <div className="form-grid">
          <label className="form-field">
            <span>Schedule starts</span>
            <input
              type="time"
              value={rules.scheduleStartTime}
              onChange={(event) =>
                setRules((currentRules) => ({
                  ...currentRules,
                  scheduleStartTime: event.target.value,
                }))
              }
            />
          </label>

          <label className="form-field">
            <span>Schedule ends</span>
            <input
              type="time"
              value={rules.scheduleEndTime}
              onChange={(event) =>
                setRules((currentRules) => ({
                  ...currentRules,
                  scheduleEndTime: event.target.value,
                }))
              }
            />
          </label>

          <label className="form-field">
            <span>Minutes per block</span>
            <input
              type="number"
              min="30"
              max="30"
              step="30"
              value={rules.slotLengthMinutes}
              onChange={(event) =>
                updateNumberField(
                  "slotLengthMinutes",
                  event.target.value
                )
              }
            />
          </label>
        </div>
      </section>

      <section className="section-card">
        <h2>Staff Hour Planning</h2>
        <p>
          The scheduler checks weekly service hours already assigned before the
          selected date. It prefers staff who still need hours and prevents
          automatic assignments beyond the configured maximum.
        </p>

        <div className="form-grid">
          <label className="form-field">
            <span>Full-time minimum weekly hours</span>
            <input
              type="number"
              min="0"
              step="0.5"
              value={rules.fullTimeMinimumWeeklyHours}
              onChange={(event) =>
                updateNumberField(
                  "fullTimeMinimumWeeklyHours",
                  event.target.value
                )
              }
            />
          </label>

          <label className="form-field">
            <span>Full-time maximum weekly hours</span>
            <input
              type="number"
              min="0"
              step="0.5"
              value={rules.fullTimeMaximumWeeklyHours}
              onChange={(event) =>
                updateNumberField(
                  "fullTimeMaximumWeeklyHours",
                  event.target.value
                )
              }
            />
          </label>

          <label className="form-field">
            <span>Part-time minimum weekly hours</span>
            <input
              type="number"
              min="0"
              step="0.5"
              value={rules.partTimeMinimumWeeklyHours}
              onChange={(event) =>
                updateNumberField(
                  "partTimeMinimumWeeklyHours",
                  event.target.value
                )
              }
            />
          </label>

          <label className="form-field">
            <span>Part-time maximum weekly hours</span>
            <input
              type="number"
              min="0"
              step="0.5"
              value={rules.partTimeMaximumWeeklyHours}
              onChange={(event) =>
                updateNumberField(
                  "partTimeMaximumWeeklyHours",
                  event.target.value
                )
              }
            />
          </label>

          <label className="form-field">
            <span>Weekly hour target priority</span>
            <input
              type="number"
              min="0"
              max="200"
              step="1"
              value={rules.weeklyHoursPriority}
              onChange={(event) =>
                updateNumberField(
                  "weeklyHoursPriority",
                  event.target.value
                )
              }
            />
            <small>
              {softPriorityLabel(rules.weeklyHoursPriority)}
            </small>
          </label>
        </div>
      </section>

      <section className="section-card">
        <h2>Break Planning</h2>
        <p>
          Breaks are planned inside this window only when the remaining staff can
          still cover client demand. The scheduler can also represent Break/Nap
          and Break/Speech when the staff member remains responsible for the
          client during that fixed event.
        </p>

        <div className="form-grid">
          <label className="form-field">
            <span>Default break minutes</span>
            <select
              value={rules.defaultBreakMinutes}
              onChange={(event) =>
                updateNumberField(
                  "defaultBreakMinutes",
                  event.target.value
                )
              }
            >
              <option value={0}>No automatic break</option>
              <option value={30}>30 minutes</option>
            </select>
          </label>

          <label className="form-field">
            <span>Break required after shift hours</span>
            <input
              type="number"
              min="0"
              max="24"
              step="0.5"
              value={rules.breakEligibilityHours}
              onChange={(event) =>
                updateNumberField(
                  "breakEligibilityHours",
                  event.target.value
                )
              }
            />
          </label>

          <label className="form-field">
            <span>Break window starts</span>
            <input
              type="time"
              value={rules.breakWindowStart}
              onChange={(event) =>
                setRules((currentRules) => ({
                  ...currentRules,
                  breakWindowStart: event.target.value,
                }))
              }
            />
          </label>

          <label className="form-field">
            <span>Break window ends</span>
            <input
              type="time"
              value={rules.breakWindowEnd}
              onChange={(event) =>
                setRules((currentRules) => ({
                  ...currentRules,
                  breakWindowEnd: event.target.value,
                }))
              }
            />
          </label>
        </div>
      </section>

      <section className="section-card">
        <h2>Coverage Role Order</h2>
        <p>
          Higher values are chosen first. The default clinic order is BT/RBT,
          then Intern, then Office Manager for relief coverage, with BCBA used as
          the final coverage tier when lower tiers cannot cover the client.
        </p>

        <div className="form-grid">
          <label className="form-field">
            <span>BT / RBT priority</span>
            <input
              type="number"
              min="0"
              max="1000"
              step="25"
              value={rules.btCoveragePriority}
              onChange={(event) =>
                updateNumberField(
                  "btCoveragePriority",
                  event.target.value
                )
              }
            />
            <small>
              {rolePriorityLabel(rules.btCoveragePriority)}
            </small>
          </label>

          <label className="form-field">
            <span>Intern priority</span>
            <input
              type="number"
              min="0"
              max="1000"
              step="25"
              value={rules.internCoveragePriority}
              onChange={(event) =>
                updateNumberField(
                  "internCoveragePriority",
                  event.target.value
                )
              }
            />
            <small>
              {rolePriorityLabel(rules.internCoveragePriority)}
            </small>
          </label>

          <label className="form-field">
            <span>Office Manager priority</span>
            <input
              type="number"
              min="0"
              max="1000"
              step="25"
              value={rules.managerCoveragePriority}
              onChange={(event) =>
                updateNumberField(
                  "managerCoveragePriority",
                  event.target.value
                )
              }
            />
            <small>
              {rolePriorityLabel(rules.managerCoveragePriority)}
            </small>
          </label>

          <label className="form-field">
            <span>BCBA priority</span>
            <input
              type="number"
              min="0"
              max="1000"
              step="25"
              value={rules.bcbaCoveragePriority}
              onChange={(event) =>
                updateNumberField(
                  "bcbaCoveragePriority",
                  event.target.value
                )
              }
            />
            <small>
              {rolePriorityLabel(rules.bcbaCoveragePriority)}
            </small>
          </label>

          <label className="form-field">
            <span>Other role priority</span>
            <input
              type="number"
              min="0"
              max="1000"
              step="25"
              value={rules.otherCoveragePriority}
              onChange={(event) =>
                updateNumberField(
                  "otherCoveragePriority",
                  event.target.value
                )
              }
            />
            <small>
              {rolePriorityLabel(rules.otherCoveragePriority)}
            </small>
          </label>
        </div>
      </section>

      <section className="section-card">
        <h2>Excel Pattern Guidance</h2>
        <p>
          These settings help Auto Generate resemble the clinic&apos;s established
          spreadsheet patterns without treating an old schedule as an unchangeable
          rule. Current attendance, shifts, call-outs, speech, nap, hard pairing
          restrictions, and manual overrides still take priority.
        </p>

        <div className="toggle-list">
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={rules.autoUseWeekdayTemplate}
              onChange={(event) =>
                updateBooleanField(
                  "autoUseWeekdayTemplate",
                  event.target.checked
                )
              }
            />
            <span>
              Use the saved template for the selected weekday as a scheduling
              preference.
            </span>
          </label>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={rules.autoUsePreviousWeekdaySchedule}
              onChange={(event) =>
                updateBooleanField(
                  "autoUsePreviousWeekdaySchedule",
                  event.target.checked
                )
              }
            />
            <span>
              Use the most recent schedule from the same weekday as a second
              reference pattern.
            </span>
          </label>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={rules.autoUseHistoricalPatterns}
              onChange={(event) =>
                updateBooleanField(
                  "autoUseHistoricalPatterns",
                  event.target.checked
                )
              }
            />
            <span>
              Learn from imported historical schedule patterns when matching
              staff/client pairings, exact time slots, and break timing.
            </span>
          </label>
        </div>

        <div className="form-grid">
          <label className="form-field">
            <span>Weekday template priority</span>
            <input
              type="number"
              min="0"
              max="200"
              step="5"
              value={rules.weekdayTemplatePriority}
              onChange={(event) =>
                updateNumberField(
                  "weekdayTemplatePriority",
                  event.target.value
                )
              }
            />
            <small>
              {softPriorityLabel(rules.weekdayTemplatePriority)}
            </small>
          </label>

          <label className="form-field">
            <span>Current schedule stability priority</span>
            <input
              type="number"
              min="0"
              max="200"
              step="5"
              value={rules.scheduleStabilityPriority}
              onChange={(event) =>
                updateNumberField(
                  "scheduleStabilityPriority",
                  event.target.value
                )
              }
            />
            <small>
              {softPriorityLabel(rules.scheduleStabilityPriority)}
            </small>
          </label>

          <label className="form-field">
            <span>Historical pairing priority</span>
            <input
              type="number"
              min="0"
              max="200"
              step="5"
              value={rules.historicalPairingPriority}
              onChange={(event) =>
                updateNumberField(
                  "historicalPairingPriority",
                  event.target.value
                )
              }
            />
            <small>
              {softPriorityLabel(rules.historicalPairingPriority)}. Rewards
              staff/client pairings that repeatedly worked in imported history.
            </small>
          </label>

          <label className="form-field">
            <span>Historical exact-slot priority</span>
            <input
              type="number"
              min="0"
              max="200"
              step="5"
              value={rules.historicalSlotPriority}
              onChange={(event) =>
                updateNumberField(
                  "historicalSlotPriority",
                  event.target.value
                )
              }
            />
            <small>
              {softPriorityLabel(rules.historicalSlotPriority)}. Rewards a
              pairing when it historically appeared at the same time of day.
            </small>
          </label>

          <label className="form-field">
            <span>Historical break priority</span>
            <input
              type="number"
              min="0"
              max="200"
              step="5"
              value={rules.historicalBreakPriority}
              onChange={(event) =>
                updateNumberField(
                  "historicalBreakPriority",
                  event.target.value
                )
              }
            />
            <small>
              {softPriorityLabel(rules.historicalBreakPriority)}. Guides break
              timing toward repeated safe historical break slots.
            </small>
          </label>
        </div>
      </section>

      <section className="section-card">
        <h2>Client Matching Priorities</h2>
        <p>
          These are soft priorities. Hard restrictions and actual availability
          always win over the scores below.
        </p>

        <div className="form-grid">
          <label className="form-field">
            <span>Preferred staff priority</span>
            <input
              type="number"
              min="0"
              max="200"
              step="5"
              value={rules.preferredStaffPriority}
              onChange={(event) =>
                updateNumberField(
                  "preferredStaffPriority",
                  event.target.value
                )
              }
            />
            <small>
              {softPriorityLabel(rules.preferredStaffPriority)}
            </small>
          </label>

          <label className="form-field">
            <span>Same team priority</span>
            <input
              type="number"
              min="0"
              max="200"
              step="5"
              value={rules.sameTeamPriority}
              onChange={(event) =>
                updateNumberField(
                  "sameTeamPriority",
                  event.target.value
                )
              }
            />
            <small>
              {softPriorityLabel(rules.sameTeamPriority)}
            </small>
          </label>

          <label className="form-field">
            <span>Continuity priority</span>
            <input
              type="number"
              min="0"
              max="200"
              step="5"
              value={rules.continuityPriority}
              onChange={(event) =>
                updateNumberField(
                  "continuityPriority",
                  event.target.value
                )
              }
            />
            <small>
              {softPriorityLabel(rules.continuityPriority)}
            </small>
          </label>

          <label className="form-field">
            <span>Rotation / higher-support priority</span>
            <input
              type="number"
              min="0"
              max="200"
              step="5"
              value={rules.rotationPriority}
              onChange={(event) =>
                updateNumberField(
                  "rotationPriority",
                  event.target.value
                )
              }
            />
            <small>
              {softPriorityLabel(rules.rotationPriority)}
            </small>
          </label>

          <label className="form-field">
            <span>Workload balance priority</span>
            <input
              type="number"
              min="0"
              max="200"
              step="5"
              value={rules.workloadBalancePriority}
              onChange={(event) =>
                updateNumberField(
                  "workloadBalancePriority",
                  event.target.value
                )
              }
            />
            <small>
              {softPriorityLabel(rules.workloadBalancePriority)}
            </small>
          </label>

          <label className="form-field">
            <span>Reduce client handoffs priority</span>
            <input
              type="number"
              min="0"
              max="200"
              step="5"
              value={rules.clientHandoffPenaltyPriority}
              onChange={(event) =>
                updateNumberField(
                  "clientHandoffPenaltyPriority",
                  event.target.value
                )
              }
            />
            <small>
              {softPriorityLabel(rules.clientHandoffPenaltyPriority)}. Higher
              values discourage unnecessary staff changes between neighboring
              client blocks without overriding rotation or hard rules.
            </small>
          </label>

          <label className="form-field">
            <span>Compact staff schedule priority</span>
            <input
              type="number"
              min="0"
              max="200"
              step="5"
              value={rules.staffScheduleCompactnessPriority}
              onChange={(event) =>
                updateNumberField(
                  "staffScheduleCompactnessPriority",
                  event.target.value
                )
              }
            />
            <small>
              {softPriorityLabel(rules.staffScheduleCompactnessPriority)}. Higher
              values prefer assignments next to a staff member's existing work
              and reduce avoidable isolated gaps.
            </small>
          </label>
        </div>

        <div className="toggle-list">
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={rules.preferSameTeam}
              onChange={(event) =>
                updateBooleanField(
                  "preferSameTeam",
                  event.target.checked
                )
              }
            />
            <span>
              Prefer a same-team staff/client match when coverage allows it.
            </span>
          </label>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={rules.preferStaffContinuity}
              onChange={(event) =>
                updateBooleanField(
                  "preferStaffContinuity",
                  event.target.checked
                )
              }
            />
            <span>
              Keep standard clients with the same staff across neighboring blocks
              when possible.
            </span>
          </label>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={rules.preserveManualOverrides}
              onChange={(event) =>
                updateBooleanField(
                  "preserveManualOverrides",
                  event.target.checked
                )
              }
            />
            <span>
              Preserve manager-approved manual assignments during Generate and
              Repair.
            </span>
          </label>
        </div>
      </section>

      <section className="section-card">
        <h2>Flexible Nap & Speech Duration Rules</h2>
        <p>
          The client event start/end time is the allowed placement window. When a
          duration rule is enabled, Auto Generate chooses the actual event blocks
          inside that window instead of treating the entire window as the event.
          It prefers the configured duration, stays between the minimum and
          maximum, and spreads overlapping windows when possible so staff breaks
          can be placed more cleanly.
        </p>

        <div className="toggle-list">
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={rules.napDurationRulesEnabled}
              onChange={(event) =>
                updateBooleanField(
                  "napDurationRulesEnabled",
                  event.target.checked
                )
              }
            />
            <span>
              Use flexible nap duration rules. Recommended for nap windows such
              as 12:00-1:00 when the actual nap is usually one 30-minute block.
            </span>
          </label>
        </div>

        <div className="form-grid">
          <label className="form-field">
            <span>Nap minimum duration</span>
            <input
              type="number"
              min="30"
              max="240"
              step="30"
              disabled={!rules.napDurationRulesEnabled}
              value={rules.napMinimumMinutes}
              onChange={(event) =>
                updateNumberField("napMinimumMinutes", event.target.value)
              }
            />
          </label>
          <label className="form-field">
            <span>Nap preferred duration</span>
            <input
              type="number"
              min="30"
              max="240"
              step="30"
              disabled={!rules.napDurationRulesEnabled}
              value={rules.napPreferredMinutes}
              onChange={(event) =>
                updateNumberField("napPreferredMinutes", event.target.value)
              }
            />
          </label>
          <label className="form-field">
            <span>Nap maximum duration</span>
            <input
              type="number"
              min="30"
              max="240"
              step="30"
              disabled={!rules.napDurationRulesEnabled}
              value={rules.napMaximumMinutes}
              onChange={(event) =>
                updateNumberField("napMaximumMinutes", event.target.value)
              }
            />
          </label>
        </div>

        <div className="toggle-list">
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={rules.speechDurationRulesEnabled}
              onChange={(event) =>
                updateBooleanField(
                  "speechDurationRulesEnabled",
                  event.target.checked
                )
              }
            />
            <span>
              Use flexible Speech duration rules. Leave this off when Speech
              start/end times are exact fixed appointments.
            </span>
          </label>
        </div>

        <div className="form-grid">
          <label className="form-field">
            <span>Speech minimum duration</span>
            <input
              type="number"
              min="30"
              max="240"
              step="30"
              disabled={!rules.speechDurationRulesEnabled}
              value={rules.speechMinimumMinutes}
              onChange={(event) =>
                updateNumberField("speechMinimumMinutes", event.target.value)
              }
            />
          </label>
          <label className="form-field">
            <span>Speech preferred duration</span>
            <input
              type="number"
              min="30"
              max="240"
              step="30"
              disabled={!rules.speechDurationRulesEnabled}
              value={rules.speechPreferredMinutes}
              onChange={(event) =>
                updateNumberField("speechPreferredMinutes", event.target.value)
              }
            />
          </label>
          <label className="form-field">
            <span>Speech maximum duration</span>
            <input
              type="number"
              min="30"
              max="240"
              step="30"
              disabled={!rules.speechDurationRulesEnabled}
              value={rules.speechMaximumMinutes}
              onChange={(event) =>
                updateNumberField("speechMaximumMinutes", event.target.value)
              }
            />
          </label>
        </div>
      </section>

      <section className="section-card">
        <h2>Automatic Scheduling Limits</h2>
        <p>
          These limits control client/staff rotation. Each automatic pairing must
          last at least the configured minimum, cannot run longer than the
          configured maximum, and can be prevented from restarting later in the
          same day after a gap. Client-specific rotation limits can still be
          stricter than these clinic-wide limits.
        </p>

        <div className="form-grid">
          <label className="form-field">
            <span>Minimum client/staff assignment</span>
            <select
              value={rules.minimumClientStaffAssignmentMinutes}
              onChange={(event) =>
                updateNumberField(
                  "minimumClientStaffAssignmentMinutes",
                  event.target.value
                )
              }
            >
              <option value={30}>30 minutes</option>
              <option value={60}>1 hour</option>
              <option value={90}>1.5 hours</option>
              <option value={120}>2 hours</option>
            </select>
            <small>
              Automatic assignments will not start a new pairing unless this
              minimum continuous duration can be scheduled.
            </small>
          </label>

          <label className="form-field">
            <span>Maximum continuous client/staff time</span>
            <select
              value={rules.maximumClientStaffConsecutiveHours}
              onChange={(event) =>
                updateNumberField(
                  "maximumClientStaffConsecutiveHours",
                  event.target.value
                )
              }
            >
              <option value={3}>3 hours</option>
              <option value={3.5}>3.5 hours</option>
              <option value={4}>4 hours</option>
            </select>
            <small>
              The automatic scheduler rotates to another eligible staff member
              when this continuous limit is reached.
            </small>
          </label>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={rules.preventSameStaffClientRepeatSameDay}
              onChange={(event) =>
                updateBooleanField(
                  "preventSameStaffClientRepeatSameDay",
                  event.target.checked
                )
              }
            />
            <span>
              Do not pair the same client and staff member again later that day
              after their continuous block has ended. Manual manager changes can
              still handle approved special cases.
            </span>
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={rules.allowSameStaffClientRepeatForCoverageException}
              onChange={(event) =>
                updateBooleanField(
                  "allowSameStaffClientRepeatForCoverageException",
                  event.target.checked
                )
              }
            />
            <span>
              Allow a same-day staff/client repeat only after the scheduler has
              completed its normal pass using different eligible pairings and
              non-repeat swaps. If a client is still uncovered and the practical
              remaining staff option is someone who already had that client,
              the scheduler may reuse the pair as a last-resort exception. The
              continuous 3-4 hour maximum still applies and the exception is
              reported as a warning.
            </span>
          </label>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={rules.minimalFixAllowProtectedRelocation}
              onChange={(event) =>
                updateBooleanField(
                  "minimalFixAllowProtectedRelocation",
                  event.target.checked
                )
              }
            />
            <span>
              Minimal Fix may relocate manager/manual client blocks when that is
              the smallest change needed to restore coverage. Turn this off when
              manual placements must remain protected.
            </span>
          </label>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={rules.minimalFixAllowBreakRelocation}
              onChange={(event) =>
                updateBooleanField(
                  "minimalFixAllowBreakRelocation",
                  event.target.checked
                )
              }
            />
            <span>
              Minimal Fix may temporarily move a break to cover a client, then
              recalculate a valid break afterward. Turn this off to keep existing
              breaks fixed during automatic repair.
            </span>
          </label>

          <label className="form-field">
            <span>Max clients per technician per day</span>
            <input
              type="number"
              min="1"
              value={rules.maximumClientsPerTechPerDay}
              onChange={(event) =>
                updateNumberField(
                  "maximumClientsPerTechPerDay",
                  event.target.value
                )
              }
            />
          </label>

          <label className="form-field">
            <span>Max technicians per client per day</span>
            <input
              type="number"
              min="1"
              value={rules.maximumTechsPerClientPerDay}
              onChange={(event) =>
                updateNumberField(
                  "maximumTechsPerClientPerDay",
                  event.target.value
                )
              }
            />
          </label>

          <label className="form-field">
            <span>Supervision planning target (%)</span>
            <input
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={rules.supervisionPlanningTargetPercent}
              onChange={(event) =>
                updateNumberField(
                  "supervisionPlanningTargetPercent",
                  event.target.value
                )
              }
            />
          </label>
        </div>

        <button
          type="button"
          className="button button-primary"
          disabled={loading || saving || !locationId}
          onClick={() => void saveRules()}
        >
          {saving ? "Saving..." : "Save Scheduling Rules"}
        </button>

        <div className="inline-message">
          {message}
        </div>
      </section>
    </div>
  );
}
