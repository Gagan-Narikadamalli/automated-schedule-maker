"use client";

import { useEffect, useMemo, useState } from "react";

import styles from "./ClientStaffAssignments.module.css";

type Relationship = "PREFERRED" | "ALLOWED" | "HARD_RESTRICTION";
type StaffRole = "BT" | "RBT" | "INTERN" | "BCBA" | "OFFICE_MANAGER" | "OTHER";

type LocationOption = { id: string; name: string };
type StaffRecord = {
  id: string;
  fullName: string;
  role: StaffRole;
  active: boolean;
};
type StaffRelationship = { staffId: string; relationship: Relationship };
type ClientRecord = {
  id: string;
  displayCode: string;
  fullName: string;
  staffRelationships: StaffRelationship[];
  active: boolean;
  teamId?: string | null;
};
type LocationsResponse = { locations?: LocationOption[]; error?: string };
type StaffResponse = { staff?: StaffRecord[]; error?: string };
type ClientsResponse = { clients?: ClientRecord[]; error?: string };
type DraftRelationships = Record<string, Record<string, Relationship>>;

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
}

const THERAPIST_ROLES: StaffRole[] = ["BT", "RBT", "INTERN"];

const RELATIONSHIP_OPTIONS: Array<{ value: Relationship; label: string }> = [
  { value: "PREFERRED", label: "Preferred" },
  { value: "ALLOWED", label: "Allowed" },
  { value: "HARD_RESTRICTION", label: "Restricted" },
];

function relationshipLabel(relationship: Relationship): string {
  return relationship === "PREFERRED"
    ? "Preferred"
    : relationship === "HARD_RESTRICTION"
      ? "Restricted"
      : "Allowed";
}

