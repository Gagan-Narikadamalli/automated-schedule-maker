"use client";

import { useEffect, useMemo, useState } from "react";

import cardStyles from "@/components/ManagementCards.module.css";
import { ManagementModal } from "@/components/ManagementModal";

type LocationOption = {
  id: string;
  name: string;
};

type SupervisorOption = {
  id: string;
  fullName: string;
};

type SupervisionRow = {
  staffId: string;
  staffName: string;
  role: string;
  color: string;
  serviceHours: number;
  calculatedServiceHours: number;
  supervisionHours: number;
  planningTargetPercent: number;
  targetHours: number;
  remainingHours: number;
  supervisorStaffId: string | null;
  supervisorName: string | null;
  note: string;
  hasSavedRecord: boolean;
  status: "NEEDS_SUPERVISION" | "ON_TARGET";
};

type LocationsResponse = {
  locations?: LocationOption[];
  error?: string;
};

type SupervisionResponse = {
  month?: string;
  planningTargetPercent?: number;
  bcbaCount?: number;
  hasSupervisionGap?: boolean;
  supervisors?: SupervisorOption[];
  rows?: SupervisionRow[];
  error?: string;
};

type SupervisionForm = {
  staffId: string;
  supervisorStaffId: string;
  serviceHours: number;
  supervisionHours: number;
  note: string;
};

function getCurrentMonth(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 7);
}

function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
}

function emptyForm(): SupervisionForm {
  return {
    staffId: "",
    supervisorStaffId: "",
    serviceHours: 0,
    supervisionHours: 0,
    note: "",
  };
}

