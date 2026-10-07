"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import cardStyles from "@/components/ManagementCards.module.css";
import { useActionConfirmDialog } from "@/components/ActionConfirmDialog";
import { ManagementModal } from "@/components/ManagementModal";

type EventType = "SPEECH" | "NAP";
type NapPriorityCategory = "YOUNGER" | "OLDER";
type ScheduleMode = "ONE_TIME" | "WEEKLY";

type LocationOption = { id: string; name: string };
type ClientOption = { id: string; fullName: string; displayCode: string; color: string };

type ClientEvent = {
  id: string;
  eventType: EventType;
  clientId: string;
  client: ClientOption | null;
  date: string;
  startTime: string;
  endTime: string;
  recurringSeriesId: string;
  note: string;
  priorityCategory?: NapPriorityCategory;
};

type LocationsResponse = { locations?: LocationOption[]; error?: string };
type ClientsResponse = { clients?: ClientOption[]; error?: string };
type SpeechResponse = { speechSessions?: Omit<ClientEvent, "eventType">[]; createdCount?: number; deletedCount?: number; error?: string };
type NapResponse = { napSessions?: Omit<ClientEvent, "eventType">[]; createdCount?: number; deletedCount?: number; error?: string };

const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
const EVENT_COLORS: Record<EventType, string> = {
  SPEECH: "#DCE9F8",
  NAP: "#FFF3D6",
};

