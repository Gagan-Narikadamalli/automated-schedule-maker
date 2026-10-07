"use client";

import { useEffect, useMemo, useState } from "react";

import { EditableNumberInput } from "@/components/EditableNumberInput";

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
  code: string;
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
  locationId: string;
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

type LocationsResponse = {
  locations?: LocationOption[];
  error?: string;
};

type TeamsResponse = {
  teams?: TeamOption[];
  error?: string;
};

type StaffResponse = {
  staff?: StaffMember[];
  staffMember?: StaffMember;
  error?: string;
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

function createEmptyForm(): StaffForm {
  return {
    fullName: "",
    startDate: "",
    endDate: "",
    role: "BT",
    employeeType: "FULL_TIME",
    teamId: "",
    color: "#DCE9F8",
    serviceSetting: "IN_CENTER",
    minimumWeeklyHours: 30,
    targetWeeklyHours: 35,
    maximumWeeklyHours: 40,
    shiftPatterns: [],
  };
}

function createEmptyShiftPattern(): ShiftPattern {
  return {
    name: "",
    days: [],
    startTime: "08:00",
    endTime: "16:00",
  };
}

function formatDateForInput(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return value.slice(0, 10);
}

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T;

  if (response.status === 401) {
    window.location.href = "/login";
    throw new Error("Your session expired. Please sign in again.");
  }

  return data;
}

