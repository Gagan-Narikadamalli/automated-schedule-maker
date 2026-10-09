"use client";

import { useEffect, useMemo, useState } from "react";

import { ManagementModal } from "@/components/ManagementModal";

import styles from "./TemplateEditorModal.module.css";
import { synchronizeTemplateNaps, pairedStaff } from "./templateNapLinks";

type TemplateAssignment = {
  id?: string;
  startTime: string;
  endTime: string;
  staffId: string;
  clientId: string | null;
  assignmentType: string;
  locked: boolean;
};

type TemplateDetail = {
  id: string;
  locationId: string;
  name: string;
  dayOfWeek: string;
  sourceType: string;
  sourceName: string;
  sourceDate: string;
  learningOnly: boolean;
  assignments: TemplateAssignment[];
  clientNapSlots?: Array<{ clientId: string; startTime: string }>;
  assignmentCount: number;
};

type StaffOption = {
  id: string;
  name: string;
  role: string;
  color: string;
};

type ClientOption = {
  id: string;
  code: string;
  color: string;
};

type EditorResponse = {
  template?: TemplateDetail;
  staff?: StaffOption[];
  clients?: ClientOption[];
  error?: string;
};

type TemplateEditorModalProps = {
  open: boolean;
  locationId: string;
  templateId: string | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
};

const DAYS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
];

function displayDay(day: string) {
  return day.charAt(0) + day.slice(1).toLowerCase();
}

function addMinutes(time: string, minutes: number): string {
  const [hourText, minuteText] = time.split(":");
  const total = Number(hourText) * 60 + Number(minuteText) + minutes;
  const hour = Math.floor(total / 60) % 24;
  const minute = total % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(
    2,
    "0"
  )}`;
}

function formatTime(time: string): string {
  const [hourText, minuteText] = time.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${period}`;
}

function slotRange(time: string) {
  return `${formatTime(time)} - ${formatTime(addMinutes(time, 30))}`;
}

function assignmentValue(
  assignment: TemplateAssignment | undefined
): string {
  if (!assignment) return "";
  if (
    assignment.assignmentType === "CLIENT_1_TO_1" &&
    assignment.clientId
  ) {
    return `CLIENT:${assignment.clientId}`;
  }
  return `TYPE:${assignment.assignmentType}`;
}

function cellBackground(
  assignment: TemplateAssignment | undefined,
  clientsById: Map<string, ClientOption>
): string {
  if (!assignment) return "#ffffff";
  if (
    assignment.assignmentType === "CLIENT_1_TO_1" &&
    assignment.clientId
  ) {
    return clientsById.get(assignment.clientId)?.color || "#D9F4EE";
  }
  if (
    assignment.assignmentType === "BREAK" ||
    assignment.assignmentType === "BREAK_NAP" ||
    assignment.assignmentType === "BREAK_SPEECH"
  ) {
    return "#fff3cf";
  }
  if (assignment.assignmentType === "SPEECH") return "#e9e1fb";
  if (assignment.assignmentType === "NAP") return "#dff3ef";
  return "#ffffff";
}

