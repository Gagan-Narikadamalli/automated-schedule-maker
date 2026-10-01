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
  defaultBreakMinutes: number;
  breakEligibilityHours: number;
  breakWindowStart: string;
  breakWindowEnd: string;
  preferSameTeam: boolean;
  preferStaffContinuity: boolean;
  preserveManualOverrides: boolean;
  preferredStaffPriority: number;
  sameTeamPriority: number;
  continuityPriority: number;
  rotationPriority: number;
  workloadBalancePriority: number;
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
  | "defaultBreakMinutes"
  | "breakEligibilityHours"
  | "preferredStaffPriority"
  | "sameTeamPriority"
  | "continuityPriority"
  | "rotationPriority"
  | "workloadBalancePriority"
  | "supervisionPlanningTargetPercent";

const DEFAULT_RULES: RulesForm = {
  scheduleStartTime: "08:00",
  scheduleEndTime: "18:00",
  slotLengthMinutes: 30,
  fullTimeMinimumWeeklyHours: 30,
  fullTimeMaximumWeeklyHours: 40,
  partTimeMinimumWeeklyHours: 0,
  partTimeMaximumWeeklyHours: 29,
  maximumClientsPerTechPerDay: 6,
  maximumTechsPerClientPerDay: 4,
  defaultBreakMinutes: 30,
  breakEligibilityHours: 6,
  breakWindowStart: "11:00",
  breakWindowEnd: "13:30",
  preferSameTeam: true,
  preferStaffContinuity: true,
  preserveManualOverrides: true,
  preferredStaffPriority: 100,
  sameTeamPriority: 40,
  continuityPriority: 35,
  rotationPriority: 60,
  workloadBalancePriority: 10,
  supervisionPlanningTargetPercent: 5,
};

type LocationsResponse = {
  locations?: LocationOption[];
  error?: string;
};

type RulesResponse = {
  rules?: Partial<RulesForm>;
  error?: string;
};

export function SchedulingSettings() {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [locationId, setLocationId] = useState("");
  const [rules, setRules] = useState<RulesForm>(DEFAULT_RULES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("Loading clinic scheduling rules...");

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

      const response = await fetch("/api/locations", { cache: "no-store" });
      const data = (await response.json()) as LocationsResponse;

      if (!response.ok) {
        throw new Error(data.error || "Locations could not be loaded.");
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
        error instanceof Error ? error.message : "Locations could not be loaded."
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
        { cache: "no-store" }
      );
      const data = (await response.json()) as RulesResponse;

      if (!response.ok || !data.rules) {
        throw new Error(data.error || "Scheduling rules could not be loaded.");
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

  function updateNumberField(field: NumericRuleField, value: string) {
    setRules((currentRules) => ({
      ...currentRules,
      [field]: Number(value),
    }));
  }

  function priorityHelp(value: number): string {
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

  async function saveRules() {
    if (!locationId) {
      setMessage("Choose a clinic location before saving.");
      return;
    }

    if (rules.scheduleEndTime <= rules.scheduleStartTime) {
      setMessage("Schedule end time must be later than schedule start time.");
      return;
    }

    if (rules.breakWindowEnd <= rules.breakWindowStart) {
      setMessage("Break window end must be later than break window start.");
      return;
    }

    if (
      rules.fullTimeMaximumWeeklyHours < rules.fullTimeMinimumWeeklyHours ||
      rules.partTimeMaximumWeeklyHours < rules.partTimeMinimumWeeklyHours
    ) {
      setMessage("Maximum hours cannot be lower than minimum hours.");
      return;
    }

    if (rules.slotLengthMinutes !== 30) {
      setMessage(
        "The Excel-matching schedule currently requires 30-minute blocks."
      );
      return;
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
        throw new Error(data.error || "Scheduling rules could not be saved.");
      }

      setRules({
        ...DEFAULT_RULES,
        ...data.rules,
      });
      setMessage(
        "Scheduling rules saved. Auto Generate and Repair will use the new priorities."
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
              Livingston and Parsippany keep separate scheduling rules while sharing
              the same application.
            </p>
          </div>

          <label className="form-field compact-field">
            <span>Clinic location</span>
            <select
              value={locationId}
              disabled={loading || saving}
              onChange={(event) => setLocationId(event.target.value)}
            >
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
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
          These values define the Excel-style day that the automatic scheduler is
          allowed to use.
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
                updateNumberField("slotLengthMinutes", event.target.value)
              }
            />
          </label>
        </div>
      </section>

      <section className="section-card">
        <h2>Staff Hour Rules</h2>
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
        </div>
      </section>

      <section className="section-card">
        <h2>Break Planning</h2>
        <p>
          Automatic breaks are only placed when enough staff remain to cover all
          clients. Multiple staff may break together when the clinic has spare
          coverage.
        </p>

        <div className="form-grid">
          <label className="form-field">
            <span>Default break minutes</span>
            <select
              value={rules.defaultBreakMinutes}
              onChange={(event) =>
                updateNumberField("defaultBreakMinutes", event.target.value)
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
                updateNumberField("breakEligibilityHours", event.target.value)
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
        <h2>Automatic Scheduler Priorities</h2>
        <p>
          Higher numbers make a soft preference more important. Hard rules such as
          availability, call-outs, double-booking, service setting, and hard
          staff/client restrictions always take priority over these scores.
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
                updateNumberField("preferredStaffPriority", event.target.value)
              }
            />
            <small>{priorityHelp(rules.preferredStaffPriority)}</small>
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
                updateNumberField("sameTeamPriority", event.target.value)
              }
            />
            <small>{priorityHelp(rules.sameTeamPriority)}</small>
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
                updateNumberField("continuityPriority", event.target.value)
              }
            />
            <small>{priorityHelp(rules.continuityPriority)}</small>
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
                updateNumberField("rotationPriority", event.target.value)
              }
            />
            <small>{priorityHelp(rules.rotationPriority)}</small>
          </label>

          <label className="form-field">
            <span>Workload balancing priority</span>
            <input
              type="number"
              min="0"
              max="200"
              step="5"
              value={rules.workloadBalancePriority}
              onChange={(event) =>
                updateNumberField("workloadBalancePriority", event.target.value)
              }
            />
            <small>{priorityHelp(rules.workloadBalancePriority)}</small>
          </label>
        </div>
      </section>

      <section className="section-card">
        <h2>Automatic Scheduling Limits</h2>
        <div className="form-grid">
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

        <div className="toggle-list">
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={rules.preferSameTeam}
              onChange={(event) =>
                setRules((currentRules) => ({
                  ...currentRules,
                  preferSameTeam: event.target.checked,
                }))
              }
            />
            <span>
              Use the same-team priority when staff and client belong to the same
              team.
            </span>
          </label>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={rules.preferStaffContinuity}
              onChange={(event) =>
                setRules((currentRules) => ({
                  ...currentRules,
                  preferStaffContinuity: event.target.checked,
                }))
              }
            />
            <span>
              Prefer continuity for standard clients while rotation clients still
              rotate according to their own support rules.
            </span>
          </label>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={rules.preserveManualOverrides}
              onChange={(event) =>
                setRules((currentRules) => ({
                  ...currentRules,
                  preserveManualOverrides: event.target.checked,
                }))
              }
            />
            <span>
              Preserve manager-approved manual overrides during Generate and Repair.
            </span>
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

        <div className="inline-message">{message}</div>
      </section>
    </div>
  );
}
