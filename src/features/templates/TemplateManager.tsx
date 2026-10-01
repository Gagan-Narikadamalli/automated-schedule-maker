"use client";

import { useState } from "react";

type TemplateRecord = {
  id: string;
  name: string;
  dayOfWeek: string;
  location: string;
  notes: string;
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

const INITIAL_TEMPLATES: TemplateRecord[] = [
  {
    id: "template-livingston-monday",
    name: "Livingston Monday",
    dayOfWeek: "MONDAY",
    location: "Livingston",
    notes: "Base Monday staffing pattern. Revalidate call-outs and speech before publishing.",
  },
  {
    id: "template-parsippany-monday",
    name: "Parsippany Monday",
    dayOfWeek: "MONDAY",
    location: "Parsippany",
    notes: "Parsippany Monday base template.",
  },
];

export function TemplateManager() {
  const [templates, setTemplates] = useState<TemplateRecord[]>(INITIAL_TEMPLATES);
  const [name, setName] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState("MONDAY");
  const [location, setLocation] = useState("Livingston");
  const [notes, setNotes] = useState("");
  const [sourceDate, setSourceDate] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [message, setMessage] = useState(
    "Templates are reusable starting points. Generated schedules will still revalidate attendance, staff availability, call-outs, speech, breaks, and hard restrictions."
  );

  function createTemplate() {
    if (!name.trim()) {
      setMessage("Template name is required.");
      return;
    }

    setTemplates((currentTemplates) => [
      ...currentTemplates,
      {
        id: `template-${Date.now()}`,
        name: name.trim(),
        dayOfWeek,
        location,
        notes: notes.trim(),
      },
    ]);

    setMessage(`${name} was created.`);
    setName("");
    setNotes("");
  }

  function removeTemplate(templateId: string) {
    setTemplates((currentTemplates) =>
      currentTemplates.filter((template) => template.id !== templateId)
    );
    setMessage("Template removed from the current list.");
  }

  function copyScheduleDate() {
    if (!sourceDate || !targetDate) {
      setMessage("Choose both a source date and a target date.");
      return;
    }

    setMessage(
      `Copy requested from ${sourceDate} to ${targetDate}. The database-backed version will copy assignments, preserve locked/manual information, and then revalidate the target date before publishing.`
    );
  }

  return (
    <div className="management-layout">
      <section className="section-card">
        <h2>Create a Day Template</h2>

        <div className="form-grid">
          <label className="form-field">
            <span>Template name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Example: Livingston Monday"
            />
          </label>

          <label className="form-field">
            <span>Location</span>
            <select
              value={location}
              onChange={(event) => setLocation(event.target.value)}
            >
              <option value="Livingston">Livingston</option>
              <option value="Parsippany">Parsippany</option>
            </select>
          </label>

          <label className="form-field">
            <span>Day of week</span>
            <select
              value={dayOfWeek}
              onChange={(event) => setDayOfWeek(event.target.value)}
            >
              {DAYS.map((day) => (
                <option key={day} value={day}>
                  {day.charAt(0) + day.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </label>

          <label className="form-field form-field-wide">
            <span>Notes</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              placeholder="Describe known recurring constraints for this template."
            />
          </label>
        </div>

        <button
          type="button"
          className="button button-primary"
          onClick={createTemplate}
        >
          Create Template
        </button>
      </section>

      <section className="section-card">
        <h2>Copy an Existing Day</h2>
        <p className="helper-text">
          Copying a previous schedule is different from blindly duplicating it. The
          target day will be checked against current attendance, shifts, call-outs,
          speech sessions, and hard staff/client restrictions.
        </p>

        <div className="form-grid form-grid-compact">
          <label className="form-field">
            <span>Copy from</span>
            <input
              type="date"
              value={sourceDate}
              onChange={(event) => setSourceDate(event.target.value)}
            />
          </label>

          <label className="form-field">
            <span>Copy to</span>
            <input
              type="date"
              value={targetDate}
              onChange={(event) => setTargetDate(event.target.value)}
            />
          </label>
        </div>

        <button
          type="button"
          className="button button-primary"
          onClick={copyScheduleDate}
        >
          Copy and Revalidate
        </button>
      </section>

      <section className="section-card">
        <h2>Saved Templates</h2>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Location</th>
                <th>Day</th>
                <th>Notes</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => (
                <tr key={template.id}>
                  <td>{template.name}</td>
                  <td>{template.location}</td>
                  <td>{template.dayOfWeek}</td>
                  <td>{template.notes || "—"}</td>
                  <td>
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      onClick={() => removeTemplate(template.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="inline-message">{message}</div>
      </section>
    </div>
  );
}
