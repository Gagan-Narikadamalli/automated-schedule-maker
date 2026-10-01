"use client";

import { useEffect, useMemo, useState } from "react";

type Relationship = "PREFERRED" | "ALLOWED" | "HARD_RESTRICTION";
type ServiceSetting = "IN_CENTER" | "IN_HOME" | "BOTH";
type SupportLevel = "STANDARD" | "ONE_TO_ONE" | "ROTATION" | "HIGH_SUPPORT";

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
  locationId: string;
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
  staffRelationships: Record<string, Relationship>;
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
  client?: ClientRecord;
  error?: string;
};

type PatternEditorProps = {
  title: string;
  description: string;
  buttonLabel: string;
  patterns: TimePattern[];
  onChange: (patterns: TimePattern[]) => void;
  onMessage: (message: string) => void;
  defaultName: string;
  defaultStartTime: string;
  defaultEndTime: string;
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

function createEmptyForm(): ClientForm {
  return {
    fullName: "",
    displayCode: "",
    startDate: "",
    endDate: "",
    teamId: "",
    color: "#D9F4EE",
    serviceSetting: "IN_CENTER",
    supportLevel: "ONE_TO_ONE",
    insurancePlan: "",
    assignedBcbaId: "",
    assignedInternIds: [],
    attendancePatterns: [],
    napPatterns: [],
    staffRelationships: {},
  };
}

function createEmptyPattern(
  name: string,
  startTime: string,
  endTime: string
): TimePattern {
  return {
    name,
    days: [],
    startTime,
    endTime,
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

function TimePatternEditor({
  title,
  description,
  buttonLabel,
  patterns,
  onChange,
  onMessage,
  defaultName,
  defaultStartTime,
  defaultEndTime,
}: PatternEditorProps) {
  const [draft, setDraft] = useState<TimePattern>(() =>
    createEmptyPattern(defaultName, defaultStartTime, defaultEndTime)
  );

  function toggleDay(day: string) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      days: currentDraft.days.includes(day)
        ? currentDraft.days.filter((currentDay) => currentDay !== day)
        : [...currentDraft.days, day],
    }));
  }

  function addPattern() {
    if (!draft.name.trim()) {
      onMessage(`${title}: enter a pattern name.`);
      return;
    }

    if (draft.days.length === 0) {
      onMessage(`${title}: select at least one weekday.`);
      return;
    }

    if (!draft.startTime || !draft.endTime) {
      onMessage(`${title}: start and end times are required.`);
      return;
    }

    if (draft.endTime <= draft.startTime) {
      onMessage(`${title}: the end time must be later than the start time.`);
      return;
    }

    const newPattern: TimePattern = {
      name: draft.name.trim(),
      days: [...draft.days],
      startTime: draft.startTime,
      endTime: draft.endTime,
    };

    onChange([...patterns, newPattern]);
    setDraft(createEmptyPattern(defaultName, defaultStartTime, defaultEndTime));
    onMessage(`${newPattern.name} was added.`);
  }

  function removePattern(index: number) {
    onChange(patterns.filter((_, patternIndex) => patternIndex !== index));
  }

  return (
    <div className="subsection">
      <h3>{title}</h3>
      <p>{description}</p>

      <div className="form-grid form-grid-compact">
        <label className="form-field">
          <span>Pattern name</span>
          <input
            value={draft.name}
            onChange={(event) =>
              setDraft((currentDraft) => ({
                ...currentDraft,
                name: event.target.value,
              }))
            }
          />
        </label>

        <label className="form-field">
          <span>Starts</span>
          <input
            type="time"
            value={draft.startTime}
            onChange={(event) =>
              setDraft((currentDraft) => ({
                ...currentDraft,
                startTime: event.target.value,
              }))
            }
          />
        </label>

        <label className="form-field">
          <span>Ends</span>
          <input
            type="time"
            value={draft.endTime}
            onChange={(event) =>
              setDraft((currentDraft) => ({
                ...currentDraft,
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
              checked={draft.days.includes(day)}
              onChange={() => toggleDay(day)}
            />
            <span>{day}</span>
          </label>
        ))}
      </div>

      <div className="form-actions">
        <button
          type="button"
          className="button button-secondary"
          onClick={addPattern}
        >
          {buttonLabel}
        </button>
      </div>

      {patterns.length > 0 && (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Days</th>
                <th>Time</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {patterns.map((pattern, index) => (
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
                      onClick={() => removePattern(index)}
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
  );
}

export function ClientManager() {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [form, setForm] = useState<ClientForm>(createEmptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(
    "Loading client information from MongoDB..."
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

  const relationshipStaff = useMemo(
    () =>
      activeStaff.filter((staffMember) =>
        ["BT", "RBT", "INTERN"].includes(staffMember.role)
      ),
    [activeStaff]
  );

  const teamNameById = useMemo(
    () => new Map(teams.map((team) => [team.id, team.name])),
    [teams]
  );

  const staffNameById = useMemo(
    () => new Map(staff.map((staffMember) => [staffMember.id, staffMember.fullName])),
    [staff]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadLocations() {
      try {
        const response = await fetch("/api/locations", {
          cache: "no-store",
        });
        const data = await readJson<LocationsResponse>(response);

        if (!response.ok) {
          throw new Error(data.error || "Locations could not be loaded.");
        }

        if (cancelled) {
          return;
        }

        const nextLocations = data.locations ?? [];
        setLocations(nextLocations);

        if (nextLocations.length > 0) {
          setSelectedLocationId((currentLocationId) =>
            currentLocationId || nextLocations[0].id
          );
        } else {
          setMessage("No clinic locations are available for this account.");
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
        setMessage("Loading clients, staff, and teams from MongoDB...");

        const [clientsResponse, staffResponse, teamsResponse] = await Promise.all([
          fetch(
            `/api/clients?locationId=${encodeURIComponent(
              selectedLocationId
            )}&includeArchived=true`,
            { cache: "no-store" }
          ),
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

        const [clientsData, staffData, teamsData] = await Promise.all([
          readJson<ClientsResponse>(clientsResponse),
          readJson<StaffResponse>(staffResponse),
          readJson<TeamsResponse>(teamsResponse),
        ]);

        if (!clientsResponse.ok) {
          throw new Error(clientsData.error || "Clients could not be loaded.");
        }

        if (!staffResponse.ok) {
          throw new Error(staffData.error || "Staff could not be loaded.");
        }

        if (!teamsResponse.ok) {
          throw new Error(teamsData.error || "Teams could not be loaded.");
        }

        if (cancelled) {
          return;
        }

        setClients(clientsData.clients ?? []);
        setStaff(staffData.staff ?? []);
        setTeams(teamsData.teams ?? []);
        setMessage(
          "Client records are stored in MongoDB and feed directly into automatic scheduling."
        );
      } catch (error) {
        if (!cancelled) {
          setMessage(
            error instanceof Error
              ? error.message
              : "Client information could not be loaded."
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

  async function refreshClients() {
    const response = await fetch(
      `/api/clients?locationId=${encodeURIComponent(
        selectedLocationId
      )}&includeArchived=true`,
      { cache: "no-store" }
    );
    const data = await readJson<ClientsResponse>(response);

    if (!response.ok) {
      throw new Error(data.error || "Clients could not be refreshed.");
    }

    setClients(data.clients ?? []);
  }

  function resetForm() {
    setForm(createEmptyForm());
    setEditingId(null);
  }

  function toggleIntern(staffId: string) {
    setForm((currentForm) => ({
      ...currentForm,
      assignedInternIds: currentForm.assignedInternIds.includes(staffId)
        ? currentForm.assignedInternIds.filter((internId) => internId !== staffId)
        : [...currentForm.assignedInternIds, staffId],
    }));
  }

  function setStaffRelationship(staffId: string, relationship: Relationship) {
    setForm((currentForm) => ({
      ...currentForm,
      staffRelationships: {
        ...currentForm.staffRelationships,
        [staffId]: relationship,
      },
    }));
  }

  function validateForm(): string | null {
    if (!selectedLocationId) {
      return "Select a clinic location before saving a client.";
    }

    if (!form.fullName.trim() || !form.displayCode.trim() || !form.startDate) {
      return "Client name, calendar display code, and start date are required.";
    }

    if (form.endDate && form.endDate < form.startDate) {
      return "End date cannot be earlier than start date.";
    }

    if (form.attendancePatterns.length === 0) {
      return "Add at least one attendance pattern so the scheduler knows when the client needs coverage.";
    }

    return null;
  }

  async function saveClient() {
    const validationError = validateForm();

    if (validationError) {
      setMessage(validationError);
      return;
    }

    const relationships: StaffRelationship[] = relationshipStaff.map(
      (staffMember) => ({
        staffId: staffMember.id,
        relationship: form.staffRelationships[staffMember.id] ?? "ALLOWED",
      })
    );

    const requestBody = {
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
      attendancePatterns: form.attendancePatterns,
      napPatterns: form.napPatterns,
      staffRelationships: relationships,
    };

    try {
      setSaving(true);
      setMessage(editingId ? "Saving client changes..." : "Adding client...");

      const response = await fetch(
        editingId ? `/api/clients/${editingId}` : "/api/clients",
        {
          method: editingId ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        }
      );
      const data = await readJson<ClientsResponse>(response);

      if (!response.ok) {
        throw new Error(data.error || "Client could not be saved.");
      }

      const savedCode = form.displayCode.trim();
      const wasEditing = Boolean(editingId);

      await refreshClients();
      resetForm();
      setMessage(
        wasEditing
          ? `${savedCode} was updated in MongoDB.`
          : `${savedCode} was added to MongoDB.`
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Client could not be saved."
      );
    } finally {
      setSaving(false);
    }
  }

  function editClient(client: ClientRecord) {
    const relationshipMap: Record<string, Relationship> = {};

    for (const relationship of client.staffRelationships ?? []) {
      relationshipMap[String(relationship.staffId)] = relationship.relationship;
    }

    setEditingId(client.id);
    setForm({
      fullName: client.fullName,
      displayCode: client.displayCode,
      startDate: formatDateForInput(client.startDate),
      endDate: formatDateForInput(client.endDate),
      teamId: client.teamId ?? "",
      color: client.color || "#D9F4EE",
      serviceSetting: client.serviceSetting,
      supportLevel: client.supportLevel,
      insurancePlan: client.insurancePlan ?? "",
      assignedBcbaId: client.assignedBcbaId ?? "",
      assignedInternIds: client.assignedInternIds ?? [],
      attendancePatterns: (client.attendancePatterns ?? []).map((pattern) => ({
        name: pattern.name,
        days: [...pattern.days],
        startTime: pattern.startTime,
        endTime: pattern.endTime,
      })),
      napPatterns: (client.napPatterns ?? []).map((pattern) => ({
        name: pattern.name,
        days: [...pattern.days],
        startTime: pattern.startTime,
        endTime: pattern.endTime,
      })),
      staffRelationships: relationshipMap,
    });
    setMessage(`Editing ${client.displayCode}.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function setClientActiveState(client: ClientRecord, active: boolean) {
    try {
      setSaving(true);
      setMessage(
        active
          ? `Restoring ${client.displayCode}...`
          : `Archiving ${client.displayCode}...`
      );

      const response = await fetch(`/api/clients/${client.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ active }),
      });
      const data = await readJson<ClientsResponse>(response);

      if (!response.ok) {
        throw new Error(data.error || "Client status could not be changed.");
      }

      await refreshClients();
      setMessage(
        active
          ? `${client.displayCode} was restored.`
          : `${client.displayCode} was archived. Historical schedules remain intact.`
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Client status could not be changed."
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
            <h2>{editingId ? "Edit Client" : "Add Client"}</h2>
            <p>
              Attendance, nap windows, team membership, and staff relationships
              are stored by clinic and used by the automatic scheduler.
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
            <span>Support level</span>
            <select
              value={form.supportLevel}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  supportLevel: event.target.value as SupportLevel,
                }))
              }
            >
              <option value="STANDARD">Standard</option>
              <option value="ONE_TO_ONE">1:1 staffing</option>
              <option value="ROTATION">Staff rotation preferred</option>
              <option value="HIGH_SUPPORT">High support / more rotation</option>
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
              value={form.assignedBcbaId}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  assignedBcbaId: event.target.value,
                }))
              }
            >
              <option value="">Not assigned</option>
              {bcbaOptions.map((staffMember) => (
                <option key={staffMember.id} value={staffMember.id}>
                  {staffMember.fullName}
                </option>
              ))}
            </select>
          </label>
        </div>

        <TimePatternEditor
          title="Attendance / scheduler details"
          description="Add one or more recurring attendance patterns. These determine the 30-minute blocks that require client coverage."
          buttonLabel="Add Attendance Pattern"
          patterns={form.attendancePatterns}
          onChange={(patterns) =>
            setForm((currentForm) => ({
              ...currentForm,
              attendancePatterns: patterns,
            }))
          }
          onMessage={setMessage}
          defaultName="Regular attendance"
          defaultStartTime="08:00"
          defaultEndTime="16:00"
        />

        <TimePatternEditor
          title="Nap / Break-Nap windows"
          description="Optional. Add recurring nap windows. The scheduler may use these blocks as Break/Nap where clinic rules allow it."
          buttonLabel="Add Nap Pattern"
          patterns={form.napPatterns}
          onChange={(patterns) =>
            setForm((currentForm) => ({
              ...currentForm,
              napPatterns: patterns,
            }))
          }
          onMessage={setMessage}
          defaultName="Nap"
          defaultStartTime="12:00"
          defaultEndTime="13:00"
        />

        <div className="subsection">
          <h3>Assigned interns</h3>
          {internOptions.length === 0 ? (
            <p className="helper-text">
              No active staff with the Intern role have been added at this clinic.
            </p>
          ) : (
            <div className="day-selector">
              {internOptions.map((staffMember) => (
                <label key={staffMember.id} className="checkbox-card">
                  <input
                    type="checkbox"
                    checked={form.assignedInternIds.includes(staffMember.id)}
                    onChange={() => toggleIntern(staffMember.id)}
                  />
                  <span>{staffMember.fullName}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="subsection">
          <h3>Staff relationships</h3>
          <p className="helper-text">
            Preferred receives scheduling priority. Allowed is neutral. Hard
            Restriction prevents the automatic scheduler from pairing that staff
            member with this client.
          </p>

          {relationshipStaff.length === 0 ? (
            <p className="helper-text">
              Add active BT, RBT, or Intern staff to configure relationships.
            </p>
          ) : (
            <div className="relationship-list">
              {relationshipStaff.map((staffMember) => (
                <div key={staffMember.id} className="relationship-row">
                  <strong>{staffMember.fullName}</strong>
                  <select
                    value={
                      form.staffRelationships[staffMember.id] ?? "ALLOWED"
                    }
                    onChange={(event) =>
                      setStaffRelationship(
                        staffMember.id,
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
          )}
        </div>

        <div className="form-actions">
          <button
            type="button"
            className="button button-primary"
            disabled={saving || loading || !selectedLocationId}
            onClick={() => void saveClient()}
          >
            {saving
              ? "Saving..."
              : editingId
                ? "Save Changes"
                : "Add Client"}
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
            <h2>Client Directory</h2>
            <p>
              Archived clients remain available to historical schedules but are
              excluded from new automatic scheduling.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="inline-message">Loading clients...</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Team</th>
                  <th>Support</th>
                  <th>Attendance</th>
                  <th>Nap</th>
                  <th>BCBA</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {clients.length === 0 ? (
                  <tr>
                    <td colSpan={8}>No clients have been added at this location yet.</td>
                  </tr>
                ) : (
                  clients.map((client) => (
                    <tr key={client.id}>
                      <td>
                        <span
                          className="color-dot"
                          style={{ backgroundColor: client.color }}
                        />
                        {client.displayCode}
                      </td>
                      <td>
                        {client.teamId
                          ? teamNameById.get(client.teamId) || "Unknown team"
                          : "Unassigned"}
                      </td>
                      <td>{client.supportLevel.replaceAll("_", " ")}</td>
                      <td>
                        {client.attendancePatterns?.length
                          ? client.attendancePatterns
                              .map(
                                (pattern) =>
                                  `${pattern.days.join(", ")} ${pattern.startTime}-${pattern.endTime}`
                              )
                              .join(" | ")
                          : "No attendance pattern"}
                      </td>
                      <td>
                        {client.napPatterns?.length
                          ? client.napPatterns
                              .map(
                                (pattern) =>
                                  `${pattern.days.join(", ")} ${pattern.startTime}-${pattern.endTime}`
                              )
                              .join(" | ")
                          : "None"}
                      </td>
                      <td>
                        {client.assignedBcbaId
                          ? staffNameById.get(client.assignedBcbaId) || "Unknown BCBA"
                          : "Not assigned"}
                      </td>
                      <td>{client.active ? "Active" : "Archived"}</td>
                      <td>
                        <div className="table-actions">
                          <button
                            type="button"
                            className="button button-secondary button-small"
                            disabled={saving}
                            onClick={() => editClient(client)}
                          >
                            Edit
                          </button>

                          <button
                            type="button"
                            className="button button-secondary button-small"
                            disabled={saving}
                            onClick={() =>
                              void setClientActiveState(client, !client.active)
                            }
                          >
                            {client.active ? "Archive" : "Restore"}
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
