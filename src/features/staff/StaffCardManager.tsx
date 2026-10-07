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

type EmployeeType = "FULL_TIME" | "PART_TIME";
type ServiceSetting = "IN_CENTER" | "IN_HOME" | "BOTH";
type StaffRole =
  | "BT"
  | "RBT"
  | "INTERN"
  | "BCBA"
  | "OFFICE_MANAGER"
  | "OTHER";

type LocationOption = {
  id: string;
  name: string;
};

type TeamOption = {
  id: string;
  name: string;
  color: string;
};

type ShiftPattern = {
  name: string;
  days: string[];
  startTime: string;
  endTime: string;
};

type StaffMember = {
  id: string;
  fullName: string;
  startDate: string;
  endDate: string | null;
  role: StaffRole;
  employeeType: EmployeeType;
  teamId: string | null;
  color: string;
  serviceSetting: ServiceSetting;
  minimumWeeklyHours: number;
  targetWeeklyHours: number;
  maximumWeeklyHours: number;
  shiftPatterns: ShiftPattern[];
  active: boolean;
};

type StaffForm = {
  fullName: string;
  startDate: string;
  endDate: string;
  role: StaffRole;
  employeeType: EmployeeType;
  teamId: string;
  color: string;
  serviceSetting: ServiceSetting;
  minimumWeeklyHours: number;
  targetWeeklyHours: number;
  maximumWeeklyHours: number;
  shiftPatterns: ShiftPattern[];
};

type StaffResponse = {
  staff?: StaffMember[];
  error?: string;
};

type LocationsResponse = {
  locations?: LocationOption[];
  error?: string;
};

