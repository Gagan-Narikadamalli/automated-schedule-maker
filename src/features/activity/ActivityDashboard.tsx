"use client";

import { useEffect, useState } from "react";

type LocationOption = {
  id: string;
  name: string;
};

type ActivityRecord = {
  id: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  createdAt: string;
};

type LocationsResponse = {
  locations?: LocationOption[];
  error?: string;
};

type ActivityResponse = {
  activity?: ActivityRecord[];
  error?: string;
};

export function ActivityDashboard() {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [locationId, setLocationId] = useState("");
  const [activity, setActivity] = useState<ActivityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("Loading activity history...");

  useEffect(() => {
    void loadLocations();
  }, []);

  useEffect(() => {
    if (locationId) {
      void loadActivity(locationId);
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

  async function loadActivity(requestedLocationId = locationId) {
    if (!requestedLocationId) {
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(
        `/api/activity?locationId=${encodeURIComponent(requestedLocationId)}&limit=150`,
        { cache: "no-store" }
      );
      const data = (await response.json()) as ActivityResponse;

      if (!response.ok) {
        throw new Error(data.error || "Activity history could not be loaded.");
      }

      setActivity(data.activity ?? []);
      setMessage(`${data.activity?.length ?? 0} recent change(s) loaded.`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Activity history could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="section-card">
      <div className="panel-heading-row">
        <div>
          <h2>Recent Activity</h2>
          <p>
            Schedule generation, call-outs, staff/client changes, templates, and
            manual overrides are recorded here from MongoDB.
          </p>
        </div>

        <div className="toolbar-group">
          <label className="form-field compact-field">
            <span>Location</span>
            <select
              value={locationId}
              disabled={loading}
              onChange={(event) => setLocationId(event.target.value)}
            >
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="button button-secondary"
            disabled={loading || !locationId}
            onClick={() => void loadActivity()}
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date / Time</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Area</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {activity.length === 0 ? (
              <tr>
                <td colSpan={5}>No recorded activity for this location yet.</td>
              </tr>
            ) : (
              activity.map((entry) => (
                <tr key={entry.id}>
                  <td>{new Date(entry.createdAt).toLocaleString()}</td>
                  <td>{entry.userId}</td>
                  <td>{entry.action.replaceAll("_", " ")}</td>
                  <td>{entry.entityType.replaceAll("_", " ")}</td>
                  <td>{entry.summary}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="inline-message">{message}</div>
    </section>
  );
}