function localToday(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function currentMonth(): string {
  return localToday().slice(0, 7);
}

function monthBounds(month: string) {
  const startDate = `${month}-01`;
  const [year, monthNumber] = month.split("-").map(Number);
  const end = new Date(year, monthNumber, 0);
  return { startDate, endDate: `${month}-${String(end.getDate()).padStart(2, "0")}` };
}

function formatEventType(value: EventType): string {
  return value === "NAP" ? "Nap" : "Speech";
}

export function FixedEventsManager() {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [locationId, setLocationId] = useState("");
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [events, setEvents] = useState<ClientEvent[]>([]);
  const [month, setMonth] = useState(currentMonth);
  const [filter, setFilter] = useState<"ALL" | EventType>("ALL");
  const [modalOpen, setModalOpen] = useState(false);
  const [eventType, setEventType] = useState<EventType>("SPEECH");
  const [clientId, setClientId] = useState("");
  const [mode, setMode] = useState<ScheduleMode>("ONE_TIME");
  const [date, setDate] = useState(localToday);
  const [seriesStartDate, setSeriesStartDate] = useState(localToday);
  const [seriesEndDate, setSeriesEndDate] = useState(localToday);
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("10:30");
  const [priorityCategory, setPriorityCategory] = useState<NapPriorityCategory>("YOUNGER");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("Loading Speech and Nap events...");
  const { requestActionDialog, actionDialog } = useActionConfirmDialog();

  const visibleEvents = useMemo(() => {
    return events
      .filter((event) => filter === "ALL" || event.eventType === filter)
      .sort((left, right) => {
        const colorDifference = EVENT_COLORS[left.eventType].localeCompare(EVENT_COLORS[right.eventType]);
        if (colorDifference !== 0) return colorDifference;
        const dateDifference = left.date.localeCompare(right.date);
        if (dateDifference !== 0) return dateDifference;
        return left.startTime.localeCompare(right.startTime);
      });
  }, [events, filter]);

  const seriesCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of events) {
      if (event.recurringSeriesId) {
        counts.set(event.recurringSeriesId, (counts.get(event.recurringSeriesId) ?? 0) + 1);
      }
    }
    return counts;
  }, [events]);

  useEffect(() => { void loadLocations(); }, []);
  useEffect(() => {
    if (locationId) void loadLocationData(locationId, month);
  }, [locationId, month]);

  async function loadLocations() {
    try {
      setLoading(true);
      const response = await fetch("/api/locations", { cache: "no-store" });
      const data = (await response.json()) as LocationsResponse;
      if (!response.ok) throw new Error(data.error || "Locations could not be loaded.");
      const next = data.locations ?? [];
      setLocations(next);
      if (next.length > 0) setLocationId(next[0].id);
      else setMessage("No clinic locations are available yet.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Locations could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  async function loadLocationData(requestedLocationId: string, requestedMonth: string) {
    try {
      setLoading(true);
      const { startDate, endDate } = monthBounds(requestedMonth);
      const query = `locationId=${encodeURIComponent(requestedLocationId)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
      const [clientsResponse, speechResponse, napResponse] = await Promise.all([
        fetch(`/api/clients?locationId=${encodeURIComponent(requestedLocationId)}`, { cache: "no-store" }),
        fetch(`/api/speech-sessions?${query}`, { cache: "no-store" }),
        fetch(`/api/nap-sessions?${query}`, { cache: "no-store" }),
      ]);
      const clientsData = (await clientsResponse.json()) as ClientsResponse;
      const speechData = (await speechResponse.json()) as SpeechResponse;
      const napData = (await napResponse.json()) as NapResponse;
      if (!clientsResponse.ok) throw new Error(clientsData.error || "Clients could not be loaded.");
      if (!speechResponse.ok) throw new Error(speechData.error || "Speech events could not be loaded.");
      if (!napResponse.ok) throw new Error(napData.error || "Nap events could not be loaded.");

      const nextClients = clientsData.clients ?? [];
      setClients(nextClients);
      setClientId((currentClientId) =>
        nextClients.some((client) => client.id === currentClientId)
          ? currentClientId
          : nextClients[0]?.id ?? ""
      );

      const speechEvents: ClientEvent[] = (speechData.speechSessions ?? []).map((event) => ({ ...event, eventType: "SPEECH" }));
      const napEvents: ClientEvent[] = (napData.napSessions ?? []).map((event) => ({ ...event, eventType: "NAP" }));
      setEvents([...speechEvents, ...napEvents]);
      setMessage(
        nextClients.length === 0
          ? `No active clients are available in this location. Add a client before creating Speech or Nap events.`
          : `${speechEvents.length + napEvents.length} fixed event(s) loaded for ${requestedMonth}.`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Fixed events could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  function openAddEvent(type: EventType = "SPEECH") {
    setEventType(type);
    setMode("ONE_TIME");
    setDate(localToday());
    setSeriesStartDate(localToday());
    setSeriesEndDate(localToday());
    setSelectedDays([]);
    setPriorityCategory("YOUNGER");
    setNote("");
    if (type === "NAP") {
      setStartTime("11:30");
      setEndTime("12:30");
    } else {
      setStartTime("10:00");
      setEndTime("10:30");
    }
    setModalOpen(true);
  }

  function changeEventType(type: EventType) {
    setEventType(type);
    if (type === "NAP") {
      setStartTime("11:30");
      setEndTime("12:30");
    }
  }

  function toggleDay(day: string) {
    setSelectedDays((current) => current.includes(day) ? current.filter((value) => value !== day) : [...current, day]);
  }

  async function saveEvent() {
    if (!locationId || !clientId) {
      setMessage("Choose a location and client first.");
      return;
    }
    if (endTime <= startTime) {
      setMessage("Event end time must be later than start time.");
      return;
    }
    if (eventType === "NAP" && (startTime < "11:00" || endTime > "14:00")) {
      setMessage("Nap time must stay inside the 11:00 AM to 2:00 PM window.");
      return;
    }
    if (mode === "WEEKLY" && selectedDays.length === 0) {
      setMessage("Select at least one weekday for a recurring event.");
      return;
    }

    try {
      setWorking(true);
      const payload = mode === "ONE_TIME"
        ? { locationId, clientId, date, startTime, endTime, note, ...(eventType === "NAP" ? { priorityCategory } : {}) }
        : { locationId, clientId, seriesStartDate, seriesEndDate, daysOfWeek: selectedDays, startTime, endTime, note, ...(eventType === "NAP" ? { priorityCategory } : {}) };
      const endpoint = eventType === "NAP" ? "/api/nap-sessions" : "/api/speech-sessions";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as { createdCount?: number; error?: string };
      if (!response.ok) throw new Error(data.error || `${formatEventType(eventType)} event could not be saved.`);
      setModalOpen(false);
      await loadLocationData(locationId, month);
      setMessage(`${data.createdCount ?? 1} ${formatEventType(eventType).toLowerCase()} event(s) saved. The automatic scheduler will protect this time before placing staff breaks.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Event could not be saved.");
    } finally {
      setWorking(false);
    }
  }

  async function removeEvent(event: ClientEvent) {
    const recurringCount = event.recurringSeriesId
      ? seriesCounts.get(event.recurringSeriesId) ?? 1
      : 0;
    const choice = await requestActionDialog({
      eyebrow: `DELETE ${formatEventType(event.eventType).toUpperCase()} EVENT`,
      title: event.recurringSeriesId
        ? "Remove this occurrence or the recurring series?"
        : "Remove this event?",
      description: event.recurringSeriesId
        ? `This event belongs to a recurring series with ${recurringCount} event(s) currently shown.`
        : "This removes the selected event from the client's schedule.",
      actions: event.recurringSeriesId
        ? [
            {
              id: "occurrence",
              label: "Remove this occurrence",
              tone: "primary",
            },
            {
              id: "series",
              label: "Remove entire series",
              tone: "danger",
            },
          ]
        : [
            {
              id: "occurrence",
              label: "Remove event",
              tone: "danger",
            },
          ],
    });

    if (!choice) {
      return;
    }

    const removeSeries = choice === "series";
    try {
      setWorking(true);
      const endpoint = event.eventType === "NAP" ? "/api/nap-sessions" : "/api/speech-sessions";
      const response = await fetch(endpoint, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(removeSeries
          ? { locationId, recurringSeriesId: event.recurringSeriesId }
          : { locationId, sessionId: event.id }),
      });
      const data = (await response.json()) as { deletedCount?: number; error?: string };
      if (!response.ok) throw new Error(data.error || "Event could not be removed.");
      await loadLocationData(locationId, month);
      setMessage(`${data.deletedCount ?? 0} event(s) removed.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Event could not be removed.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="management-layout">
      {actionDialog}
      <section className="section-card">
        <div className={cardStyles.toolbar}>
          <div className={cardStyles.toolbarLeft}>
            <label className="form-field compact-field">
              <span>Location</span>
              <select value={locationId} disabled={loading || working} onChange={(event) => setLocationId(event.target.value)}>
                {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
              </select>
            </label>
            <label className="form-field compact-field">
              <span>View month</span>
              <input type="month" value={month} disabled={loading || working} onChange={(event) => setMonth(event.target.value)} />
            </label>
            <label className="form-field compact-field">
              <span>Filter by event color</span>
              <select value={filter} disabled={loading} onChange={(event) => setFilter(event.target.value as "ALL" | EventType)}>
                <option value="ALL">All colors / events</option>
                <option value="SPEECH">Speech · Blue</option>
                <option value="NAP">Nap · Gold</option>
              </select>
            </label>
          </div>
          <div className={cardStyles.toolbarRight}>
            <button type="button" className={cardStyles.addButton} disabled={working} onClick={() => openAddEvent("SPEECH")}>
              <span className={cardStyles.addIcon}>+</span> Add Event
            </button>
          </div>
        </div>

        <div className={cardStyles.summaryStrip}>
          <div className={cardStyles.summaryItem}><span>Total events</span><strong>{events.length}</strong></div>
          <div className={cardStyles.summaryItem}><span>Speech</span><strong>{events.filter((event) => event.eventType === "SPEECH").length}</strong></div>
          <div className={cardStyles.summaryItem}><span>Nap</span><strong>{events.filter((event) => event.eventType === "NAP").length}</strong></div>
        </div>

        {visibleEvents.length === 0 ? (
          <div className={cardStyles.emptyState}>No Speech or Nap events match this filter and month.</div>
        ) : (
          <div className={cardStyles.grid}>
            {visibleEvents.map((event) => (
              <article key={`${event.eventType}-${event.id}`} className={cardStyles.card} style={{ borderTop: `8px solid ${EVENT_COLORS[event.eventType]}` }}>
                <div className={cardStyles.cardTop}>
                  <div className={cardStyles.identity}>
                    <div className={cardStyles.avatar} style={{ "--accent": EVENT_COLORS[event.eventType] } as React.CSSProperties}>
                      {event.eventType === "NAP" ? "N" : "S"}
                    </div>
                    <div className={cardStyles.identityCopy}>
                      <h3>{event.client?.displayCode ?? "Client"} · {formatEventType(event.eventType)}</h3>
                      <p>{event.client?.fullName ?? ""}</p>
                    </div>
                  </div>
                  <span className={cardStyles.pill}>{formatEventType(event.eventType)}</span>
                </div>

                <div className={cardStyles.detailList}>
                  <div className={cardStyles.detailRow}><span>Date</span><strong>{event.date}</strong></div>
                  <div className={cardStyles.detailRow}><span>Time</span><strong>{event.startTime} - {event.endTime}</strong></div>
                  {event.eventType === "NAP" && (
                    <div className={cardStyles.detailRow}><span>Nap priority</span><strong>{event.priorityCategory === "YOUNGER" ? "Younger child first" : "Older child"}</strong></div>
                  )}
                  <div className={cardStyles.detailRow}><span>Schedule</span><strong>{event.recurringSeriesId ? `Recurring · ${seriesCounts.get(event.recurringSeriesId) ?? 1} shown` : "One time"}</strong></div>
                </div>

                {event.note && <div className={cardStyles.chips}><span className={cardStyles.chip}>{event.note}</span></div>}
                <div className={cardStyles.cardActions}>
                  <button type="button" className="button button-secondary button-small" disabled={working} onClick={() => void removeEvent(event)}>Remove</button>
                </div>
              </article>
            ))}
          </div>
        )}
        <div className="inline-message">{message}</div>
      </section>

      <ManagementModal
        open={modalOpen}
        title="Add Client Event"
        eyebrow="SPEECH / NAP"
        description="Choose Speech or Nap. Nap events are limited to 11:00 AM–2:00 PM and are used first when the scheduler looks for staff break opportunities."
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <button type="button" className="button button-secondary" disabled={working} onClick={() => setModalOpen(false)}>Cancel</button>
            {clients.length === 0 ? (
              <Link href="/clients" className="button button-primary">
                Add Client
              </Link>
            ) : (
              <button type="button" className="button button-primary" disabled={working || !clientId} onClick={() => void saveEvent()}>{working ? "Saving..." : "Save Event"}</button>
            )}
          </>
        }
      >
        <div className={cardStyles.formSection}>
          <h3>Event type</h3>
          <p>Only Speech and Nap are currently available. The card color follows the selected event.</p>
          <div className="day-selector">
            <label className="checkbox-card" style={{ backgroundColor: EVENT_COLORS.SPEECH }}>
              <input type="radio" name="eventType" checked={eventType === "SPEECH"} onChange={() => changeEventType("SPEECH")} />
              <span>Speech</span>
            </label>
            <label className="checkbox-card" style={{ backgroundColor: EVENT_COLORS.NAP }}>
              <input type="radio" name="eventType" checked={eventType === "NAP"} onChange={() => changeEventType("NAP")} />
              <span>Nap</span>
            </label>
          </div>
        </div>

        <div className={cardStyles.formSection}>
          <h3>Client and schedule</h3>
          {clients.length === 0 ? (
            <div className={cardStyles.emptyState}>
              <strong>No clients are available in this location.</strong>
              <p>
                Speech and Nap events must belong to a client. Add a client
                first, then return here to create the event.
              </p>
              <Link href="/clients" className="button button-primary">
                Go to Clients
              </Link>
            </div>
          ) : null}
          <div className="form-grid">
            <label className="form-field form-field-wide">
              <span>Client / kid</span>
              <select
                value={clientId}
                disabled={clients.length === 0}
                onChange={(event) => setClientId(event.target.value)}
              >
                {clients.length === 0 ? (
                  <option value="">No active clients available</option>
                ) : (
                  clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.displayCode} — {client.fullName}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="form-field"><span>Schedule type</span><select value={mode} onChange={(event) => setMode(event.target.value as ScheduleMode)}><option value="ONE_TIME">One-time date</option><option value="WEEKLY">Recurring weekly</option></select></label>
            <label className="form-field"><span>Starts</span><input type="time" min={eventType === "NAP" ? "11:00" : undefined} max={eventType === "NAP" ? "13:30" : undefined} step="1800" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label>
            <label className="form-field"><span>Ends</span><input type="time" min={eventType === "NAP" ? "11:30" : undefined} max={eventType === "NAP" ? "14:00" : undefined} step="1800" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label>
            {eventType === "NAP" && (
              <label className="form-field"><span>Nap category</span><select value={priorityCategory} onChange={(event) => setPriorityCategory(event.target.value as NapPriorityCategory)}><option value="YOUNGER">Younger child — schedule first</option><option value="OLDER">Older child — schedule second</option></select></label>
            )}
            {mode === "ONE_TIME" ? (
              <label className="form-field"><span>Date</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
            ) : (
              <>
                <label className="form-field"><span>Series starts</span><input type="date" value={seriesStartDate} onChange={(event) => setSeriesStartDate(event.target.value)} /></label>
                <label className="form-field"><span>Series ends</span><input type="date" value={seriesEndDate} onChange={(event) => setSeriesEndDate(event.target.value)} /></label>
              </>
            )}
            <label className="form-field form-field-wide"><span>Note (optional)</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder={eventType === "NAP" ? "Example: Usually naps around noon" : "Example: Weekly speech therapy"} /></label>
          </div>

          {mode === "WEEKLY" && (
            <div className="subsection">
              <h3>Recurring weekdays</h3>
              <div className="day-selector">
                {DAYS.map((day) => (
                  <label key={day} className="checkbox-card"><input type="checkbox" checked={selectedDays.includes(day)} onChange={() => toggleDay(day)} /><span>{day.charAt(0) + day.slice(1).toLowerCase()}</span></label>
                ))}
              </div>
            </div>
          )}
        </div>
      </ManagementModal>
    </div>
  );
}