export function StaffManager() {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [form, setForm] = useState<StaffForm>(createEmptyForm);
  const [shiftDraft, setShiftDraft] = useState<ShiftPattern>(
    createEmptyShiftPattern
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(
    "Loading clinic locations and staff from MongoDB..."
  );

  const teamNameById = useMemo(() => {
    return new Map(teams.map((team) => [team.id, team.name]));
  }, [teams]);

  useEffect(() => {
    let cancelled = false;

    async function loadLocations() {
      try {
        setLoading(true);

        const response = await fetch("/api/locations", {
          cache: "no-store",
        });
        const data = await readJson<LocationsResponse>(response);

        if (!response.ok) {
          throw new Error(data.error || "Locations could not be loaded.");
        }

        const nextLocations = data.locations ?? [];

        if (cancelled) {
          return;
        }

        setLocations(nextLocations);

        if (nextLocations.length > 0) {
          setSelectedLocationId((currentLocationId) =>
            currentLocationId || nextLocations[0].id
          );
        } else {
          setMessage("No active clinic locations are available for this account.");
          setLoading(false);
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(
            error instanceof Error
              ? error.message
              : "Clinic locations could not be loaded."
          );
          setLoading(false);
        }
      }
    }

    void loadLocations();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedLocationId) {
      return;
    }

    let cancelled = false;

    async function loadLocationData() {
      try {
        setLoading(true);
        setMessage("Loading staff and teams from MongoDB...");

        const [staffResponse, teamsResponse] = await Promise.all([
          fetch(
            `/api/staff?locationId=${encodeURIComponent(
              selectedLocationId
            )}&includeArchived=true`,
            { cache: "no-store" }
          ),
          fetch(
            `/api/teams?locationId=${encodeURIComponent(selectedLocationId)}`,
            { cache: "no-store" }
          ),
        ]);

        const [staffData, teamsData] = await Promise.all([
          readJson<StaffResponse>(staffResponse),
          readJson<TeamsResponse>(teamsResponse),
        ]);

        if (!staffResponse.ok) {
          throw new Error(staffData.error || "Staff could not be loaded.");
        }

        if (!teamsResponse.ok) {
          throw new Error(teamsData.error || "Teams could not be loaded.");
        }

        if (cancelled) {
          return;
        }

        setStaff(staffData.staff ?? []);
        setTeams(teamsData.teams ?? []);
        setMessage(
          "Staff changes are saved to MongoDB and immediately become available to the scheduler."
        );
      } catch (error) {
        if (!cancelled) {
          setMessage(
            error instanceof Error
              ? error.message
              : "Staff information could not be loaded."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    resetForm();
    void loadLocationData();

    return () => {
      cancelled = true;
    };
  }, [selectedLocationId]);

  async function refreshStaff() {
    if (!selectedLocationId) {
      return;
    }

    const response = await fetch(
      `/api/staff?locationId=${encodeURIComponent(
        selectedLocationId
      )}&includeArchived=true`,
      { cache: "no-store" }
    );
    const data = await readJson<StaffResponse>(response);

    if (!response.ok) {
      throw new Error(data.error || "Staff could not be refreshed.");
    }

    setStaff(data.staff ?? []);
  }

  function resetForm() {
    setForm(createEmptyForm());
    setShiftDraft(createEmptyShiftPattern());
    setEditingId(null);
  }

  function toggleShiftDraftDay(day: string) {
    setShiftDraft((currentShift) => ({
      ...currentShift,
      days: currentShift.days.includes(day)
        ? currentShift.days.filter((currentDay) => currentDay !== day)
        : [...currentShift.days, day],
    }));
  }

  function addShiftPattern() {
    if (!shiftDraft.name.trim()) {
      setMessage("Give the shift pattern a name, such as Mon-Wed or Thu-Fri.");
      return;
    }

    if (shiftDraft.days.length === 0) {
      setMessage("Select at least one day for the shift pattern.");
      return;
    }

    if (!shiftDraft.startTime || !shiftDraft.endTime) {
      setMessage("A start time and end time are required for each shift pattern.");
      return;
    }

    if (shiftDraft.endTime <= shiftDraft.startTime) {
      setMessage("The shift end time must be later than the shift start time.");
      return;
    }

    const nextPattern: ShiftPattern = {
      name: shiftDraft.name.trim(),
      days: [...shiftDraft.days],
      startTime: shiftDraft.startTime,
      endTime: shiftDraft.endTime,
    };

    setForm((currentForm) => ({
      ...currentForm,
      shiftPatterns: [...currentForm.shiftPatterns, nextPattern],
    }));
    setShiftDraft(createEmptyShiftPattern());
    setMessage(`Added shift pattern ${nextPattern.name}.`);
  }

  function removeShiftPattern(index: number) {
    setForm((currentForm) => ({
      ...currentForm,
      shiftPatterns: currentForm.shiftPatterns.filter(
        (_, patternIndex) => patternIndex !== index
      ),
    }));
  }

  function validateForm(): string | null {
    if (!selectedLocationId) {
      return "Select a clinic location before saving staff.";
    }

    if (!form.fullName.trim() || !form.startDate) {
      return "Full name and start date are required.";
    }

    if (form.minimumWeeklyHours < 0) {
      return "Minimum weekly hours cannot be negative.";
    }

    if (form.targetWeeklyHours < form.minimumWeeklyHours) {
      return "Target weekly hours cannot be lower than minimum weekly hours.";
    }

    if (form.maximumWeeklyHours < form.targetWeeklyHours) {
      return "Maximum weekly hours cannot be lower than target weekly hours.";
    }

    if (form.endDate && form.endDate < form.startDate) {
      return "End date cannot be earlier than start date.";
    }

    return null;
  }

  async function saveStaffMember() {
    const validationError = validateForm();

    if (validationError) {
      setMessage(validationError);
      return;
    }

    const requestBody = {
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
      shiftPatterns: form.shiftPatterns,
    };

    try {
      setSaving(true);
      setMessage(editingId ? "Saving staff changes..." : "Adding staff member...");

      const response = await fetch(
        editingId ? `/api/staff/${editingId}` : "/api/staff",
        {
          method: editingId ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        }
      );
      const data = await readJson<StaffResponse>(response);

      if (!response.ok) {
        throw new Error(data.error || "Staff member could not be saved.");
      }

      const savedName = form.fullName.trim();
      await refreshStaff();
      resetForm();
      setMessage(
        editingId
          ? `${savedName} was updated in MongoDB.`
          : `${savedName} was added to MongoDB.`
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Staff member could not be saved."
      );
    } finally {
      setSaving(false);
    }
  }

  function editStaffMember(staffMember: StaffMember) {
    setEditingId(staffMember.id);
    setForm({
      fullName: staffMember.fullName,
      startDate: formatDateForInput(staffMember.startDate),
      endDate: formatDateForInput(staffMember.endDate),
      role: staffMember.role,
      employeeType: staffMember.employeeType,
      teamId: staffMember.teamId ?? "",
      color: staffMember.color || "#DCE9F8",
      serviceSetting: staffMember.serviceSetting,
      minimumWeeklyHours: staffMember.minimumWeeklyHours,
      targetWeeklyHours: staffMember.targetWeeklyHours,
      maximumWeeklyHours: staffMember.maximumWeeklyHours,
      shiftPatterns: (staffMember.shiftPatterns ?? []).map((pattern) => ({
        name: pattern.name,
        days: [...pattern.days],
        startTime: pattern.startTime,
        endTime: pattern.endTime,
      })),
    });
    setShiftDraft(createEmptyShiftPattern());
    setMessage(`Editing ${staffMember.fullName}.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function setStaffActiveState(staffMember: StaffMember, active: boolean) {
    try {
      setSaving(true);
      setMessage(
        active
          ? `Restoring ${staffMember.fullName}...`
          : `Archiving ${staffMember.fullName}...`
      );

      const response = await fetch(`/api/staff/${staffMember.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ active }),
      });
      const data = await readJson<StaffResponse>(response);

      if (!response.ok) {
        throw new Error(data.error || "Staff status could not be changed.");
      }

      await refreshStaff();
      setMessage(
        active
          ? `${staffMember.fullName} was restored.`
          : `${staffMember.fullName} was archived. Historical schedule references are preserved.`
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Staff status could not be changed."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="management-layout">
      <section className="section-card">
        <div className="panel-heading-row">
          <div>
            <h2>{editingId ? "Edit Staff Member" : "Add Staff Member"}</h2>
            <p>
              Staff records are location-specific and are stored in MongoDB.
              Recurring shift patterns tell the automatic scheduler when each
              employee is normally available.
            </p>
          </div>
        </div>

        <div className="form-grid">
          <label className="form-field form-field-wide">
            <span>Clinic location</span>
            <select
              value={selectedLocationId}
              disabled={loading || saving}
              onChange={(event) => setSelectedLocationId(event.target.value)}
            >
              {locations.length === 0 && <option value="">No locations</option>}
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>

          <label className="form-field form-field-wide">
            <span>Full name</span>
            <input
              value={form.fullName}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  fullName: event.target.value,
                }))
              }
              placeholder="Employee full name"
            />
          </label>

          <label className="form-field">
            <span>Start date</span>
            <input
              type="date"
              value={form.startDate}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  startDate: event.target.value,
                }))
              }
            />
          </label>

          <label className="form-field">
            <span>End date</span>
            <input
              type="date"
              value={form.endDate}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  endDate: event.target.value,
                }))
              }
            />
          </label>

          <label className="form-field">
            <span>Role</span>
            <select
              value={form.role}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  role: event.target.value as StaffRole,
                }))
              }
            >
              <option value="BT">BT</option>
              <option value="RBT">RBT</option>
              <option value="INTERN">Intern</option>
              <option value="BCBA">BCBA</option>
              <option value="OFFICE_MANAGER">Office Manager</option>
              <option value="OTHER">Other</option>
            </select>
          </label>

          <label className="form-field">
            <span>Employee type</span>
            <select
              value={form.employeeType}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
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
                setForm((currentForm) => ({
                  ...currentForm,
                  teamId: event.target.value,
                }))
              }
            >
              <option value="">Unassigned</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>

          <label className="form-field">
            <span>Staff color</span>
            <input
              type="color"
              value={form.color}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  color: event.target.value,
                }))
              }
            />
          </label>

          <label className="form-field">
            <span>Service setting</span>
            <select
              value={form.serviceSetting}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
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
            <span>Minimum weekly hours</span>
            <EditableNumberInput
              
              min="0"
              step="0.5"
              value={form.minimumWeeklyHours}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  minimumWeeklyHours: Number(event.target.value),
                }))
              }
            />
          </label>

          <label className="form-field">
            <span>Target weekly hours</span>
            <EditableNumberInput
              
              min="0"
              step="0.5"
              value={form.targetWeeklyHours}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  targetWeeklyHours: Number(event.target.value),
                }))
              }
            />
          </label>

          <label className="form-field">
            <span>Maximum weekly hours</span>
            <EditableNumberInput
              
              min="0"
              step="0.5"
              value={form.maximumWeeklyHours}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  maximumWeeklyHours: Number(event.target.value),
                }))
              }
            />
          </label>
        </div>

        <div className="subsection">
          <h3>Scheduler details / recurring shift patterns</h3>
          <p>
            Add as many shift patterns as needed. For example, one pattern can
            cover Monday through Wednesday and another can cover Thursday and
            Friday at different hours.
          </p>

          <div className="form-grid form-grid-compact">
            <label className="form-field">
              <span>Shift pattern name</span>
              <input
                value={shiftDraft.name}
                onChange={(event) =>
                  setShiftDraft((currentShift) => ({
                    ...currentShift,
                    name: event.target.value,
                  }))
                }
                placeholder="Example: Mon-Wed shift"
              />
            </label>

            <label className="form-field">
              <span>Shift starts</span>
              <input
                type="time"
                value={shiftDraft.startTime}
                onChange={(event) =>
                  setShiftDraft((currentShift) => ({
                    ...currentShift,
                    startTime: event.target.value,
                  }))
                }
              />
            </label>

            <label className="form-field">
              <span>Shift ends</span>
              <input
                type="time"
                value={shiftDraft.endTime}
                onChange={(event) =>
                  setShiftDraft((currentShift) => ({
                    ...currentShift,
                    endTime: event.target.value,
                  }))
                }
              />
            </label>
          </div>

          <div className="day-selector">
            {DAYS.map((day) => (
              <label key={day} className="checkbox-card">
                <input
                  type="checkbox"
                  checked={shiftDraft.days.includes(day)}
                  onChange={() => toggleShiftDraftDay(day)}
                />
                <span>{day}</span>
              </label>
            ))}
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={addShiftPattern}
            >
              Add Shift Pattern
            </button>
          </div>

          {form.shiftPatterns.length > 0 && (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Pattern</th>
                    <th>Days</th>
                    <th>Hours</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {form.shiftPatterns.map((pattern, index) => (
                    <tr key={`${pattern.name}-${index}`}>
                      <td>{pattern.name}</td>
                      <td>{pattern.days.join(", ")}</td>
                      <td>
                        {pattern.startTime} - {pattern.endTime}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="button button-secondary button-small"
                          onClick={() => removeShiftPattern(index)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="form-actions">
          <button
            type="button"
            className="button button-primary"
            disabled={saving || loading || !selectedLocationId}
            onClick={() => void saveStaffMember()}
          >
            {saving
              ? "Saving..."
              : editingId
                ? "Save Changes"
                : "Add Staff"}
          </button>

          {editingId && (
            <button
              type="button"
              className="button button-secondary"
              disabled={saving}
              onClick={resetForm}
            >
              Cancel Edit
            </button>
          )}
        </div>

        <div className="inline-message">{message}</div>
      </section>

      <section className="section-card">
        <div className="panel-heading-row">
          <div>
            <h2>Staff Directory</h2>
            <p>
              Archived staff stay in MongoDB so historical schedules remain
              accurate, but archived staff are excluded from new automatic
              scheduling.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="inline-message">Loading staff...</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Type</th>
                  <th>Team</th>
                  <th>Shift patterns</th>
                  <th>Hours min / target / max</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {staff.length === 0 ? (
                  <tr>
                    <td colSpan={8}>No staff have been added at this location yet.</td>
                  </tr>
                ) : (
                  staff.map((staffMember) => (
                    <tr key={staffMember.id}>
                      <td>
                        <span
                          className="color-dot"
                          style={{ backgroundColor: staffMember.color }}
                        />
                        {staffMember.fullName}
                      </td>
                      <td>{staffMember.role.replaceAll("_", " ")}</td>
                      <td>{staffMember.employeeType.replaceAll("_", " ")}</td>
                      <td>
                        {staffMember.teamId
                          ? teamNameById.get(staffMember.teamId) || "Unknown team"
                          : "Unassigned"}
                      </td>
                      <td>
                        {staffMember.shiftPatterns?.length
                          ? staffMember.shiftPatterns
                              .map(
                                (pattern) =>
                                  `${pattern.name}: ${pattern.days.join(", ")} ${pattern.startTime}-${pattern.endTime}`
                              )
                              .join(" | ")
                          : "No recurring shift"}
                      </td>
                      <td>
                        {staffMember.minimumWeeklyHours} / {staffMember.targetWeeklyHours} / {staffMember.maximumWeeklyHours}
                      </td>
                      <td>{staffMember.active ? "Active" : "Archived"}</td>
                      <td>
                        <div className="table-actions">
                          <button
                            type="button"
                            className="button button-secondary button-small"
                            disabled={saving}
                            onClick={() => editStaffMember(staffMember)}
                          >
                            Edit
                          </button>

                          <button
                            type="button"
                            className="button button-secondary button-small"
                            disabled={saving}
                            onClick={() =>
                              void setStaffActiveState(
                                staffMember,
                                !staffMember.active
                              )
                            }
                          >
                            {staffMember.active ? "Archive" : "Restore"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