export function TemplateEditorModal({
  open,
  locationId,
  templateId,
  onClose,
  onSaved,
}: TemplateEditorModalProps) {
  const [template, setTemplate] = useState<TemplateDetail | null>(null);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [name, setName] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState("MONDAY");
  const [assignments, setAssignments] = useState<TemplateAssignment[]>([]);
  const [view, setView] = useState<"staff" | "client">("staff");
  const [clientNapSlots, setClientNapSlots] = useState<Array<{ clientId: string; startTime: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [linkRequest, setLinkRequest] = useState<{ clientId: string; staffId: string; slots: string[] } | null>(null);
  const [linkError, setLinkError] = useState("");

  useEffect(() => {
    if (!open || !templateId || !locationId) return;

    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setMessage("Loading template...");
        const response = await fetch(
          `/api/templates/${encodeURIComponent(
            templateId as string
          )}?locationId=${encodeURIComponent(locationId)}`,
          { cache: "no-store" }
        );
        const data = (await response.json()) as EditorResponse;
        if (!response.ok || !data.template) {
          throw new Error(data.error || "Template could not be loaded.");
        }
        if (cancelled) return;

        setTemplate(data.template);
        setStaff(data.staff ?? []);
        setClients(data.clients ?? []);
        setName(data.template.name);
        setDayOfWeek(data.template.dayOfWeek);
        setAssignments(data.template.assignments ?? []);
        setClientNapSlots(data.template.clientNapSlots ?? []);
        setMessage(
          "Template-only editor. Changes here do not touch any live schedule until you explicitly apply the template."
        );
      } catch (error) {
        if (!cancelled) {
          setMessage(
            error instanceof Error
              ? error.message
              : "Template could not be loaded."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [open, templateId, locationId]);

  const clientsById = useMemo(
    () => new Map(clients.map((client) => [client.id, client])),
    [clients]
  );

  const assignmentByCell = useMemo(() => {
    const result = new Map<string, TemplateAssignment>();
    for (const assignment of assignments) {
      result.set(
        `${assignment.staffId}|${assignment.startTime}`,
        assignment
      );
    }
    return result;
  }, [assignments, clientNapSlots]);

  const slots = useMemo(() => {
    const values: string[] = [];
    for (let time = "08:00"; time < "17:00"; time = addMinutes(time, 30)) values.push(time);
    return values;
  }, []);

  const napKeys = useMemo(() => new Set(clientNapSlots.map((nap) => `${nap.clientId}|${nap.startTime}`)), [clientNapSlots]);

  function assignedStaffForNap(clientId: string, slot: string): string | null {
    return pairedStaff(assignments, clientId, slot, clientNapSlots);
  }

  function setClientNap(clientId: string, startTime: string, enabled: boolean) {
    setClientNapSlots((current) => enabled
      ? [...current.filter((item) => item.clientId !== clientId || item.startTime !== startTime), { clientId, startTime }]
      : current.filter((item) => item.clientId !== clientId || item.startTime !== startTime));
    if (!enabled) {
      setAssignments((current) => current.filter((item) =>
        !(item.assignmentType === "BREAK_NAP" && item.clientId === clientId && item.startTime === startTime)));
    }
  }
  function setNapRange(clientId: string, from: string, until: string) {
    if (until <= from) { setMessage("Nap end must be later than its start."); return; }
    const range: string[] = [];
    for (let time = from; time < until && range.length < 18; time = addMinutes(time, 30)) range.push(time);
    setClientNapSlots((current) => [
      ...current.filter((item) => item.clientId !== clientId),
      ...range.map((startTime) => ({ clientId, startTime })),
    ]);
    setAssignments((current) => current.filter((item) =>
      !(item.assignmentType === "BREAK_NAP" && item.clientId === clientId && !range.includes(item.startTime))));
  }

  function openLink(clientId: string, staffId: string, slotTimes: string[]) {
    setLinkError("");
    setLinkRequest({ clientId, staffId, slots: slotTimes });
  }

  function saveLinkedBreak() {
    if (!linkRequest?.clientId || !linkRequest.staffId || !linkRequest.slots.length) {
      setLinkError("Choose a client, staff member, and nap time."); return;
    }
    const { clientId, staffId, slots: times } = linkRequest;
    const conflicting = assignments.filter((a) => a.staffId === staffId &&
      times.includes(a.startTime) && !(a.assignmentType === "BREAK_NAP" && a.clientId === clientId));
    if (conflicting.length) {
      setLinkError(`That staff member already has ${conflicting.length} assignment(s) during the selected nap time. Clear or move those cells first; they will not be overwritten.`);
      return;
    }
    const otherCoverage = assignments.find((a) => a.clientId === clientId &&
      a.assignmentType === "CLIENT_1_TO_1" && times.includes(a.startTime));
    if (otherCoverage) {
      setLinkError("This client still has 1:1 coverage during the nap. Adjust the coverage before linking the break.");
      return;
    }
    setClientNapSlots((current) => [
      ...current.filter((n) => n.clientId !== clientId || !times.includes(n.startTime)),
      ...times.map((startTime) => ({ clientId, startTime })),
    ]);
    setAssignments((current) => [
      ...current.filter((a) => a.staffId !== staffId || !times.includes(a.startTime)),
      ...times.map((startTime) => ({
        startTime, endTime: addMinutes(startTime, 30), staffId, clientId,
        assignmentType: "BREAK_NAP", locked: false,
      })),
    ]);
    setLinkRequest(null);
    setLinkError("");
    setMessage("Linked client nap and staff break in this template. Save Template Changes to keep the changes.");
  }

  function updateCell(staffId: string, startTime: string, value: string) {
    if (value.startsWith("NAP_CLIENT:")) {
      openLink(value.slice("NAP_CLIENT:".length), staffId, [startTime]);
      return;
    }
    setAssignments((current) => {
      const next = current.filter((a) => !(a.staffId === staffId && a.startTime === startTime));
      if (!value) return next;
      if (value.startsWith("CLIENT:")) {
        return [...next, { startTime, endTime: addMinutes(startTime, 30), staffId,
          clientId: value.slice("CLIENT:".length), assignmentType: "CLIENT_1_TO_1", locked: false }];
      }
      if (value.startsWith("TYPE:")) {
        return [...next, { startTime, endTime: addMinutes(startTime, 30), staffId,
          clientId: null, assignmentType: value.slice("TYPE:".length), locked: false }];
      }
      return next;
    });
  }

  async function save() {
    if (!templateId || !name.trim()) return;

    try {
      setSaving(true);
      const linked = synchronizeTemplateNaps(assignments, clientNapSlots);
      if (linked.warnings.length) { setMessage("Review template nap conflicts before saving: " + linked.warnings.slice(0, 4).join(" ")); return; }
      setMessage("Saving template changes...");

      const response = await fetch(
        `/api/templates/${encodeURIComponent(templateId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            locationId,
            name: name.trim(),
            dayOfWeek,
            assignments: linked.assignments,
            clientNapSlots: linked.naps,
          }),
        }
      );
      const data = (await response.json()) as EditorResponse;

      if (!response.ok || !data.template) {
        throw new Error(data.error || "Template changes could not be saved.");
      }

      setTemplate(data.template);
      setAssignments(data.template.assignments ?? []);
      setClientNapSlots(data.template.clientNapSlots ?? []);
      setName(data.template.name);
      setDayOfWeek(data.template.dayOfWeek);
      setMessage(
        `Saved ${data.template.assignmentCount} template blocks. No live schedule was changed.`
      );
      await onSaved();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Template changes could not be saved."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <ManagementModal
      open={open}
      title={template ? template.name : "Template Editor"}
      eyebrow="TEMPLATE-ONLY WORKSPACE"
      description="View and edit the reusable template without changing the live scheduling calendar."
      size="large"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="button button-secondary"
            onClick={onClose}
            disabled={saving}
          >
            Close
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={() => void save()}
            disabled={
              loading ||
              saving ||
              !template ||
              template.learningOnly ||
              !name.trim()
            }
          >
            {saving ? "Saving..." : "Save Template Changes"}
          </button>
        </>
      }
    >
      {loading ? (
        <div className={styles.loading}>Loading template...</div>
      ) : template?.learningOnly ? (
        <div className={styles.learningOnly}>
          This is a learning-only profile and has no exact cells to edit.
          Upload an Excel sheet or save an exact schedule day to create an
          editable template.
        </div>
      ) : template ? (
        <div className={styles.editor}>
          <div className={styles.notice}>
            <strong>Template only:</strong> this grid is isolated from the live
            schedule. Editing and saving here changes only this reusable
            template.
          </div>

          <div className={styles.fields}>
            <label>
              <span>Template name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              <span>Weekday</span>
              <select
                value={dayOfWeek}
                onChange={(event) => setDayOfWeek(event.target.value)}
              >
                {DAYS.map((day) => (
                  <option key={day} value={day}>
                    {displayDay(day)}
                  </option>
                ))}
              </select>
            </label>
            <div className={styles.meta}>
              <span>Source</span>
              <strong>
                {template.sourceType === "HISTORICAL_WORKBOOK"
                  ? template.sourceName || "Workbook"
                  : template.sourceType === "SAVED_SCHEDULE"
                    ? `Saved day ${template.sourceDate || ""}`
                    : "Manual template"}
              </strong>
            </div>
          </div>

          <div className={styles.viewTabs} role="tablist" aria-label="Template views">
            <button type="button" role="tab" aria-selected={view === "staff"} className={view === "staff" ? styles.activeTab : ""} onClick={() => setView("staff")}>Staff View</button>
            <button type="button" role="tab" aria-selected={view === "client"} className={view === "client" ? styles.activeTab : ""} onClick={() => setView("client")}>Client View · Naps ({clientNapSlots.length})</button>
          </div>
          <div className={styles.notice}>
            Client naps and staff breaks are separate until you explicitly link them. Use Client View → Link staff break or choose a linked break from Staff View. Existing assignments are never overwritten silently.
          </div>
          {view === "client" && <div className={styles.napRangePanel}>
            {clients.map((client) => {
              const times = clientNapSlots.filter((nap) => nap.clientId === client.id).map((nap) => nap.startTime).sort();
              const from = times[0] ?? "11:30";
              const until = times.length ? addMinutes(times[times.length - 1], 30) : "12:00";
              return <div key={client.id} className={styles.napRangeRow}>
                <strong><i style={{ backgroundColor: client.color }} />{client.code}</strong>
                <label>From <select value={from} onChange={(event) => setNapRange(client.id, event.target.value, until > event.target.value ? until : addMinutes(event.target.value, 30))}>
                  {slots.filter((slot) => slot < "17:00").map((slot) => <option key={slot} value={slot}>{formatTime(slot)}</option>)}
                </select></label>
                <label>To <select value={until} onChange={(event) => setNapRange(client.id, from, event.target.value)}>
                  {slots.filter((slot) => slot >= addMinutes(from, 30) && slot < "17:00").map((slot) => <option key={slot} value={slot}>{formatTime(slot)}</option>)}
                  <option value="17:00">5:00 PM</option>
                </select></label>
                <button type="button" className="button button-secondary" disabled={!times.length}
                  onClick={() => openLink(client.id, assignedStaffForNap(client.id, times[0] ?? from) ?? "", times)}>
                  Link staff break
                </button>
                <button type="button" className="button button-secondary" onClick={() => {
                  setClientNapSlots((current) => current.filter((nap) => nap.clientId !== client.id));
                  setAssignments((current) => current.filter((assignment) => !(assignment.assignmentType === "BREAK_NAP" && assignment.clientId === client.id)));
                }}>Clear nap</button>
                {!times.length && <span>Choose a range to add nap</span>}
              </div>;
            })}
          </div>}
          {linkRequest && <div className={styles.linkPanel} role="dialog" aria-label="Link a staff break to a client's nap">
            <div>
              <strong>Connect client nap and staff break</strong>
              <p>Both will be saved in this template. Existing assignments are protected; this does not create a new 1:1 pairing.</p>
            </div>
            <label>Client
              <select value={linkRequest.clientId}
                onChange={(event) => setLinkRequest((current) => current ? { ...current, clientId: event.target.value } : null)}>
                <option value="">Choose client</option>
                {clients.map((client) => <option key={client.id} value={client.id}>{client.code}</option>)}
              </select>
            </label>
            <label>Staff taking break
              <select value={linkRequest.staffId}
                onChange={(event) => setLinkRequest((current) => current ? { ...current, staffId: event.target.value } : null)}>
                <option value="">Choose staff</option>
                {staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
              </select>
            </label>
            <p>Time: {linkRequest.slots.map(formatTime).join(", ")}</p>
            {linkError && <p role="alert" className={styles.linkError}>{linkError}</p>}
            <div className={styles.linkActions}>
              <button type="button" className="button button-secondary" onClick={() => { setLinkRequest(null); setLinkError(""); }}>Cancel</button>
              <button type="button" className="button button-primary" onClick={saveLinkedBreak}>Connect Break + Nap</button>
            </div>
          </div>}
          <div className={styles.gridWrap}>
            {view === "client" ? <table className={styles.grid}>
              <thead><tr><th className={styles.timeHeader}>Time</th>{clients.map((client) => <th key={client.id}><span className={styles.staffHeader}><i style={{ backgroundColor: client.color }} />{client.code}</span></th>)}</tr></thead>
              <tbody>{slots.map((slot) => <tr key={slot}><th className={styles.timeCell}>{slotRange(slot)}</th>{clients.map((client) => {
                const nap = napKeys.has(`${client.id}|${slot}`);
                const pairedStaffId = nap ? assignedStaffForNap(client.id, slot) : null;
                const pairedStaff = staff.find((member) => member.id === pairedStaffId);
                return <td key={client.id}><label className={styles.napCell} style={{ backgroundColor: nap ? "#dff3ef" : client.color }}>
                  <input type="checkbox" checked={nap} onChange={(event) => setClientNap(client.id, slot, event.target.checked)} />
                  <span>{nap ? `Nap${pairedStaff ? ` · ${pairedStaff.name.split(" ")[0]} break` : ""}` : "Nap?"}</span>
                </label></td>;
              })}</tr>)}</tbody>
            </table> : <table className={styles.grid}>
              <thead>
                <tr>
                  <th className={styles.timeHeader}>Time</th>
                  {staff.map((member) => (
                    <th key={member.id}>
                      <span className={styles.staffHeader}>
                        <i
                          style={{ backgroundColor: member.color }}
                          aria-hidden="true"
                        />
                        {member.name.split(/\s+/)[0]}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slots.map((slot) => (
                  <tr key={slot}>
                    <th className={styles.timeCell}>{slotRange(slot)}</th>
                    {staff.map((member) => {
                      const assignment = assignmentByCell.get(
                        `${member.id}|${slot}`
                      );

                      return (
                        <td key={member.id}>
                          <select
                            value={assignment?.assignmentType === "BREAK_NAP" && assignment.clientId ? `NAP_CLIENT:${assignment.clientId}` : assignmentValue(assignment)}
                            style={{
                              background: cellBackground(
                                assignment,
                                clientsById
                              ),
                            }}
                            onChange={(event) =>
                              updateCell(
                                member.id,
                                slot,
                                event.target.value
                              )
                            }
                          >
                            <option value="">Empty</option>
                            <optgroup label="Client 1:1">
                              {clients.map((client) => (
                                <option
                                  key={client.id}
                                  value={`CLIENT:${client.id}`}
                                >
                                  {client.code} 1:1
                                </option>
                              ))}
                            </optgroup>
                            <optgroup label="Events / breaks">
                              <option value="TYPE:BREAK">Break</option>
                            </optgroup>
                            <optgroup label="Linked break + client nap">
                                {clients.map((client) => <option key={client.id} value={`NAP_CLIENT:${client.id}`}>Break + {client.code} Nap</option>)}
                            </optgroup>
                            <optgroup label="Other events">
                              <option value="TYPE:BREAK_NAP">Break + Nap (unlinked)</option>
                              <option value="TYPE:BREAK_SPEECH">
                                Break + Speech
                              </option>
                              <option value="TYPE:NAP">Nap</option>
                              <option value="TYPE:SPEECH">Speech</option>
                            </optgroup>
                          </select>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>}
          </div>

          <div className={styles.message}>{message}</div>
        </div>
      ) : (
        <div className={styles.loading}>{message || "Template unavailable."}</div>
      )}
    </ManagementModal>
  );
}
