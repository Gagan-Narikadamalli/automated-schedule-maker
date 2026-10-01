"use client";

import { useEffect, useMemo, useState } from "react";

type LocationOption = {
  id: string;
  name: string;
};

type ClientOption = {
  id: string;
  fullName: string;
  displayCode: string;
  color: string;
};

type SpeechSession = {
  id: string;
  clientId: string;
  client: {
    id: string;
    displayCode: string;
    fullName: string;
    color: string;
  } | null;
  date: string;
  startTime: string;
  endTime: string;
  recurringSeriesId: string;
  note: string;
};

type LocationsResponse = {
  locations?: LocationOption[];
  error?: string;
};

type ClientsResponse = {
  clients?: ClientOption[];
  error?: string;
};

type SessionsResponse = {
  speechSessions?: SpeechSession[];
  createdCount?: number;
  deletedCount?: number;
  error?: string;
};

const DAYS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
];

function currentMonth(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 7);
}

function today(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function monthBounds(month: string) {
  const startDate = `${month}-01`;
  const [year, monthNumber] = month.split("-").map(Number);
  const end = new Date(year, monthNumber, 0);
  const endDate = `${month}-${String(end.getDate()).padStart(2, "0")}`;

  return { startDate, endDate };
}

export function FixedEventsManager() {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [locationId, setLocationId] = useState("");
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [sessions, setSessions] = useState<SpeechSession[]>([]);
  const [month, setMonth] = useState(currentMonth);
  const [clientId, setClientId] = useState("");
  const [mode, setMode] = useState<"ONE_TIME" | "WEEKLY">("ONE_TIME");
  const [date, setDate] = useState(today);
  const [seriesStartDate, setSeriesStartDate] = useState(today);
  const [seriesEndDate, setSeriesEndDate] = useState(today);
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("10:30");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("Loading speech and fixed events...");

  const groupedSeriesCounts = useMemo(() => {
    const counts = new Map<string, number>();

    for (const session of sessions) {
      if (!session.recurringSeriesId) {
        continue;
      }

      counts.set(
        session.recurringSeriesId,
        (counts.get(session.recurringSeriesId) ?? 0) + 1
      );
    }

    return counts;
  }, [sessions]);

  useEffect(() => {
    void loadLocations();
  }, []);

  useEffect(() => {
    if (locationId) {
      void loadLocationData(locationId, month);
    }
  }, [locationId, month]);

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

  async function loadLocationData(requestedLocationId: string, requestedMonth: string) {
    try {
      setLoading(true);
      const { startDate, endDate } = monthBounds(requestedMonth);
      const [clientsResponse, sessionsResponse] = await Promise.all([
        fetch(
          `/api/clients?locationId=${encodeURIComponent(requestedLocationId)}`,
          { cache: "no-store" }
        ),
        fetch(
          `/api/speech-sessions?locationId=${encodeURIComponent(
            requestedLocationId
          )}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(
            endDate
          )}`,
          { cache: "no-store" }
        ),
      ]);

      const clientsData = (await clientsResponse.json()) as ClientsResponse;
      const sessionsData = (await sessionsResponse.json()) as SessionsResponse;

      if (!clientsResponse.ok) {
        throw new Error(clientsData.error || "Clients could not be loaded.");
      }

      if (!sessionsResponse.ok) {
        throw new Error(
          sessionsData.error || "Speech sessions could not be loaded."
        );
      }

      const nextClients = clientsData.clients ?? [];
      setClients(nextClients);
      setSessions(sessionsData.speechSessions ?? []);

      if (!clientId && nextClients.length > 0) {
        setClientId(nextClients[0].id);
      }

      setMessage(
        `${sessionsData.speechSessions?.length ?? 0} speech session(s) loaded for ${requestedMonth}.`
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Speech and fixed events could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }

  function toggleDay(day: string) {
    setSelectedDays((currentDays) =>
      currentDays.includes(day)
        ? currentDays.filter((currentDay) => currentDay !== day)
        : [...currentDays, day]
    );
  }

  async function saveSpeechSession() {
    if (!locationId || !clientId) {
      setMessage("Choose a location and client first.");
      return;
    }

    if (endTime <= startTime) {
      setMessage("Speech end time must be later than the start time.");
      return;
    }

    if (mode === "WEEKLY" && selectedDays.length === 0) {
      setMessage("Select at least one weekday for a recurring speech series.");
      return;
    }

    try {
      setWorking(true);
      setMessage("Saving speech schedule...");

      const payload =
        mode === "ONE_TIME"
          ? {
              locationId,
              clientId,
              date,
              startTime,
              endTime,
              note,
            }
          : {
              locationId,
              clientId,
              seriesStartDate,
              seriesEndDate,
              daysOfWeek: selectedDays,
              startTime,
              endTime,
              note,
            };

      const response = await fetch("/api/speech-sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as SessionsResponse;

      if (!response.ok) {
        throw new Error(data.error || "Speech session could not be saved.");
      }

      await loadLocationData(locationId, month);
      setMessage(
        `${data.createdCount ?? 1} speech session(s) saved. Auto Generate will treat them as fixed client events.`
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Speech session could not be saved."
      );
    } finally {
      setWorking(false);
    }
  }

  async function removeSpeechSession(
    sessionId: string,
    recurringSeriesId = ""
  ) {
    const removeSeries = Boolean(
      recurringSeriesId &&
        window.confirm(
          `Remove the entire recurring series (${groupedSeriesCounts.get(recurringSeriesId) ?? 0} session(s) in the loaded month)? Choose Cancel to remove only this one session.`
        )
    );

    try {
      setWorking(true);

      const response = await fetch("/api/speech-sessions", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          removeSeries
            ? { locationId, recurringSeriesId }
            : { locationId, sessionId }
        ),
      });
      const data = (await response.json()) as SessionsResponse;

      if (!response.ok) {
        throw new Error(data.error || "Speech session could not be removed.");
      }

      await loadLocationData(locationId, month);
      setMessage(`${data.deletedCount ?? 0} speech session(s) removed.`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Speech session could not be removed."
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="management-layout">
      <section className="section-card">
        <div className="panel-heading-row">
          <div>
            <h2>Speech Calendar Context</h2>
            <p>
              Speech sessions are fixed client events. They block normal 1:1 matching
              for the client during that time, while managers can still use a
              Break/Speech cell when the supervising staff can take their break.
            </p>
          </div>

          <div className="toolbar-group">
            <label className="form-field compact-field">
              <span>Location</span>
              <select
                value={locationId}
                disabled={loading || working}
                onChange={(event) => setLocationId(event.target.value)}
              >
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="form-field compact-field">
              <span>View month</span>
              <input
                type="month"
                value={month}
                disabled={loading || working}
                onChange={(event) => setMonth(event.target.value)}
              />
            </label>
          </div>
        </div>
      </section>

      <section className="section-card">
        <h2>Add Speech Session</h2>

        <div className="form-grid">
          <label className="form-field">
            <span>Client</span>
            <select
              value={clientId}
              disabled={working || clients.length === 0}
              onChange={(event) => setClientId(event.target.value)}
            >
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.displayCode} — {client.fullName}
                </option>
              ))}
            </select>
          </label>

          <label className="form-field">
            <span>Schedule type</span>
            <select
              value={mode}
              disabled={working}
              onChange={(event) =>
                setMode(event.target.value as "ONE_TIME" | "WEEKLY")
              }
            >
              <option value="ONE_TIME">One-time date</option>
              <option value="WEEKLY">Recurring weekly series</option>
            </select>
          </label>

          <label className="form-field">
            <span>Starts</span>
            <input
              type="time"
              value={startTime}
              disabled={working}
              onChange={(event) => setStartTime(event.target.value)}
            />
          </label>

          <label className="form-field">
            <span>Ends</span>
            <input
              type="time"
              value={endTime}
              disabled={working}
              onChange={(event) => setEndTime(event.target.value)}
            />
          </label>

          {mode === "ONE_TIME" ? (
            <label className="form-field">
              <span>Date</span>
              <input
                type="date"
                value={date}
                disabled={working}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
          ) : (
            <>
              <label className="form-field">
                <span>Series starts</span>
                <input
                  type="date"
                  value={seriesStartDate}
                  disabled={working}
                  onChange={(event) => setSeriesStartDate(event.target.value)}
                />
              </label>

              <label className="form-field">
                <span>Series ends</span>
                <input
                  type="date"
                  value={seriesEndDate}
                  disabled={working}
                  onChange={(event) => setSeriesEndDate(event.target.value)}
                />
              </label>
            </>
          )}

          <label className="form-field form-field-wide">
            <span>Note (optional)</span>
            <input
              value={note}
              disabled={working}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Example: Weekly speech therapy"
            />
          </label>
        </div>

        {mode === "WEEKLY" && (
          <div className="subsection">
            <h3>Recurring weekdays</h3>
            <div className="day-selector">
              {DAYS.map((day) => (
                <label key={day} className="checkbox-card">
                  <input
                    type="checkbox"
                    checked={selectedDays.includes(day)}
                    disabled={working}
                    onChange={() => toggleDay(day)}
                  />
                  <span>{day.charAt(0) + day.slice(1).toLowerCase()}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <button
          type="button"
          className="button button-primary"
          disabled={working || loading || !clientId}
          onClick={() => void saveSpeechSession()}
        >
          {working ? "Saving..." : "Save Speech Schedule"}
        </button>
      </section>

      <section className="section-card">
        <h2>Saved Speech Sessions</h2>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Client</th>
                <th>Time</th>
                <th>Series</th>
                <th>Note</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {sessions.length === 0 ? (
                <tr>
                  <td colSpan={6}>No speech sessions are saved for this month.</td>
                </tr>
              ) : (
                sessions.map((session) => (
                  <tr key={session.id}>
                    <td>{session.date}</td>
                    <td>
                      {session.client?.displayCode ?? "Client"} — {session.client?.fullName ?? ""}
                    </td>
                    <td>
                      {session.startTime} - {session.endTime}
                    </td>
                    <td>
                      {session.recurringSeriesId
                        ? `Recurring (${groupedSeriesCounts.get(session.recurringSeriesId) ?? 1} shown)`
                        : "One time"}
                    </td>
                    <td>{session.note || "—"}</td>
                    <td>
                      <button
                        type="button"
                        className="button button-secondary button-small"
                        disabled={working}
                        onClick={() =>
                          void removeSpeechSession(
                            session.id,
                            session.recurringSeriesId
                          )
                        }
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="inline-message">{message}</div>
      </section>
    </div>
  );
}
