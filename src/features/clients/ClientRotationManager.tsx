"use client";

import { useEffect, useMemo, useState } from "react";

type SupportLevel = "STANDARD" | "ONE_TO_ONE" | "ROTATION" | "HIGH_SUPPORT";
type ServiceSetting = "IN_CENTER" | "IN_HOME" | "BOTH";

type LocationOption = {
  id: string;
  name: string;
};

type ClientRecord = {
  id: string;
  displayCode: string;
  fullName: string;
  supportLevel: SupportLevel;
  serviceSetting: ServiceSetting;
  maxConsecutiveBlocksWithSameStaff: number | null;
  desiredDifferentStaffPerDay: number | null;
  active: boolean;
};

type RotationDraft = {
  maxConsecutiveBlocksWithSameStaff: string;
  desiredDifferentStaffPerDay: string;
};

type LocationsResponse = {
  locations?: LocationOption[];
  error?: string;
};

type ClientsResponse = {
  clients?: ClientRecord[];
  error?: string;
};

function recommendedRotationSettings(supportLevel: SupportLevel): {
  maxBlocks: string;
  desiredStaff: string;
  explanation: string;
} {
  if (supportLevel === "HIGH_SUPPORT") {
    return {
      maxBlocks: "2",
      desiredStaff: "3",
      explanation: "Default: rotate about every hour and aim for 3 different staff.",
    };
  }

  if (supportLevel === "ROTATION") {
    return {
      maxBlocks: "4",
      desiredStaff: "2",
      explanation: "Default: rotate about every 2 hours and aim for 2 different staff.",
    };
  }

  return {
    maxBlocks: "No automatic limit",
    desiredStaff: "1",
    explanation: "Default: favor continuity unless another rule requires a change.",
  };
}

function readOptionalInteger(value: string): number | null | "INVALID" {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
    return "INVALID";
  }

  return parsed;
}

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T;

  if (response.status === 401) {
    window.location.href = "/login";
    throw new Error("Your session expired. Please sign in again.");
  }

  return data;
}

