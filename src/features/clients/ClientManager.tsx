"use client";

import { useState } from "react";

type Relationship = "PREFERRED" | "ALLOWED" | "HARD_RESTRICTION";

type ClientRecord = {
  id: string;
  fullName: string;
  displayCode: string;
  startDate: string;
  endDate: string;
  team: string;
  color: string;
  serviceSetting: "IN_CENTER" | "IN_HOME" | "BOTH";
  supportLevel: "STANDARD" | "ONE_TO_ONE" | "ROTATION" | "HIGH_SUPPORT";
  insurancePlan: string;
  assignedBcba: string;
  assignedInterns: string[];
  attendanceDays: string[];
  attendanceStart: string;
  attendanceEnd: string;
  staffRelationships: Record<string, Relationship>;
  active: boolean;
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const STAFF_OPTIONS = ["Areyana", "Ariana", "Anias", "Danielle", "Devonyah"];
const BCBA_OPTIONS = ["BCBA - Primary", "BCBA - Coverage"];
const INTERN_OPTIONS = ["Intern A", "Intern B", "Intern C"];

const EMPTY_FORM: Omit<ClientRecord, "id" | "active"> = {
  fullName: "",
  displayCode: "",
  startDate: "",
  endDate: "",
  team: "",
  color: "#D9F4EE",
  serviceSetting: "IN_CENTER",
  supportLevel: "ONE_TO_ONE",
  insurancePlan: "",
  assignedBcba: "",
  assignedInterns: [],
  attendanceDays: [],
  attendanceStart: "08:00",
  attendanceEnd: "16:00",
  staffRelationships: {},
};

const INITIAL_CLIENTS: ClientRecord[] = [
  {
    id: "client-1",
    fullName: "Demo Client One",
    displayCode: "ZiBo",
    startDate: "2026-01-05",
    endDate: "",
    team: "Blue Team",
    color: "#00E5E5",
    serviceSetting: "IN_CENTER",
    supportLevel: "ONE_TO_ONE",
    insurancePlan: "",
    assignedBcba: "BCBA - Primary",
    assignedInterns: ["Intern A"],
    attendanceDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    attendanceStart: "08:00",
    attendanceEnd: "16:00",
    staffRelationships: {
      Areyana: "PREFERRED",
      Ariana: "ALLOWED",
      Anias: "ALLOWED",
      Danielle: "HARD_RESTRICTION",
      Devonyah: "ALLOWED",
    },
    active: true,
  },
];

export function ClientManager() {
  const [clients, setClients] = useState<ClientRecord[]>(INITIAL_CLIENTS);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState(
    "Client records shown here are demo data until MongoDB save APIs are connected."
  );

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
  }

  function toggleAttendanceDay(day: string) {
    setForm((currentForm) => ({
      ...currentForm,
      attendanceDays: currentForm.attendanceDays.includes(day)
        ? currentForm.attendanceDays.filter((currentDay) => currentDay !== day)
        : [...currentForm.attendanceDays, day],
    }));
  }

  function toggleIntern(intern: string) {
    setForm((currentForm) => ({
      ...currentForm,
      assignedInterns: currentForm.assignedInterns.includes(intern)
        ? currentForm.assignedInterns.filter(
            (assignedIntern) => assignedIntern !== intern
          )
        : [...currentForm.assignedInterns, intern],
    }));
  }

  function setStaffRelationship(staffName: string, relationship: Relationship) {
    setForm((currentForm) => ({
      ...currentForm,
      staffRelationships: {
        ...currentForm.staffRelationships,
        [staffName]: relationship,
      },
    }));
  }

  function saveClient() {
    if (!form.fullName.trim() || !form.displayCode.trim() || !form.startDate) {
      setMessage("Client name, display code, and start date are required.");
      return;
    }

    if (editingId) {
      setClients((currentClients) =>
        currentClients.map((client) =>
          client.id === editingId
            ? {
                ...client,
                ...form,
              }
            : client
        )
      );
      setMessage(`${form.displayCode} was updated.`);
      resetForm();
      return;
    }

    setClients((currentClients) => [
      ...currentClients,
      {
        id: `client-${Date.now()}`,
        ...form,
        active: true,
      },
    ]);

    setMessage(`${form.displayCode} was added.`);
    resetForm();
  }

  function editClient(client: ClientRecord) {
    setEditingId(client.id);
    setForm({
      fullName: client.fullName,
      displayCode: client.displayCode,
      startDate: client.startDate,
      endDate: client.endDate,
      team: client.team,
      color: client.color,
      serviceSetting: client.serviceSetting,
      supportLevel: client.supportLevel,
      insurancePlan: client.insurancePlan,
      assignedBcba: client.assignedBcba,
      assignedInterns: client.assignedInterns,
      attendanceDays: client.attendanceDays,
      attendanceStart: client.attendanceStart,
      attendanceEnd: client.attendanceEnd,
      staffRelationships: client.staffRelationships,
    });
    setMessage(`Editing ${client.displayCode}.`);
  }

  function archiveClient(clientId: string) {
    setClients((currentClients) =>
      currentClients.map((client) =>
        client.id === clientId
          ? {
              ...client,
              active: false,
            }
          : client
      )
    );

    setMessage(
      "Client archived. Historical schedules will retain the original client reference."
    );
  }

  return (
    <div className="management-layout">
      <section className="section-card">
        <div className="panel-heading-row">
          <div>
            <h2>{editingId ? "Edit Client" : "Add Client"}</h2>
            <p>
              Client attendance and staff relationships directly affect automatic
              scheduling priority and hard restrictions.
            </p>
          </div>
        </div>

        <div className="form-grid">
          <label className="form-field form-field-wide">
            <span>Client full name</span>
            <input
              value={form.fullName}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  fullName: event.target.value,
                }))
              }
              placeholder="Client full name"
            />
          </label>

          <label className="form-field">
            <span>Calendar display code</span>
            <input
              value={form.displayCode}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  displayCode: event.target.value,
                }))
              }
              placeholder="Example: ZiBo"
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
            <span>Client color</span>
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
            <span>Support level</span>
            <select
              value={form.supportLevel}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  supportLevel: event.target.value as ClientRecord["supportLevel"],
                }))
              }
            >
              <option value="STANDARD">Standard</option>
              <option value="ONE_TO_ONE">1:1 staffing</option>
              <option value="ROTATION">Staff rotation preferred</option>
              <option value="HIGH_SUPPORT">High support</option>
            </select>
          </label>

          <label className="form-field">
            <span>Insurance plan (optional)</span>
            <input
              value={form.insurancePlan}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  insurancePlan: event.target.value,
                }))
              }
            />
          </label>

          <label className="form-field">
            <span>Assigned BCBA</span>
            <select
              value={form.assignedBcba}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  assignedBcba: event.target.value,
                }))
              }
            >
              <option value="">Not assigned</option>
              {BCBA_OPTIONS.map((bcba) => (
                <option key={bcba} value={bcba}>
                  {bcba}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="subsection">
          <h3>Attendance / scheduler details</h3>

          <div className="day-selector">
            {DAYS.map((day) => (
              <label key={day} className="checkbox-card">
                <input
                  type="checkbox"
                  checked={form.attendanceDays.includes(day)}
                  onChange={() => toggleAttendanceDay(day)}
                />
                <span>{day}</span>
              </label>
            ))}
          </div>

          <div className="form-grid form-grid-compact">
            <label className="form-field">
              <span>Attendance starts</span>
              <input
                type="time"
                value={form.attendanceStart}
                onChange={(event) =>
                  setForm((currentForm) => ({
                    ...currentForm,
                    attendanceStart: event.target.value,
                  }))
                }
              />
            </label>

            <label className="form-field">
              <span>Attendance ends</span>
              <input
                type="time"
                value={form.attendanceEnd}
                onChange={(event) =>
                  setForm((currentForm) => ({
                    ...currentForm,
                    attendanceEnd: event.target.value,
                  }))
                }
              />
            </label>
          </div>
        </div>

        <div className="subsection">
          <h3>Assigned interns</h3>
          <div className="day-selector">
            {INTERN_OPTIONS.map((intern) => (
              <label key={intern} className="checkbox-card">
                <input
                  type="checkbox"
                  checked={form.assignedInterns.includes(intern)}
                  onChange={() => toggleIntern(intern)}
                />
                <span>{intern}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="subsection">
          <h3>Staff relationships</h3>
          <p className="helper-text">
            Preferred is tried first. Allowed is neutral. Hard Restriction prevents
            the auto scheduler from pairing that staff member with this client.
          </p>

          <div className="relationship-list">
            {STAFF_OPTIONS.map((staffName) => (
              <div key={staffName} className="relationship-row">
                <strong>{staffName}</strong>
                <select
                  value={form.staffRelationships[staffName] ?? "ALLOWED"}
                  onChange={(event) =>
                    setStaffRelationship(
                      staffName,
                      event.target.value as Relationship
                    )
                  }
                >
                  <option value="PREFERRED">Preferred</option>
                  <option value="ALLOWED">Allowed</option>
                  <option value="HARD_RESTRICTION">Hard Restriction</option>
                </select>
              </div>
            ))}
          </div>
        </div>

        <div className="form-actions">
          <button
            type="button"
            className="button button-primary"
            onClick={saveClient}
          >
            {editingId ? "Save Changes" : "Add Client"}
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
        <h2>Client Directory</h2>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Team</th>
                <th>Support</th>
                <th>Attendance</th>
                <th>BCBA</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => (
                <tr key={client.id}>
                  <td>
                    <span
                      className="color-dot"
                      style={{ backgroundColor: client.color }}
                    />
                    {client.displayCode}
                  </td>
                  <td>{client.team || "Unassigned"}</td>
                  <td>{client.supportLevel.replaceAll("_", " ")}</td>
                  <td>
                    {client.attendanceDays.join(", ")} {client.attendanceStart}-
                    {client.attendanceEnd}
                  </td>
                  <td>{client.assignedBcba || "Not assigned"}</td>
                  <td>{client.active ? "Active" : "Archived"}</td>
                  <td>
                    <div className="table-actions">
                      <button
                        type="button"
                        className="button button-secondary button-small"
                        onClick={() => editClient(client)}
                      >
                        Edit
                      </button>
                      {client.active && (
                        <button
                          type="button"
                          className="button button-secondary button-small"
                          onClick={() => archiveClient(client.id)}
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
