"use client";

import { useEffect, useMemo, useState } from "react";

import { useActionConfirmDialog } from "@/components/ActionConfirmDialog";

type LocationOption = {
  id: string;
  name: string;
  code: string;
};

type TeamRecord = {
  id: string;
  locationId: string;
  name: string;
  color: string;
  active: boolean;
};

type StaffRecord = {
  id: string;
  fullName: string;
  teamId: string | null;
  active: boolean;
};

type ClientRecord = {
  id: string;
  displayCode: string;
  fullName: string;
  teamId: string | null;
  active: boolean;
};

type LocationsResponse = {
  locations?: LocationOption[];
  error?: string;
};

type TeamsResponse = {
  teams?: TeamRecord[];
  team?: TeamRecord;
  error?: string;
};

type StaffResponse = {
  staff?: StaffRecord[];
  error?: string;
};

type ClientsResponse = {
  clients?: ClientRecord[];
  error?: string;
};

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T;

  if (response.status === 401) {
    window.location.href = "/login";
    throw new Error("Your session expired. Please sign in again.");
  }

  return data;
}

export function TeamManager() {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [teams, setTeams] = useState<TeamRecord[]>([]);
  const [staff, setStaff] = useState<StaffRecord[]>([]);
  const [clients, setClients] = useState<ClientRecord[]>([]);

  const [teamName, setTeamName] = useState("");
  const [teamColor, setTeamColor] = useState("#DCE9F8");
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(
    "Loading teams, staff, and clients from MongoDB..."
  );
  const { requestActionDialog, actionDialog } = useActionConfirmDialog();

  const activeStaff = useMemo(
    () => staff.filter((staffMember) => staffMember.active),
    [staff]
  );

  const activeClients = useMemo(
    () => clients.filter((client) => client.active),
    [clients]
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

    resetForm();
    void loadLocationData(selectedLocationId);
  }, [selectedLocationId]);

  async function loadLocationData(locationId: string) {
    try {
      setLoading(true);
      setMessage("Loading team membership from MongoDB...");

      const [teamsResponse, staffResponse, clientsResponse] = await Promise.all([
        fetch(`/api/teams?locationId=${encodeURIComponent(locationId)}`, {
          cache: "no-store",
        }),
        fetch(
          `/api/staff?locationId=${encodeURIComponent(
            locationId
          )}&includeArchived=true`,
          { cache: "no-store" }
        ),
        fetch(
          `/api/clients?locationId=${encodeURIComponent(
            locationId
          )}&includeArchived=true`,
          { cache: "no-store" }
        ),
      ]);

      const [teamsData, staffData, clientsData] = await Promise.all([
        readJson<TeamsResponse>(teamsResponse),
        readJson<StaffResponse>(staffResponse),
        readJson<ClientsResponse>(clientsResponse),
      ]);

      if (!teamsResponse.ok) {
        throw new Error(teamsData.error || "Teams could not be loaded.");
      }

      if (!staffResponse.ok) {
        throw new Error(staffData.error || "Staff could not be loaded.");
      }

      if (!clientsResponse.ok) {
        throw new Error(clientsData.error || "Clients could not be loaded.");
      }

      setTeams(teamsData.teams ?? []);
      setStaff(staffData.staff ?? []);
      setClients(clientsData.clients ?? []);
      setMessage(
        "Teams are stored by clinic. Team matching is a scheduling preference, while coverage remains the higher priority."
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Team data could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setTeamName("");
    setTeamColor("#DCE9F8");
    setSelectedStaffIds([]);
    setSelectedClientIds([]);
    setEditingId(null);
  }

  function toggleSelectedId(
    id: string,
    currentIds: string[],
    setIds: (ids: string[]) => void
  ) {
    if (currentIds.includes(id)) {
      setIds(currentIds.filter((currentId) => currentId !== id));
      return;
    }

    setIds([...currentIds, id]);
  }

  function editTeam(team: TeamRecord) {
    setEditingId(team.id);
    setTeamName(team.name);
    setTeamColor(team.color);
    setSelectedStaffIds(
      activeStaff
        .filter((staffMember) => staffMember.teamId === team.id)
        .map((staffMember) => staffMember.id)
    );
    setSelectedClientIds(
      activeClients
        .filter((client) => client.teamId === team.id)
        .map((client) => client.id)
    );
    setMessage(`Editing ${team.name}.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function updateStaffTeam(staffId: string, teamId: string | null) {
    const response = await fetch(`/api/staff/${staffId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ teamId }),
    });

    const data = await readJson<{ error?: string }>(response);

    if (!response.ok) {
      throw new Error(data.error || "A staff team assignment could not be saved.");
    }
  }

  async function updateClientTeam(clientId: string, teamId: string | null) {
    const response = await fetch(`/api/clients/${clientId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ teamId }),
    });

    const data = await readJson<{ error?: string }>(response);

    if (!response.ok) {
      throw new Error(data.error || "A client team assignment could not be saved.");
    }
  }

  async function synchronizeMembership(
    teamId: string,
    desiredStaffIds: string[],
    desiredClientIds: string[]
  ) {
    const desiredStaff = new Set(desiredStaffIds);
    const desiredClients = new Set(desiredClientIds);
    const membershipUpdates: Promise<void>[] = [];

    for (const staffMember of activeStaff) {
      const shouldBelongToTeam = desiredStaff.has(staffMember.id);
      const currentlyBelongsToTeam = staffMember.teamId === teamId;

      if (shouldBelongToTeam && !currentlyBelongsToTeam) {
        membershipUpdates.push(updateStaffTeam(staffMember.id, teamId));
      } else if (!shouldBelongToTeam && currentlyBelongsToTeam) {
        membershipUpdates.push(updateStaffTeam(staffMember.id, null));
      }
    }

    for (const client of activeClients) {
      const shouldBelongToTeam = desiredClients.has(client.id);
      const currentlyBelongsToTeam = client.teamId === teamId;

      if (shouldBelongToTeam && !currentlyBelongsToTeam) {
        membershipUpdates.push(updateClientTeam(client.id, teamId));
      } else if (!shouldBelongToTeam && currentlyBelongsToTeam) {
        membershipUpdates.push(updateClientTeam(client.id, null));
      }
    }

    await Promise.all(membershipUpdates);
  }

  async function saveTeam() {
    const trimmedName = teamName.trim();

    if (!selectedLocationId) {
      setMessage("Select a clinic location before saving a team.");
      return;
    }

    if (!trimmedName) {
      setMessage("Team name is required.");
      return;
    }

    try {
      setSaving(true);
      setMessage(editingId ? "Saving team changes..." : "Creating team...");

      let teamId = editingId;

      if (editingId) {
        const response = await fetch(`/api/teams/${editingId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: trimmedName,
            color: teamColor,
          }),
        });
        const data = await readJson<TeamsResponse>(response);

        if (!response.ok) {
          throw new Error(data.error || "Team could not be updated.");
        }
      } else {
        const response = await fetch("/api/teams", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            locationId: selectedLocationId,
            name: trimmedName,
            color: teamColor,
          }),
        });
        const data = await readJson<TeamsResponse>(response);

        if (!response.ok || !data.team) {
          throw new Error(data.error || "Team could not be created.");
        }

        teamId = data.team.id;
      }

      if (!teamId) {
        throw new Error("The team was saved but no team identifier was returned.");
      }

      await synchronizeMembership(
        teamId,
        selectedStaffIds,
        selectedClientIds
      );

      const savedName = trimmedName;
      const wasEditing = Boolean(editingId);

      await loadLocationData(selectedLocationId);
      resetForm();
      setMessage(
        wasEditing
          ? `${savedName} and its membership were updated.`
          : `${savedName} and its membership were created.`
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Team could not be saved."
      );
    } finally {
      setSaving(false);
    }
  }

  async function archiveTeam(team: TeamRecord) {
    const choice = await requestActionDialog({
      eyebrow: "ARCHIVE TEAM",
      title: `Archive ${team.name}?`,
      description:
        "Active staff and clients currently assigned to this team will be moved to Unassigned.",
      actions: [
        {
          id: "archive",
          label: "Archive team",
          tone: "danger",
        },
      ],
    });

    if (choice !== "archive") {
      return;
    }

    try {
      setSaving(true);
      setMessage(`Archiving ${team.name}...`);

      await synchronizeMembership(team.id, [], []);

      const response = await fetch(`/api/teams/${team.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ active: false }),
      });
      const data = await readJson<TeamsResponse>(response);

      if (!response.ok) {
        throw new Error(data.error || "Team could not be archived.");
      }

      await loadLocationData(selectedLocationId);
      resetForm();
      setMessage(`${team.name} was archived.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Team could not be archived."
      );
    } finally {
      setSaving(false);
    }
  }

  function staffNamesForTeam(teamId: string): string {
    const names = activeStaff
      .filter((staffMember) => staffMember.teamId === teamId)
      .map((staffMember) => staffMember.fullName);

    return names.length > 0 ? names.join(", ") : "None";
  }

  function clientNamesForTeam(teamId: string): string {
    const names = activeClients
      .filter((client) => client.teamId === teamId)
      .map((client) => client.displayCode);

    return names.length > 0 ? names.join(", ") : "None";
  }

  return (
    <div className="management-layout">
      {actionDialog}
      <section className="section-card">
        <div className="panel-heading-row">
          <div>
            <h2>{editingId ? "Edit Team" : "Create Team"}</h2>
            <p>
              Teams give staff and clients the same scheduling preference group.
              The generator tries same-team matches first, but required coverage
              remains more important than team preference.
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

          <label className="form-field">
            <span>Team name</span>
            <input
              value={teamName}
              onChange={(event) => setTeamName(event.target.value)}
              placeholder="Example: Blue Team"
            />
          </label>

          <label className="form-field">
            <span>Team color</span>
            <input
              type="color"
              value={teamColor}
              onChange={(event) => setTeamColor(event.target.value)}
            />
          </label>
        </div>

        <div className="subsection">
          <h3>Staff in this team</h3>
          {activeStaff.length === 0 ? (
            <p className="helper-text">No active staff are available yet.</p>
          ) : (
            <div className="day-selector">
              {activeStaff.map((staffMember) => (
                <label key={staffMember.id} className="checkbox-card">
                  <input
                    type="checkbox"
                    checked={selectedStaffIds.includes(staffMember.id)}
                    onChange={() =>
                      toggleSelectedId(
                        staffMember.id,
                        selectedStaffIds,
                        setSelectedStaffIds
                      )
                    }
                  />
                  <span>{staffMember.fullName}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="subsection">
          <h3>Clients in this team</h3>
          {activeClients.length === 0 ? (
            <p className="helper-text">No active clients are available yet.</p>
          ) : (
            <div className="day-selector">
              {activeClients.map((client) => (
                <label key={client.id} className="checkbox-card">
                  <input
                    type="checkbox"
                    checked={selectedClientIds.includes(client.id)}
                    onChange={() =>
                      toggleSelectedId(
                        client.id,
                        selectedClientIds,
                        setSelectedClientIds
                      )
                    }
                  />
                  <span>{client.displayCode}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="form-actions">
          <button
            type="button"
            className="button button-primary"
            disabled={loading || saving || !selectedLocationId}
            onClick={() => void saveTeam()}
          >
            {saving
              ? "Saving..."
              : editingId
                ? "Save Team"
                : "Create Team"}
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
            <h2>Teams</h2>
            <p>
              Membership shown here is read from the current staff and client
              records in MongoDB.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="inline-message">Loading teams...</div>
        ) : teams.length === 0 ? (
          <div className="inline-message">
            No teams have been created at this location yet.
          </div>
        ) : (
          <div className="team-card-grid">
            {teams.map((team) => (
              <article key={team.id} className="team-card">
                <div className="team-card-heading">
                  <span
                    className="team-color-swatch"
                    style={{ backgroundColor: team.color }}
                  />
                  <h3>{team.name}</h3>
                </div>

                <p>
                  <strong>Staff:</strong> {staffNamesForTeam(team.id)}
                </p>
                <p>
                  <strong>Clients:</strong> {clientNamesForTeam(team.id)}
                </p>

                <div className="table-actions">
                  <button
                    type="button"
                    className="button button-secondary button-small"
                    disabled={saving}
                    onClick={() => editTeam(team)}
                  >
                    Edit
                  </button>

                  <button
                    type="button"
                    className="button button-secondary button-small"
                    disabled={saving}
                    onClick={() => void archiveTeam(team)}
                  >
                    Archive
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