export function ClientRotationManager() {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [drafts, setDrafts] = useState<Record<string, RotationDraft>>({});
  const [loading, setLoading] = useState(true);
  const [savingClientId, setSavingClientId] = useState<string | null>(null);
  const [message, setMessage] = useState(
    "Loading client rotation settings from MongoDB..."
  );

  const activeClients = useMemo(
    () => clients.filter((client) => client.active),
    [clients]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadLocations() {
      try {
        const response = await fetch("/api/locations", { cache: "no-store" });
        const data = await readJson<LocationsResponse>(response);

        if (!response.ok) {
          throw new Error(data.error || "Locations could not be loaded.");
        }

        if (cancelled) {
          return;
        }

        const nextLocations = data.locations ?? [];
        setLocations(nextLocations);
        setSelectedLocationId(nextLocations[0]?.id ?? "");

        if (nextLocations.length === 0) {
          setLoading(false);
          setMessage("No clinic locations are available for this account.");
        }
      } catch (error) {
        if (!cancelled) {
          setLoading(false);
          setMessage(
            error instanceof Error
              ? error.message
              : "Clinic locations could not be loaded."
          );
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

    async function loadClients() {
      try {
        setLoading(true);
        setMessage("Loading rotation rules for this clinic...");

        const response = await fetch(
          `/api/clients?locationId=${encodeURIComponent(selectedLocationId)}`,
          { cache: "no-store" }
        );
        const data = await readJson<ClientsResponse>(response);

        if (!response.ok) {
          throw new Error(data.error || "Clients could not be loaded.");
        }

        if (cancelled) {
          return;
        }

        const nextClients = data.clients ?? [];
        const nextDrafts: Record<string, RotationDraft> = {};

        for (const client of nextClients) {
          nextDrafts[client.id] = {
            maxConsecutiveBlocksWithSameStaff:
              client.maxConsecutiveBlocksWithSameStaff?.toString() ?? "",
            desiredDifferentStaffPerDay:
              client.desiredDifferentStaffPerDay?.toString() ?? "",
          };
        }

        setClients(nextClients);
        setDrafts(nextDrafts);
        setMessage(
          "Blank values use the automatic defaults for the selected support level."
        );
      } catch (error) {
        if (!cancelled) {
          setMessage(
            error instanceof Error
              ? error.message
              : "Client rotation settings could not be loaded."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadClients();

    return () => {
      cancelled = true;
    };
  }, [selectedLocationId]);

  function updateDraft(
    clientId: string,
    field: keyof RotationDraft,
    value: string
  ) {
    setDrafts((currentDrafts) => ({
      ...currentDrafts,
      [clientId]: {
        ...currentDrafts[clientId],
        [field]: value.replace(/[^0-9]/g, "").slice(0, 2),
      },
    }));
  }

  async function saveRotationSettings(client: ClientRecord) {
    const draft = drafts[client.id];

    if (!draft) {
      return;
    }

    const maxBlocks = readOptionalInteger(
      draft.maxConsecutiveBlocksWithSameStaff
    );
    const desiredStaff = readOptionalInteger(draft.desiredDifferentStaffPerDay);

    if (maxBlocks === "INVALID" || desiredStaff === "INVALID") {
      setMessage(
        "Rotation values must be whole numbers from 1 to 20. Leave a field blank to use its automatic support-level default."
      );
      return;
    }

    try {
      setSavingClientId(client.id);
      setMessage(`Saving rotation settings for ${client.displayCode}...`);

      const response = await fetch(`/api/clients/${client.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          maxConsecutiveBlocksWithSameStaff: maxBlocks,
          desiredDifferentStaffPerDay: desiredStaff,
        }),
      });
      const data = (await readJson<{ error?: string }>(response));

      if (!response.ok) {
        throw new Error(data.error || "Rotation settings could not be saved.");
      }

      setClients((currentClients) =>
        currentClients.map((currentClient) =>
          currentClient.id === client.id
            ? {
                ...currentClient,
                maxConsecutiveBlocksWithSameStaff: maxBlocks,
                desiredDifferentStaffPerDay: desiredStaff,
              }
            : currentClient
        )
      );
      setMessage(
        `${client.displayCode} rotation settings were saved. Auto Generate and Repair Schedule will use them immediately.`
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Rotation settings could not be saved."
      );
    } finally {
      setSavingClientId(null);
    }
  }

  return (
    <section className="section-card">
      <div className="panel-heading-row">
        <div>
          <h2>Client Rotation Rules</h2>
          <p>
            Fine-tune how frequently a client should change staff. These values
            directly affect Auto Generate and Repair Schedule.
          </p>
        </div>
      </div>

      <div className="form-grid">
        <label className="form-field form-field-wide">
          <span>Clinic location</span>
          <select
            value={selectedLocationId}
            disabled={loading || savingClientId !== null}
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
      </div>

      <div className="inline-message">{message}</div>

      {loading ? (
        <div className="inline-message">Loading rotation settings...</div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Support</th>
                <th>Service</th>
                <th>Max consecutive 30-min blocks</th>
                <th>Desired different staff/day</th>
                <th>Automatic default</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {activeClients.length === 0 ? (
                <tr>
                  <td colSpan={7}>No active clients are available at this location.</td>
                </tr>
              ) : (
                activeClients.map((client) => {
                  const recommendation = recommendedRotationSettings(
                    client.supportLevel
                  );
                  const draft = drafts[client.id] ?? {
                    maxConsecutiveBlocksWithSameStaff: "",
                    desiredDifferentStaffPerDay: "",
                  };

                  return (
                    <tr key={client.id}>
                      <td>
                        <strong>{client.displayCode}</strong>
                        <div className="helper-text">{client.fullName}</div>
                      </td>
                      <td>{client.supportLevel.replaceAll("_", " ")}</td>
                      <td>{client.serviceSetting.replaceAll("_", " ")}</td>
                      <td>
                        <input
                          type="text"
                          inputMode="numeric"
                          aria-label={`Maximum consecutive blocks for ${client.displayCode}`}
                          placeholder="Auto"
                          value={draft.maxConsecutiveBlocksWithSameStaff}
                          onChange={(event) =>
                            updateDraft(
                              client.id,
                              "maxConsecutiveBlocksWithSameStaff",
                              event.target.value
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          inputMode="numeric"
                          aria-label={`Desired different staff per day for ${client.displayCode}`}
                          placeholder="Auto"
                          value={draft.desiredDifferentStaffPerDay}
                          onChange={(event) =>
                            updateDraft(
                              client.id,
                              "desiredDifferentStaffPerDay",
                              event.target.value
                            )
                          }
                        />
                      </td>
                      <td>
                        <strong>
                          {recommendation.maxBlocks} blocks / {recommendation.desiredStaff} staff
                        </strong>
                        <div className="helper-text">
                          {recommendation.explanation}
                        </div>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="button button-secondary button-small"
                          disabled={savingClientId !== null}
                          onClick={() => void saveRotationSettings(client)}
                        >
                          {savingClientId === client.id ? "Saving..." : "Save"}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
