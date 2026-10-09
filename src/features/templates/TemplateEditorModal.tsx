"use client";

import { useEffect, useMemo, useState } from "react";

import { ManagementModal } from "@/components/ManagementModal";

import styles from "./TemplateEditorModal.module.css";

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
    const fromAssignments = [
      ...new Set([...assignments.map((assignment) => assignment.startTime), ...clientNapSlots.map((nap) => nap.startTime)]),
    ].sort();

    if (fromAssignments.length > 0) {
      const first = fromAssignments[0];
      const last = fromAssignments[fromAssignments.length - 1];
      const values: string[] = [];
      let current = first;

      while (current <= last && values.length < 40) {
        values.push(current);
        current = addMinutes(current, 30);
      }
      return values;
    }

    const defaults: string[] = [];
    let current = "08:00";
    while (current < "18:00") {
      defaults.push(current);
      current = addMinutes(current, 30);
    }
    return defaults;
  }, [assignments]);

  const napKeys = useMemo(() => new Set(clientNapSlots.map((nap) => `${nap.clientId}|${nap.startTime}`)), [clientNapSlots]);

  function assignedStaffForNap(clientId: string, slot: string): string | null {
    // Prefer the employee working with the client immediately before or after nap.
    const adjacent = [addMinutes(slot, -30), addMinutes(slot, 30)];
    for (const time of adjacent) {
      const paired = assignments.find((item) => item.clientId === clientId &&
        item.assignmentType === "CLIENT_1_TO_1" && item.startTime === time);
      if (paired) return paired.staffId;
    }
    return null;
  }

  function setClientNap(clientId: string, startTime: string, enabled: boolean) {
    setClientNapSlots((current) => enabled
      ? [...current.filter((item) => item.clientId !== clientId || item.startTime !== startTime), { clientId, startTime }]
      : current.filter((item) => item.clientId !== clientId || item.startTime !== startTime));
  }

  function updateCell(
    staffId: string,
    startTime: string,
    value: string
  ) {
    setAssignments((current) => {
      const next = current.filter(
        (assignment) =>
          !(
            assignment.staffId === staffId &&
            assignment.startTime === startTime
          )
      );

      if (!value) return next;

      if (value.startsWith("CLIENT:")) {
        const clientId = value.slice("CLIENT:".length);
        return [
          ...next,
          {
            startTime,
            endTime: addMinutes(startTime, 30),
            staffId,
            clientId,
            assignmentType: "CLIENT_1_TO_1",
            locked: false,
          },
        ];
      }

      if (value.startsWith("TYPE:")) {
        return [
          ...next,
          {
            startTime,
            endTime: addMinutes(startTime, 30),
            staffId,
            clientId: null,
            assignmentType: value.slice("TYPE:".length),
            locked: false,
          },
        ];
      }

      return next;
    });
  }

  async function save() {
    if (!templateId || !name.trim()) return;

    try {
      setSaving(true);
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
            assignments,
            clientNapSlots,
          }),
        }
      );
      const data = (await response.json()) as EditorResponse;

      if (!response.ok || !data.template) {
        throw new Error(data.error || "Template changes could not be saved.");
      }

      setTemplate(data.template);
      setAssignments(data.template.assignments ?? []);
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
            Client naps are stored in this template. Staff View previews a Break + Nap for the employee paired with that client near the nap time. Explicit staff cells are never silently overwritten.
          </div>
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
                      const pairedNap = clientNapSlots.find((nap) => nap.startTime === slot && assignedStaffForNap(nap.clientId, slot) === member.id);
                      const napPreview = pairedNap && !assignment ? { assignmentType: "BREAK_NAP", clientId: pairedNap.clientId } : null;
                      return (
                        <td key={member.id}>
                          <select
                            value={napPreview ? "TYPE:BREAK_NAP" : assignmentValue(assignment)}
                            style={{
                              background: cellBackground(
                                assignment ?? (napPreview ? { startTime: slot, endTime: addMinutes(slot, 30), staffId: member.id, clientId: pairedNap?.clientId ?? null, assignmentType: "BREAK_NAP", locked: false } : undefined),
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
                              <option value="TYPE:BREAK_NAP">
                                Break + Nap
                              </option>
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