type TeamsResponse = {
  teams?: TeamOption[];
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

function emptyForm(): StaffForm {
  return {
    fullName: "",
    startDate: localToday(),
    endDate: "",
    role: "BT",
    employeeType: "FULL_TIME",
    teamId: "",
    color: "#7DB2E8",
    serviceSetting: "IN_CENTER",
    minimumWeeklyHours: 30,
    targetWeeklyHours: 40,
    maximumWeeklyHours: 40,
    shiftPatterns: [],
  };
}

function emptyShift(): ShiftPattern {
  return {
    name: "Regular shift",
    days: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
    startTime: "08:00",
    endTime: "17:00",
  };
}

function dateForInput(value: string | null): string {
  return value ? value.slice(0, 10) : "";
}

function initials(name: string): string {
  return name
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

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function shiftHours(pattern: ShiftPattern): number {
  return Math.max(
    (timeToMinutes(pattern.endTime) - timeToMinutes(pattern.startTime)) / 60,
    0
  );
}

function hoursForDay(staffMember: StaffMember, day: string): number {
  return (staffMember.shiftPatterns ?? [])
    .filter((pattern) => pattern.days.includes(day))
    .reduce((total, pattern) => total + shiftHours(pattern), 0);
}

function weeklyAvailabilityHours(staffMember: StaffMember): number {
  return WEEKDAYS.reduce(
    (total, [day]) => total + hoursForDay(staffMember, day),
    0
  );
}

function formatHours(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function StaffCardManager() {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<StaffForm>(emptyForm);
  const [shiftDraft, setShiftDraft] = useState<ShiftPattern>(emptyShift);
  const [weeklyShiftSchedule, setWeeklyShiftSchedule] =
    useState<WeeklySchedule>(() =>
      createWeeklySchedule("08:00", "17:00", true)
    );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("Loading staff...");
  const { requestActionDialog, actionDialog } = useActionConfirmDialog();

  const teamNameById = useMemo(
    () => new Map(teams.map((team) => [team.id, team.name])),
    [teams]
  );

  const visibleStaff = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return staff.filter((staffMember) => {
      if (!normalizedQuery) {
        return true;
      }

      const teamName = staffMember.teamId
        ? teamNameById.get(staffMember.teamId) ?? ""
        : "";

      return [
        staffMember.fullName,
        staffMember.role,
        staffMember.employeeType,
        teamName,
      ].some((value) => value.toLowerCase().includes(normalizedQuery));
    });
  }, [query, staff, teamNameById]);

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

      const [staffResponse, teamsResponse] = await Promise.all([
        fetch(
          `/api/staff?locationId=${encodeURIComponent(locationId)}`,
          { cache: "no-store" }
        ),
        fetch(`/api/teams?locationId=${encodeURIComponent(locationId)}`, {
          cache: "no-store",
        }),
      ]);

      const staffData = (await staffResponse.json()) as StaffResponse;
      const teamsData = (await teamsResponse.json()) as TeamsResponse;

      if (!staffResponse.ok) {
        throw new Error(staffData.error || "Staff could not be loaded.");
      }

      if (!teamsResponse.ok) {
        throw new Error(teamsData.error || "Teams could not be loaded.");
      }

      setStaff(staffData.staff ?? []);
      setTeams(teamsData.teams ?? []);
      setMessage("Staff roster loaded. Use + Add Staff to create another profile.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Staff could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  function openNewStaff() {
    setEditingId(null);
    setForm(emptyForm());
    setShiftDraft(emptyShift());
    setWeeklyShiftSchedule(
      createWeeklySchedule("08:00", "17:00", true)
    );
    setModalOpen(true);
  }

  function openEditStaff(staffMember: StaffMember) {
    setEditingId(staffMember.id);
    setForm({
      fullName: staffMember.fullName,
      startDate: dateForInput(staffMember.startDate),
      endDate: dateForInput(staffMember.endDate),
      role: staffMember.role,
      employeeType: staffMember.employeeType,
      teamId: staffMember.teamId ?? "",
      color: staffMember.color || "#7DB2E8",
      serviceSetting: staffMember.serviceSetting,
      minimumWeeklyHours: staffMember.minimumWeeklyHours,
      targetWeeklyHours: staffMember.targetWeeklyHours,
      maximumWeeklyHours: staffMember.maximumWeeklyHours,
      shiftPatterns: (staffMember.shiftPatterns ?? []).map((pattern) => ({
        ...pattern,
        days: [...pattern.days],
      })),
    });
    setShiftDraft(emptyShift());
    setWeeklyShiftSchedule(
      weeklyScheduleFromPatterns(
        staffMember.shiftPatterns ?? [],
        "08:00",
        "17:00"
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
    setForm(emptyForm());
    setShiftDraft(emptyShift());
    setWeeklyShiftSchedule(
      createWeeklySchedule("08:00", "17:00", true)
    );
  }

  function toggleShiftDay(day: string) {
    setShiftDraft((current) => ({
      ...current,
      days: current.days.includes(day)
        ? current.days.filter((value) => value !== day)
        : [...current.days, day],
    }));
  }

  function applyShiftToSelectedDays() {
    if (shiftDraft.days.length === 0) {
      setMessage("Choose at least one weekday to apply the shift.");
      return;
    }

    if (shiftDraft.endTime <= shiftDraft.startTime) {
      setMessage("Shift end time must be later than the start time.");
      return;
    }

    setWeeklyShiftSchedule((current) => {
      const next = { ...current };

      for (const day of shiftDraft.days) {
        next[day] = {
          enabled: true,
          startTime: shiftDraft.startTime,
          endTime: shiftDraft.endTime,
        };
      }

      return next;
    });
    setMessage(
      `Applied ${shiftDraft.startTime}-${shiftDraft.endTime} to the selected weekdays.`
    );
  }

  function toggleWeeklyShiftDay(day: string) {
    setWeeklyShiftSchedule((current) => ({
      ...current,
      [day]: {
        ...current[day],
        enabled: !current[day]?.enabled,
      },
    }));
  }

  function updateWeeklyShiftTime(
    day: string,
    field: "startTime" | "endTime",
    value: string
  ) {
    setWeeklyShiftSchedule((current) => ({
      ...current,
      [day]: {
        ...current[day],
        [field]: value,
      },
    }));
  }

  async function saveStaff() {
    if (!selectedLocationId || !form.fullName.trim() || !form.startDate) {
      setMessage("Full name and start date are required.");
      return;
    }

    const weeklyScheduleError = validateWeeklySchedule(
      weeklyShiftSchedule,
      "working"
    );

    if (weeklyScheduleError) {
      setMessage(weeklyScheduleError);
      return;
    }

    const shiftPatterns = patternsFromWeeklySchedule(
      weeklyShiftSchedule,
      "Regular shift"
    );

    if (
      form.minimumWeeklyHours < 0 ||
      form.targetWeeklyHours < form.minimumWeeklyHours ||
      form.maximumWeeklyHours < form.targetWeeklyHours
    ) {
      setMessage("Weekly hours must follow minimum ≤ target ≤ maximum.");
      return;
    }

    try {
      setSaving(true);

      const response = await fetch(
        editingId ? `/api/staff/${editingId}` : "/api/staff",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            locationId: selectedLocationId,
            fullName: form.fullName.trim(),
            startDate: form.startDate,
            endDate: form.endDate || null,
            role: form.role,
            employeeType: form.employeeType,
            teamId: form.teamId || null,
            color: form.color,
            serviceSetting: form.serviceSetting,
            minimumWeeklyHours: form.minimumWeeklyHours,
            targetWeeklyHours: form.targetWeeklyHours,
            maximumWeeklyHours: form.maximumWeeklyHours,
            shiftPatterns,
          }),
        }
      );
      const data = (await response.json()) as StaffResponse;

      if (!response.ok) {
        throw new Error(data.error || "Staff member could not be saved.");
      }

      const savedName = form.fullName.trim();
      closeModal(true);
      await loadLocationData(selectedLocationId);
      setMessage(`${savedName} was saved and is available to the scheduler.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Staff member could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteStaff(staffMember: StaffMember) {
    const choice = await requestActionDialog({
      eyebrow: "DELETE STAFF",
      title: `Permanently delete ${staffMember.fullName}?`,
      description:
        "This removes the staff profile and its linked live schedule, call-out, template, and supervision references. Imported historical-learning text is preserved.",
      actions: [
        {
          id: "delete",
          label: "Delete staff",
          tone: "danger",
        },
      ],
    });

    if (choice !== "delete") {
      return;
    }

    try {
      setSaving(true);
      const response = await fetch(`/api/staff/${staffMember.id}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as StaffResponse;

      if (!response.ok) {
        throw new Error(data.error || "Staff member could not be deleted.");
      }

      await loadLocationData(selectedLocationId);
      setMessage(`${staffMember.fullName} was permanently deleted.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Staff member could not be deleted."
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
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>

            <label className={`form-field compact-field ${cardStyles.searchField}`}>
              <span>Find staff</span>
              <input
                value={query}
                placeholder="Search name, role, or team..."
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>

          </div>

          <div className={cardStyles.toolbarRight}>
            <button
              type="button"
              className={cardStyles.addButton}
              disabled={!selectedLocationId}
              onClick={openNewStaff}
            >
              <span className={cardStyles.addIcon}>+</span>
              Add Staff
            </button>
          </div>
        </div>

        <div className={cardStyles.summaryStrip}>
          <div className={cardStyles.summaryItem}>
            <span>Active staff</span>
            <strong>{staff.filter((item) => item.active).length}</strong>
          </div>
          <div className={cardStyles.summaryItem}>
            <span>BT / RBT</span>
            <strong>
              {staff.filter((item) => item.active && ["BT", "RBT"].includes(item.role)).length}
            </strong>
          </div>
          <div className={cardStyles.summaryItem}>
            <span>Interns</span>
            <strong>{staff.filter((item) => item.active && item.role === "INTERN").length}</strong>
          </div>
          <div className={cardStyles.summaryItem}>
            <span>Managers / BCBAs</span>
            <strong>
              {staff.filter(
                (item) => item.active && ["OFFICE_MANAGER", "BCBA"].includes(item.role)
              ).length}
            </strong>
          </div>
        </div>

        {loading ? (
          <div className="inline-message">Loading staff...</div>
        ) : visibleStaff.length === 0 ? (
          <div className={cardStyles.emptyState}>
            No staff match this view. Use + Add Staff to create the first profile.
          </div>
        ) : (
          <div className={cardStyles.grid}>
            {visibleStaff.map((staffMember) => {
              const teamName = staffMember.teamId
                ? teamNameById.get(staffMember.teamId) ?? "Unknown team"
                : "No team";

              return (
                <article
                  key={staffMember.id}
                  className={cardStyles.card}
                  style={{ "--accent": staffMember.color } as React.CSSProperties}
                >
                  <div className={cardStyles.cardTop}>
                    <div className={cardStyles.identity}>
                      <div className={cardStyles.avatar}>{initials(staffMember.fullName)}</div>
                      <div className={cardStyles.identityCopy}>
                        <h3>{staffMember.fullName}</h3>
                        <p>
                          {prettyEnum(staffMember.employeeType)} · {teamName}
                        </p>
                      </div>
                    </div>
                    <span className={cardStyles.pill}>
                      {prettyEnum(staffMember.role)}
                    </span>
                  </div>

                  <div className={cardStyles.detailList}>
                    <div className={cardStyles.detailRow}>
                      <span>Service setting</span>
                      <strong>{prettyEnum(staffMember.serviceSetting)}</strong>
                    </div>
                    <div className={cardStyles.detailRow}>
                      <span>Weekly target</span>
                      <strong>
                        {staffMember.minimumWeeklyHours} / {staffMember.targetWeeklyHours} / {staffMember.maximumWeeklyHours} h
                      </strong>
                    </div>
                    <div className={cardStyles.detailRow}>
                      <span>Recurring shifts</span>
                      <strong>{staffMember.shiftPatterns?.length ?? 0}</strong>
                    </div>
                  </div>

                  <div className={cardStyles.metricHeader}>
                    <span>Weekly availability</span>
                    <strong>
                      {formatHours(weeklyAvailabilityHours(staffMember))} / {staffMember.targetWeeklyHours} h
                      {staffMember.minimumWeeklyHours > 0 ? ` · min ${staffMember.minimumWeeklyHours}` : ""}
                    </strong>
                  </div>
                  <div className={cardStyles.availabilityTrack}>
                    <div
                      className={cardStyles.availabilityFill}
                      style={{
                        width: `${Math.min(
                          (weeklyAvailabilityHours(staffMember) /
                            Math.max(staffMember.targetWeeklyHours, 1)) *
                            100,
                          100
                        )}%`,
                      }}
                    />
                  </div>
                  <div className={cardStyles.weekdayGrid}>
                    {WEEKDAYS.map(([day, label]) => {
                      const hours = hoursForDay(staffMember, day);
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
                    {(staffMember.shiftPatterns ?? []).length === 0 && staffMember.active ? (
                      <span className={cardStyles.chip}>
                        Needs working days/hours before scheduling
                      </span>
                    ) : null}
                    {(staffMember.shiftPatterns ?? []).slice(0, 3).map((pattern, index) => (
                      <span key={`${staffMember.id}-${index}`} className={cardStyles.chip}>
                        {pattern.name}: {pattern.startTime}-{pattern.endTime}
                      </span>
                    ))}
                  </div>

                  <div className={cardStyles.cardActions}>
                    <button
                      type="button"
                      className={`button button-small ${cardStyles.editButton}`}
                      disabled={saving}
                      onClick={() => openEditStaff(staffMember)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className={`button button-small ${cardStyles.dangerButton}`}
                      disabled={saving}
                      onClick={() => void deleteStaff(staffMember)}
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
        title={editingId ? "Edit Staff" : "Add Staff"}
        eyebrow="STAFF PROFILE"
        description="Enter the staff essentials first, then add the recurring availability the automatic scheduler should respect."
        onClose={closeModal}
        footer={
          <>
            <button
              type="button"
              className="button button-secondary"
              disabled={saving}
              onClick={() => closeModal()}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button button-primary"
              disabled={saving || !selectedLocationId}
              onClick={() => void saveStaff()}
            >
              {saving ? "Saving..." : editingId ? "Save Changes" : "Add Staff"}
            </button>
          </>
        }
      >
        <div className={cardStyles.formSection}>
          <h3>Staff essentials</h3>
          <p>These fields determine how this person can be used by the scheduler.</p>

          <div className="form-grid">
            <label className="form-field form-field-wide">
              <span>Full name</span>
              <input
                autoFocus
                value={form.fullName}
                placeholder="e.g. Jane Doe"
                onChange={(event) =>
                  setForm((current) => ({ ...current, fullName: event.target.value }))
                }
              />
            </label>

            <label className="form-field">
              <span>Start date</span>
              <input
                type="date"
                value={form.startDate}
                onChange={(event) =>
                  setForm((current) => ({ ...current, startDate: event.target.value }))
                }
              />
            </label>

            <label className="form-field">
              <span>End date (optional)</span>
              <input
                type="date"
                value={form.endDate}
                onChange={(event) =>
                  setForm((current) => ({ ...current, endDate: event.target.value }))
                }
              />
            </label>

            <label className="form-field">
              <span>Role</span>
              <select
                value={form.role}
                onChange={(event) =>
                  setForm((current) => ({ ...current, role: event.target.value as StaffRole }))
                }
              >
                <option value="BT">BT</option>
                <option value="RBT">RBT</option>
                <option value="INTERN">Intern</option>
                <option value="OFFICE_MANAGER">Office Manager</option>
                <option value="BCBA">BCBA</option>
                <option value="OTHER">Other</option>
              </select>
            </label>

            <label className="form-field">
              <span>Employment type</span>
              <select
                value={form.employeeType}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    employeeType: event.target.value as EmployeeType,
                  }))
                }
              >
                <option value="FULL_TIME">Full time</option>
                <option value="PART_TIME">Part time</option>
              </select>
            </label>

            <label className="form-field">
              <span>Team</span>
              <select
                value={form.teamId}
                onChange={(event) =>
                  setForm((current) => ({ ...current, teamId: event.target.value }))
                }
              >
                <option value="">No team</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="form-field">
              <span>Service location</span>
              <select
                value={form.serviceSetting}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    serviceSetting: event.target.value as ServiceSetting,
                  }))
                }
              >
                <option value="IN_CENTER">In center</option>
                <option value="IN_HOME">In home</option>
                <option value="BOTH">Both</option>
              </select>
            </label>

            <label className="form-field">
              <span>Card color</span>
              <input
                type="color"
                value={form.color}
                onChange={(event) =>
                  setForm((current) => ({ ...current, color: event.target.value }))
                }
              />
            </label>
          </div>
        </div>

        <div className={cardStyles.formSection}>
          <h3>Weekly hour guardrails</h3>
          <p>The automatic scheduler stays within these limits whenever possible.</p>
          <div className="form-grid">
            <label className="form-field">
              <span>Minimum</span>
              <input
                type="number"
                min="0"
                step="0.5"
                value={form.minimumWeeklyHours}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    minimumWeeklyHours: Number(event.target.value),
                  }))
                }
              />
            </label>
            <label className="form-field">
              <span>Target</span>
              <input
                type="number"
                min="0"
                step="0.5"
                value={form.targetWeeklyHours}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    targetWeeklyHours: Number(event.target.value),
                  }))
                }
              />
            </label>
            <label className="form-field">
              <span>Maximum</span>
              <input
                type="number"
                min="0"
                step="0.5"
                value={form.maximumWeeklyHours}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    maximumWeeklyHours: Number(event.target.value),
                  }))
                }
              />
            </label>
          </div>
        </div>

        <div className={cardStyles.formSection}>
          <h3>Weekly availability</h3>
          <p>
            Set the actual working hours for each weekday. Use Quick Apply when
            several days share the same shift, then adjust any individual day
            below. The automatic scheduler uses these daily hours directly.
          </p>

          <div className={cardStyles.quickSchedule}>
            <strong>Quick Apply</strong>
            <span>
              Example: select Mon, Tue, Wed and apply 09:00-17:00, then select
              Thu, Fri and apply 08:00-16:00.
            </span>

            <div className="form-grid">
              <label className="form-field">
                <span>Starts</span>
                <input
                  type="time"
                  value={shiftDraft.startTime}
                  onChange={(event) =>
                    setShiftDraft((current) => ({
                      ...current,
                      startTime: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="form-field">
                <span>Ends</span>
                <input
                  type="time"
                  value={shiftDraft.endTime}
                  onChange={(event) =>
                    setShiftDraft((current) => ({
                      ...current,
                      endTime: event.target.value,
                    }))
                  }
                />
              </label>
            </div>

            <div className="day-selector">
              {WEEKDAYS.map(([value, label]) => (
                <label key={value} className="checkbox-card">
                  <input
                    type="checkbox"
                    checked={shiftDraft.days.includes(value)}
                    onChange={() => toggleShiftDay(value)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>

            <button
              type="button"
              className="button button-secondary button-small"
              onClick={applyShiftToSelectedDays}
            >
              Apply to selected days
            </button>
          </div>

          <div className={cardStyles.weeklyEditor}>
            {WEEKDAYS.map(([value, label]) => {
              const daySchedule = weeklyShiftSchedule[value];

              return (
                <div key={value} className={cardStyles.weeklyEditorRow}>
                  <label className={cardStyles.weeklyDayToggle}>
                    <input
                      type="checkbox"
                      checked={daySchedule?.enabled ?? false}
                      onChange={() => toggleWeeklyShiftDay(value)}
                    />
                    <strong>{label}</strong>
                  </label>

                  <label className="form-field">
                    <span>Start</span>
                    <input
                      type="time"
                      disabled={!daySchedule?.enabled}
                      value={daySchedule?.startTime ?? "08:00"}
                      onChange={(event) =>
                        updateWeeklyShiftTime(
                          value,
                          "startTime",
                          event.target.value
                        )
                      }
                    />
                  </label>

                  <label className="form-field">
                    <span>End</span>
                    <input
                      type="time"
                      disabled={!daySchedule?.enabled}
                      value={daySchedule?.endTime ?? "17:00"}
                      onChange={(event) =>
                        updateWeeklyShiftTime(
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
            Uncheck a weekday for a normal day off. You no longer need to create
            or select separate shift-pattern chips.
          </p>
        </div>

        <div className={`${cardStyles.modalMessage} inline-message`}>{message}</div>
      </ManagementModal>
    </div>
  );
}
