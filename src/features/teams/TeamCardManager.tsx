"use client";

import { useEffect, useMemo, useState } from "react";

import cardStyles from "@/components/ManagementCards.module.css";
import { ManagementModal } from "@/components/ManagementModal";

type LocationOption = {
  id: string;
  name: string;
};

type TeamRecord = {
  id: string;
  name: string;
  color: string;
  active: boolean;
};

type StaffRecord = {
  id: string;
  fullName: string;
  role: string;
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

function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
}

export function TeamCardManager() {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [teams, setTeams] = useState<TeamRecord[]>([]);
  const [staff, setStaff] = useState<StaffRecord[]>([]);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [query, setQuery] = useState("");
  const [teamName, setTeamName] = useState("");
  const [teamColor, setTeamColor] = useState("#2A87B8");
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("Loading teams...");

  const activeStaff = useMemo(
    () => staff.filter((staffMember) => staffMember.active),
    [staff]
  );

  const activeClients = useMemo(
    () => clients.filter((client) => client.active),
    [clients]
  );

  const visibleTeams = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return teams.filter((team) => {
      if (!team.active) {
        return false;
      }
      if (!normalized) {
        return true;
      }
      const memberNames = [
        ...activeStaff.filter((item) => item.teamId === team.id).map((item) => item.fullName),
        ...activeClients.filter((item) => item.teamId === team.id).map((item) => item.displayCode),
      ].join(" ");
      return `${team.name} ${memberNames}`.toLowerCase().includes(normalized);
    });
  }, [teams, activeStaff, activeClients, query]);

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
      const [teamsResponse, staffResponse, clientsResponse] = await Promise.all([
        fetch(`/api/teams?locationId=${encodeURIComponent(locationId)}`, { cache: "no-store" }),
        fetch(`/api/staff?locationId=${encodeURIComponent(locationId)}&includeArchived=true`, { cache: "no-store" }),
        fetch(`/api/clients?locationId=${encodeURIComponent(locationId)}&includeArchived=true`, { cache: "no-store" }),
      ]);

      const teamsData = (await teamsResponse.json()) as TeamsResponse;
      const staffData = (await staffResponse.json()) as StaffResponse;
      const clientsData = (await clientsResponse.json()) as ClientsResponse;

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
      setMessage("Teams loaded. Use + Add Team to create a scheduling preference group.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Team data could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setTeamName("");
    setTeamColor("#2A87B8");
    setSelectedStaffIds([]);
    setSelectedClientIds([]);
    setEditingId(null);
  }

  function openNewTeam() {
    resetForm();
    setModalOpen(true);
  }

  function openEditTeam(team: TeamRecord) {
    setEditingId(team.id);
    setTeamName(team.name);
    setTeamColor(team.color);
    setSelectedStaffIds(
      activeStaff.filter((staffMember) => staffMember.teamId === team.id).map((staffMember) => staffMember.id)
    );
    setSelectedClientIds(
      activeClients.filter((client) => client.teamId === team.id).map((client) => client.id)
    );
    setModalOpen(true);
  }

  function closeModal(force = false) {
    if (saving && !force) {
      return;
    }
    setModalOpen(false);
    resetForm();
  }

  function toggleId(id: string, current: string[], setter: (ids: string[]) => void) {
    setter(current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  async function updateStaffTeam(staffId: string, teamId: string | null) {
    const response = await fetch(`/api/staff/${staffId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId }),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      throw new Error(data.error || "Staff membership could not be saved.");
    }
  }

  async function updateClientTeam(clientId: string, teamId: string | null) {
    const response = await fetch(`/api/clients/${clientId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId }),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      throw new Error(data.error || "Client membership could not be saved.");
    }
  }

  async function syncMembership(teamId: string) {
    const desiredStaff = new Set(selectedStaffIds);
    const desiredClients = new Set(selectedClientIds);
    const operations: Promise<void>[] = [];

    for (const staffMember of activeStaff) {
      const belongs = staffMember.teamId === teamId;
      const shouldBelong = desiredStaff.has(staffMember.id);
      if (belongs !== shouldBelong) {
        operations.push(updateStaffTeam(staffMember.id, shouldBelong ? teamId : null));
      }
    }

    for (const client of activeClients) {
      const belongs = client.teamId === teamId;
      const shouldBelong = desiredClients.has(client.id);
      if (belongs !== shouldBelong) {
        operations.push(updateClientTeam(client.id, shouldBelong ? teamId : null));
      }
    }

    await Promise.all(operations);
  }

  async function saveTeam() {
    const trimmedName = teamName.trim();
    if (!selectedLocationId || !trimmedName) {
      setMessage("Team name is required.");
      return;
    }

    try {
      setSaving(true);
      let teamId = editingId;

      if (editingId) {
        const response = await fetch(`/api/teams/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmedName, color: teamColor }),
        });
        const data = (await response.json()) as TeamsResponse;
        if (!response.ok) {
          throw new Error(data.error || "Team could not be updated.");
        }
      } else {
        const response = await fetch("/api/teams", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            locationId: selectedLocationId,
            name: trimmedName,
            color: teamColor,
          }),
        });
        const data = (await response.json()) as TeamsResponse;
        if (!response.ok || !data.team) {
          throw new Error(data.error || "Team could not be created.");
        }
        teamId = data.team.id;
      }

      if (!teamId) {
        throw new Error("No team id was returned.");
      }

      await syncMembership(teamId);
      closeModal(true);
      await loadLocationData(selectedLocationId);
      setMessage(`${trimmedName} was saved with its current staff and client membership.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Team could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTeam(team: TeamRecord) {
    const confirmed = window.confirm(
      `Permanently delete ${team.name}? Staff and clients in this team will be moved to No team. Their profiles and schedules will remain.`
    );

    if (!confirmed) {
      return;
    }

    try {
      setSaving(true);
      const response = await fetch(`/api/teams/${team.id}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as TeamsResponse;

      if (!response.ok) {
        throw new Error(data.error || "Team could not be deleted.");
      }

      await loadLocationData(selectedLocationId);
      setMessage(`${team.name} was permanently deleted.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Team could not be deleted.");
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
              <select value={selectedLocationId} disabled={loading} onChange={(event) => setSelectedLocationId(event.target.value)}>
                {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
              </select>
            </label>

            <label className={`form-field compact-field ${cardStyles.searchField}`}>
              <span>Find team</span>
              <input value={query} placeholder="Search team or member..." onChange={(event) => setQuery(event.target.value)} />
            </label>
          </div>

          <button type="button" className={cardStyles.addButton} disabled={!selectedLocationId} onClick={openNewTeam}>
            <span className={cardStyles.addIcon}>+</span>
            Add Team
          </button>
        </div>

        <div className={cardStyles.summaryStrip}>
          <div className={cardStyles.summaryItem}>
            <span>Active teams</span>
            <strong>{teams.filter((team) => team.active).length}</strong>
          </div>
          <div className={cardStyles.summaryItem}>
            <span>Assigned staff</span>
            <strong>{activeStaff.filter((item) => item.teamId).length}</strong>
          </div>
          <div className={cardStyles.summaryItem}>
            <span>Assigned clients</span>
            <strong>{activeClients.filter((item) => item.teamId).length}</strong>
          </div>
        </div>

        <div className="notice info-notice">
          <strong>How teams affect Auto Schedule</strong>
          <p>
            Same-team matching is a preference, not a hard rule. Coverage, availability, call-outs, and client restrictions always come first.
          </p>
        </div>

        {loading ? (
          <div className="inline-message">Loading teams...</div>
        ) : visibleTeams.length === 0 ? (
          <div className={cardStyles.emptyState}>No active teams match this view. Use + Add Team to create one.</div>
        ) : (
          <div className={cardStyles.grid}>
            {visibleTeams.map((team) => {
              const teamStaff = activeStaff.filter((item) => item.teamId === team.id);
              const teamClients = activeClients.filter((item) => item.teamId === team.id);

              return (
                <article key={team.id} className={cardStyles.card} style={{ "--accent": team.color } as React.CSSProperties}>
                  <div className={cardStyles.cardTop}>
                    <div className={cardStyles.identity}>
                      <div className={cardStyles.avatar}>{initials(team.name)}</div>
                      <div className={cardStyles.identityCopy}>
                        <h3>{team.name}</h3>
                        <p>{teamStaff.length} staff · {teamClients.length} clients</p>
                      </div>
                    </div>
                    <span className={cardStyles.pill}>Active</span>
                  </div>

                  <div className={cardStyles.detailList}>
                    <div className={cardStyles.detailRow}>
                      <span>Therapists</span>
                      <strong>{teamStaff.length ? teamStaff.map((item) => item.fullName).join(", ") : "None"}</strong>
                    </div>
                    <div className={cardStyles.detailRow}>
                      <span>Clients</span>
                      <strong>{teamClients.length ? teamClients.map((item) => item.displayCode).join(", ") : "None"}</strong>
                    </div>
                  </div>

                  <div className={cardStyles.cardActions}>
                    <button
                      type="button"
                      className={`button button-small ${cardStyles.editButton}`}
                      disabled={saving}
                      onClick={() => openEditTeam(team)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className={`button button-small ${cardStyles.dangerButton}`}
                      disabled={saving}
                      onClick={() => void deleteTeam(team)}
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
        title={editingId ? "Edit Team" : "Add Team"}
        eyebrow="SCHEDULING GROUP"
        description="Group staff and clients that normally work together. Auto Schedule will try same-team matches before general matching when coverage allows it."
        size="medium"
        onClose={closeModal}
        footer={
          <>
            <button type="button" className="button button-secondary" disabled={saving} onClick={() => closeModal()}>Cancel</button>
            <button type="button" className="button button-primary" disabled={saving} onClick={() => void saveTeam()}>
              {saving ? "Saving..." : editingId ? "Save Changes" : "Add Team"}
            </button>
          </>
        }
      >
        <div className={cardStyles.formSection}>
          <h3>Team essentials</h3>
          <div className="form-grid">
            <label className="form-field form-field-wide">
              <span>Team name</span>
              <input autoFocus value={teamName} placeholder="e.g. Team Blue" onChange={(event) => setTeamName(event.target.value)} />
            </label>
            <label className="form-field">
              <span>Team color</span>
              <input type="color" value={teamColor} onChange={(event) => setTeamColor(event.target.value)} />
            </label>
          </div>
        </div>

        <div className={cardStyles.formSection}>
          <h3>Staff in this team</h3>
          <p>Select the staff who normally work with this team.</p>
          {activeStaff.length > 0 ? (
            <div className="day-selector">
              {activeStaff.map((staffMember) => (
                <label key={staffMember.id} className="checkbox-card">
                  <input
                    type="checkbox"
                    checked={selectedStaffIds.includes(staffMember.id)}
                    onChange={() => toggleId(staffMember.id, selectedStaffIds, setSelectedStaffIds)}
                  />
                  <span>{staffMember.fullName} · {staffMember.role}</span>
                </label>
              ))}
            </div>
          ) : <p className="helper-text">No active staff yet.</p>}
        </div>

        <div className={cardStyles.formSection}>
          <h3>Clients in this team</h3>
          <p>Select the clients that should prefer these staff members.</p>
          {activeClients.length > 0 ? (
            <div className="day-selector">
              {activeClients.map((client) => (
                <label key={client.id} className="checkbox-card">
                  <input
                    type="checkbox"
                    checked={selectedClientIds.includes(client.id)}
                    onChange={() => toggleId(client.id, selectedClientIds, setSelectedClientIds)}
                  />
                  <span>{client.displayCode}</span>
                </label>
              ))}
            </div>
          ) : <p className="helper-text">No active clients yet.</p>}
        </div>

        <div className={`${cardStyles.modalMessage} inline-message`}>{message}</div>
      </ManagementModal>
    </div>
  );
}
