"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { DAILY_TIME_SLOTS } from "./constants";
import styles from "./SchedulerCalendarViews.module.css";

type ScheduleView = "STAFF" | "CLIENT";

type WorkspaceContext = {
  locationId: string;
  locationName: string;
  date: string;
  dateSelectionExplicit: boolean;
};

type ClientRef = {
  _id?: string;
  id?: string;
  displayCode?: string;
  fullName?: string;
  color?: string;
};

type ScheduleStaff = {
  id: string;
  name: string;
  color?: string;
};

type ScheduleAssignment = {
  id: string;
  staffId: string;
  clientId: string | ClientRef | null;
  startTime: string;
  assignmentType:
    | "CLIENT_1_TO_1"
    | "BREAK"
    | "BREAK_NAP"
    | "BREAK_SPEECH"
    | "NAP"
    | "SPEECH"
    | "UNAVAILABLE"
    | "OPEN";
};

type ClientEvent = {
  clientId: string;
  startTime: string;
  eventType: "NAP" | "SPEECH";
};

type ScheduleResponse = {
  staff?: ScheduleStaff[];
  assignments?: ScheduleAssignment[];
  clientEvents?: ClientEvent[];
  requiredClientSlots?: number;
  error?: string;
};

type UnplacedRecord = {
  id: string;
  clientId: string | null;
  clientCode: string | null;
  clientColor?: string | null;
  originalStartTime: string;
};

type UnplacedResponse = {
  unplacedAssignments?: UnplacedRecord[];
  error?: string;
};

type SchedulerCalendarViewsProps = {
  view: ScheduleView;
  onViewChange: (view: ScheduleView) => void;
  activeDate: string;
  onActiveDateChange: (date: string, explicit?: boolean) => void;
  context: WorkspaceContext | null;
  refreshKey: number;
};

type ClientColumn = {
  id: string;
  code: string;
  name: string;
  color: string;
};

type ClientCellResult = {
  text: string;
  detail: string;
  kind: "coverage" | "nap" | "speech" | "uncovered";
  staffColor?: string;
};

function parseLocalDate(dateText: string): Date {
  return new Date(`${dateText}T12:00:00`);
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(dateText: string, days: number): string {
  const date = parseLocalDate(dateText);
  date.setDate(date.getDate() + days);
  return formatDate(date);
}

function getMonday(dateText: string): string {
  const date = parseLocalDate(dateText);
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + offset);
  return formatDate(date);
}

function shortDate(dateText: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(parseLocalDate(dateText));
}

function longDate(dateText: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(parseLocalDate(dateText));
}

function clientObject(assignment: ScheduleAssignment): ClientRef | null {
  return assignment.clientId && typeof assignment.clientId === "object"
    ? assignment.clientId
    : null;
}

function clientId(assignment: ScheduleAssignment): string | null {
  if (!assignment.clientId) return null;
  if (typeof assignment.clientId === "string") return assignment.clientId;
  return String(assignment.clientId._id ?? assignment.clientId.id ?? "") || null;
}

function timeLabel(time: string): string {
  const [hourText, minute] = time.split(":");
  const hour = Number(hourText);
  const suffix = hour >= 12 ? "PM" : "AM";
  const twelveHour = hour % 12 || 12;
  return `${twelveHour}:${minute} ${suffix}`;
}

function accentForKind(kind: ClientCellResult["kind"]): string {
  switch (kind) {
    case "nap":
      return "#E6B84A";
    case "speech":
      return "#8C72D9";
    case "uncovered":
      return "#E76B73";
    default:
      return "rgba(16, 80, 122, 0.22)";
  }
}

