"use client";

import { useState } from "react";

type TeamRecord = {
  id: string;
  name: string;
  color: string;
  staffMembers: string[];
  clients: string[];
};

const STAFF_OPTIONS = ["Areyana", "Ariana", "Anias", "Danielle", "Devonyah"];
const CLIENT_OPTIONS = ["ZiBo", "CaMe", "EyNa", "CaGr", "AmAb"];

const INITIAL_TEAMS: TeamRecord[] = [
  {
    id: "team-blue",
    name: "Blue Team",
    color: "#00E5E5",
    staffMembers: ["Areyana", "Ariana"],
    clients: ["ZiBo", "CaMe"],
  },
  {
    id: "team-red",
    name: "Red Team",
    color: "#B10B12",
    staffMembers: ["Danielle"],
    clients: ["CaGr"],
  },
];

export function TeamManager() {
  const [teams, setTeams] = useState<TeamRecord[]>(INITIAL_TEAMS);
  const [teamName, setTeamName] = useState("");
  const [teamColor, setTeamColor] = useState("#DCE9F8");
  const [staffMembers, setStaffMembers] = useState<string[]>([]);
  const [clients, setClients] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState(
    "Teams help the scheduler match staff and clients before filling remaining coverage."
  );

  function toggleValue(
    value: string,
    currentValues: string[],
    setValues: (values: string[]) => void
  ) {
    if (currentValues.includes(value)) {
      setValues(currentValues.filter((currentValue) => currentValue !== value));
      return;
    }

    setValues([...currentValues, value]);
  }

  function resetForm() {
    setTeamName("");
    setTeamColor("#DCE9F8");
    setStaffMembers([]);
    setClients([]);
    setEditingId(null);
  }

  function saveTeam() {
    if (!teamName.trim()) {
      setMessage("Team name is required.");
      return;
    }

    if (editingId) {
      setTeams((currentTeams) =>
        currentTeams.map((team) =>
          team.id === editingId
            ? {
                ...team,
                name: teamName.trim(),
                color: teamColor,
                staffMembers,
                clients,
              }
            : team
        )
      );
      setMessage(`${teamName} was updated.`);
      resetForm();
      return;
    }

    setTeams((currentTeams) => [
      ...currentTeams,
      {
        id: `team-${Date.now()}`,
        name: teamName.trim(),
        color: teamColor,
        staffMembers,
        clients,
      },
    ]);

    setMessage(`${teamName} was added.`);
    resetForm();
  }

  function editTeam(team: TeamRecord) {
    setEditingId(team.id);
    setTeamName(team.name);
    setTeamColor(team.color);
    setStaffMembers(team.staffMembers);
    setClients(team.clients);
    setMessage(`Editing ${team.name}.`);
  }

  function deleteTeam(teamId: string) {
    setTeams((currentTeams) =>
      currentTeams.filter((team) => team.id !== teamId)
    );
    setMessage(
      "Team removed from the current list. Database validation will prevent deleting a team that is still referenced without reassignment."
    );
  }

  return (
    <div className="management-layout">
      <section className="section-card">
        <h2>{editingId ? "Edit Team" : "Create Team"}</h2>

        <div className="form-grid">
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
          <div className="day-selector">
            {STAFF_OPTIONS.map((staffName) => (
              <label key={staffName} className="checkbox-card">
                <input
                  type="checkbox"
                  checked={staffMembers.includes(staffName)}
                  onChange={() =>
                    toggleValue(staffName, staffMembers, setStaffMembers)
                  }
                />
                <span>{staffName}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="subsection">
          <h3>Clients in this team</h3>
          <div className="day-selector">
            {CLIENT_OPTIONS.map((clientCode) => (
              <label key={clientCode} className="checkbox-card">
                <input
                  type="checkbox"
                  checked={clients.includes(clientCode)}
                  onChange={() => toggleValue(clientCode, clients, setClients)}
                />
                <span>{clientCode}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="form-actions">
          <button
            type="button"
            className="button button-primary"
            onClick={saveTeam}
          >
            {editingId ? "Save Team" : "Create Team"}
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
        <h2>Teams</h2>
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
                <strong>Staff:</strong> {team.staffMembers.join(", ") || "None"}
              </p>
              <p>
                <strong>Clients:</strong> {team.clients.join(", ") || "None"}
              </p>

              <div className="table-actions">
                <button
                  type="button"
                  className="button button-secondary button-small"
                  onClick={() => editTeam(team)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="button button-secondary button-small"
                  onClick={() => deleteTeam(team.id)}
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
