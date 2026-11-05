"use client";

import { useEffect, useMemo, useState } from "react";

import { ManagementModal } from "@/components/ManagementModal";

import { TemplateEditorModal } from "./TemplateEditorModal";

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
  updatedAt?: string;
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

type WeekdayPreference = { dayOfWeek: string; firstTemplateId: string; secondTemplateId: string; previousWeekFirst: boolean };
const DEFAULT_WEEKDAY_PREFERENCE = (dayOfWeek: string): WeekdayPreference => ({
  dayOfWeek, firstTemplateId: "", secondTemplateId: "", previousWeekFirst: true,
});

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
  const [filterDay, setFilterDay] = useState("ALL");
  const [activePanel, setActivePanel] = useState<"library" | "add" | "workbook" | "priority" | "copy">("library");
  const [weekdayPreferences, setWeekdayPreferences] = useState<Record<string, WeekdayPreference>>({});
  const [savingPreferenceDay, setSavingPreferenceDay] = useState("");
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [deleteCandidates, setDeleteCandidates] = useState<string[]>([]);
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
  const [applyTemplateTarget, setApplyTemplateTarget] =
    useState<TemplateRecord | null>(null);
  const [applyTargetDate, setApplyTargetDate] = useState(getToday);
  const [editorTemplateId, setEditorTemplateId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("Loading schedule templates...");
  const [notification, setNotification] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  function notify(kind: "success" | "error", text: string) {
    setNotification({ kind, text });
    setMessage(text);
  }

  useEffect(() => {
    if (!notification) return;
    const timeout = window.setTimeout(() => setNotification(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [notification]);

  const selectedLocation = useMemo(
    () => locations.find((location) => location.id === locationId),
    [locations, locationId]
  );

  const visibleTemplates = useMemo(() =>
    templates.filter((item) => filterDay === "ALL" || item.dayOfWeek === filterDay),
    [templates, filterDay]
  );
  const visibleSelected = visibleTemplates.filter((item) => selectedTemplateIds.includes(item.id));
  const primaryExactTemplateIdByDay = useMemo(() => {
    const result = new Map<string, string>();

    for (const template of templates) {
      if (template.learningOnly || template.assignmentCount <= 0) continue;

      const existingId = result.get(template.dayOfWeek);
      if (!existingId) {
        result.set(template.dayOfWeek, template.id);
        continue;
      }

      const existing = templates.find((item) => item.id === existingId);
      if (
        String(template.updatedAt ?? "") >
        String(existing?.updatedAt ?? "")
      ) {
        result.set(template.dayOfWeek, template.id);
      }
    }

    return result;
  }, [templates]);

  useEffect(() => {
    void loadLocations();
  }, []);

  useEffect(() => {
    if (locationId) {
      void loadTemplates(locationId);
      void loadWeekdayPreferences(locationId);
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

  async function loadWeekdayPreferences(requestedLocationId: string) {
    try {
      const response = await fetch(`/api/templates/preferences?locationId=${encodeURIComponent(requestedLocationId)}`, {cache:"no-store"});
      const data = await response.json() as {preferences?: WeekdayPreference[];error?:string};
      if(!response.ok)throw new Error(data.error || "Could not load weekday preferences.");
      setWeekdayPreferences(Object.fromEntries((data.preferences ?? []).map(item=>[item.dayOfWeek,item])));
    } catch(error) {
      notify("error",error instanceof Error ? error.message : "Could not load weekday preferences.");
    }
  }
  function updateWeekdayPreference(day: string, updates: Partial<WeekdayPreference>) {
    setWeekdayPreferences(current => ({
      ...current,
      [day]: {...DEFAULT_WEEKDAY_PREFERENCE(day), ...current[day], ...updates},
    }));
  }
  async function saveWeekdayPreference(day: string) {
    try {
      setSavingPreferenceDay(day);
      const preference = weekdayPreferences[day] ?? DEFAULT_WEEKDAY_PREFERENCE(day);
      const response = await fetch("/api/templates/preferences", {
        method:"PUT",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({locationId,...preference,dayOfWeek:day}),
      });
      const data=await response.json() as {success?:boolean;error?:string};
      if(!response.ok)throw new Error(data.error || "Could not save priority.");
      notify("success",`${displayDay(day)} first/second template order saved. The next Auto Generate Day uses this priority.`);
    } catch(error) {
      notify("error",error instanceof Error ? error.message : "Could not save priority.");
    } finally {
      setSavingPreferenceDay("");
    }
  }

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
      // Do not overwrite a successful action notification during list refresh.
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

      const savedTemplateId = data.template?.id ?? null;
      setName("");
      await loadTemplates();
      notify("success",
        `Exact ${displayDay(
          getDayOfWeekFromDate(templateSourceDate)
        )} template captured from ${templateSourceDate}. Edit the template in the isolated template workspace; the live schedule will not be changed.`
      );
      if (savedTemplateId) {
        setEditorTemplateId(savedTemplateId);
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Template could not be saved."
      );
    } finally {
      setWorking(false);
    }
  }

  async function importRecentTwoWeeks() {
    if (!workbookFile || !locationId) {
      notify("error","Select the updated Livingston workbook before importing.");
      return;
    }
    try {
      setWorking(true);
      const form = new FormData();
      form.set("mode","BULK_RECENT_TWO_WEEKS");
      form.set("locationId",locationId);
      form.set("file",workbookFile);
      const response = await fetch("/api/templates/workbook",{method:"POST",body:form});
      const data = await response.json() as {success?:boolean; importedCount?:number; error?:string; missingDates?:string[]};
      if(!response.ok)throw new Error((data.error ?? "Bulk import failed.")+(data.missingDates?.length ? " Missing dates: "+data.missingDates.join(", "):""));
      await loadTemplates();
      notify("success",`Imported ${data.importedCount ?? 0} dated workbook templates for the two recent workweeks. Auto Generate now uses exact-date, then prior-week saved workbook templates.`);
    } catch(error) {
      notify("error",error instanceof Error?error.message:"Bulk import failed.");
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
      if (data.template?.id) {
        setEditorTemplateId(data.template.id);
      }
      const inspection = data.inspection;
      const skippedStaff = inspection?.unmatchedStaffHeaders.length ?? 0;
      const skippedClients = inspection?.unmatchedClientCodes.length ?? 0;
      const warning =
        skippedStaff || skippedClients
          ? ` ${skippedStaff} unmatched staff header(s) and ${skippedClients} unmatched client code(s) were skipped; review the mapping shown above.`
          : "";

      notify("success",
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
      notify("success", "Template archived successfully. Existing schedules were not changed.");
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

  async function deleteSelectedTemplates() {
    if (!deleteCandidates.length || !locationId) return;
    try {
      setWorking(true);
      const response = await fetch("/api/templates", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId, templateIds: deleteCandidates, permanent: true }),
      });
      const data = (await response.json()) as OperationResponse;
      if (!response.ok) throw new Error(data.error || "Templates could not be deleted.");
      setSelectedTemplateIds((current) => current.filter((id) => !deleteCandidates.includes(id)));
      setDeleteCandidates([]);
      await loadTemplates(locationId);
      notify("success", "Selected templates deleted successfully. Existing schedules were not changed.");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Templates could not be deleted.");
    } finally {
      setWorking(false);
    }
  }

  function openApplyTemplate(template: TemplateRecord) {
    setApplyTemplateTarget(template);
    setApplyTargetDate(getToday());
  }

  async function applyTemplate() {
    if (!applyTemplateTarget || !applyTargetDate) {
      setMessage("Choose the date where this template should be applied.");
      return;
    }

    try {
      setWorking(true);
      setMessage(
        `Applying ${applyTemplateTarget.name} to ${applyTargetDate} and revalidating current-day rules...`
      );

      const response = await fetch("/api/templates/apply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          locationId,
          templateId: applyTemplateTarget.id,
          targetDate: applyTargetDate,
        }),
      });
      const data = (await response.json()) as OperationResponse;

      if (!response.ok) {
        throw new Error(data.error || "Template could not be applied.");
      }

      const warningText = data.warnings?.length
        ? ` ${data.warnings.length} block(s) skipped: ${data.warnings.slice(0, 3).join(" | ")}${data.warnings.length > 3 ? " (additional conflicts omitted)" : ""}`
        : "";

      notify("success",
        `${data.appliedCount ?? 0} template blocks applied to ${applyTargetDate}.${warningText}`
      );
      setApplyTemplateTarget(null);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Template could not be applied.");
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

      notify("success",
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

  const panelButtonStyle = (active: boolean) => ({
    border: active ? "1px solid #244c68" : "1px solid #d6e0e8",
    background: active ? "#edf4f8" : "#ffffff",
    color: active ? "#173c56" : "#425466",
    borderRadius: 10,
    padding: "10px 14px",
    fontWeight: 750,
    cursor: "pointer",
  });

  const sourceLabel = (template: TemplateRecord) =>
    template.sourceType === "HISTORICAL_WORKBOOK"
      ? template.learningOnly
        ? `Workbook learning profile · ${template.sourceDate ?? "undated"}`
        : `Excel workbook · ${template.sourceDate ?? "undated"}`
      : template.sourceType === "SAVED_SCHEDULE"
        ? `Saved schedule · ${template.sourceDate ?? "date unavailable"}`
        : "Manually created";

  return (
    <div className="management-layout">
      <section className="section-card">
        <div className="panel-heading-row">
          <div>
            <h2>Schedule Templates</h2>
            <p>Manage reusable templates for one clinic at a time. Templates are stored separately from live calendars; editing or deleting a template never deletes an existing schedule.</p>
          </div>
          <label className="form-field compact-field">
            <span>Clinic location</span>
            <select value={locationId} disabled={loading || working} onChange={(event) => setLocationId(event.target.value)}>
              {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
            </select>
          </label>
        </div>
        <div style={{display:"flex",flexWrap:"wrap",gap:8,marginTop:18}} role="tablist" aria-label="Template management sections">
          <button type="button" style={panelButtonStyle(activePanel==="library")} aria-selected={activePanel==="library"} onClick={()=>setActivePanel("library")}>Saved templates ({templates.length})</button>
          <button type="button" style={panelButtonStyle(activePanel==="add")} aria-selected={activePanel==="add"} onClick={()=>setActivePanel("add")}>+ Save a schedule day</button>
          <button type="button" style={panelButtonStyle(activePanel==="workbook")} aria-selected={activePanel==="workbook"} onClick={()=>setActivePanel("workbook")}>Import Excel workbook</button>
          <button type="button" style={panelButtonStyle(activePanel==="priority")} aria-selected={activePanel==="priority"} onClick={()=>setActivePanel("priority")}>Auto Generate priorities</button>
          <button type="button" style={panelButtonStyle(activePanel==="copy")} aria-selected={activePanel==="copy"} onClick={()=>setActivePanel("copy")}>Copy a schedule</button>
        </div>
      </section>

      {activePanel === "library" ? (
        <section className="section-card" id="saved-schedule-templates">
          <div className="panel-heading-row">
            <div>
              <h2>Saved template library</h2>
              <p>Browse, edit, apply, archive, or permanently delete templates. Select multiple templates for bulk deletion.</p>
            </div>
            <button type="button" className="button button-primary" onClick={()=>setActivePanel("add")}>+ Add template</button>
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:12,alignItems:"center",margin:"16px 0"}}>
            <label className="form-field compact-field"><span>Filter by weekday</span>
              <select value={filterDay} onChange={(event)=>{setFilterDay(event.target.value);setSelectedTemplateIds([]);}}>
                <option value="ALL">All weekdays</option>
                {DAYS.map((day)=><option key={day} value={day}>{displayDay(day)}</option>)}
              </select>
            </label>
            <button type="button" className="button button-secondary button-small" disabled={working||visibleTemplates.length===0} onClick={()=>{
              const allSelected=visibleTemplates.every((item)=>selectedTemplateIds.includes(item.id));
              setSelectedTemplateIds(allSelected?[]:visibleTemplates.map((item)=>item.id));
            }}>{visibleTemplates.length>0&&visibleTemplates.every((item)=>selectedTemplateIds.includes(item.id))?"Clear selection":"Select all shown"}</button>
            <button type="button" className="button button-warning button-small" disabled={working||visibleSelected.length===0} onClick={()=>setDeleteCandidates(visibleSelected.map((item)=>item.id))}>Delete selected ({visibleSelected.length})</button>
            <span className="helper-text">{visibleTemplates.length} template(s) shown</span>
          </div>
          {loading ? <p className="helper-text">Loading templates…</p> : visibleTemplates.length===0 ? (
            <div className="template-import-ok" style={{padding:20}}>
              <strong>No templates found for this filter.</strong>
              <p>Save a completed schedule day or import an Excel sheet to create your first reusable template.</p>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <button type="button" className="button button-primary" onClick={()=>setActivePanel("add")}>Save a schedule day</button>
                <button type="button" className="button button-secondary" onClick={()=>setActivePanel("workbook")}>Import Excel workbook</button>
              </div>
            </div>
          ) : (
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,320px),1fr))",gap:14}}>
              {visibleTemplates.map((template)=>(
                <article key={template.id} style={{border:"1px solid #dbe4eb",borderRadius:14,padding:16,background:"#fff",display:"flex",flexDirection:"column",gap:12}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
                    <label style={{display:"flex",alignItems:"flex-start",gap:9,minWidth:0}}>
                      <input aria-label={`Select ${template.name}`} type="checkbox" checked={selectedTemplateIds.includes(template.id)} onChange={(event)=>setSelectedTemplateIds((current)=>event.target.checked?[...current,template.id]:current.filter((id)=>id!==template.id))}/>
                      <span style={{fontWeight:800,overflowWrap:"anywhere"}}>{template.name}</span>
                    </label>
                    {primaryExactTemplateIdByDay.get(template.dayOfWeek)===template.id ? <span className="template-primary-badge">Recently updated</span> : null}
                  </div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    <span className="badge">{displayDay(template.dayOfWeek)}</span>
                    <span className="badge">{template.assignmentCount} saved block(s)</span>
                    {template.learningOnly ? <span className="badge">Learning profile</span> : <span className="badge">Editable</span>}
                  </div>
                  <p className="helper-text" style={{margin:0}}>{sourceLabel(template)}</p>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:"auto"}}>
                    {!template.learningOnly ? <button type="button" className="button button-secondary button-small" disabled={working} onClick={()=>setEditorTemplateId(template.id)}>Edit template</button> : null}
                    <button type="button" className="button button-primary button-small" disabled={working||template.learningOnly} title={template.learningOnly?"Learning-only profiles guide Auto Generate but have no exact schedule cells.":"Apply this template to a selected date."} onClick={()=>openApplyTemplate(template)}>{template.learningOnly?"Learning only":"Apply to date"}</button>
                    <button type="button" className="button button-secondary button-small" disabled={working} onClick={()=>void archiveTemplate(template.id)}>Archive</button>
                  </div>
                </article>
              ))}
            </div>
          )}
          <div className="inline-message" role="status">{message}</div>
        </section>
      ) : null}

      {activePanel === "add" ? (
        <section className="section-card" id="create-schedule-template">
          <div className="panel-heading-row"><div><h2>Save a completed schedule as a template</h2><p>Choose the saved calendar date and give the reusable template a clear name. The weekday is detected from the date automatically.</p></div><button type="button" className="button button-secondary" onClick={()=>setActivePanel("library")}>Back to library</button></div>
          <div className="form-grid">
            <label className="form-field"><span>Template name</span><input value={name} onChange={(event)=>setName(event.target.value)} placeholder={`Example: ${selectedLocation?.name??"Clinic"} Monday standard`} maxLength={100}/><small>Use a recognizable name, such as “Livingston Monday – Standard Coverage”.</small></label>
            <label className="form-field"><span>Schedule date to capture</span><input type="date" value={templateSourceDate} onChange={(event)=>setTemplateSourceDate(event.target.value)}/><small>The source date must already have a saved schedule.</small></label>
            <label className="form-field"><span>Detected weekday</span><input value={displayDay(dayOfWeek)} readOnly aria-readonly="true"/><small>This is calculated from the selected date.</small></label>
          </div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap",marginTop:16}}>
            <button type="button" className="button button-primary" disabled={working||loading||!locationId||!name.trim()||!templateSourceDate} onClick={()=>void createTemplate()}>{working?"Saving template…":"Save day as template & open editor"}</button>
            <button type="button" className="button button-secondary" onClick={()=>setActivePanel("library")}>Cancel</button>
          </div>
          <div className="helper-text" style={{marginTop:14}}>This creates a separate template record. It does not change the source calendar day. After saving, the template editor opens so you can review the copied assignments before using it for Auto Generate.</div>
        </section>
      ) : null}

      {activePanel === "workbook" ? (
        <section className="section-card" id="workbook-template-upload">
          <div className="panel-heading-row"><div><h2>Import templates from Excel</h2><p>Inspect the workbook first, choose a sheet, review matching results, then save that sheet as a reusable template.</p></div><button type="button" className="button button-secondary" onClick={()=>setActivePanel("library")}>Back to library</button></div>
          <label className="form-field"><span>Excel workbook</span><input type="file" accept=".xlsx,.xls,.xlsm" disabled={working||inspectingWorkbook||!locationId} onChange={(event)=>void inspectWorkbook(event.target.files?.[0]??null)}/><small>{inspectingWorkbook?"Inspecting workbook…":workbookFile?workbookFile.name:"Select an .xlsx, .xls, or .xlsm file."}</small></label>
          {workbookSheets.length>0 ? (
            <>
              <div className="form-grid" style={{marginTop:16}}>
                <label className="form-field"><span>Workbook sheet</span><select value={selectedWorkbookSheet} disabled={working||inspectingWorkbook} onChange={(event)=>applyWorkbookSheetSelection(event.target.value)}>{workbookSheets.map((sheet)=><option key={sheet.sheetName} value={sheet.sheetName}>{sheet.sheetName}</option>)}</select></label>
                <label className="form-field"><span>Template name</span><input value={workbookName} disabled={!selectedWorkbookSheet||working} onChange={(event)=>setWorkbookName(event.target.value)} maxLength={100}/></label>
                <label className="form-field"><span>Weekday</span><select value={workbookDayOfWeek} disabled={!selectedWorkbookSheet||working} onChange={(event)=>setWorkbookDayOfWeek(event.target.value)}>{DAYS.map((day)=><option key={day} value={day}>{displayDay(day)}</option>)}</select></label>
                <label className="form-field"><span>Original schedule date (optional)</span><input type="date" value={workbookSourceDate} disabled={!selectedWorkbookSheet||working} onChange={(event)=>setWorkbookSourceDate(event.target.value)}/></label>
              </div>
              {selectedWorkbookSheet ? (()=>{const sheet=workbookSheets.find((item)=>item.sheetName===selectedWorkbookSheet);if(!sheet)return null;return <><div className="template-import-summary"><div><strong>{sheet.assignmentCount}</strong><span>mapped blocks</span></div><div><strong>{sheet.matchedStaffCount}/{sheet.totalStaffHeaders||sheet.matchedStaffCount}</strong><span>staff columns matched</span></div><div><strong>{sheet.mappedClientAssignmentCount}</strong><span>client assignments</span></div><div><strong>{sheet.mappedBreakCount}</strong><span>break / nap blocks</span></div></div>{sheet.unmatchedStaffHeaders.length||sheet.unmatchedClientCodes.length?<div className="template-import-warning"><p><strong>Review before saving.</strong></p>{sheet.unmatchedStaffHeaders.length?<p>Unmatched staff columns: {sheet.unmatchedStaffHeaders.join(", ")}</p>:null}{sheet.unmatchedClientCodes.length?<p>Unmatched client codes: {sheet.unmatchedClientCodes.slice(0,18).join(", ")}{sheet.unmatchedClientCodes.length>18?" …":""}</p>:null}<p>Unmatched values are skipped; they are never assigned to the wrong person.</p></div>:<div className="template-import-ok">All detected staff and client values on this sheet match clinic records.</div>}</>;})():null}
              <div style={{display:"flex",gap:10,flexWrap:"wrap",marginTop:16}}><button type="button" className="button button-primary" disabled={working||loading||!selectedWorkbookSheet||!workbookName.trim()} onClick={()=>void createWorkbookTemplate()}>{working?"Saving…":"Save selected sheet as template"}</button><button type="button" className="button button-secondary" disabled={working||!workbookFile} onClick={()=>void importRecentTwoWeeks()}>{working?"Importing…":"Bulk import the 10 configured recent dates"}</button></div>
            </>
          ) : null}
          <p className="helper-text" style={{marginTop:14}}>Bulk import is an optional shortcut for the configured recent two-week range. It does not replace or delete unrelated templates.</p>
        </section>
      ) : null}

      {activePanel === "priority" ? (
        <section className="section-card" id="weekday-template-priority">
          <div className="panel-heading-row"><div><h2>Auto Generate weekday priorities</h2><p>Set preferred templates for each weekday. The generator still checks attendance, availability, role eligibility, fixed events, breaks, and coverage constraints; templates are guidance, not hard rules.</p></div><button type="button" className="button button-secondary" onClick={()=>setActivePanel("library")}>Back to library</button></div>
          {DAYS.slice(0,5).map((day)=>{
            const preference=weekdayPreferences[day]??DEFAULT_WEEKDAY_PREFERENCE(day);
            const choices=templates.filter((template)=>template.dayOfWeek===day&&!template.learningOnly&&template.assignmentCount>0);
            return <div key={day} className="form-grid" style={{marginBottom:14,alignItems:"end",paddingBottom:14,borderBottom:"1px solid #e7edf2"}}>
              <label className="form-field"><span>{displayDay(day)} · First choice</span><select value={preference.firstTemplateId} onChange={(event)=>updateWeekdayPreference(day,{firstTemplateId:event.target.value})}><option value="">Automatic best saved template</option>{choices.map((template)=><option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
              <label className="form-field"><span>Second choice</span><select value={preference.secondTemplateId} onChange={(event)=>updateWeekdayPreference(day,{secondTemplateId:event.target.value})}><option value="">None</option>{choices.map((template)=><option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
              <button type="button" className="button button-primary" disabled={working||savingPreferenceDay!==""||!locationId||(preference.firstTemplateId!==""&&preference.firstTemplateId===preference.secondTemplateId)} onClick={()=>void saveWeekdayPreference(day)}>{savingPreferenceDay===day?"Saving…":"Save weekday priority"}</button>
            </div>;
          })}
        </section>
      ) : null}

      {activePanel === "copy" ? (
        <section className="section-card">
          <div className="panel-heading-row"><div><h2>Copy one saved schedule day to another date</h2><p>This copies schedule assignments, not a reusable weekday template. The destination is revalidated against current staff/client constraints.</p></div><button type="button" className="button button-secondary" onClick={()=>setActivePanel("library")}>Back to library</button></div>
          <div className="form-grid form-grid-compact">
            <label className="form-field"><span>Copy from date</span><input type="date" value={copySourceDate} onChange={(event)=>setCopySourceDate(event.target.value)}/></label>
            <label className="form-field"><span>Copy to date</span><input type="date" value={copyTargetDate} onChange={(event)=>setCopyTargetDate(event.target.value)}/></label>
          </div>
          <button type="button" className="button button-primary" disabled={working||loading||!locationId||!copySourceDate||!copyTargetDate||copySourceDate===copyTargetDate} onClick={()=>void copyScheduleDate()}>{working?"Copying…":"Copy schedule and revalidate"}</button>
        </section>
      ) : null}

      <ManagementModal open={Boolean(applyTemplateTarget)} title={applyTemplateTarget?`Apply ${applyTemplateTarget.name}`:"Apply Template"} eyebrow="MANUAL TEMPLATE APPLICATION" description="Choose a date. The template is revalidated against the target date; incompatible blocks are skipped and reported." size="medium" onClose={()=>setApplyTemplateTarget(null)} footer={<><button type="button" className="button button-secondary" disabled={working} onClick={()=>setApplyTemplateTarget(null)}>Cancel</button><button type="button" className="button button-primary" disabled={working||!applyTargetDate} onClick={()=>void applyTemplate()}>{working?"Applying…":"Apply to selected date"}</button></>}>
        <label className="form-field"><span>Target date</span><input type="date" value={applyTargetDate} onChange={(event)=>setApplyTargetDate(event.target.value)}/><small>{applyTemplateTarget? `Template weekday: ${displayDay(applyTemplateTarget.dayOfWeek)} · Selected date: ${displayDay(getDayOfWeekFromDate(applyTargetDate))}`:""}</small></label>
      </ManagementModal>

      <ManagementModal open={deleteCandidates.length>0} title="Permanently delete templates?" eyebrow="CONFIRM TEMPLATE DELETION" size="medium" description="Only the selected template records will be deleted. Existing calendar schedules and staff/client records will not be changed." onClose={()=>{if(!working)setDeleteCandidates([]);}} footer={<><button type="button" className="button button-secondary" disabled={working} onClick={()=>setDeleteCandidates([])}>Keep templates</button><button type="button" className="button button-warning" disabled={working} onClick={()=>void deleteSelectedTemplates()}>{working?"Deleting…":`Permanently delete ${deleteCandidates.length}`}</button></>}>
        <p>You are about to permanently delete {deleteCandidates.length} template(s):</p>
        <ul>{templates.filter((item)=>deleteCandidates.includes(item.id)).map((item)=><li key={item.id}>{item.name} · {displayDay(item.dayOfWeek)}</li>)}</ul>
        <p className="helper-text">This cannot be undone. If you only want to hide a template from Auto Generate, use Archive instead.</p>
      </ManagementModal>

      {notification ? <div role="status" aria-live="polite" style={{position:"fixed",right:20,bottom:22,zIndex:2000,width:"min(420px,calc(100vw - 40px))",padding:"13px 16px",borderRadius:12,background:notification.kind==="success"?"#e5f7ed":"#fff0f0",color:notification.kind==="success"?"#145336":"#9a2424",border:"1px solid #b8d6c5",boxShadow:"0 8px 30px #091b2a26",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
        <span style={{fontWeight:750}}>{notification.kind==="success"?"✓ ":""}{notification.text}</span>
        <button type="button" aria-label="Dismiss notification" onClick={()=>setNotification(null)} style={{border:0,background:"transparent",fontSize:22,cursor:"pointer"}}>×</button>
      </div> : null}

      <TemplateEditorModal open={Boolean(editorTemplateId)} locationId={locationId} templateId={editorTemplateId} onClose={()=>setEditorTemplateId(null)} onSaved={async()=>{
        setEditorTemplateId(null);
        await loadTemplates();
        notify("success","Template changes saved. The updated template is ready for Auto Generate.");
      }}/>
    </div>
  );
}
}
