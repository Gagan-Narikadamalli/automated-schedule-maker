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
  learningOnly?: boolean;
  learningProfile?: {
    humanStyleBlockBalancingEnabled?: boolean;
    preferredClientsPerStaffPerDay?: number;
    preferredStaffPerClientPerDay?: number;
  } | null;
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

type WorkbookSheetSummary = {
  sheetName: string;
  detectedDate: string | null;
  detectedDayOfWeek: string | null;
  headerRowNumber: number | null;
  timeRowCount: number;
  matchedStaffCount: number;
  totalStaffHeaders: number;
  mappedClientAssignmentCount: number;
  mappedBreakCount: number;
  assignmentCount: number;
  unmatchedStaffHeaders: string[];
  unmatchedClientCodes: string[];
};

type WorkbookInspectResponse = {
  fileName?: string;
  sheets?: WorkbookSheetSummary[];
  inspection?: WorkbookSheetSummary;
  template?: TemplateRecord;
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

function getDayOfWeekFromDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "MONDAY";
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "MONDAY";
  return DAYS[parsed.getUTCDay()];
}

function displayDay(day: string): string {
  return day.charAt(0) + day.slice(1).toLowerCase();
}

export function TemplateManager() {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [locationId, setLocationId] = useState("");
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [name, setName] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState("MONDAY");
  const [templateSourceDate, setTemplateSourceDate] = useState(getToday);
  const [workbookFile, setWorkbookFile] = useState<File | null>(null);
  const [workbookSheets, setWorkbookSheets] = useState<WorkbookSheetSummary[]>([]);
  const [selectedWorkbookSheet, setSelectedWorkbookSheet] = useState("");
  const [workbookName, setWorkbookName] = useState("");
  const [workbookDayOfWeek, setWorkbookDayOfWeek] = useState("WEDNESDAY");
  const [workbookSourceDate, setWorkbookSourceDate] = useState("");
  const [inspectingWorkbook, setInspectingWorkbook] = useState(false);
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

  useEffect(() => {
    setDayOfWeek(getDayOfWeekFromDate(templateSourceDate));
  }, [templateSourceDate]);

  useEffect(() => {
    setWorkbookFile(null);
    setWorkbookSheets([]);
    setSelectedWorkbookSheet("");
    setWorkbookName("");
    setWorkbookSourceDate("");
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
          dayOfWeek: getDayOfWeekFromDate(templateSourceDate),
          sourceDate: templateSourceDate,
          sourceType: "SAVED_SCHEDULE",
        }),
      });
      const data = (await response.json()) as TemplatesResponse;

      if (!response.ok) {
        throw new Error(data.error || "Template could not be saved.");
      }

      setName("");
      await loadTemplates();
      setMessage(
        `Exact ${displayDay(
          getDayOfWeekFromDate(templateSourceDate)
        )} template saved from ${templateSourceDate}. Auto Generate can use it as the same-weekday reference, and direct application will still revalidate current constraints.`
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Template could not be saved."
      );
    } finally {
      setWorking(false);
    }
  }

  function applyWorkbookSheetSelection(
    sheetName: string,
    sheets = workbookSheets
  ) {
    setSelectedWorkbookSheet(sheetName);
    const selected = sheets.find((sheet) => sheet.sheetName === sheetName);
    if (!selected) return;

    if (selected.detectedDayOfWeek) {
      setWorkbookDayOfWeek(selected.detectedDayOfWeek);
    }
    setWorkbookSourceDate(selected.detectedDate ?? "");

    const clinic = selectedLocation?.name ?? "Clinic";
    const day = displayDay(
      selected.detectedDayOfWeek || workbookDayOfWeek
    );
    setWorkbookName(`${clinic} ${day} - ${sheetName}`);
  }

  async function inspectWorkbook(file: File | null) {
    if (!file || !locationId) {
      setWorkbookFile(null);
      setWorkbookSheets([]);
      setSelectedWorkbookSheet("");
      return;
    }

    try {
      setInspectingWorkbook(true);
      setWorkbookFile(file);
      setWorkbookSheets([]);
      setSelectedWorkbookSheet("");
      setMessage("Reading workbook sheets and matching clinic names...");

      const form = new FormData();
      form.set("mode", "INSPECT");
      form.set("locationId", locationId);
      form.set("file", file);

      const response = await fetch("/api/templates/workbook", {
        method: "POST",
        body: form,
      });
      const data = (await response.json()) as WorkbookInspectResponse;

      if (!response.ok) {
        throw new Error(data.error || "Workbook could not be inspected.");
      }

      const sheets = data.sheets ?? [];
      setWorkbookSheets(sheets);

      const firstUsable =
        sheets.find((sheet) => sheet.assignmentCount > 0) ?? sheets[0];
      if (firstUsable) {
        applyWorkbookSheetSelection(firstUsable.sheetName, sheets);
        setMessage(
          `Workbook loaded. Choose a sheet, review its mapping, then save it as an exact weekday template.`
        );
      } else {
        setMessage("Workbook opened, but it does not contain any readable sheets.");
      }
    } catch (error) {
      setWorkbookFile(null);
      setWorkbookSheets([]);
      setSelectedWorkbookSheet("");
      setMessage(
        error instanceof Error
          ? error.message
          : "Workbook could not be inspected."
      );
    } finally {
      setInspectingWorkbook(false);
    }
  }

  async function createWorkbookTemplate() {
    if (
      !locationId ||
      !workbookFile ||
      !selectedWorkbookSheet ||
      !workbookName.trim() ||
      !workbookDayOfWeek
    ) {
      setMessage(
        "Upload a workbook, select a sheet, confirm the weekday, and enter a template name."
      );
      return;
    }

    try {
      setWorking(true);
      setMessage("Creating an exact template from the selected workbook sheet...");

      const form = new FormData();
      form.set("mode", "CREATE");
      form.set("locationId", locationId);
      form.set("file", workbookFile);
      form.set("sheetName", selectedWorkbookSheet);
      form.set("templateName", workbookName.trim());
      form.set("dayOfWeek", workbookDayOfWeek);
      if (workbookSourceDate) {
        form.set("sourceDate", workbookSourceDate);
      }

      const response = await fetch("/api/templates/workbook", {
        method: "POST",
        body: form,
      });
      const data = (await response.json()) as WorkbookInspectResponse;

      if (!response.ok) {
        throw new Error(
          data.error || "Workbook template could not be saved."
        );
      }

      await loadTemplates();
      const inspection = data.inspection;
      const skippedStaff = inspection?.unmatchedStaffHeaders.length ?? 0;
      const skippedClients = inspection?.unmatchedClientCodes.length ?? 0;
      const warning =
        skippedStaff || skippedClients
          ? ` ${skippedStaff} unmatched staff header(s) and ${skippedClients} unmatched client code(s) were skipped; review the mapping shown above.`
          : "";

      setMessage(
        `Exact template saved from "${selectedWorkbookSheet}" with ${inspection?.assignmentCount ?? data.template?.assignmentCount ?? 0} mapped blocks.${warning}`
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
          Generate or manually edit any schedule in the main workspace first,
          then capture that exact saved day here. The weekday is detected from
          the date automatically. Saving the same template name again updates it
          with the newly edited day.
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
            <span>Detected weekday</span>
            <input
              value={displayDay(dayOfWeek)}
              readOnly
              aria-readonly="true"
            />
            <small>
              The weekday is taken from the capture date so a Thursday can no
              longer accidentally be saved as a Monday template.
            </small>
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

        <div className="template-action-row">
          <button
            type="button"
            className="button button-primary"
            disabled={
              working ||
              loading ||
              !locationId ||
              !name.trim() ||
              !templateSourceDate
            }
            onClick={() => void createTemplate()}
          >
            {working ? "Working..." : "Save Exact Day as Template"}
          </button>
          <a className="button button-secondary" href="/">
            Open Schedule Workspace to Generate / Edit
          </a>
        </div>
      </section>

      <section className="section-card">
        <h2>Upload Excel Workbook and Create an Exact Sheet Template</h2>
        <p className="helper-text">
          Upload the real Excel workbook. The website reads its sheet names,
          lets you select one sheet, matches the staff names in the columns and
          client display codes inside the time cells, and saves those exact
          mapped blocks as the weekday template. Current-day rules still
          override the template when Auto Generate runs.
        </p>

        <div className="form-grid">
          <label className="form-field">
            <span>Excel workbook</span>
            <input
              type="file"
              accept=".xlsx,.xls,.xlsm"
              disabled={working || inspectingWorkbook || !locationId}
              onChange={(event) =>
                void inspectWorkbook(event.target.files?.[0] ?? null)
              }
            />
            <small>
              {inspectingWorkbook
                ? "Reading workbook..."
                : workbookFile
                  ? workbookFile.name
                  : "Choose the Livingston workbook or another clinic workbook."}
            </small>
          </label>

          <label className="form-field">
            <span>Sheet to use</span>
            <select
              value={selectedWorkbookSheet}
              disabled={
                inspectingWorkbook ||
                working ||
                workbookSheets.length === 0
              }
              onChange={(event) =>
                applyWorkbookSheetSelection(event.target.value)
              }
            >
              {workbookSheets.length === 0 ? (
                <option value="">Upload a workbook first</option>
              ) : (
                workbookSheets.map((sheet) => (
                  <option key={sheet.sheetName} value={sheet.sheetName}>
                    {sheet.sheetName}
                  </option>
                ))
              )}
            </select>
          </label>

          <label className="form-field">
            <span>Template name</span>
            <input
              value={workbookName}
              disabled={!selectedWorkbookSheet || working}
              onChange={(event) => setWorkbookName(event.target.value)}
              placeholder="Example: Livingston Wednesday - Oct 7"
            />
          </label>

          <label className="form-field">
            <span>Weekday</span>
            <select
              value={workbookDayOfWeek}
              disabled={!selectedWorkbookSheet || working}
              onChange={(event) =>
                setWorkbookDayOfWeek(event.target.value)
              }
            >
              {DAYS.map((day) => (
                <option key={day} value={day}>
                  {displayDay(day)}
                </option>
              ))}
            </select>
            <small>
              Auto-detected from the sheet name/date when possible. You can
              correct it before saving.
            </small>
          </label>

          <label className="form-field">
            <span>Original sheet date (optional)</span>
            <input
              type="date"
              value={workbookSourceDate}
              disabled={!selectedWorkbookSheet || working}
              onChange={(event) =>
                setWorkbookSourceDate(event.target.value)
              }
            />
          </label>
        </div>

        {selectedWorkbookSheet ? (() => {
          const sheet = workbookSheets.find(
            (item) => item.sheetName === selectedWorkbookSheet
          );
          if (!sheet) return null;

          return (
            <div className="template-import-summary">
              <div>
                <strong>{sheet.assignmentCount}</strong>
                <span>mapped blocks</span>
              </div>
              <div>
                <strong>
                  {sheet.matchedStaffCount}/{sheet.totalStaffHeaders || sheet.matchedStaffCount}
                </strong>
                <span>staff columns matched</span>
              </div>
              <div>
                <strong>{sheet.mappedClientAssignmentCount}</strong>
                <span>client blocks</span>
              </div>
              <div>
                <strong>{sheet.mappedBreakCount}</strong>
                <span>break / break+nap blocks</span>
              </div>
              <div>
                <strong>{sheet.timeRowCount}</strong>
                <span>time rows detected</span>
              </div>
            </div>
          );
        })() : null}

        {selectedWorkbookSheet ? (() => {
          const sheet = workbookSheets.find(
            (item) => item.sheetName === selectedWorkbookSheet
          );
          if (!sheet) return null;
          const hasWarnings =
            sheet.unmatchedStaffHeaders.length > 0 ||
            sheet.unmatchedClientCodes.length > 0;
          if (!hasWarnings) {
            return (
              <div className="template-import-ok">
                All detected workbook names/codes on this sheet mapped to the
                current clinic records.
              </div>
            );
          }

          return (
            <div className="template-import-warning">
              {sheet.unmatchedStaffHeaders.length > 0 ? (
                <p>
                  <strong>Unmatched staff columns:</strong>{" "}
                  {sheet.unmatchedStaffHeaders.join(", ")}
                </p>
              ) : null}
              {sheet.unmatchedClientCodes.length > 0 ? (
                <p>
                  <strong>Unmatched client cells:</strong>{" "}
                  {sheet.unmatchedClientCodes.slice(0, 18).join(", ")}
                  {sheet.unmatchedClientCodes.length > 18 ? " ..." : ""}
                </p>
              ) : null}
              <p>
                Unmatched values are skipped instead of being attached to the
                wrong person.
              </p>
            </div>
          );
        })() : null}

        <button
          type="button"
          className="button button-primary"
          disabled={
            working ||
            inspectingWorkbook ||
            loading ||
            !locationId ||
            !workbookFile ||
            !selectedWorkbookSheet ||
            !workbookName.trim()
          }
          onClick={() => void createWorkbookTemplate()}
        >
          {working ? "Working..." : "Create Exact Template from Selected Sheet"}
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
                        ? template.learningOnly
                          ? `Workbook learning profile ${template.sourceDate ?? ""}`
                          : `Workbook ${template.sourceDate ?? ""}`
                        : template.sourceType === "SAVED_SCHEDULE"
                          ? `Saved day ${template.sourceDate ?? ""}`
                          : "Manual"}
                    </td>
                    <td>
                      <div className="table-actions">
                        <button
                          type="button"
                          className="button button-primary button-small"
                          disabled={working || template.learningOnly}
                          title={
                            template.learningOnly
                              ? "Learning-only workbook templates guide Auto Generate and Native AI; they are not direct cell copies."
                              : undefined
                          }
                          onClick={() => void applyTemplate(template)}
                        >
                          {template.learningOnly ? "Learning only" : "Apply"}
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
