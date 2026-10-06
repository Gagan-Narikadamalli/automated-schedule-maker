"use client";

import { useCallback, useEffect, useState } from "react";

import { ScheduleAssistant } from "@/components/ScheduleAssistant";

import {
  SchedulerCalendarViews,
  type ScheduleView,
  type WorkspaceContext,
} from "./SchedulerCalendarViews";
import { ScheduleWorkspaceV3 } from "./ScheduleWorkspaceV3";

function getTodayForDateInput(): string {
  const now = new Date();
  const localTime = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return localTime.toISOString().slice(0, 10);
}

function readWorkspaceContext(): WorkspaceContext | null {
  if (typeof document === "undefined") return null;
  const container = document.querySelector(".schedule-context-controls");
  if (!container) return null;
  const select = container.querySelector("select") as HTMLSelectElement | null;
  const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement | null;
  const locationId = select?.value?.trim() ?? "";
  const locationName = select?.selectedOptions?.[0]?.textContent?.trim() || "Clinic";
  const date = dateInput?.value?.trim() ?? "";
  if (!locationId || !date) return null;
  return {
    locationId,
    locationName,
    date,
    dateSelectionExplicit: dateInput?.dataset.aiDateExplicit === "true",
  };
}

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  );
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export function ScheduleWorkspaceShell() {
  const [scheduleRefreshKey, setScheduleRefreshKey] = useState(0);
  const [view, setView] = useState<ScheduleView>("STAFF");
  const [activeDate, setActiveDate] = useState(getTodayForDateInput);
  const [context, setContext] = useState<WorkspaceContext | null>(null);

  const syncFromWorkspace = useCallback(() => {
    const next = readWorkspaceContext();
    if (!next) return;
    setContext(next);
    setActiveDate(next.date);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(syncFromWorkspace, 350);
    const handleChange = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".schedule-context-controls")) return;
      if (target instanceof HTMLInputElement && target.type === "date") {
        target.dataset.aiDateExplicit = "true";
      }
      window.setTimeout(syncFromWorkspace, 0);
    };
    document.addEventListener("change", handleChange, true);
    syncFromWorkspace();
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("change", handleChange, true);
    };
  }, [syncFromWorkspace]);

  const selectDate = useCallback((date: string, explicit = true) => {
    setActiveDate(date);
    const input = document.querySelector(
      '.schedule-context-controls input[type="date"]'
    ) as HTMLInputElement | null;
    if (!input) return;
    input.dataset.aiDateExplicit = explicit ? "true" : "false";
    setNativeInputValue(input, date);
    window.setTimeout(syncFromWorkspace, 0);
  }, [syncFromWorkspace]);

  useEffect(() => {
    if (!activeDate) return;
    const timer = window.setTimeout(() => {
      const input = document.querySelector(
        '.schedule-context-controls input[type="date"]'
      ) as HTMLInputElement | null;
      if (!input || input.value === activeDate) return;
      input.dataset.aiDateExplicit = context?.dateSelectionExplicit ? "true" : "false";
      setNativeInputValue(input, activeDate);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [scheduleRefreshKey, activeDate, context?.dateSelectionExplicit]);

  function handleAiChanged(effectiveDate?: string) {
    if (effectiveDate) {
      setActiveDate(effectiveDate);
      setContext((current) =>
        current
          ? { ...current, date: effectiveDate, dateSelectionExplicit: true }
          : current
      );
    }
    setScheduleRefreshKey((current) => current + 1);
  }

  return (
    <>
      <SchedulerCalendarViews
        view={view}
        onViewChange={setView}
        activeDate={activeDate}
        onActiveDateChange={selectDate}
        context={context}
        refreshKey={scheduleRefreshKey}
      />

      <div style={{ display: view === "STAFF" ? "block" : "none" }}>
        <ScheduleWorkspaceV3 key={scheduleRefreshKey} />
      </div>

      <ScheduleAssistant onScheduleChanged={handleAiChanged} />
    </>
  );
}
