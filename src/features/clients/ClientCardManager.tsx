"use client";

import { useEffect, useMemo, useState } from "react";

import cardStyles from "@/components/ManagementCards.module.css";
import { useActionConfirmDialog } from "@/components/ActionConfirmDialog";
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
  firstName: string;
  lastName: string;
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
    firstName: "",
    lastName: "",
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

function splitClientName(fullName: string): {
  firstName: string;
  lastName: string;
} {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" "),
  };
}

function calendarCodePart(value: string): string {
  const letters = value.trim().replace(/[^A-Za-z]/g, "");
  if (!letters) return "";
  return (
    letters.charAt(0).toUpperCase() +
    letters.charAt(1).toLowerCase()
  );
}

function clientDisplayCode(firstName: string, lastName: string): string {
  return `${calendarCodePart(firstName)}${calendarCodePart(lastName)}`;
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
      createWeeklySchedule("08:00", "16:00", false)
    );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [message, setMessage] = useState("Loading clients...");
  const { requestActionDialog, actionDialog } = useActionConfirmDialog();

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
      const clientType =
        client.serviceSetting === "IN_HOME"
          ? "home client"
          : "regular kid in-center";
      return [
        client.displayCode,
        client.supportLevel,
        clientType,
        teamName,
      ].some((value) =>
        value.toLowerCase().includes(normalizedQuery)
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
      createWeeklySchedule("08:00", "16:00", false)
    );
    setSaveError("");
    setModalOpen(true);
  }

  function openEditClient(client: ClientRecord) {
    const preferredStaffIds = client.staffRelationships
      .filter((relationship) => relationship.relationship === "PREFERRED")
      .map((relationship) => relationship.staffId);
    const restrictedStaffIds = client.staffRelationships
      .filter((relationship) => relationship.relationship === "HARD_RESTRICTION")
      .map((relationship) => relationship.staffId);

    const clientName = splitClientName(client.fullName);

    setEditingId(client.id);
    setForm({
      firstName: clientName.firstName,
      lastName: clientName.lastName,
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
      createWeeklySchedule("08:00", "16:00", false)
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
      !form.firstName.trim() ||
      !form.lastName.trim() ||
      !form.startDate
    ) {
      setSaveError("Client first name, last name, and start date are required.");
      return;
    }

    const hasAttendanceHours = Object.values(
      weeklyAttendanceSchedule
    ).some((day) => day.enabled);
    const attendanceScheduleError = hasAttendanceHours
      ? validateWeeklySchedule(
          weeklyAttendanceSchedule,
          "attendance"
        )
      : null;

    if (attendanceScheduleError) {
      setSaveError(attendanceScheduleError);
      return;
    }

    const attendancePatterns = patternsFromWeeklySchedule(
      weeklyAttendanceSchedule,
      "Regular attendance"
    );
    const fullName = `${form.firstName.trim()} ${form.lastName.trim()}`.trim();
    const displayCode = clientDisplayCode(
      form.firstName,
      form.lastName
    );

    if (displayCode.length < 4) {
      setSaveError(
        "First name and last name must each contain at least two letters so the calendar code can be generated."
      );
      return;
    }

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
      setSaveError("");
      setSaving(true);
      const response = await fetch(
        editingId ? `/api/clients/${editingId}` : "/api/clients",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(25000),
          body: JSON.stringify({
            locationId: selectedLocationId,
            firstName: form.firstName.trim(),
            lastName: form.lastName.trim(),
            fullName,
            displayCode,
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
            staffRelationships,
          }),
        }
      );
      const rawResponse = await response.text();
      const data = (rawResponse ? JSON.parse(rawResponse) : {}) as ClientsResponse;

      if (!response.ok) {
        throw new Error(data.error || "Client could not be saved.");
      }

      const savedCode = displayCode;
      closeModal(true);
      // The profile has already been saved. A list refresh failure must not
      // be reported as a failed save or keep the editor open.
      void loadLocationData(selectedLocationId);
      setSaveError(
        attendancePatterns.length > 0
          ? `${savedCode} was saved and is available to the scheduler.`
          : `${savedCode} was saved. Add attendance days/hours before the automatic scheduler can schedule this client.`
      );
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Client could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteClient(client: ClientRecord) {
    const choice = await requestActionDialog({
      eyebrow: "DELETE CLIENT",
      title: `Permanently delete ${client.displayCode}?`,
      description:
        `This removes client ${client.displayCode} and its linked live schedule, nap, speech, attendance, unplaced, and template references. Imported historical-learning text is preserved.`,
      actions: [
        {
          id: "delete",
          label: "Delete client",
          tone: "danger",
        },
      ],
    });

    if (choice !== "delete") {
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
      {actionDialog}
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
                placeholder="Search code, client type, support, or team..."
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
            <span>Total clients</span>
            <strong>{clients.filter((client) => client.active).length}</strong>
          </div>
          <div className={cardStyles.summaryItem}>
            <span>Regular kids / in-center</span>
            <strong>
              {clients.filter(
                (client) =>
                  client.active &&
                  client.serviceSetting === "IN_CENTER"
              ).length}
            </strong>
          </div>
          <div className={cardStyles.summaryItem}>
            <span>Home clients</span>
            <strong>
              {clients.filter(
                (client) =>
                  client.active &&
                  client.serviceSetting === "IN_HOME"
              ).length}
            </strong>
          </div>
          <div className={cardStyles.summaryItem}>
            <span>Schedulable now</span>
            <strong>
              {clients.filter(
                (client) =>
                  client.active &&
                  client.attendancePatterns.length > 0
              ).length}
            </strong>
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
                        <p>
                          {client.serviceSetting === "IN_HOME"
                            ? "Home Client"
                            : "Regular Kid / In-Center"}
                        </p>
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
        {saveError ? (
          <div role="alert" style={{ position: "sticky", top: 0, zIndex: 12, marginBottom: 12, padding: "12px 16px", border: "1px solid #e49c9c", borderRadius: 10, background: "#fff0f0", color: "#842424", fontWeight: 750 }}>
            Save was not completed: {saveError}
          </div>
        ) : null}
        <div className={cardStyles.formSection}>
          <h3>Client essentials</h3>
          <p>
            Enter first and last name separately. The calendar code is generated
            automatically using the first two letters of each name, for example
            Ziva Bowman becomes ZiBo.
          </p>
          <div className="form-grid">
            <label className="form-field">
              <span>First name</span>
              <input
                autoFocus
                value={form.firstName}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    firstName: event.target.value,
                  }))
                }
              />
            </label>
            <label className="form-field">
              <span>Last name</span>
              <input
                value={form.lastName}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    lastName: event.target.value,
                  }))
                }
              />
            </label>
            <label className="form-field">
              <span>Calendar display code</span>
              <input
                readOnly
                value={clientDisplayCode(
                  form.firstName,
                  form.lastName
                )}
                placeholder="Auto-generated"
              />
              <small>
                First name: capital first letter + lowercase second letter;
                last name uses the same format.
              </small>
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
              <span>Client type</span>
              <select value={form.serviceSetting} onChange={(event) => setForm((current) => ({ ...current, serviceSetting: event.target.value as ServiceSetting }))}>
                <option value="IN_CENTER">Regular Kid / In-Center Client</option>
                <option value="IN_HOME">Home Client</option>
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
          <h3>Nap scheduling</h3>
          <p>
            Nap timing is managed from Speech, Nap & Attendance Changes so the
            same nap window can be applied to multiple kids at once. Every
            client who is present during the clinic nap period receives a
            flexible daily nap automatically; special Nap events can narrow the
            allowed window for selected kids.
          </p>
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
