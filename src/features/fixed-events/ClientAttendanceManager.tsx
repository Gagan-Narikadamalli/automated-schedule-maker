"use client";

import { useEffect, useMemo, useState } from "react";

import cardStyles from "@/components/ManagementCards.module.css";
import { ManagementModal } from "@/components/ManagementModal";

type ChangeType = "CALL_OUT" | "CALL_IN";
type LocationOption = { id: string; name: string };
type ClientOption = { id: string; fullName: string; displayCode: string; color: string };
type AttendanceChange = {
  id: string;
  clientId: string;
  client: ClientOption | null;
  date: string;
  changeType: ChangeType;
  startTime: string;
  endTime: string;
  note: string;
};

type LocationsResponse = { locations?: LocationOption[]; error?: string };
type ClientsResponse = { clients?: ClientOption[]; error?: string };
type ChangesResponse = { attendanceChanges?: AttendanceChange[]; attendanceChange?: AttendanceChange; error?: string };

type GenerateResponse = { success?: boolean; error?: string };

function localToday(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function ClientAttendanceManager() {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [locationId, setLocationId] = useState("");
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [selectedDate, setSelectedDate] = useState(localToday);
  const [changes, setChanges] = useState<AttendanceChange[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [changeType, setChangeType] = useState<ChangeType>("CALL_OUT");
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("18:00");
  const [note, setNote] = useState("");
  const [working, setWorking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("Loading client attendance changes...");

  const sortedChanges = useMemo(
    () => [...changes].sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [changes]
  );

  useEffect(() => { void loadLocations(); }, []);
  useEffect(() => {
    if (locationId) void loadData(locationId, selectedDate);
  }, [locationId, selectedDate]);

  async function loadLocations() {
    try {
      setLoading(true);
      const response = await fetch("/api/locations", { cache: "no-store" });
      const data = (await response.json()) as LocationsResponse;
      if (!response.ok) throw new Error(data.error || "Locations could not be loaded.");
      const next = data.locations ?? [];
      setLocations(next);
      if (next.length > 0) setLocationId(next[0].id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Locations could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  async function loadData(requestedLocationId: string, date: string) {
    try {
      setLoading(true);
      const [clientsResponse, changesResponse] = await Promise.all([
        fetch(`/api/clients?locationId=${encodeURIComponent(requestedLocationId)}`, { cache: "no-store" }),
        fetch(`/api/client-attendance?locationId=${encodeURIComponent(requestedLocationId)}&date=${encodeURIComponent(date)}`, { cache: "no-store" }),
      ]);
      const clientsData = (await clientsResponse.json()) as ClientsResponse;
      const changesData = (await changesResponse.json()) as ChangesResponse;
      if (!clientsResponse.ok) throw new Error(clientsData.error || "Clients could not be loaded.");
      if (!changesResponse.ok) throw new Error(changesData.error || "Attendance changes could not be loaded.");
      const nextClients = clientsData.clients ?? [];
      setClients(nextClients);
      if (!clientId && nextClients.length > 0) setClientId(nextClients[0].id);
      setChanges(changesData.attendanceChanges ?? []);
      setMessage(`${changesData.attendanceChanges?.length ?? 0} client attendance change(s) saved for ${date}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Client attendance changes could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  function openChange(type: ChangeType) {
    setChangeType(type);
    setStartTime("08:00");
    setEndTime("18:00");
    setNote("");
    setModalOpen(true);
  }

  async function regenerateDay() {
    const response = await fetch("/api/schedule/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locationId, date: selectedDate }),
    });
    const data = (await response.json()) as GenerateResponse;
    if (!response.ok) throw new Error(data.error || "The schedule could not be updated after the attendance change.");
  }

  async function saveChange() {
    if (!locationId || !clientId) return;
    if (endTime <= startTime) {
      setMessage("End time must be later than start time.");
      return;
    }

    try {
      setWorking(true);
      setMessage(`Saving client ${changeType === "CALL_IN" ? "call in" : "call out"} and updating the schedule...`);
      const response = await fetch("/api/client-attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId,
          clientId,
          date: selectedDate,
          changeType,
          startTime,
          endTime,
          note,
        }),
      });
      const data = (await response.json()) as ChangesResponse;
      if (!response.ok) throw new Error(data.error || "Client attendance change could not be saved.");
      await regenerateDay();
      setModalOpen(false);
      await loadData(locationId, selectedDate);
      setMessage(`Client ${changeType === "CALL_IN" ? "call in" : "call out"} saved and ${selectedDate} was automatically regenerated around the new attendance.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Client attendance change could not be saved.");
    } finally {
      setWorking(false);
    }
  }

  async function removeChange(change: AttendanceChange) {
    try {
      setWorking(true);
      const response = await fetch("/api/client-attendance", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId, exceptionId: change.id }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Attendance change could not be removed.");
      await regenerateDay();
      await loadData(locationId, selectedDate);
      setMessage("Attendance change removed and the day was regenerated using the client's normal attendance pattern.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Attendance change could not be removed.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="section-card">
      <div className={cardStyles.toolbar}>
        <div className={cardStyles.toolbarLeft}>
          <div>
            <h2>Client / Kid Call Outs & Call Ins</h2>
            <p>A call-out removes client demand for the selected time. A call-in adds demand and automatically rebuilds the day while still protecting Speech and Nap.</p>
          </div>
        </div>
        <div className={cardStyles.toolbarRight}>
          <button type="button" className="button button-secondary" disabled={working || clients.length === 0} onClick={() => openChange("CALL_OUT")}>Client Call Out</button>
          <button type="button" className="button button-primary" disabled={working || clients.length === 0} onClick={() => openChange("CALL_IN")}>Client Call In</button>
        </div>
      </div>

      <div className="form-grid form-grid-compact">
        <label className="form-field"><span>Location</span><select value={locationId} disabled={loading || working} onChange={(event) => setLocationId(event.target.value)}>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
        <label className="form-field"><span>Date</span><input type="date" value={selectedDate} disabled={working} onChange={(event) => setSelectedDate(event.target.value)} /></label>
      </div>

      {sortedChanges.length === 0 ? (
        <div className={cardStyles.emptyState}>No client call-outs or call-ins are saved for this date.</div>
      ) : (
        <div className={cardStyles.grid}>
          {sortedChanges.map((change) => (
            <article key={change.id} className={cardStyles.card} style={{ borderTop: `8px solid ${change.changeType === "CALL_IN" ? "#D9F4EE" : "#F5D7D7"}` }}>
              <div className={cardStyles.cardTop}>
                <div className={cardStyles.identityCopy}>
                  <h3>{change.client?.displayCode ?? "Client"} · {change.changeType === "CALL_IN" ? "Call In" : "Call Out"}</h3>
                </div>
                <span className={cardStyles.pill}>{change.changeType === "CALL_IN" ? "Coming In" : "Out"}</span>
              </div>
              <div className={cardStyles.detailList}>
                <div className={cardStyles.detailRow}><span>Date</span><strong>{change.date}</strong></div>
                <div className={cardStyles.detailRow}><span>Time</span><strong>{change.startTime} - {change.endTime}</strong></div>
              </div>
              {change.note && <div className={cardStyles.chips}><span className={cardStyles.chip}>{change.note}</span></div>}
              <div className={cardStyles.cardActions}><button type="button" className="button button-secondary button-small" disabled={working} onClick={() => void removeChange(change)}>Remove Change</button></div>
            </article>
          ))}
        </div>
      )}

      <div className="inline-message">{message}</div>

      <ManagementModal
        open={modalOpen}
        title={changeType === "CALL_IN" ? "Client Call In" : "Client Call Out"}
        eyebrow="CLIENT ATTENDANCE CHANGE"
        description={changeType === "CALL_IN" ? "Add coverage demand for a child who is coming in unexpectedly or returning after a call-out." : "Remove coverage demand while the child is out. Existing automatic assignments are rebuilt around the absence."}
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <button type="button" className="button button-secondary" disabled={working} onClick={() => setModalOpen(false)}>Cancel</button>
            <button type="button" className="button button-primary" disabled={working || !clientId} onClick={() => void saveChange()}>{working ? "Updating..." : "Save & Update Schedule"}</button>
          </>
        }
      >
        <div className={cardStyles.formSection}>
          <div className="form-grid">
            <label className="form-field form-field-wide"><span>Client / kid</span><select value={clientId} onChange={(event) => setClientId(event.target.value)}>{clients.map((client) => <option key={client.id} value={client.id}>{client.displayCode}</option>)}</select></label>
            <label className="form-field"><span>Starts</span><input type="time" step="1800" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label>
            <label className="form-field"><span>Ends</span><input type="time" step="1800" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label>
            <label className="form-field form-field-wide"><span>Note (optional)</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder={changeType === "CALL_IN" ? "Example: Parent confirmed late arrival" : "Example: Sick today"} /></label>
          </div>
        </div>
      </ManagementModal>
    </section>
  );
}
