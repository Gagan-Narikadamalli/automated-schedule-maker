"use client";

import { useEffect, useMemo, useState } from "react";

type LocationOption = {
  id: string;
  name: string;
  code: string;
};

type TemplateRecord = {
  id: string;
  locationId: string;
  name: string;
  dayOfWeek: string;
  assignmentCount: number;
  sourceType?: "SAVED_SCHEDULE" | "HISTORICAL_WORKBOOK" | "MANUAL";
  sourceName?: string;
  sourceDate?: string;
  styleNotes?: string[];
  active: boolean;
};

type LocationsResponse = {
  locations?: LocationOption[];
  error?: string;
};

type TemplatesResponse = {
  templates?: TemplateRecord[];
  template?: TemplateRecord;
  error?: string;
};

type OperationResponse = {
  success?: boolean;
  copiedCount?: number;
  appliedCount?: number;
  warnings?: string[];
  error?: string;
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

function getToday(): string {
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}

export function TemplateManager() {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [locationId, setLocationId] = useState("");
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [name, setName] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState("MONDAY");
  const [templateSourceDate, setTemplateSourceDate] = useState(getToday);
  const [workbookName, setWorkbookName] = useState("");
  const [workbookDayOfWeek, setWorkbookDayOfWeek] =
    useState("WEDNESDAY");
  const [workbookSourceDate, setWorkbookSourceDate] =
    useState("2026-09-30");
  const [copySourceDate, setCopySourceDate] = useState("");
  const [copyTargetDate, setCopyTargetDate] = useState("");
  const [applyTargetDate, setApplyTargetDate] = useState(getToday);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("Loading schedule templates...");

  const selectedLocation = useMemo(
    () => locations.find((location) => location.id === locationId),
    [locations, locationId]
  );

  useEffect(() => {
    void loadLocations();
  }, []);

  useEffect(() => {
    if (locationId) {
      void loadTemplates(locationId);
    }
  }, [locationId]);

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

      if (nextLocations.length > 0) {
        setLocationId(nextLocations[0].id);
      } else {
        setMessage("No clinic locations are available yet.");
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Locations could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadTemplates(requestedLocationId = locationId) {
    if (!requestedLocationId) {
      return;
    }

    try {
      setLoading(true);

      const response = await fetch(
        `/api/templates?locationId=${encodeURIComponent(requestedLocationId)}`,
        { cache: "no-store" }
      );
      const data = (await response.json()) as TemplatesResponse;

      if (!response.ok) {
        throw new Error(data.error || "Templates could not be loaded.");
      }

      setTemplates(data.templates ?? []);
      setMessage("Templates loaded from MongoDB.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Templates could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }

  async function createTemplate() {
    if (!locationId || !name.trim()) {
      setMessage("Choose a location and enter a template name.");
      return;
    }

    try {
      setWorking(true);
      setMessage("Saving schedule template...");

      const response = await fetch("/api/templates", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          locationId,
          name: name.trim(),
          dayOfWeek,
          sourceDate: templateSourceDate,
        }),
      });
      const data = (await response.json()) as TemplatesResponse;

      if (!response.ok) {
        throw new Error(data.error || "Template could not be saved.");
      }

      setName("");
      await loadTemplates();
      setMessage(
        `Template saved from ${templateSourceDate}. It will still be revalidated when applied to another date.`
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Template could not be saved."
      );
    } finally {
      setWorking(false);
    }
  }

  async function createWorkbookTemplate() {
    if (!locationId || !workbookName.trim() || !workbookSourceDate) {
      setMessage(
        "Choose a location, template name, weekday, and workbook sheet date."
      );
      return;
    }

    try {
      setWorking(true);
      setMessage("Creating template from imported workbook history...");

      const response = await fetch("/api/templates", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          locationId,
          name: workbookName.trim(),
          dayOfWeek: workbookDayOfWeek,
          sourceDate: workbookSourceDate,
          sourceType: "HISTORICAL_WORKBOOK",
          sourceName: "Livingston workbook history",
          styleNotes: [
            "Prefer long continuous client/staff blocks instead of half-hour fragmentation.",
            "Use natural handoff points around Speech, Nap, and staff breaks.",
            "Prefer roughly 2 clients per staff and 2 stable staff blocks per long-day client when coverage allows.",
            "Client coverage and required staff breaks remain more important than copying the template exactly.",
          ],
        }),
      });
      const data = (await response.json()) as TemplatesResponse & {
        skippedHistoricalRows?: number;
      };

      if (!response.ok) {
        throw new Error(
          data.error || "Workbook template could not be saved."
        );
      }

      setWorkbookName("");
      await loadTemplates();
      setMessage(
        `Workbook template saved from ${workbookSourceDate}. ${data.skippedHistoricalRows ?? 0} unmapped workbook row(s) were skipped. Auto Generate and Native AI can use this as same-weekday guidance.`
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Workbook template could not be saved."
      );
    } finally {
      setWorking(false);
    }
  }

  async function archiveTemplate(templateId: string) {
    try {
      setWorking(true);

      const response = await fetch("/api/templates", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          locationId,
          templateId,
        }),
      });
      const data = (await response.json()) as OperationResponse;

      if (!response.ok) {
        throw new Error(data.error || "Template could not be archived.");
      }

      await loadTemplates();
      setMessage("Template archived. Historical schedules are unchanged.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Template could not be archived."
      );
    } finally {
      setWorking(false);
    }
  }

  async function applyTemplate(template: TemplateRecord) {
    if (!applyTargetDate) {
      setMessage("Choose a target date before applying a template.");
      return;
    }

    try {
      setWorking(true);
      setMessage(`Applying ${template.name} and revalidating the target date...`);

      const response = await fetch("/api/templates/apply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          locationId,
          templateId: template.id,
          targetDate: applyTargetDate,
        }),
      });
      const data = (await response.json()) as OperationResponse;

      if (!response.ok) {
        throw new Error(data.error || "Template could not be applied.");
      }

      const warningText = data.warnings?.length
        ? ` ${data.warnings.length} item(s) were skipped during revalidation.`
        : "";

      setMessage(
        `${data.appliedCount ?? 0} template blocks applied to ${applyTargetDate}.${warningText}`
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Template could not be applied."
      );
    } finally {
      setWorking(false);
    }
  }

  async function copyScheduleDate() {
    if (!locationId || !copySourceDate || !copyTargetDate) {
      setMessage("Choose a source date and target date.");
      return;
    }

    try {
      setWorking(true);
      setMessage("Copying the schedule and revalidating the target date...");

      const response = await fetch("/api/schedule/copy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          locationId,
          sourceDate: copySourceDate,
          targetDate: copyTargetDate,
        }),
      });
      const data = (await response.json()) as OperationResponse;

      if (!response.ok) {
        throw new Error(data.error || "Schedule day could not be copied.");
      }

      const warningText = data.warnings?.length
        ? ` ${data.warnings.length} block(s) were skipped because the target date has different constraints.`
        : "";

      setMessage(
        `${data.copiedCount ?? 0} schedule blocks copied to ${copyTargetDate}.${warningText}`
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Schedule day could not be copied."
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="management-layout">
      <section className="section-card">
        <div className="panel-heading-row">
          <div>
            <h2>Template Location</h2>
            <p>
              Templates are location-specific. Livingston and Parsippany never share
              staff/client IDs accidentally.
            </p>
          </div>

          <label className="form-field compact-field">
            <span>Location</span>
            <select
              value={locationId}
              disabled={loading || working}
              onChange={(event) => setLocationId(event.target.value)}
            >
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="section-card">
        <h2>Create Template from a Saved Day</h2>
        <p className="helper-text">
          Capture the current saved schedule as a reusable weekday template. Manual
          locks are remembered, but the template is revalidated when applied later.
        </p>

        <div className="form-grid">
          <label className="form-field">
            <span>Template name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={`Example: ${selectedLocation?.name ?? "Clinic"} Monday`}
            />
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

          <label className="form-field">
            <span>Capture schedule from date</span>
            <input
              type="date"
              value={templateSourceDate}
              onChange={(event) => setTemplateSourceDate(event.target.value)}
            />
          </label>
        </div>

        <button
          type="button"
          className="button button-primary"
          disabled={working || loading || !locationId}
          onClick={() => void createTemplate()}
        >
          {working ? "Working..." : "Save Day as Template"}
        </button>
      </section>

      <section className="section-card">
        <h2>Create Template from Imported Workbook History</h2>
        <p className="helper-text">
          Use a historical Excel sheet as a same-weekday reference without
          blindly copying it. Only rows mapped to current staff/clients are
          included, and every future application is revalidated against current
          availability, attendance, Speech, Nap, breaks, call-outs, and locks.
        </p>

        <div className="form-grid">
          <label className="form-field">
            <span>Template name</span>
            <input
              value={workbookName}
              onChange={(event) => setWorkbookName(event.target.value)}
              placeholder="Example: Livingston Wednesday Workbook"
            />
          </label>

          <label className="form-field">
            <span>Workbook weekday</span>
            <select
              value={workbookDayOfWeek}
              onChange={(event) =>
                setWorkbookDayOfWeek(event.target.value)
              }
            >
              {DAYS.map((day) => (
                <option key={day} value={day}>
                  {day.charAt(0) + day.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </label>

          <label className="form-field">
            <span>Original sheet date</span>
            <input
              type="date"
              value={workbookSourceDate}
              onChange={(event) =>
                setWorkbookSourceDate(event.target.value)
              }
            />
          </label>
        </div>

        <button
          type="button"
          className="button button-primary"
          disabled={
            working ||
            loading ||
            !locationId ||
            !workbookName.trim() ||
            !workbookSourceDate
          }
          onClick={() => void createWorkbookTemplate()}
        >
          {working ? "Working..." : "Save Workbook Sheet as Template"}
        </button>
      </section>

      <section className="section-card">
        <h2>Copy an Existing Day</h2>
        <p className="helper-text">
          The target day is checked against staff availability, client activity,
          protected manual cells, and other current constraints instead of being
          blindly duplicated.
        </p>

        <div className="form-grid form-grid-compact">
          <label className="form-field">
            <span>Copy from</span>
            <input
              type="date"
              value={copySourceDate}
              onChange={(event) => setCopySourceDate(event.target.value)}
            />
          </label>

          <label className="form-field">
            <span>Copy to</span>
            <input
              type="date"
              value={copyTargetDate}
              onChange={(event) => setCopyTargetDate(event.target.value)}
            />
          </label>
        </div>

        <button
          type="button"
          className="button button-primary"
          disabled={working || loading || !locationId}
          onClick={() => void copyScheduleDate()}
        >
          Copy and Revalidate
        </button>
      </section>

      <section className="section-card">
        <div className="panel-heading-row">
          <div>
            <h2>Saved Templates</h2>
            <p>Apply a saved template to a specific date after revalidation.</p>
          </div>

          <label className="form-field compact-field">
            <span>Apply to date</span>
            <input
              type="date"
              value={applyTargetDate}
              onChange={(event) => setApplyTargetDate(event.target.value)}
            />
          </label>
        </div>

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Day</th>
                <th>Saved blocks</th>
                <th>Source</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.length === 0 ? (
                <tr>
                  <td colSpan={5}>No active templates have been saved yet.</td>
                </tr>
              ) : (
                templates.map((template) => (
                  <tr key={template.id}>
                    <td>{template.name}</td>
                    <td>{template.dayOfWeek}</td>
                    <td>{template.assignmentCount}</td>
                    <td>
                      {template.sourceType === "HISTORICAL_WORKBOOK"
                        ? `Workbook ${template.sourceDate ?? ""}`
                        : template.sourceType === "SAVED_SCHEDULE"
                          ? `Saved day ${template.sourceDate ?? ""}`
                          : "Manual"}
                    </td>
                    <td>
                      <div className="table-actions">
                        <button
                          type="button"
                          className="button button-primary button-small"
                          disabled={working}
                          onClick={() => void applyTemplate(template)}
                        >
                          Apply
                        </button>
                        <button
                          type="button"
                          className="button button-secondary button-small"
                          disabled={working}
                          onClick={() => void archiveTemplate(template.id)}
                        >
                          Archive
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="inline-message">{message}</div>
      </section>
    </div>
  );
}
