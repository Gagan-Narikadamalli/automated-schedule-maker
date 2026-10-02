"use client";

import { useEffect, useState } from "react";

type LocationOption = {
  id: string;
  name: string;
  code?: string;
};

type HistoricalRules = {
  autoUseHistoricalPatterns: boolean;
  historicalPairingPriority: number;
  historicalSlotPriority: number;
  historicalBreakPriority: number;
};

type LocationsResponse = {
  locations?: LocationOption[];
  error?: string;
};

type RulesResponse = {
  rules?: Partial<HistoricalRules>;
  error?: string;
};

const DEFAULT_RULES: HistoricalRules = {
  autoUseHistoricalPatterns: true,
  historicalPairingPriority: 70,
  historicalSlotPriority: 90,
  historicalBreakPriority: 80,
};

function priorityLabel(value: number): string {
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

export function HistoricalTrainingSettings() {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [locationId, setLocationId] = useState("");
  const [rules, setRules] = useState<HistoricalRules>(DEFAULT_RULES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(
    "Loading historical scheduling preferences..."
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
        throw new Error(data.error || "Locations could not be loaded.");
      }

      const nextLocations = data.locations ?? [];
      setLocations(nextLocations);

      if (nextLocations.length > 0) {
        setLocationId(nextLocations[0].id);
      } else {
        setMessage("No clinic locations are available.");
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
      setMessage("Loading saved historical pattern rules...");

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
          data.error || "Historical pattern rules could not be loaded."
        );
      }

      setRules({
        ...DEFAULT_RULES,
        ...data.rules,
      });
      setMessage(
        "Historical guidance is ready. Hard scheduling constraints always remain more important than learned patterns."
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Historical pattern rules could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }

  function updatePriority(
    field:
      | "historicalPairingPriority"
      | "historicalSlotPriority"
      | "historicalBreakPriority",
    value: string
  ) {
    const numericValue = Math.min(
      Math.max(Number(value), 0),
      200
    );

    setRules((currentRules) => ({
      ...currentRules,
      [field]: numericValue,
    }));
  }

  async function saveRules() {
    if (!locationId) {
      setMessage("Choose a clinic location before saving.");
      return;
    }

    try {
      setSaving(true);
      setMessage("Saving historical scheduling preferences...");

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
          data.error || "Historical scheduling preferences could not be saved."
        );
      }

      setRules({
        ...DEFAULT_RULES,
        ...data.rules,
      });
      setMessage(
        "Historical pattern settings saved. Auto Generate will use these preferences without overriding availability, call-outs, manual locks, hard pair restrictions, nap, speech, or role order."
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Historical scheduling preferences could not be saved."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="section-card">
      <div className="panel-heading-row">
        <div>
          <h2>Historical Pattern Learning</h2>
          <p>
            Use recent clinic schedules and imported workbook observations as
            soft guidance. For Livingston, the current trial profile is based on
            the recent Sep 28 through Oct 2 workbook week and only matches staff
            and clients that still exist in the database.
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

      <div className="toggle-list">
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={rules.autoUseHistoricalPatterns}
            disabled={loading || saving}
            onChange={(event) =>
              setRules((currentRules) => ({
                ...currentRules,
                autoUseHistoricalPatterns: event.target.checked,
              }))
            }
          />
          <span>
            Learn from recent same-weekday schedules, imported historical data,
            and the Livingston workbook trial profile when available.
          </span>
        </label>
      </div>

      <div className="form-grid">
        <label className="form-field">
          <span>Repeated staff/client pairing priority</span>
          <input
            type="number"
            min="0"
            max="200"
            step="5"
            disabled={loading || saving || !rules.autoUseHistoricalPatterns}
            value={rules.historicalPairingPriority}
            onChange={(event) =>
              updatePriority(
                "historicalPairingPriority",
                event.target.value
              )
            }
          />
          <small>
            {priorityLabel(rules.historicalPairingPriority)} — favors pairings
            that appear repeatedly across recent schedules.
          </small>
        </label>

        <label className="form-field">
          <span>Repeated exact-time priority</span>
          <input
            type="number"
            min="0"
            max="200"
            step="5"
            disabled={loading || saving || !rules.autoUseHistoricalPatterns}
            value={rules.historicalSlotPriority}
            onChange={(event) =>
              updatePriority(
                "historicalSlotPriority",
                event.target.value
              )
            }
          />
          <small>
            {priorityLabel(rules.historicalSlotPriority)} — favors a familiar
            staff/client pairing at the same half-hour block.
          </small>
        </label>

        <label className="form-field">
          <span>Historical break-time priority</span>
          <input
            type="number"
            min="0"
            max="200"
            step="5"
            disabled={loading || saving || !rules.autoUseHistoricalPatterns}
            value={rules.historicalBreakPriority}
            onChange={(event) =>
              updatePriority(
                "historicalBreakPriority",
                event.target.value
              )
            }
          />
          <small>
            {priorityLabel(rules.historicalBreakPriority)} — prefers familiar
            break windows only when client coverage remains safe.
          </small>
        </label>
      </div>

      <p className="helper-text">
        Historical learning never creates a hard assignment. The scheduler still
        enforces the BT/RBT → Intern → Manager → BCBA coverage order, staff
        availability, client attendance, call-outs, service setting, hard
        staff/client restrictions, fixed events, weekly limits, and manager locks.
      </p>

      <button
        type="button"
        className="button button-primary"
        disabled={loading || saving || !locationId}
        onClick={() => void saveRules()}
      >
        {saving ? "Saving..." : "Save Historical Learning Rules"}
      </button>

      <div className="inline-message">{message}</div>
    </section>
  );
}