export function SchedulerCalendarViews({
  view,
  onViewChange,
  activeDate,
  onActiveDateChange,
  context,
  refreshKey,
}: SchedulerCalendarViewsProps) {
  const monday = useMemo(() => getMonday(activeDate), [activeDate]);
  const weekdays = useMemo(
    () => ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((label, index) => ({
      label,
      shortLabel: label.slice(0, 3),
      date: addDays(monday, index),
    })),
    [monday]
  );

  return (
    <>
      <section className={styles.calendarBar} aria-label="Schedule week navigation">
        <div className={styles.weekHeader}>
          <div>
            <span className={styles.eyebrow}>WORK WEEK</span>
            <strong>{shortDate(monday)} – {shortDate(addDays(monday, 4))}</strong>
          </div>
          <div className={styles.weekActions}>
            <button type="button" onClick={() => onActiveDateChange(addDays(monday, -7), true)}>← Previous</button>
            <button type="button" onClick={() => onActiveDateChange(addDays(monday, 7), true)}>Next →</button>
          </div>
        </div>

        <div className={styles.dayTabs}>
          {weekdays.map((day) => (
            <button
              key={day.date}
              type="button"
              className={day.date === activeDate ? styles.dayTabActive : styles.dayTab}
              onClick={() => onActiveDateChange(day.date, true)}
              aria-pressed={day.date === activeDate}
            >
              <span>{day.shortLabel}</span>
              <strong>{shortDate(day.date)}</strong>
            </button>
          ))}
        </div>
      </section>

      <div className={styles.viewTabs} role="tablist" aria-label="Schedule view">
        <button
          type="button"
          role="tab"
          aria-selected={view === "STAFF"}
          className={view === "STAFF" ? styles.viewTabActive : styles.viewTab}
          onClick={() => onViewChange("STAFF")}
        >
          Staff Schedule
          <small>Assignments, Break, Break/Nap, Break/Speech</small>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "CLIENT"}
          className={view === "CLIENT" ? styles.viewTabActive : styles.viewTab}
          onClick={() => onViewChange("CLIENT")}
        >
          Client Schedule
          <small>Live projection of the same saved day: coverage, Nap, Speech, and uncovered time</small>
        </button>
      </div>

      {view === "CLIENT" && (
        <ClientScheduleView
          key={`${context?.locationId ?? "clinic"}-${activeDate}-${refreshKey}`}
          locationId={context?.locationId ?? ""}
          locationName={context?.locationName ?? "Clinic"}
          date={activeDate}
          refreshKey={refreshKey}
        />
      )}
    </>
  );
}