export function SupervisionCardDashboard() {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [locationId, setLocationId] = useState("");
  const [month, setMonth] = useState(getCurrentMonth);
  const [data, setData] = useState<SupervisionResponse | null>(null);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<SupervisionForm>(emptyForm);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("Loading supervision planning data...");

  const rows = data?.rows ?? [];
  const supervisors = data?.supervisors ?? [];

  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return rows;
    }

    return rows.filter((row) =>
      [row.staffName, row.role, row.supervisorName ?? "", row.status]
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    );
  }, [rows, query]);

  const staffNeedingSupervision = rows.filter(
    (row) => row.status === "NEEDS_SUPERVISION"
  );

  useEffect(() => {
    void loadLocations();
  }, []);

  useEffect(() => {
    if (locationId && month) {
      void loadSupervision(locationId, month);
    }
  }, [locationId, month]);

  async function loadLocations() {
    try {
      setLoading(true);
      const response = await fetch("/api/locations", { cache: "no-store" });
      const body = (await response.json()) as LocationsResponse;

      if (!response.ok) {
        throw new Error(body.error || "Locations could not be loaded.");
      }

      const nextLocations = body.locations ?? [];
      setLocations(nextLocations);
      setLocationId(nextLocations[0]?.id ?? "");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Locations could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  async function loadSupervision(
    requestedLocationId = locationId,
    requestedMonth = month
  ) {
    try {
      setLoading(true);
      const response = await fetch(
        `/api/supervision?locationId=${encodeURIComponent(requestedLocationId)}&month=${encodeURIComponent(requestedMonth)}`,
        { cache: "no-store" }
      );
      const body = (await response.json()) as SupervisionResponse;

      if (!response.ok) {
        throw new Error(body.error || "Supervision planning data could not be loaded.");
      }

      setData(body);
      setMessage("Supervision planning estimate loaded from the saved schedule and supervision records.");
    } catch (error) {
      setData(null);
      setMessage(
        error instanceof Error
          ? error.message
          : "Supervision planning data could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }

  function openNewRecord() {
    const firstRow = rows[0];
    setForm({
      ...emptyForm(),
      staffId: firstRow?.staffId ?? "",
      serviceHours: firstRow?.serviceHours ?? 0,
    });
    setModalOpen(true);
  }

  function openEditRecord(row: SupervisionRow) {
    setForm({
      staffId: row.staffId,
      supervisorStaffId: row.supervisorStaffId ?? "",
      serviceHours: row.serviceHours,
      supervisionHours: row.supervisionHours,
      note: row.note ?? "",
    });
    setModalOpen(true);
  }

  function closeModal(force = false) {
    if (saving && !force) {
      return;
    }
    setModalOpen(false);
    setForm(emptyForm());
  }

  function chooseStaff(staffId: string) {
    const row = rows.find((candidate) => candidate.staffId === staffId);
    setForm((current) => ({
      ...current,
      staffId,
      serviceHours: row?.serviceHours ?? 0,
      supervisionHours: row?.supervisionHours ?? 0,
      supervisorStaffId: row?.supervisorStaffId ?? "",
      note: row?.note ?? "",
    }));
  }

  async function saveRecord() {
    if (!locationId || !month || !form.staffId) {
      setMessage("Choose a BT/RBT before saving the supervision record.");
      return;
    }

    if (form.serviceHours < 0 || form.supervisionHours < 0) {
      setMessage("Service and supervision hours cannot be negative.");
      return;
    }

    try {
      setSaving(true);
      const response = await fetch("/api/supervision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId,
          month,
          staffId: form.staffId,
          supervisorStaffId: form.supervisorStaffId || null,
          serviceHours: form.serviceHours,
          supervisionHours: form.supervisionHours,
          note: form.note,
        }),
      });
      const body = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(body.error || "Supervision record could not be saved.");
      }

      closeModal(true);
      await loadSupervision(locationId, month);
      setMessage("Supervision record saved. The staff card now reflects the updated monthly progress.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Supervision record could not be saved.");
    } finally {
      setSaving(false);
    }
  }


  async function deleteRecord(row: SupervisionRow) {
    if (!row.hasSavedRecord) {
      return;
    }

    const confirmed = window.confirm(
      `Delete the saved ${month} supervision record for ${row.staffName}? This does not delete the staff member.`
    );

    if (!confirmed) {
      return;
    }

    try {
      setSaving(true);
      const response = await fetch("/api/supervision", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId,
          month,
          staffId: row.staffId,
        }),
      });
      const body = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(body.error || "Supervision record could not be deleted.");
      }

      await loadSupervision(locationId, month);
      setMessage(
        `The ${month} supervision record for ${row.staffName} was deleted.`
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Supervision record could not be deleted."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="management-layout">
      <section className="section-card">
        <div className={cardStyles.toolbar}>
          <div className={cardStyles.toolbarLeft}>
            <label className="form-field compact-field">
              <span>Location</span>
              <select value={locationId} disabled={loading} onChange={(event) => setLocationId(event.target.value)}>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>{location.name}</option>
                ))}
              </select>
            </label>

            <label className="form-field compact-field">
              <span>Month</span>
              <input type="month" value={month} disabled={loading} onChange={(event) => setMonth(event.target.value)} />
            </label>

            <label className={`form-field compact-field ${cardStyles.searchField}`}>
              <span>Find staff</span>
              <input value={query} placeholder="Search staff or supervisor..." onChange={(event) => setQuery(event.target.value)} />
            </label>
          </div>

          <button type="button" className={cardStyles.addButton} disabled={!locationId || rows.length === 0} onClick={openNewRecord}>
            <span className={cardStyles.addIcon}>+</span>
            Record Supervision
          </button>
        </div>

        <div className={cardStyles.summaryStrip}>
          <div className={cardStyles.summaryItem}>
            <span>Planning target</span>
            <strong>{(data?.planningTargetPercent ?? 5).toFixed(1)}%</strong>
          </div>
          <div className={cardStyles.summaryItem}>
            <span>Active BCBAs</span>
            <strong>{data?.bcbaCount ?? 0}</strong>
          </div>
          <div className={cardStyles.summaryItem}>
            <span>Need supervision</span>
            <strong>{staffNeedingSupervision.length}</strong>
          </div>
          <div className={cardStyles.summaryItem}>
            <span>On target</span>
            <strong>{rows.filter((row) => row.status === "ON_TARGET").length}</strong>
          </div>
        </div>

        {data?.hasSupervisionGap ? (
          <div className="notice warning-notice">
            <strong>No BCBAs are available for supervision</strong>
            <p>BT/RBT staff have remaining supervision needs, but this clinic has no active BCBA record.</p>
          </div>
        ) : null}

        {loading ? (
          <div className="inline-message">Loading supervision planning data...</div>
        ) : visibleRows.length === 0 ? (
          <div className={cardStyles.emptyState}>No active BT/RBT supervision rows match this view.</div>
        ) : (
          <div className={cardStyles.grid}>
            {visibleRows.map((row) => {
              const completion = row.targetHours > 0
                ? Math.min((row.supervisionHours / row.targetHours) * 100, 100)
                : 100;

              return (
                <article
                  key={row.staffId}
                  className={cardStyles.card}
                  style={{ "--accent": row.color } as React.CSSProperties}
                >
                  <div className={cardStyles.cardTop}>
                    <div className={cardStyles.identity}>
                      <div className={cardStyles.avatar}>{initials(row.staffName)}</div>
                      <div className={cardStyles.identityCopy}>
                        <h3>{row.staffName}</h3>
                        <p>{row.role} · {month}</p>
                      </div>
                    </div>
                    <span className={`${cardStyles.pill} ${row.status === "ON_TARGET" ? "" : cardStyles.pillMuted}`}>
                      {row.status === "ON_TARGET" ? "On target" : "Needs supervision"}
                    </span>
                  </div>

                  <div className={cardStyles.progressTrack} aria-label="Supervision progress">
                    <div
                      className={`${cardStyles.progressFill} ${row.status === "ON_TARGET" ? "" : cardStyles.warningFill}`}
                      style={{ width: `${completion}%` }}
                    />
                  </div>

                  <div className={cardStyles.detailList}>
                    <div className={cardStyles.detailRow}>
                      <span>Service hours</span>
                      <strong>{row.serviceHours.toFixed(1)} h</strong>
                    </div>
                    <div className={cardStyles.detailRow}>
                      <span>Supervision recorded</span>
                      <strong>{row.supervisionHours.toFixed(1)} h</strong>
                    </div>
                    <div className={cardStyles.detailRow}>
                      <span>Target / remaining</span>
                      <strong>{row.targetHours.toFixed(1)} / {row.remainingHours.toFixed(1)} h</strong>
                    </div>
                    <div className={cardStyles.detailRow}>
                      <span>Supervisor</span>
                      <strong>{row.supervisorName ?? "Not assigned"}</strong>
                    </div>
                  </div>

                  <div className={cardStyles.cardActions}>
                    <button
                      type="button"
                      className={`button button-small ${cardStyles.editButton}`}
                      disabled={saving}
                      onClick={() => openEditRecord(row)}
                    >
                      {row.hasSavedRecord ? "Edit" : "Add Record"}
                    </button>
                    {row.hasSavedRecord ? (
                      <button
                        type="button"
                        className={`button button-small ${cardStyles.dangerButton}`}
                        disabled={saving}
                        onClick={() => void deleteRecord(row)}
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <div className="inline-message">{message}</div>
      </section>

      <ManagementModal
        open={modalOpen}
        title="Record Supervision"
        eyebrow="MONTHLY TRACKING"
        description="Save a planning record for a BT/RBT. The card view will compare recorded supervision against the clinic's target percentage."
        size="medium"
        onClose={closeModal}
        footer={
          <>
            <button type="button" className="button button-secondary" disabled={saving} onClick={() => closeModal()}>Cancel</button>
            <button type="button" className="button button-primary" disabled={saving || !form.staffId} onClick={() => void saveRecord()}>
              {saving ? "Saving..." : "Save Supervision"}
            </button>
          </>
        }
      >
        <div className={cardStyles.formSection}>
          <h3>Supervision record</h3>
          <p>Service hours default to the current planning value and can be adjusted when the clinic has a more accurate total.</p>

          <div className="form-grid">
            <label className="form-field form-field-wide">
              <span>BT / RBT</span>
              <select value={form.staffId} onChange={(event) => chooseStaff(event.target.value)}>
                <option value="">Choose staff member</option>
                {rows.map((row) => <option key={row.staffId} value={row.staffId}>{row.staffName} ({row.role})</option>)}
              </select>
            </label>

            <label className="form-field form-field-wide">
              <span>BCBA supervisor</span>
              <select value={form.supervisorStaffId} onChange={(event) => setForm((current) => ({ ...current, supervisorStaffId: event.target.value }))}>
                <option value="">Not assigned</option>
                {supervisors.map((supervisor) => <option key={supervisor.id} value={supervisor.id}>{supervisor.fullName}</option>)}
              </select>
            </label>

            <label className="form-field">
              <span>Service hours</span>
              <input type="number" min="0" step="0.5" value={form.serviceHours} onChange={(event) => setForm((current) => ({ ...current, serviceHours: Number(event.target.value) }))} />
            </label>

            <label className="form-field">
              <span>Supervision hours</span>
              <input type="number" min="0" step="0.25" value={form.supervisionHours} onChange={(event) => setForm((current) => ({ ...current, supervisionHours: Number(event.target.value) }))} />
            </label>

            <label className="form-field form-field-wide">
              <span>Manager note</span>
              <textarea rows={4} value={form.note} placeholder="Optional note about supervision planning or completion..." onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} />
            </label>
          </div>
        </div>

        <div className={`${cardStyles.modalMessage} inline-message`}>{message}</div>
      </ManagementModal>
    </div>
  );
}
