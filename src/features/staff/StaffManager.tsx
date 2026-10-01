"use client";

import { useState } from "react";

type StaffMember = {
  id: string;
  fullName: string;
  startDate: string;
  endDate: string;
  role: string;
  employeeType: "FULL_TIME" | "PART_TIME";
  team: string;
  color: string;
  serviceSetting: "IN_CENTER" | "IN_HOME" | "BOTH";
  minimumWeeklyHours: number;
  targetWeeklyHours: number;
  maximumWeeklyHours: number;
  shiftDays: string[];
  shiftStart: string;
  shiftEnd: string;
  active: boolean;
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

const INITIAL_STAFF: StaffMember[] = [
  {
    id: "staff-1",
    fullName: "Areyana",
    startDate: "2026-01-05",
    endDate: "",
    role: "BT",
    employeeType: "FULL_TIME",
    team: "Blue Team",
    color: "#00E5E5",
    serviceSetting: "IN_CENTER",
    minimumWeeklyHours: 30,
    targetWeeklyHours: 35,
    maximumWeeklyHours: 40,
    shiftDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    shiftStart: "08:00",
    shiftEnd: "16:00",
    active: true,
  },
  {
    id: "staff-2",
    fullName: "Danielle",
    startDate: "2026-02-10",
    endDate: "",
    role: "RBT",
    employeeType: "FULL_TIME",
    team: "Red Team",
    color: "#B10B12",
    serviceSetting: "IN_CENTER",
    minimumWeeklyHours: 30,
    targetWeeklyHours: 36,
    maximumWeeklyHours: 40,
    shiftDays: ["Mon", "Tue", "Wed"],
    shiftStart: "09:00",
    shiftEnd: "17:00",
    active: true,
  },
];

const EMPTY_FORM: Omit<StaffMember, "id" | "active"> = {
  fullName: "",
  startDate: "",
  endDate: "",
  role: "BT",
  employeeType: "FULL_TIME",
  team: "",
  color: "#DCE9F8",
  serviceSetting: "IN_CENTER",
  minimumWeeklyHours: 30,
  targetWeeklyHours: 35,
  maximumWeeklyHours: 40,
  shiftDays: [],
  shiftStart: "08:00",
  shiftEnd: "16:00",
};

export function StaffManager() {
  const [staff, setStaff] = useState<StaffMember[]>(INITIAL_STAFF);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState(
    "Staff records shown here are demo data until MongoDB save APIs are connected."
  );

  function toggleShiftDay(day: string) {
    setForm((currentForm) => ({
      ...currentForm,
      shiftDays: currentForm.shiftDays.includes(day)
        ? currentForm.shiftDays.filter((currentDay) => currentDay !== day)
        : [...currentForm.shiftDays, day],
    }));
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
  }

  function saveStaffMember() {
    if (!form.fullName.trim() || !form.startDate) {
      setMessage("Full name and start date are required.");
      return;
    }

    if (form.maximumWeeklyHours < form.minimumWeeklyHours) {
      setMessage("Maximum weekly hours cannot be less than minimum weekly hours.");
      return;
    }

    if (editingId) {
      setStaff((currentStaff) =>
        currentStaff.map((staffMember) =>
          staffMember.id === editingId
            ? {
                ...staffMember,
                ...form,
              }
            : staffMember
        )
      );
      setMessage(`${form.fullName} was updated.`);
      resetForm();
      return;
    }

    const newStaffMember: StaffMember = {
      id: `staff-${Date.now()}`,
      ...form,
      active: true,
    };

    setStaff((currentStaff) => [...currentStaff, newStaffMember]);
    setMessage(`${form.fullName} was added.`);
    resetForm();
  }

  function editStaffMember(staffMember: StaffMember) {
    setEditingId(staffMember.id);
    setForm({
      fullName: staffMember.fullName,
      startDate: staffMember.startDate,
      endDate: staffMember.endDate,
      role: staffMember.role,
      employeeType: staffMember.employeeType,
      team: staffMember.team,
      color: staffMember.color,
      serviceSetting: staffMember.serviceSetting,
      minimumWeeklyHours: staffMember.minimumWeeklyHours,
      targetWeeklyHours: staffMember.targetWeeklyHours,
      maximumWeeklyHours: staffMember.maximumWeeklyHours,
      shiftDays: staffMember.shiftDays,
      shiftStart: staffMember.shiftStart,
      shiftEnd: staffMember.shiftEnd,
    });
    setMessage(`Editing ${staffMember.fullName}.`);
  }

  function archiveStaffMember(staffId: string) {
    setStaff((currentStaff) =>
      currentStaff.map((staffMember) =>
        staffMember.id === staffId
          ? {
              ...staffMember,
              active: false,
            }
          : staffMember
      )
    );

    setMessage(
      "Staff member archived. Historical schedules should keep their old staff references."
    );
  }

  return (
    <div className="management-layout">
      <section className="section-card">
        <div className="panel-heading-row">
          <div>
            <h2>{editingId ? "Edit Staff Member" : "Add Staff Member"}</h2>
            <p>
              Employee details and recurring shift availability are used by the
              automatic scheduler.
            </p>
          </div>
        </div>

        <div className="form-grid">
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
                  role: event.target.value,
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
                  employeeType: event.target.value as "FULL_TIME" | "PART_TIME",
                }))
              }
            >
              <option value="FULL_TIME">Full time</option>
              <option value="PART_TIME">Part time</option>
            </select>
          </label>

          <label className="form-field">
            <span>Team</span>
            <input
              value={form.team}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  team: event.target.value,
                }))
              }
              placeholder="Example: Blue Team"
            />
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
            <span>Service location</span>
            <select
              value={form.serviceSetting}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  serviceSetting: event.target.value as
                    | "IN_CENTER"
                    | "IN_HOME"
                    | "BOTH",
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
            <input
              type="number"
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
            <input
              type="number"
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
            <input
              type="number"
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
          <h3>Scheduler details / recurring shift</h3>

          <div className="day-selector">
            {DAYS.map((day) => (
              <label key={day} className="checkbox-card">
                <input
                  type="checkbox"
                  checked={form.shiftDays.includes(day)}
                  onChange={() => toggleShiftDay(day)}
                />
                <span>{day}</span>
              </label>
            ))}
          </div>

          <div className="form-grid form-grid-compact">
            <label className="form-field">
              <span>Shift starts</span>
              <input
                type="time"
                value={form.shiftStart}
                onChange={(event) =>
                  setForm((currentForm) => ({
                    ...currentForm,
                    shiftStart: event.target.value,
                  }))
                }
              />
            </label>

            <label className="form-field">
              <span>Shift ends</span>
              <input
                type="time"
                value={form.shiftEnd}
                onChange={(event) =>
                  setForm((currentForm) => ({
                    ...currentForm,
                    shiftEnd: event.target.value,
                  }))
                }
              />
            </label>
          </div>
        </div>

        <div className="form-actions">
          <button
            type="button"
            className="button button-primary"
            onClick={saveStaffMember}
          >
            {editingId ? "Save Changes" : "Add Staff"}
          </button>

          {editingId && (
            <button
              type="button"
              className="button button-secondary"
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
              Active staff are available to the scheduler. Archive instead of
              permanently deleting staff who appear on old schedules.
            </p>
          </div>
        </div>

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Type</th>
                <th>Team</th>
                <th>Shift</th>
                <th>Hours</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((staffMember) => (
                <tr key={staffMember.id}>
                  <td>
                    <span
                      className="color-dot"
                      style={{ backgroundColor: staffMember.color }}
                    />
                    {staffMember.fullName}
                  </td>
                  <td>{staffMember.role}</td>
                  <td>{staffMember.employeeType.replace("_", " ")}</td>
                  <td>{staffMember.team || "Unassigned"}</td>
                  <td>
                    {staffMember.shiftDays.join(", ")} {staffMember.shiftStart}-
                    {staffMember.shiftEnd}
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
                        onClick={() => editStaffMember(staffMember)}
                      >
                        Edit
                      </button>
                      {staffMember.active && (
                        <button
                          type="button"
                          className="button button-secondary button-small"
                          onClick={() => archiveStaffMember(staffMember.id)}
                        >
                          Archive
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