export function ClientStaffAssignments() {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [staff, setStaff] = useState<StaffRecord[]>([]);
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [draftRelationships, setDraftRelationships] = useState<DraftRelationships>({});
  const [selectedClientId, setSelectedClientId] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [staffSearch, setStaffSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("Loading client and therapist information...");
  const [error, setError] = useState("");

  const activeStaff = useMemo(
    () => staff.filter((member) => member.active && THERAPIST_ROLES.includes(member.role)),
    [staff]
  );
  const activeClients = useMemo(
    () => clients.filter((client) => client.active),
    [clients]
  );
  const selectedClient = useMemo(
    () => activeClients.find((client) => client.id === selectedClientId) ?? null,
    [activeClients, selectedClientId]
  );
  const visibleClients = useMemo(() => {
    const normalized = clientSearch.trim().toLowerCase();
    return activeClients.filter((client) =>
      !normalized ||
      client.displayCode.toLowerCase().includes(normalized) ||
      client.fullName.toLowerCase().includes(normalized)
    );
  }, [activeClients, clientSearch]);
  const visibleStaff = useMemo(() => {
    const normalized = staffSearch.trim().toLowerCase();
    return activeStaff.filter((member) =>
      !normalized ||
      member.fullName.toLowerCase().includes(normalized) ||
      member.role.toLowerCase().includes(normalized)
    );
  }, [activeStaff, staffSearch]);

  const selectedRelationships = selectedClientId
    ? draftRelationships[selectedClientId] ?? {}
    : {};

  const selectedCounts = useMemo(() => {
    const counts = { preferred: 0, allowed: 0, restricted: 0 };
    for (const member of activeStaff) {
      const relationship = selectedRelationships[member.id] ?? "ALLOWED";
      if (relationship === "PREFERRED") counts.preferred += 1;
      else if (relationship === "HARD_RESTRICTION") counts.restricted += 1;
      else counts.allowed += 1;
    }
    return counts;
  }, [activeStaff, selectedRelationships]);

  const sharedStaffSummary = useMemo(() => {
    return activeStaff
      .map((member) => {
        const preferredClients = activeClients.filter(
          (client) =>
            (draftRelationships[client.id]?.[member.id] ??
              client.staffRelationships?.find((item) => item.staffId === member.id)?.relationship ??
              "ALLOWED") === "PREFERRED"
        );
        const allowedClients = activeClients.filter(
          (client) =>
            (draftRelationships[client.id]?.[member.id] ??
              client.staffRelationships?.find((item) => item.staffId === member.id)?.relationship ??
              "ALLOWED") === "ALLOWED"
        );
        return { ...member, preferredClients, allowedClients };
      })
      .filter((member) => member.preferredClients.length > 0 || member.allowedClients.length > 0)
      .sort((left, right) =>
        right.preferredClients.length - left.preferredClients.length ||
        left.fullName.localeCompare(right.fullName)
      );
  }, [activeStaff, activeClients, draftRelationships]);

  useEffect(() => {
    let cancelled = false;
    async function loadLocations() {
      try {
        const response = await fetch("/api/locations", { cache: "no-store" });
        const data = await readJson<LocationsResponse>(response);
        if (!response.ok) throw new Error(data.error || "Clinic locations could not be loaded.");
        if (cancelled) return;
        const nextLocations = data.locations ?? [];
        setLocations(nextLocations);
        if (nextLocations.length > 0) setSelectedLocationId(nextLocations[0].id);
        else {
          setMessage("No clinic locations are available for this account.");
          setLoading(false);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Clinic locations could not be loaded.");
          setLoading(false);
        }
      }
    }
    void loadLocations();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedLocationId) return;
    let cancelled = false;
    async function loadLocationData() {
      try {
        setLoading(true);
        setError("");
        setMessage("Loading clients and therapists...");
        const [staffResponse, clientsResponse] = await Promise.all([
          fetch(`/api/staff?locationId=${encodeURIComponent(selectedLocationId)}`, { cache: "no-store" }),
          fetch(`/api/clients?locationId=${encodeURIComponent(selectedLocationId)}`, { cache: "no-store" }),
        ]);
        const [staffData, clientsData] = await Promise.all([
          readJson<StaffResponse>(staffResponse),
          readJson<ClientsResponse>(clientsResponse),
        ]);
        if (!staffResponse.ok) throw new Error(staffData.error || "Therapists could not be loaded.");
        if (!clientsResponse.ok) throw new Error(clientsData.error || "Clients could not be loaded.");
        if (cancelled) return;
        const nextStaff = staffData.staff ?? [];
        const nextClients = (clientsData.clients ?? []).map((client) => ({
          ...client,
          staffRelationships: client.staffRelationships ?? [],
        }));
        const nextDrafts: DraftRelationships = {};
        for (const client of nextClients) {
          nextDrafts[client.id] = Object.fromEntries(
            client.staffRelationships.map((item) => [item.staffId, item.relationship])
          );
        }
        setStaff(nextStaff);
        setClients(nextClients);
        setDraftRelationships(nextDrafts);
        setSelectedClientId((current) =>
          nextClients.some((client) => client.id === current)
            ? current
            : nextClients.find((client) => client.active)?.id ?? ""
        );
        setMessage(`${nextClients.filter((client) => client.active).length} active clients and ${nextStaff.filter((member) => member.active && THERAPIST_ROLES.includes(member.role)).length} active therapists loaded.`);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Client-staff assignments could not be loaded.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadLocationData();
    return () => { cancelled = true; };
  }, [selectedLocationId]);

  function updateRelationship(staffId: string, relationship: Relationship) {
    if (!selectedClientId) return;
    setDraftRelationships((current) => ({
      ...current,
      [selectedClientId]: {
        ...(current[selectedClientId] ?? {}),
        [staffId]: relationship,
      },
    }));
  }

  function resetSelectedClient() {
    if (!selectedClient) return;
    setDraftRelationships((current) => ({
      ...current,
      [selectedClient.id]: Object.fromEntries(
        selectedClient.staffRelationships.map((item) => [item.staffId, item.relationship])
      ),
    }));
  }

  async function saveSelectedClient() {
    if (!selectedClient) return;
    try {
      setSaving(true);
      setError("");
      setMessage(`Saving therapist preferences for ${selectedClient.displayCode}...`);
      const existingRelationships = new Map(
        selectedClient.staffRelationships.map((item) => [item.staffId, item.relationship])
      );
      // Keep relationships for archived or non-therapist staff; update only the active therapist roster.
      for (const member of activeStaff) {
        existingRelationships.set(member.id, draftRelationships[selectedClient.id]?.[member.id] ?? "ALLOWED");
      }
      const staffRelationships = Array.from(existingRelationships.entries()).map(
        ([staffId, relationship]) => ({ staffId, relationship })
      );
      const response = await fetch(`/api/clients/${selectedClient.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffRelationships }),
      });
      const data = await readJson<{ client?: ClientRecord; error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "Therapist preferences could not be saved.");
      const savedRelationships = data.client?.staffRelationships ?? staffRelationships;
      setClients((current) => current.map((client) =>
        client.id === selectedClient.id
          ? { ...client, staffRelationships: savedRelationships }
          : client
      ));
      setDraftRelationships((current) => ({
        ...current,
        [selectedClient.id]: Object.fromEntries(
          savedRelationships.map((item) => [item.staffId, item.relationship])
        ),
      }));
      setMessage(`Saved ${activeStaff.filter((member) => (draftRelationships[selectedClient.id]?.[member.id] ?? "ALLOWED") === "PREFERRED").length} preferred therapist(s) for ${selectedClient.displayCode}. Other clients' assignments were not changed.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Therapist preferences could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.workspace}>
      <section className="section-card">
        <div className={styles.toolbar}>
          <div>
            <h2>Client–therapist assignments</h2>
            <p>Set each client's therapist relationships independently. The same therapist can be preferred by any number of clients.</p>
          </div>
          <label className="form-field">
            <span>Clinic location</span>
            <select value={selectedLocationId} disabled={loading || saving} onChange={(event) => setSelectedLocationId(event.target.value)}>
              {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
            </select>
          </label>
        </div>

        <div className={styles.notice}>
          <strong>Shared therapists are supported.</strong>
          <span>For example, Beatrice can be Preferred for Client A and Client B at the same time. Changing Client A never removes Beatrice from Client B.</span>
        </div>

        <div className={styles.workspaceGrid}>
          <aside className={styles.clientPanel}>
            <div className={styles.panelHeading}>
              <h3>Clients</h3>
              <span>{activeClients.length}</span>
            </div>
            <input
              className={styles.search}
              value={clientSearch}
              onChange={(event) => setClientSearch(event.target.value)}
              placeholder="Search clients..."
              aria-label="Search clients"
            />
            <div className={styles.clientList}>
              {visibleClients.map((client) => {
                const preferredCount = activeStaff.filter(
                  (member) => (draftRelationships[client.id]?.[member.id] ?? "ALLOWED") === "PREFERRED"
                ).length;
                return (
                  <button
                    type="button"
                    key={client.id}
                    className={`${styles.clientButton} ${selectedClientId === client.id ? styles.clientButtonActive : ""}`}
                    onClick={() => setSelectedClientId(client.id)}
                    disabled={saving}
                  >
                    <span className={styles.clientIdentity}>
                      <strong>{client.displayCode}</strong>
                      <small>{client.fullName}</small>
                    </span>
                    <span className={styles.clientMeta}>{preferredCount} preferred</span>
                  </button>
                );
              })}
              {visibleClients.length === 0 && <p className={styles.empty}>No clients match this search.</p>}
            </div>
          </aside>

          <section className={styles.assignmentPanel}>
            {selectedClient ? (
              <>
                <div className={styles.selectedHeader}>
                  <div>
                    <span className={styles.eyebrow}>CLIENT PREFERENCES</span>
                    <h3>{selectedClient.displayCode}</h3>
                    <p>{selectedClient.fullName}</p>
                  </div>
                  <div className={styles.actions}>
                    <button type="button" className="button button-secondary" onClick={resetSelectedClient} disabled={saving}>Reset</button>
                    <button type="button" className="button button-primary" onClick={() => void saveSelectedClient()} disabled={saving || loading}>
                      {saving ? "Saving..." : "Save client assignments"}
                    </button>
                  </div>
                </div>

                <div className={styles.counts}>
                  <div><strong>{selectedCounts.preferred}</strong><span>Preferred</span></div>
                  <div><strong>{selectedCounts.allowed}</strong><span>Allowed</span></div>
                  <div><strong>{selectedCounts.restricted}</strong><span>Restricted</span></div>
                </div>

                <input
                  className={styles.search}
                  value={staffSearch}
                  onChange={(event) => setStaffSearch(event.target.value)}
                  placeholder="Search therapist by name or role..."
                  aria-label="Search therapists"
                />

                <div className={styles.staffList}>
                  {visibleStaff.map((member) => {
                    const relationship = selectedRelationships[member.id] ?? "ALLOWED";
                    const sharedClientCount = activeClients.filter((client) =>
                      (draftRelationships[client.id]?.[member.id] ??
                        client.staffRelationships.find((item) => item.staffId === member.id)?.relationship ??
                        "ALLOWED") === "PREFERRED"
                    ).length;
                    return (
                      <div className={styles.staffRow} key={member.id}>
                        <div className={styles.staffIdentity}>
                          <strong>{member.fullName}</strong>
                          <span>{member.role} · Preferred for {sharedClientCount} {sharedClientCount === 1 ? "client" : "clients"}</span>
                        </div>
                        <label className={styles.relationshipControl}>
                          <span className={styles.srOnly}>{relationshipLabel(relationship)} relationship for {member.fullName}</span>
                          <select value={relationship} onChange={(event) => updateRelationship(member.id, event.target.value as Relationship)} disabled={saving}>
                            {RELATIONSHIP_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                          </select>
                        </label>
                      </div>
                    );
                  })}
                  {visibleStaff.length === 0 && <p className={styles.empty}>No active BT, RBT, or Intern therapists match this search.</p>}
                </div>
                <p className={styles.helper}>Allowed is the default. Preferred gives the therapist extra scheduling priority. Restricted prevents this therapist from being paired with this client. Availability, role eligibility, breaks, and coverage rules still take priority.</p>
              </>
            ) : (
              <div className={styles.emptyState}>
                <h3>Select a client</h3>
                <p>Choose a client from the list to manage their therapist preferences.</p>
              </div>
            )}
          </section>
        </div>
        {error ? <div className={styles.error}>{error}</div> : null}
        <div className="inline-message">{message}</div>
      </section>

      <section className="section-card">
        <div className={styles.summaryHeader}>
          <div>
            <h2>Shared therapist overview</h2>
            <p>See which therapists are preferred by multiple clients. These relationships are independent, not exclusive.</p>
          </div>
        </div>
        <div className={styles.sharedGrid}>
          {sharedStaffSummary.map((member) => (
            <article className={styles.sharedCard} key={member.id}>
              <div>
                <strong>{member.fullName}</strong>
                <span>{member.role}</span>
              </div>
              <div className={styles.sharedCount}>
                <strong>{member.preferredClients.length}</strong>
                <span>preferred clients</span>
              </div>
              <p>{member.preferredClients.length ? member.preferredClients.map((client) => client.displayCode).join(", ") : "No preferred clients"}</p>
            </article>
          ))}
          {sharedStaffSummary.length === 0 && <p className={styles.empty}>No active therapist relationships are available yet.</p>}
        </div>
      </section>
    </div>
  );
}
