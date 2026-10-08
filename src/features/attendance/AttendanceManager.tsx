"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import styles from "./AttendanceManager.module.css";

type Mode = "IN" | "OUT";
type PersonType = "staff" | "client";
type Attendance = { personType: PersonType; personId: string; mode: Mode; startTime: string; endTime: string };
type Person = { id: string; name: string; color?: string };
type Location = { id: string; name: string };
function validColor(color: string | undefined): string {
  return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#DCE9F8";
}
function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((word) => word.charAt(0).toUpperCase()).join("") || "?";
}
function friendlyTime(time: string): string {
  const [hour, minute] = time.split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}
function canonical(records: Attendance[]): string {
  return JSON.stringify([...records].sort((a, b) => a.personType.localeCompare(b.personType) || a.personId.localeCompare(b.personId)));
}

function today() {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
}

export function AttendanceManager() {
  const [locationId, setLocationId] = useState("");
  const [date, setDate] = useState(today);
  const [locations, setLocations] = useState<Location[]>([]);
  const [people, setPeople] = useState<Record<PersonType, Person[]>>({ staff: [], client: [] });
  const [records, setRecords] = useState<Attendance[]>([]);
  const [saved, setSaved] = useState<Attendance[]>([]);
  const [group, setGroup] = useState<PersonType>("staff");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"ALL" | "CHANGED" | "IN" | "OUT">("ALL");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialDate = params.get("date");
    if (initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate)) setDate(initialDate);
    const preferredLocation = params.get("locationId");
    void (async () => {
      try {
        const response = await fetch("/api/locations", { cache: "no-store" });
        const result = await response.json() as { locations?: Location[]; error?: string };
        if (!response.ok) throw Error(result.error || "Unable to load locations");
        setLocations(result.locations ?? []);
        setLocationId((result.locations ?? []).find((item) => item.id === preferredLocation)?.id ?? result.locations?.[0]?.id ?? "");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Locations unavailable");
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!locationId || !date) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const query = `locationId=${encodeURIComponent(locationId)}&date=${encodeURIComponent(date)}`;
        const [scheduleResponse, attendanceResponse] = await Promise.all([
          fetch(`/api/schedule?${query}`, { cache: "no-store" }),
          fetch(`/api/attendance-overrides?${query}`, { cache: "no-store" })
        ]);
        const schedule = await scheduleResponse.json() as {
          rosterStaff?: Array<{ id: string; name: string; color?: string }>;
          clients?: Array<{ id: string; name: string; code: string; color?: string }>;
          error?: string;
        };
        const overrides = await attendanceResponse.json() as { overrides?: Attendance[]; error?: string };
        if (!scheduleResponse.ok || !attendanceResponse.ok) throw Error(schedule.error || overrides.error || "Unable to load attendance");
        if (cancelled) return;
        setPeople({
          staff: (schedule.rosterStaff ?? []).map((item) => ({ id: item.id, name: item.name, color: item.color })),
          client: (schedule.clients ?? []).map((item) => ({ id: item.id, name: item.code || item.name, color: item.color })),
        });
        setRecords(overrides.overrides ?? []);
        setSaved(overrides.overrides ?? []);
        setExpanded(null);
        setMessage("");
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Unable to load attendance");
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [locationId, date]);

  const getRecord = (id: string) => records.find((record) => record.personType === group && record.personId === id);
  const update = (id: string, next: Attendance | null) =>
    setRecords((current) => [...current.filter((record) => !(record.personType === group && record.personId === id)), ...(next ? [next] : [])]);
  const filtered = useMemo(() => people[group].filter((person) => {
    if (!person.name.toLowerCase().includes(search.toLowerCase())) return false;
    const record = records.find((entry) => entry.personId === person.id && entry.personType === group);
    return filter === "ALL" || (filter === "CHANGED" && Boolean(record)) || record?.mode === filter;
  }).sort((left, right) => {
    const changedLeft = Number(records.some((entry) => entry.personType === group && entry.personId === left.id));
    const changedRight = Number(records.some((entry) => entry.personType === group && entry.personId === right.id));
    return changedRight - changedLeft || left.name.localeCompare(right.name);
  }), [people, group, search, filter, records]);
  const current = records.filter((entry) => entry.personType === group);
  const dirty = canonical(current) !== canonical(saved.filter((entry) => entry.personType === group));
  const unsavedCount = new Set([...current, ...saved.filter((entry) => entry.personType === group)].map((entry) => entry.personId))
    .size ? new Set([...current, ...saved.filter((entry) => entry.personType === group)].map((entry) => entry.personId))
      .size : 0;
  const normalCount = people[group].length - current.length;

  async function save() {
    try {
      setSaving(true);
      setMessage("");
      if (current.some((entry) => entry.startTime < "08:00" || entry.endTime > "17:00" ||
        entry.startTime >= entry.endTime || !/^(?:[01]\d|2[0-3]):(?:00|30)$/.test(entry.startTime) ||
        !/^(?:[01]\d|2[0-3]):(?:00|30)$/.test(entry.endTime))) {
        throw Error("Time ranges must use 30-minute intervals between 8:00 AM and 5:00 PM, with end later than start.");
      }
      const response = await fetch("/api/attendance-overrides", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId, date, personType: group, overrides: current })
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw Error(data.error || "Unable to save attendance");
      setSaved((existing) => [...existing.filter((entry) => entry.personType !== group), ...current]);
      setMessage("Attendance saved. Updating the day's schedule...");
      const generation = await fetch("/api/schedule/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId, date })
      });
      const generationResult = await generation.json() as { error?: string };
      setMessage(generation.ok ? "Attendance saved and today's schedule regenerated. You can return to the Daily Schedule." :
        `Attendance saved, but automatic regeneration needs review: ${generationResult.error ?? "unknown error"}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save"); }
    finally { setSaving(false); }
  }

  return <div className={styles.page}>
    <section className={styles.context}>
      <div className={styles.heading}>
        <h2>Attendance editor</h2>
        <p>Select a person to change only that day's attendance. Regular shifts and client attendance patterns remain unchanged.</p>
      </div>
      <div className={styles.contextFields}>
        <label>Location<select value={locationId} onChange={(event) => setLocationId(event.target.value)} disabled={saving || loading}>
          {locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} disabled={saving} /></label>
        <a className={styles.back} href={`/?date=${encodeURIComponent(date)}`}>Back to schedule</a>
      </div>
    </section>

    <section className={styles.panel}>
      <div className={styles.toolbar}>
        <div className={styles.tabs} role="tablist" aria-label="Attendance category">
          <button type="button" role="tab" aria-selected={group === "staff"} className={group === "staff" ? styles.activeTab : ""}
            onClick={() => { setGroup("staff"); setExpanded(null); setSearch(""); setFilter("ALL"); }}>Staff ({people.staff.length})</button>
          <button type="button" role="tab" aria-selected={group === "client"} className={group === "client" ? styles.activeTab : ""}
            onClick={() => { setGroup("client"); setExpanded(null); setSearch(""); setFilter("ALL"); }}>Clients ({people.client.length})</button>
        </div>
        <div className={styles.filters}>
          <input aria-label="Search people" placeholder="Search by name or code" value={search} onChange={(event) => setSearch(event.target.value)} />
          <select aria-label="Filter attendance status" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
            <option value="ALL">All people</option><option value="CHANGED">Changes only</option>
            <option value="IN">Called in</option><option value="OUT">Called out</option>
          </select>
        </div>
      </div>
      <div className={styles.summary}>
        <span>{people[group].length} total</span>
        <span>{normalCount} normal</span>
        <span>{current.filter((item) => item.mode === "IN").length} called in</span>
        <span>{current.filter((item) => item.mode === "OUT").length} called out</span>
        {dirty && <strong>Unsaved attendance changes</strong>}
        <button type="button" className={styles.summaryAction} onClick={() => setExpanded(
          filtered.find((person) => getRecord(person.id))?.id ?? null
        )} disabled={!current.length}>Expand first changed</button>
        <button type="button" className={styles.summaryAction} onClick={() => setExpanded(null)}>Collapse all</button>
      </div>

      {loading ? <p className={styles.message}>Loading attendance…</p> :
      <div className={styles.grid}>
        {filtered.map((person) => {
          const record = getRecord(person.id);
          const open = expanded === person.id;
          const wholeDay = record?.startTime === "08:00" && record?.endTime === "17:00";
          const personStyle = { "--person-color": validColor(person.color) } as CSSProperties;
          return <article key={person.id} style={personStyle} className={`${styles.card} ${open ? styles.open : ""} ${record?.mode === "IN" ? styles.cardIn : record?.mode === "OUT" ? styles.cardOut : ""}`}>
            <button type="button" className={styles.cardHeader} aria-expanded={open} onClick={() => setExpanded(open ? null : person.id)}>
              <span className={styles.avatar} aria-hidden="true">{initials(person.name)}</span>
              <span className={styles.personInfo}>
                <span className={styles.personName}>{person.name}</span>
                <span className={styles.personMeta}>{record
                  ? `${record.mode === "IN" ? "Available" : "Away"} · ${record.startTime === "08:00" && record.endTime === "17:00" ? "Whole day" : `${friendlyTime(record.startTime)} – ${friendlyTime(record.endTime)}`}`
                  : "Regular attendance schedule"}</span>
              </span>
              <span className={`${styles.status} ${record?.mode === "IN" ? styles.calledIn : record?.mode === "OUT" ? styles.calledOut : ""}`}>
                {record?.mode === "IN" ? "Call In" : record?.mode === "OUT" ? "Call Out" : "Normal"}
              </span>
              <span className={styles.editHint}>{open ? "Close" : "Edit"} <span aria-hidden="true">{open ? "▴" : "▾"}</span></span>
            </button>
            {open && <div className={styles.details}>
              <p className={styles.fieldTitle}>Attendance status</p>
              <div className={styles.modeButtons}>
                {(["NONE", "IN", "OUT"] as const).map((mode) =>
                  <button type="button" key={mode} className={(record?.mode ?? "NONE") === mode ? styles.selected : ""}
                    onClick={() => update(person.id, mode === "NONE" ? null :
                      { personId: person.id, personType: group, mode, startTime: record?.startTime ?? "08:00", endTime: record?.endTime ?? "17:00" })}>
                    {mode === "NONE" ? "Normal" : mode === "IN" ? "Call In" : "Call Out"}
                  </button>)}
              </div>
              {record && <>
                <p className={styles.helperText}>This applies only to {date}. It does not change the recurring schedule.</p>
                <label className={styles.wholeDay}><input type="checkbox" checked={wholeDay}
                  onChange={(event) => update(person.id, { ...record, startTime: "08:00", endTime: event.target.checked ? "17:00" : "12:00" })} />
                  Whole day · 8:00 AM–5:00 PM</label>
                {!wholeDay && <div className={styles.times}>
                  <label>From<input type="time" min="08:00" max="16:30" step={1800} value={record.startTime}
                    onChange={(event) => update(person.id, { ...record, startTime: event.target.value })} /></label>
                  <label>To<input type="time" min="08:30" max="17:00" step={1800} value={record.endTime}
                    onChange={(event) => update(person.id, { ...record, endTime: event.target.value })} /></label>
                </div>}
                <p className={styles.previewLine}>{record.mode === "IN" ? "Available for scheduling" : "Unavailable for scheduling"} from {friendlyTime(record.startTime)} to {friendlyTime(record.endTime)}.</p>
              </>}
            </div>}
          </article>;
        })}
        {!filtered.length && <p className={styles.message}>No matching {group === "staff" ? "staff" : "clients"}.</p>}
      </div>}
      <div className={styles.footer}>
        <p role="status">{message || "Call-ins add availability; call-outs block it. Saving will refresh this day's schedule."}</p>
        <div className={styles.saveGroup}>
          {dirty && <span className={styles.unsavedLabel}>Unsaved changes · {unsavedCount} affected record(s)</span>}
          <button className={styles.save} type="button" disabled={loading || saving || !dirty} onClick={() => void save()}>
          {saving ? "Saving…" : `Save ${group === "staff" ? "Staff" : "Client"} Attendance`}
          </button>
        </div>
      </div>
    </section>
  </div>;
}