function ClientScheduleView({
  locationId,
  locationName,
  date,
  refreshKey,
}: {
  locationId: string;
  locationName: string;
  date: string;
  refreshKey: number;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [staff, setStaff] = useState<ScheduleStaff[]>([]);
  const [assignments, setAssignments] = useState<ScheduleAssignment[]>([]);
  const [clientEvents, setClientEvents] = useState<ClientEvent[]>([]);
  const [unplaced, setUnplaced] = useState<UnplacedRecord[]>([]);

  const load = useCallback(async (silent = false) => {
    if (!locationId || !date || locationId.startsWith("demo-")) {
      setLoading(false);
      return;
    }
    try {
      if (!silent) setLoading(true);
      setError("");
      const [scheduleResponse, unplacedResponse] = await Promise.all([
        fetch(`/api/schedule?locationId=${encodeURIComponent(locationId)}&date=${encodeURIComponent(date)}`, { cache: "no-store" }),
        fetch(`/api/unplaced?locationId=${encodeURIComponent(locationId)}&date=${encodeURIComponent(date)}`, { cache: "no-store" }),
      ]);
      const scheduleData = (await scheduleResponse.json()) as ScheduleResponse;
      const unplacedData = (await unplacedResponse.json()) as UnplacedResponse;
      if (!scheduleResponse.ok) throw new Error(scheduleData.error || "Client schedule could not be loaded.");
      if (!unplacedResponse.ok) throw new Error(unplacedData.error || "Unplaced coverage could not be loaded.");
      setStaff(scheduleData.staff ?? []);
      setAssignments(scheduleData.assignments ?? []);
      setClientEvents(scheduleData.clientEvents ?? []);
      setUnplaced(unplacedData.unplacedAssignments ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Client schedule could not be loaded.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [locationId, date]);

  useEffect(() => {
    void load(false);
  }, [load, refreshKey]);

  useEffect(() => {
    function handleFocus() {
      void load(true);
    }
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [load]);

  const staffNameById = useMemo(
    () => new Map(staff.map((member) => [member.id, member.name])),
    [staff]
  );

  const staffColorById = useMemo(
    () =>
      new Map(
        staff.map((member) => [
          member.id,
          member.color || "#9BB8CA",
        ])
      ),
    [staff]
  );

  const clientEventByKey = useMemo(() => {
    const events = new Map<string, ClientEvent>();
    for (const event of clientEvents) {
      events.set(event.clientId + "|" + event.startTime, event);
    }
    return events;
  }, [clientEvents]);

  const clients = useMemo<ClientColumn[]>(() => {
    const byId = new Map<string, ClientColumn>();
    for (const assignment of assignments) {
      const id = clientId(assignment);
      if (!id) continue;
      const client = clientObject(assignment);
      const code = client?.displayCode || "Client";
      const existing = byId.get(id);
      byId.set(id, {
        id,
        code: existing?.code || code,
        name: existing?.name || code,
        color: client?.color || existing?.color || "#D9F4EE",
      });
    }
    for (const record of unplaced) {
      if (!record.clientId) continue;
      if (!byId.has(record.clientId)) {
        byId.set(record.clientId, {
          id: record.clientId,
          code: record.clientCode || "Client",
          name: record.clientCode || "Client",
          color: record.clientColor || "#FDECEC",
        });
      }
    }
    return [...byId.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [assignments, unplaced]);

  function cellFor(clientIdValue: string, startTime: string): ClientCellResult | null {
    const matching = assignments.filter(
      (assignment) => clientId(assignment) === clientIdValue && assignment.startTime === startTime
    );
    const resolvedEvent = clientEventByKey.get(
      clientIdValue + "|" + startTime
    );
    const coverage = matching.find((assignment) => assignment.assignmentType === "CLIENT_1_TO_1");
    const coverageName = coverage
      ? staffNameById.get(coverage.staffId) || "another staff member"
      : null;

    const napBreak = matching.find((assignment) => assignment.assignmentType === "BREAK_NAP");
    const nap = matching.find((assignment) => assignment.assignmentType === "NAP");
    if (napBreak || nap) {
      const breakStaff = napBreak
        ? staffNameById.get(napBreak.staffId) || "Staff"
        : null;
      const detail = coverageName
        ? napBreak
          ? `Covered by ${coverageName}; ${breakStaff} on break`
          : `Covered by ${coverageName}`
        : napBreak
          ? `${breakStaff} on break during nap`
          : "Client nap";
      return { text: "Nap", detail, kind: "nap" };
    }

    const speechBreak = matching.find((assignment) => assignment.assignmentType === "BREAK_SPEECH");
    const speech = matching.find((assignment) => assignment.assignmentType === "SPEECH");
    if (speechBreak || speech) {
      const breakStaff = speechBreak
        ? staffNameById.get(speechBreak.staffId) || "Staff"
        : null;
      const detail = coverageName
        ? speechBreak
          ? `Covered by ${coverageName}; ${breakStaff} on break`
          : `Covered by ${coverageName}`
        : speechBreak
          ? `${breakStaff} on break during speech`
          : "Fixed speech event";
      return { text: "Speech", detail, kind: "speech" };
    }

    if (resolvedEvent?.eventType === "NAP") {
      return {
        text: "Nap",
        detail: "Scheduled 30-minute nap",
        kind: "nap",
      };
    }

    if (resolvedEvent?.eventType === "SPEECH") {
      return {
        text: "Speech",
        detail: "Scheduled 30-minute speech",
        kind: "speech",
      };
    }

    if (coverage) {
      return {
        text: coverageName || "Covered",
        detail: "1:1 coverage",
        kind: "coverage",
        staffColor: staffColorById.get(coverage.staffId),
      };
    }
    if (unplaced.some((record) => record.clientId === clientIdValue && record.originalStartTime === startTime)) {
      return { text: "Needs coverage", detail: "Unplaced", kind: "uncovered" };
    }
    return null;
  }

  if (loading) {
    return <section className={styles.clientPanel}><div className={styles.emptyState}>Loading client schedule for {longDate(date)}…</div></section>;
  }
  if (error) {
    return <section className={styles.clientPanel}><div className={styles.errorState}>{error}</div></section>;
  }

  return (
    <section className={styles.clientPanel} aria-label={`Client schedule for ${date}`}>
      <div className={styles.clientPanelHeader}>
        <div>
          <span className={styles.eyebrow}>CLIENT COVERAGE VIEW</span>
          <h2>{locationName} · {longDate(date)}</h2>
          <p>This view is rebuilt from the same saved assignments as Staff Schedule. Manual staff edits therefore change this client view for the same date, and each client's normal coverage keeps the same client color in both views.</p>
        </div>
        <div className={styles.legend}>
          <span><i className={styles.legendCoverage} />Client color = 1:1 coverage</span>
          <span><i className={styles.legendNap} />Nap</span>
          <span><i className={styles.legendSpeech} />Speech</span>
          <span><i className={styles.legendUncovered} />Needs coverage</span>
        </div>
      </div>

      {clients.length === 0 ? (
        <div className={styles.emptyState}>No client assignments are saved for this date.</div>
      ) : (
        <div className={styles.clientGridScroll}>
          <table className={styles.clientGrid}>
            <thead>
              <tr>
                <th>Time</th>
                {clients.map((client) => (
                  <th key={client.id} title={client.name}>
                    <span className={styles.clientDot} style={{ backgroundColor: client.color }} />
                    {client.code}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DAILY_TIME_SLOTS.map((slot) => (
                <tr key={slot.startTime}>
                  <th>{timeLabel(slot.startTime)}</th>
                  {clients.map((client) => {
                    const cell = cellFor(client.id, slot.startTime);
                    const preserveClientColor = cell?.kind === "coverage";
                    return (
                      <td key={`${client.id}-${slot.startTime}`}>
                        {cell ? (
                          <div
                            className={`${styles.clientCell} ${styles[`clientCell_${cell.kind}`]}`}
                            style={{
                              ...(preserveClientColor ? { background: client.color } : {}),
                              borderLeft: `4px solid ${preserveClientColor ? client.color : accentForKind(cell.kind)}`,
                            }}
                          >
                            <strong>{cell.text}</strong>
                            <span>{cell.detail}</span>
                          </div>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export type { ScheduleView, WorkspaceContext };
