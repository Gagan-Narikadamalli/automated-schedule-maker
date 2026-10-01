"use client";

import { useState } from "react";

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
  breakWindowStart: string;
  breakWindowEnd: string;
  staffLimit: number;
  preferSameTeam: boolean;
  preferStaffContinuity: boolean;
  preserveManualOverrides: boolean;
};

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
  breakWindowStart: "11:00",
  breakWindowEnd: "14:00",
  staffLimit: 100,
  preferSameTeam: true,
  preferStaffContinuity: true,
  preserveManualOverrides: true,
};

export function SchedulingSettings() {
  const [rules, setRules] = useState<RulesForm>(DEFAULT_RULES);
  const [message, setMessage] = useState(
    "These defaults reflect the requested Excel-style scheduling workflow."
  );

  function updateNumberField(
    field: keyof RulesForm,
    value: string
  ) {
    setRules((currentRules) => ({
      ...currentRules,
      [field]: Number(value),
    }));
  }

  function saveRules() {
    if (rules.scheduleEndTime <= rules.scheduleStartTime) {
      setMessage("Schedule end time must be later than schedule start time.");
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
        "The current calendar is designed around 30-minute blocks. Other slot lengths will be supported later, but the Excel-matching layout should remain at 30 minutes for now."
      );
      return;
    }

    setMessage(
      "Scheduling rules validated. The MongoDB-backed save endpoint will persist these separately for Livingston and Parsippany."
    );
  }

  return (
    <div className="management-layout">
      <section className="section-card">
        <h2>Calendar Rules</h2>
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
              min="15"
              step="15"
              value={rules.slotLengthMinutes}
              onChange={(event) =>
                updateNumberField("slotLengthMinutes", event.target.value)
              }
            />
          </label>

          <label className="form-field">
            <span>Maximum staff records</span>
            <input
              type="number"
              min="1"
              value={rules.staffLimit}
              onChange={(event) =>
                updateNumberField("staffLimit", event.target.value)
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
        <h2>Auto Schedule Rules</h2>
        <div className="form-grid">
          <label className="form-field">
            <span>Max clients per tech per day</span>
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
            <span>Max techs per client per day</span>
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
            <span>Default break minutes</span>
            <input
              type="number"
              min="0"
              step="30"
              value={rules.defaultBreakMinutes}
              onChange={(event) =>
                updateNumberField("defaultBreakMinutes", event.target.value)
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
              Prefer matching staff and clients from the same team before using
              other allowed staff.
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
              Prefer continuity so a good schedule does not change staff/client
              pairings unnecessarily.
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
          onClick={saveRules}
        >
          Save Scheduling Rules
        </button>

        <div className="inline-message">{message}</div>
      </section>
    </div>
  );
}
