"use client";

import { useEffect, useMemo, useState } from "react";

import cardStyles from "@/components/ManagementCards.module.css";
import { ManagementModal } from "@/components/ManagementModal";
import {
  createWeeklySchedule,
  patternsFromWeeklySchedule,
  validateWeeklySchedule,
  weeklyScheduleFromPatterns,
  type WeeklySchedule,
} from "@/features/shared/weeklySchedule";

type ServiceSetting = "IN_CENTER" | "IN_HOME" | "BOTH";
type SupportLevel = "STANDARD" | "ONE_TO_ONE" | "ROTATION" | "HIGH_SUPPORT";
type Relationship = "PREFERRED" | "ALLOWED" | "HARD_RESTRICTION";

type LocationOption = {
  id: string;
  name: string;
};

type TeamOption = {
  id: string;
  name: string;
};

type StaffOption = {
  id: string;
  fullName: string;
  role: string;
  active: boolean;
};

type TimePattern = {
  name: string;
  days: string[];
  startTime: string;
  endTime: string;
};

type StaffRelationship = {
  staffId: string;
  relationship: Relationship;
};

type ClientRecord = {
  id: string;
  fullName: string;
  displayCode: string;
  startDate: string;
  endDate: string | null;
  teamId: string | null;
  color: string;
  serviceSetting: ServiceSetting;
  supportLevel: SupportLevel;
  insurancePlan: string;
  assignedBcbaId: string | null;
  assignedInternIds: string[];
  attendancePatterns: TimePattern[];
  napPatterns: TimePattern[];
  staffRelationships: StaffRelationship[];
  active: boolean;
};

type ClientForm = {
  fullName: string;
  displayCode: string;
  startDate: string;
  endDate: string;
  teamId: string;
  color: string;
  serviceSetting: ServiceSetting;
  supportLevel: SupportLevel;
  insurancePlan: string;
  assignedBcbaId: string;
  assignedInternIds: string[];
  attendancePatterns: TimePattern[];
  napPatterns: TimePattern[];
  preferredStaffIds: string[];
  restrictedStaffIds: string[];
};

type LocationsResponse = {
  locations?: LocationOption[];
  error?: string;
};

type TeamsResponse = {
  teams?: TeamOption[];
  error?: string;
};

type StaffResponse = {
  staff?: StaffOption[];
  error?: string;
};

type ClientsResponse = {
  clients?: ClientRecord[];
  error?: string;
};

const WEEKDAYS = [
  ["MONDAY", "Mon"],
  ["TUESDAY", "Tue"],
  ["WEDNESDAY", "Wed"],
  ["THURSDAY", "Thu"],
  ["FRIDAY", "Fri"],
] as const;

function localToday(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function emptyClientForm(): ClientForm {
  return {
    fullName: "",
    displayCode: "",
    startDate: localToday(),
    endDate: "",
    teamId: "",
    color: "#7FD8CB",
    serviceSetting: "IN_CENTER",
    supportLevel: "ONE_TO_ONE",
    insurancePlan: "",
    assignedBcbaId: "",
    assignedInternIds: [],
    attendancePatterns: [],
    napPatterns: [],
    preferredStaffIds: [],
    restrictedStaffIds: [],
  };
}

function emptyAttendance(): TimePattern {
  return {
    name: "Regular attendance",
    days: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
    startTime: "08:00",
    endTime: "16:00",
  };
}

function emptyNap(): TimePattern {
  return {
    name: "Nap",
    days: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
    startTime: "12:00",
    endTime: "13:00",
  };
}

function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
}

