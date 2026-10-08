"use client";

import { useEffect, useState } from "react";

import { EditableNumberInput } from "@/components/EditableNumberInput";

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
  breakSchedulingEnabled: boolean;
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
  maximumClientsPerTechPerDay: 3,
  maximumTechsPerClientPerDay: 3,
  minimumClientStaffAssignmentMinutes: 30,
  maximumClientStaffConsecutiveHours: 4,
  preventSameStaffClientRepeatSameDay: true,
  allowSameStaffClientRepeatForCoverageException: true,
  breakSchedulingEnabled: true,
  defaultBreakMinutes: 30,
  breakEligibilityHours: 0,
  breakWindowStart: "11:00",
  breakWindowEnd: "14:00",
  preferSameTeam: true,
  preferStaffContinuity: true,
  preserveManualOverrides: true,
  autoUseWeekdayTemplate: true,
  autoUsePreviousWeekdaySchedule: true,
  autoUseHistoricalPatterns: true,
  napDurationRulesEnabled: true,
  napMinimumMinutes: 30,
  napPreferredMinutes: 30,
  napMaximumMinutes: 30,
  speechDurationRulesEnabled: true,
  speechMinimumMinutes: 30,
  speechPreferredMinutes: 30,
  speechMaximumMinutes: 30,
  preferredStaffPriority: 100,
  sameTeamPriority: 40,
  continuityPriority: 200,
  rotationPriority: 60,
  workloadBalancePriority: 0,
  historicalPairingPriority: 70,
  historicalSlotPriority: 90,
  historicalBreakPriority: 80,
  clientHandoffPenaltyPriority: 200,
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
      | "breakSchedulingEnabled"
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

    if (
      rules.breakWindowStart < "11:00" ||
      rules.breakWindowEnd > "14:00" ||
      rules.breakWindowEnd <= rules.breakWindowStart
    ) {
      setMessage(
        "Staff breaks must stay inside the 11:00 AM to 2:00 PM clinic break window."
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

    const automaticEventDurations = [
      {
        label: "Break",
        enabled: rules.breakSchedulingEnabled,
        minutes: rules.defaultBreakMinutes,
      },
      {
        label: "Nap",
        enabled: rules.napDurationRulesEnabled,
        minutes: rules.napPreferredMinutes,
      },
      {
        label: "Speech",
        enabled: rules.speechDurationRulesEnabled,
        minutes: rules.speechPreferredMinutes,
      },
    ];

    for (const durationRule of automaticEventDurations) {
      if (!durationRule.enabled) {
        continue;
      }

      if (
        durationRule.minutes < 30 ||
        durationRule.minutes > 240 ||
        durationRule.minutes % 30 !== 0
      ) {
        setMessage(
          `${durationRule.label} duration must use 30-minute increments between 30 and 240 minutes.`
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
            <EditableNumberInput
              
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
            <EditableNumberInput
              
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
            <EditableNumberInput
              
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
            <EditableNumberInput
              
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
            <EditableNumberInput
              
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
            <EditableNumberInput
              
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
          The break start/end values define the allowed placement window, not a
          fixed break appointment. Auto Generate chooses the best block inside
          that window after client coverage and nap/speech windows are considered.
        </p>

        <p className="helper-text">
          Every scheduled staff member must receive one break when a legal
          placement exists. Auto Generate first protects client coverage and
          Speech, then uses Break + Speech and Break + Nap opportunities before
          placing an ordinary Break.
        </p>

        <div className="form-grid">
          <label className="form-field">
            <span>Usual break duration</span>
            <select
              value={rules.defaultBreakMinutes}
              onChange={(event) =>
                updateNumberField(
                  "defaultBreakMinutes",
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
              Most clinics use 30 minutes. The scheduler places this duration
              somewhere inside the break window.
            </small>
          </label>

          <label className="form-field">
            <span>Break placement window starts</span>
            <input
              type="time"
              min="11:00"
              max="13:30"
              step="1800"
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
            <span>Break placement window ends</span>
            <input
              type="time"
              min="11:30"
              max="14:00"
              step="1800"
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
            <EditableNumberInput
              
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
            <EditableNumberInput
              
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
            <EditableNumberInput
              
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
            <EditableNumberInput
              
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
            <EditableNumberInput
              
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
            <EditableNumberInput
              
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
            <EditableNumberInput
              
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
            <EditableNumberInput
              
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
            <EditableNumberInput
              
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
            <EditableNumberInput
              
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
            <EditableNumberInput
              
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
            <EditableNumberInput
              
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
            <EditableNumberInput
              
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
            <EditableNumberInput
              
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
            <EditableNumberInput
              
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
            <EditableNumberInput
              
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
            <EditableNumberInput
              
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
        <h2>Speech, Nap & Break Priority</h2>
        <p>
          Auto Generate follows the clinic order: protect Speech first, place
          each present client&apos;s Nap next, use Break + Speech or Break + Nap
          whenever possible, then place any remaining ordinary staff breaks.
        </p>

        <div className="form-grid">
          <label className="form-field">
            <span>Usual nap duration</span>
            <select
              value={rules.napPreferredMinutes}
              onChange={(event) => {
                const value = Number(event.target.value);
                setRules((currentRules) => ({
                  ...currentRules,
                  napDurationRulesEnabled: true,
                  napMinimumMinutes: value,
                  napPreferredMinutes: value,
                  napMaximumMinutes: value,
                }));
              }}
            >
              <option value={30}>30 minutes</option>
              <option value={60}>1 hour</option>
              <option value={90}>1.5 hours</option>
              <option value={120}>2 hours</option>
            </select>
            <small>
              Nap placement is flexible only between 11:30 AM and 2:00 PM.
              Shared Nap special events can narrow that window for selected
              clients.
            </small>
          </label>

          <label className="form-field">
            <span>Speech duration</span>
            <input value="30 minutes" readOnly />
            <small>
              Speech is always one fixed 30-minute appointment for one client
              and has priority over Nap and ordinary break placement.
            </small>
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
            <span>Preferred max clients per staff per day</span>
            <EditableNumberInput
              min="1"
              value={rules.maximumClientsPerTechPerDay}
              onChange={(event) =>
                updateNumberField(
                  "maximumClientsPerTechPerDay",
                  event.target.value
                )
              }
            />
            <small>
              Default is 3 so staff normally stay with only 2-3 clients in long
              continuous blocks. Coverage can exceed this only as a last resort.
            </small>
          </label>

          <label className="form-field">
            <span>Preferred max staff per client per day</span>
            <EditableNumberInput
              min="1"
              value={rules.maximumTechsPerClientPerDay}
              onChange={(event) =>
                updateNumberField(
                  "maximumTechsPerClientPerDay",
                  event.target.value
                )
              }
            />
            <small>
              Default is 3 to reduce client handoffs. The scheduler keeps the
              current staff/client pairing together until a break, Speech/Nap,
              availability boundary, or the four-hour continuous maximum
              requires a handoff.
            </small>
          </label>

          <label className="form-field">
            <span>Supervision planning target (%)</span>
            <EditableNumberInput
              
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