function prettyEnum(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatPattern(pattern: TimePattern): string {
  const days = pattern.days
    .map((day) => WEEKDAYS.find(([value]) => value === day)?.[1] ?? day.slice(0, 3))
    .join(", ");
  return `${days} · ${pattern.startTime}-${pattern.endTime}`;
}

function patternTimeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function patternHours(pattern: TimePattern): number {
  return Math.max(
    (patternTimeToMinutes(pattern.endTime) -
      patternTimeToMinutes(pattern.startTime)) /
      60,
    0
  );
}

function attendanceHoursForDay(client: ClientRecord, day: string): number {
  return (client.attendancePatterns ?? [])
    .filter((pattern) => pattern.days.includes(day))
    .reduce((total, pattern) => total + patternHours(pattern), 0);
}

function weeklyAttendanceHours(client: ClientRecord): number {
  return WEEKDAYS.reduce(
    (total, [day]) => total + attendanceHoursForDay(client, day),
    0
  );
}

function formatHours(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function ClientCardManager() {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<ClientForm>(emptyClientForm);
  const [attendanceDraft, setAttendanceDraft] = useState<TimePattern>(emptyAttendance);
  const [weeklyAttendanceSchedule, setWeeklyAttendanceSchedule] =
    useState<WeeklySchedule>(() =>
      createWeeklySchedule("08:00", "16:00", true)
    );
  const [napDraft, setNapDraft] = useState<TimePattern>(emptyNap);
  const [weeklyNapSchedule, setWeeklyNapSchedule] =
    useState<WeeklySchedule>(() =>
      createWeeklySchedule("12:00", "13:00", false)
    );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("Loading clients...");

  const teamNameById = useMemo(
    () => new Map(teams.map((team) => [team.id, team.name])),
    [teams]
  );

  const staffNameById = useMemo(
    () => new Map(staff.map((staffMember) => [staffMember.id, staffMember.fullName])),
    [staff]
  );

  const activeStaff = useMemo(
    () => staff.filter((staffMember) => staffMember.active),
    [staff]
  );

  const bcbaOptions = useMemo(
    () => activeStaff.filter((staffMember) => staffMember.role === "BCBA"),
    [activeStaff]
  );

  const internOptions = useMemo(
    () => activeStaff.filter((staffMember) => staffMember.role === "INTERN"),
    [activeStaff]
  );

  const pairingStaff = useMemo(
    () => activeStaff.filter((staffMember) => ["BT", "RBT", "INTERN"].includes(staffMember.role)),
    [activeStaff]
  );

  const visibleClients = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return clients.filter((client) => {
      if (!normalizedQuery) {
        return true;
      }

      const teamName = client.teamId ? teamNameById.get(client.teamId) ?? "" : "";
      return [client.displayCode, client.fullName, client.supportLevel, teamName].some(
        (value) => value.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [clients, query, teamNameById]);

  useEffect(() => {
    void loadLocations();
  }, []);

  useEffect(() => {
    if (selectedLocationId) {
      void loadLocationData(selectedLocationId);
    }
  }, [selectedLocationId]);

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
      setSelectedLocationId(nextLocations[0]?.id ?? "");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Locations could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  async function loadLocationData(locationId: string) {
    try {
      setLoading(true);
      const [clientResponse, teamResponse, staffResponse] = await Promise.all([
        fetch(
          `/api/clients?locationId=${encodeURIComponent(locationId)}`,
          { cache: "no-store" }
        ),
        fetch(`/api/teams?locationId=${encodeURIComponent(locationId)}`, {
          cache: "no-store",
        }),
        fetch(
          `/api/staff?locationId=${encodeURIComponent(locationId)}`,
          { cache: "no-store" }
        ),
      ]);

      const clientData = (await clientResponse.json()) as ClientsResponse;
      const teamData = (await teamResponse.json()) as TeamsResponse;
      const staffData = (await staffResponse.json()) as StaffResponse;

      if (!clientResponse.ok) {
        throw new Error(clientData.error || "Clients could not be loaded.");
      }
      if (!teamResponse.ok) {
        throw new Error(teamData.error || "Teams could not be loaded.");
      }
      if (!staffResponse.ok) {
        throw new Error(staffData.error || "Staff could not be loaded.");
      }

      setClients(clientData.clients ?? []);
      setTeams(teamData.teams ?? []);
      setStaff(staffData.staff ?? []);
      setMessage("Client roster loaded. Use + Add Client to create another profile.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Client data could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  function openNewClient() {
    setEditingId(null);
    setForm(emptyClientForm());
    setAttendanceDraft(emptyAttendance());
    setWeeklyAttendanceSchedule(
      createWeeklySchedule("08:00", "16:00", true)
    );
    setNapDraft(emptyNap());
    setWeeklyNapSchedule(
      createWeeklySchedule("12:00", "13:00", false)
    );
    setModalOpen(true);
  }

  function openEditClient(client: ClientRecord) {
    const preferredStaffIds = client.staffRelationships
      .filter((relationship) => relationship.relationship === "PREFERRED")
      .map((relationship) => relationship.staffId);
    const restrictedStaffIds = client.staffRelationships
      .filter((relationship) => relationship.relationship === "HARD_RESTRICTION")
      .map((relationship) => relationship.staffId);

    setEditingId(client.id);
    setForm({
      fullName: client.fullName,
      displayCode: client.displayCode,
      startDate: client.startDate.slice(0, 10),
      endDate: client.endDate?.slice(0, 10) ?? "",
      teamId: client.teamId ?? "",
      color: client.color || "#7FD8CB",
      serviceSetting: client.serviceSetting,
      supportLevel: client.supportLevel,
      insurancePlan: client.insurancePlan ?? "",
      assignedBcbaId: client.assignedBcbaId ?? "",
      assignedInternIds: [...(client.assignedInternIds ?? [])],
      attendancePatterns: (client.attendancePatterns ?? []).map((pattern) => ({
        ...pattern,
        days: [...pattern.days],
      })),
      napPatterns: (client.napPatterns ?? []).map((pattern) => ({
        ...pattern,
        days: [...pattern.days],
      })),
      preferredStaffIds,
      restrictedStaffIds,
    });
    setAttendanceDraft(emptyAttendance());
    setWeeklyAttendanceSchedule(
      weeklyScheduleFromPatterns(
        client.attendancePatterns ?? [],
        "08:00",
        "16:00"
      )
    );
    setNapDraft(emptyNap());
    setWeeklyNapSchedule(
      weeklyScheduleFromPatterns(
        client.napPatterns ?? [],
        "12:00",
        "13:00"
      )
    );
    setModalOpen(true);
  }

  function closeModal(force = false) {
    if (saving && !force) {
      return;
    }
    setModalOpen(false);
    setEditingId(null);
    setForm(emptyClientForm());
    setAttendanceDraft(emptyAttendance());
    setWeeklyAttendanceSchedule(
      createWeeklySchedule("08:00", "16:00", true)
    );
    setNapDraft(emptyNap());
    setWeeklyNapSchedule(
      createWeeklySchedule("12:00", "13:00", false)
    );
  }

  function toggleDraftDay(
    draft: TimePattern,
    setDraft: (pattern: TimePattern) => void,
    day: string
  ) {
    setDraft({
      ...draft,
      days: draft.days.includes(day)
        ? draft.days.filter((value) => value !== day)
        : [...draft.days, day],
    });
  }

  function applyAttendanceToSelectedDays() {
    if (attendanceDraft.days.length === 0) {
      setMessage("Choose at least one weekday to apply attendance hours.");
      return;
    }

    if (attendanceDraft.endTime <= attendanceDraft.startTime) {
      setMessage("Attendance end time must be later than the start time.");
      return;
    }

    setWeeklyAttendanceSchedule((current) => {
      const next = { ...current };

      for (const day of attendanceDraft.days) {
        next[day] = {
          enabled: true,
          startTime: attendanceDraft.startTime,
          endTime: attendanceDraft.endTime,
        };
      }

      return next;
    });
    setMessage(
      `Applied ${attendanceDraft.startTime}-${attendanceDraft.endTime} attendance to the selected weekdays.`
    );
  }

  function toggleWeeklyAttendanceDay(day: string) {
    setWeeklyAttendanceSchedule((current) => ({
      ...current,
      [day]: {
        ...current[day],
        enabled: !current[day]?.enabled,
      },
    }));
  }

  function updateWeeklyAttendanceTime(
    day: string,
    field: "startTime" | "endTime",
    value: string
  ) {
    setWeeklyAttendanceSchedule((current) => ({
      ...current,
      [day]: {
        ...current[day],
        [field]: value,
      },
    }));
  }

  function applyNapToSelectedDays() {
    if (napDraft.days.length === 0) {
      setMessage("Choose at least one weekday to apply the nap window.");
      return;
    }

    if (napDraft.endTime <= napDraft.startTime) {
      setMessage("Nap window end time must be later than the start time.");
      return;
    }

    setWeeklyNapSchedule((current) => {
      const next = { ...current };

      for (const day of napDraft.days) {
        next[day] = {
          enabled: true,
          startTime: napDraft.startTime,
          endTime: napDraft.endTime,
        };
      }

      return next;
    });
    setMessage(
      `Applied ${napDraft.startTime}-${napDraft.endTime} nap window to the selected weekdays.`
    );
  }

  function toggleWeeklyNapDay(day: string) {
    setWeeklyNapSchedule((current) => ({
      ...current,
      [day]: {
        ...current[day],
        enabled: !current[day]?.enabled,
      },
    }));
  }

  function updateWeeklyNapTime(
    day: string,
    field: "startTime" | "endTime",
    value: string
  ) {
    setWeeklyNapSchedule((current) => ({
      ...current,
      [day]: {
        ...current[day],
        [field]: value,
      },
    }));
  }

  function toggleId(field: "assignedInternIds" | "preferredStaffIds" | "restrictedStaffIds", id: string) {
    setForm((current) => ({
      ...current,
      [field]: current[field].includes(id)
        ? current[field].filter((value) => value !== id)
        : [...current[field], id],
    }));
  }

  async function saveClient() {
    if (
      !selectedLocationId ||
      !form.fullName.trim() ||
      !form.displayCode.trim() ||
      !form.startDate
    ) {
      setMessage("Client name, display code, and start date are required.");
      return;
    }

    const attendanceScheduleError = validateWeeklySchedule(
      weeklyAttendanceSchedule,
      "attendance"
    );

    if (attendanceScheduleError) {
      setMessage(attendanceScheduleError);
      return;
    }

    const attendancePatterns = patternsFromWeeklySchedule(
      weeklyAttendanceSchedule,
      "Regular attendance"
    );
    const napScheduleError =
      Object.values(weeklyNapSchedule).some(
        (day) =>
          day.enabled &&
          (!day.startTime ||
            !day.endTime ||
            day.endTime <= day.startTime)
      )
        ? "Each enabled nap window must end after it starts."
        : null;

    if (napScheduleError) {
      setMessage(napScheduleError);
      return;
    }

    const napPatterns = patternsFromWeeklySchedule(
      weeklyNapSchedule,
      "Nap window"
    );

    const staffRelationships = pairingStaff.map((staffMember) => {
      let relationship: Relationship = "ALLOWED";
      if (form.preferredStaffIds.includes(staffMember.id)) {
        relationship = "PREFERRED";
      }
      if (form.restrictedStaffIds.includes(staffMember.id)) {
        relationship = "HARD_RESTRICTION";
      }
      return { staffId: staffMember.id, relationship };
    });

    try {
      setSaving(true);
      const response = await fetch(
        editingId ? `/api/clients/${editingId}` : "/api/clients",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            locationId: selectedLocationId,
            fullName: form.fullName.trim(),
            displayCode: form.displayCode.trim(),
            startDate: form.startDate,
            endDate: form.endDate || null,
            teamId: form.teamId || null,
            color: form.color,
            serviceSetting: form.serviceSetting,
            supportLevel: form.supportLevel,
            insurancePlan: form.insurancePlan.trim(),
            assignedBcbaId: form.assignedBcbaId || null,
            assignedInternIds: form.assignedInternIds,
            attendancePatterns,
            napPatterns,
            staffRelationships,
          }),
        }
      );
      const data = (await response.json()) as ClientsResponse;

      if (!response.ok) {
        throw new Error(data.error || "Client could not be saved.");
      }

      const savedCode = form.displayCode.trim();
      closeModal(true);
      await loadLocationData(selectedLocationId);
      setMessage(`${savedCode} was saved and is available to the scheduler.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Client could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteClient(client: ClientRecord) {
    const confirmed = window.confirm(
      `Permanently delete ${client.displayCode} (${client.fullName})? This removes the client profile and its linked live schedule, nap, speech, attendance, unplaced, and template references. Imported historical-learning text is preserved.`
    );

    if (!confirmed) {
      return;
    }

    try {
      setSaving(true);
      const response = await fetch(`/api/clients/${client.id}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as ClientsResponse;

      if (!response.ok) {
        throw new Error(data.error || "Client could not be deleted.");
      }

      await loadLocationData(selectedLocationId);
      setMessage(`${client.displayCode} was permanently deleted.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Client could not be deleted."
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
              <span>Clinic location</span>
              <select
                value={selectedLocationId}
                disabled={loading}
                onChange={(event) => setSelectedLocationId(event.target.value)}
              >
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>{location.name}</option>
                ))}
              </select>
            </label>

            <label className={`form-field compact-field ${cardStyles.searchField}`}>
              <span>Find client</span>
              <input
                value={query}
                placeholder="Search code, name, support, or team..."
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>

          </div>

          <button
            type="button"
            className={cardStyles.addButton}
            disabled={!selectedLocationId}
            onClick={openNewClient}
          >
            <span className={cardStyles.addIcon}>+</span>
            Add Client
          </button>
        </div>

        <div className={cardStyles.summaryStrip}>
          <div className={cardStyles.summaryItem}>
            <span>Active clients</span>
            <strong>{clients.filter((client) => client.active).length}</strong>
          </div>
          <div className={cardStyles.summaryItem}>
            <span>Rotation / high support</span>
            <strong>
              {clients.filter(
                (client) => client.active && ["ROTATION", "HIGH_SUPPORT"].includes(client.supportLevel)
              ).length}
            </strong>
          </div>
          <div className={cardStyles.summaryItem}>
            <span>Nap plans</span>
            <strong>{clients.filter((client) => client.active && client.napPatterns.length > 0).length}</strong>
          </div>
        </div>

        {loading ? (
          <div className="inline-message">Loading clients...</div>
        ) : visibleClients.length === 0 ? (
          <div className={cardStyles.emptyState}>
            No clients match this view. Use + Add Client to create the first profile.
          </div>
        ) : (
          <div className={cardStyles.grid}>
            {visibleClients.map((client) => {
              const preferred = client.staffRelationships
                .filter((relationship) => relationship.relationship === "PREFERRED")
                .map((relationship) => staffNameById.get(relationship.staffId))
                .filter(Boolean) as string[];

              return (
                <article
                  key={client.id}
                  className={cardStyles.card}
                  style={{ "--accent": client.color } as React.CSSProperties}
                >
                  <div className={cardStyles.cardTop}>
                    <div className={cardStyles.identity}>
                      <div className={cardStyles.avatar}>{initials(client.displayCode)}</div>
                      <div className={cardStyles.identityCopy}>
                        <h3>{client.displayCode}</h3>
                        <p>{client.fullName}</p>
                      </div>
                    </div>
                    <span className={`${cardStyles.pill} ${client.active ? "" : cardStyles.pillMuted}`}>
                      {prettyEnum(client.supportLevel)}
                    </span>
                  </div>

                  <div className={cardStyles.detailList}>
                    <div className={cardStyles.detailRow}>
                      <span>Team</span>
                      <strong>{client.teamId ? teamNameById.get(client.teamId) ?? "Unknown" : "No team"}</strong>
                    </div>
                    <div className={cardStyles.detailRow}>
                      <span>Attendance plans</span>
                      <strong>{client.attendancePatterns.length}</strong>
                    </div>
                    <div className={cardStyles.detailRow}>
                      <span>BCBA</span>
                      <strong>
                        {client.assignedBcbaId
                          ? staffNameById.get(client.assignedBcbaId) ?? "Unknown"
                          : "Not assigned"}
                      </strong>
                    </div>
                  </div>

                  <div className={cardStyles.metricHeader}>
                    <span>Weekly attendance</span>
                    <strong>{formatHours(weeklyAttendanceHours(client))} h</strong>
                  </div>
                  <div className={cardStyles.weekdayGrid}>
                    {WEEKDAYS.map(([day, label]) => {
                      const hours = attendanceHoursForDay(client, day);
                      return (
                        <div
                          key={day}
                          className={`${cardStyles.weekdayCell} ${
                            hours > 0 ? cardStyles.weekdayCellActive : ""
                          }`}
                        >
                          <span className={cardStyles.weekdayLabel}>{label}</span>
                          <span className={cardStyles.weekdayHours}>
                            {hours > 0 ? `${formatHours(hours)}h` : "—"}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div className={cardStyles.chips}>
                    {client.attendancePatterns.length === 0 && client.active ? (
                      <span className={cardStyles.chip}>
                        Needs attendance days/hours before scheduling
                      </span>
                    ) : null}
                    {client.attendancePatterns.slice(0, 2).map((pattern, index) => (
                      <span key={`${client.id}-attendance-${index}`} className={cardStyles.chip}>
                        {formatPattern(pattern)}
                      </span>
                    ))}
                    {preferred.slice(0, 3).map((name) => (
                      <span key={`${client.id}-${name}`} className={cardStyles.chip}>
                        Preferred: {name}
                      </span>
                    ))}
                  </div>

                  <div className={cardStyles.cardActions}>
                    <button
                      type="button"
                      className={`button button-small ${cardStyles.editButton}`}
                      disabled={saving}
                      onClick={() => openEditClient(client)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className={`button button-small ${cardStyles.dangerButton}`}
                      disabled={saving}
                      onClick={() => void deleteClient(client)}
                    >
                      Delete
                    </button>
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
        title={editingId ? "Edit Client" : "Add Client"}
        eyebrow="CLIENT PROFILE"
        description="Set attendance and support requirements so the automatic scheduler knows exactly when and how this client needs coverage."
        onClose={closeModal}
        footer={
          <>
            <button type="button" className="button button-secondary" disabled={saving} onClick={() => closeModal()}>
              Cancel
            </button>
            <button type="button" className="button button-primary" disabled={saving} onClick={() => void saveClient()}>
              {saving ? "Saving..." : editingId ? "Save Changes" : "Add Client"}
            </button>
          </>
        }
      >
        <div className={cardStyles.formSection}>
          <h3>Client essentials</h3>
          <p>Calendar code is what appears inside the Excel-style schedule cells.</p>
          <div className="form-grid">
            <label className="form-field form-field-wide">
              <span>Client full name</span>
              <input
                autoFocus
                value={form.fullName}
                onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))}
              />
            </label>
            <label className="form-field">
              <span>Calendar display code</span>
              <input
                value={form.displayCode}
                placeholder="e.g. ZiBo"
                onChange={(event) => setForm((current) => ({ ...current, displayCode: event.target.value }))}
              />
            </label>
            <label className="form-field">
              <span>Support level</span>
              <select
                value={form.supportLevel}
                onChange={(event) => setForm((current) => ({ ...current, supportLevel: event.target.value as SupportLevel }))}
              >
                <option value="STANDARD">Standard</option>
                <option value="ONE_TO_ONE">1:1 staffing</option>
                <option value="ROTATION">Rotation preferred</option>
                <option value="HIGH_SUPPORT">High support / rotation</option>
              </select>
            </label>
            <label className="form-field">
              <span>Start date</span>
              <input type="date" value={form.startDate} onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))} />
            </label>
            <label className="form-field">
              <span>End date (optional)</span>
              <input type="date" value={form.endDate} onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))} />
            </label>
            <label className="form-field">
              <span>Team</span>
              <select value={form.teamId} onChange={(event) => setForm((current) => ({ ...current, teamId: event.target.value }))}>
                <option value="">No team</option>
                {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
            </label>
            <label className="form-field">
              <span>Service location</span>
              <select value={form.serviceSetting} onChange={(event) => setForm((current) => ({ ...current, serviceSetting: event.target.value as ServiceSetting }))}>
                <option value="IN_CENTER">In center</option>
                <option value="IN_HOME">In home</option>
                <option value="BOTH">Both</option>
              </select>
            </label>
            <label className="form-field">
              <span>Card color</span>
              <input type="color" value={form.color} onChange={(event) => setForm((current) => ({ ...current, color: event.target.value }))} />
            </label>
            <label className="form-field form-field-wide">
              <span>Insurance plan (optional)</span>
              <input value={form.insurancePlan} onChange={(event) => setForm((current) => ({ ...current, insurancePlan: event.target.value }))} />
            </label>
          </div>
        </div>

        <div className={cardStyles.formSection}>
          <h3>Weekly attendance / required coverage</h3>
          <p>
            Enter the client's normal attendance hours directly by weekday.
            Quick Apply is useful when several days have the same hours; each
            individual day can still be changed below.
          </p>

          <div className={cardStyles.quickSchedule}>
            <strong>Quick Apply</strong>
            <span>
              Example: apply 09:00-17:00 to Mon, Tue, Wed, then apply
              08:00-16:00 to Thu and Fri.
            </span>

            <div className="form-grid">
              <label className="form-field">
                <span>Starts</span>
                <input
                  type="time"
                  value={attendanceDraft.startTime}
                  onChange={(event) =>
                    setAttendanceDraft({
                      ...attendanceDraft,
                      startTime: event.target.value,
                    })
                  }
                />
              </label>
              <label className="form-field">
                <span>Ends</span>
                <input
                  type="time"
                  value={attendanceDraft.endTime}
                  onChange={(event) =>
                    setAttendanceDraft({
                      ...attendanceDraft,
                      endTime: event.target.value,
                    })
                  }
                />
              </label>
            </div>

            <div className="day-selector">
              {WEEKDAYS.map(([value, label]) => (
                <label key={value} className="checkbox-card">
                  <input
                    type="checkbox"
                    checked={attendanceDraft.days.includes(value)}
                    onChange={() =>
                      toggleDraftDay(
                        attendanceDraft,
                        setAttendanceDraft,
                        value
                      )
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>

            <button
              type="button"
              className="button button-secondary button-small"
              onClick={applyAttendanceToSelectedDays}
            >
              Apply to selected days
            </button>
          </div>

          <div className={cardStyles.weeklyEditor}>
            {WEEKDAYS.map(([value, label]) => {
              const daySchedule = weeklyAttendanceSchedule[value];

              return (
                <div key={value} className={cardStyles.weeklyEditorRow}>
                  <label className={cardStyles.weeklyDayToggle}>
                    <input
                      type="checkbox"
                      checked={daySchedule?.enabled ?? false}
                      onChange={() => toggleWeeklyAttendanceDay(value)}
                    />
                    <strong>{label}</strong>
                  </label>

                  <label className="form-field">
                    <span>Arrival</span>
                    <input
                      type="time"
                      disabled={!daySchedule?.enabled}
                      value={daySchedule?.startTime ?? "08:00"}
                      onChange={(event) =>
                        updateWeeklyAttendanceTime(
                          value,
                          "startTime",
                          event.target.value
                        )
                      }
                    />
                  </label>

                  <label className="form-field">
                    <span>Departure</span>
                    <input
                      type="time"
                      disabled={!daySchedule?.enabled}
                      value={daySchedule?.endTime ?? "16:00"}
                      onChange={(event) =>
                        updateWeeklyAttendanceTime(
                          value,
                          "endTime",
                          event.target.value
                        )
                      }
                    />
                  </label>
                </div>
              );
            })}
          </div>

          <p className="helper-text">
            Uncheck a weekday when the client normally does not attend. These
            daily hours become the required coverage window used by Auto
            Generate.
          </p>
        </div>

        <div className={cardStyles.formSection}>
          <h3>Weekly Nap / Break + Nap windows</h3>
          <p>
            Nap times are placement windows for Auto Generate. The actual nap
            duration comes from Clinic Settings. Enter the allowed window for
            each weekday, or leave the day unchecked when no nap window applies.
          </p>

          <div className={cardStyles.quickSchedule}>
            <strong>Quick Apply</strong>
            <span>
              Select the weekdays that share the same nap window, set the window,
              and apply it. You can then adjust any day individually.
            </span>

            <div className="form-grid">
              <label className="form-field">
                <span>Window starts</span>
                <input
                  type="time"
                  value={napDraft.startTime}
                  onChange={(event) =>
                    setNapDraft({
                      ...napDraft,
                      startTime: event.target.value,
                    })
                  }
                />
              </label>
              <label className="form-field">
                <span>Window ends</span>
                <input
                  type="time"
                  value={napDraft.endTime}
                  onChange={(event) =>
                    setNapDraft({
                      ...napDraft,
                      endTime: event.target.value,
                    })
                  }
                />
              </label>
            </div>

            <div className="day-selector">
              {WEEKDAYS.map(([value, label]) => (
                <label key={value} className="checkbox-card">
                  <input
                    type="checkbox"
                    checked={napDraft.days.includes(value)}
                    onChange={() =>
                      toggleDraftDay(napDraft, setNapDraft, value)
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>

            <button
              type="button"
              className="button button-secondary button-small"
              onClick={applyNapToSelectedDays}
            >
              Apply nap window to selected days
            </button>
          </div>

          <div className={cardStyles.weeklyEditor}>
            {WEEKDAYS.map(([value, label]) => {
              const daySchedule = weeklyNapSchedule[value];

              return (
                <div key={value} className={cardStyles.weeklyEditorRow}>
                  <label className={cardStyles.weeklyDayToggle}>
                    <input
                      type="checkbox"
                      checked={daySchedule?.enabled ?? false}
                      onChange={() => toggleWeeklyNapDay(value)}
                    />
                    <strong>{label}</strong>
                  </label>

                  <label className="form-field">
                    <span>Window start</span>
                    <input
                      type="time"
                      disabled={!daySchedule?.enabled}
                      value={daySchedule?.startTime ?? "12:00"}
                      onChange={(event) =>
                        updateWeeklyNapTime(
                          value,
                          "startTime",
                          event.target.value
                        )
                      }
                    />
                  </label>

                  <label className="form-field">
                    <span>Window end</span>
                    <input
                      type="time"
                      disabled={!daySchedule?.enabled}
                      value={daySchedule?.endTime ?? "13:00"}
                      onChange={(event) =>
                        updateWeeklyNapTime(
                          value,
                          "endTime",
                          event.target.value
                        )
                      }
                    />
                  </label>
                </div>
              );
            })}
          </div>
        </div>

        <div className={cardStyles.formSection}>
          <h3>Clinical relationships</h3>
          <p>Preferred staff receive priority; restricted staff will not be automatically paired with this client.</p>

          <div className="form-grid">
            <label className="form-field">
              <span>Assigned BCBA</span>
              <select value={form.assignedBcbaId} onChange={(event) => setForm((current) => ({ ...current, assignedBcbaId: event.target.value }))}>
                <option value="">Not assigned</option>
                {bcbaOptions.map((staffMember) => <option key={staffMember.id} value={staffMember.id}>{staffMember.fullName}</option>)}
              </select>
            </label>
          </div>

          {internOptions.length > 0 ? (
            <>
              <p className="helper-text">Assigned interns</p>
              <div className="day-selector">
                {internOptions.map((staffMember) => (
                  <label key={staffMember.id} className="checkbox-card">
                    <input type="checkbox" checked={form.assignedInternIds.includes(staffMember.id)} onChange={() => toggleId("assignedInternIds", staffMember.id)} />
                    <span>{staffMember.fullName}</span>
                  </label>
                ))}
              </div>
            </>
          ) : null}

          {pairingStaff.length > 0 ? (
            <>
              <p className="helper-text">Preferred therapists</p>
              <div className="day-selector">
                {pairingStaff.map((staffMember) => (
                  <label key={`preferred-${staffMember.id}`} className="checkbox-card">
                    <input type="checkbox" checked={form.preferredStaffIds.includes(staffMember.id)} onChange={() => toggleId("preferredStaffIds", staffMember.id)} />
                    <span>{staffMember.fullName}</span>
                  </label>
                ))}
              </div>

              <p className="helper-text">Hard restrictions</p>
              <div className="day-selector">
                {pairingStaff.map((staffMember) => (
                  <label key={`restricted-${staffMember.id}`} className="checkbox-card">
                    <input type="checkbox" checked={form.restrictedStaffIds.includes(staffMember.id)} onChange={() => toggleId("restrictedStaffIds", staffMember.id)} />
                    <span>{staffMember.fullName}</span>
                  </label>
                ))}
              </div>
            </>
          ) : null}
        </div>

        <div className={`${cardStyles.modalMessage} inline-message`}>{message}</div>
      </ManagementModal>
    </div>
  );
}
