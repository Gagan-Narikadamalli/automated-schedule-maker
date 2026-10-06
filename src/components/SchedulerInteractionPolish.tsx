"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { exportDailyScheduleXlsx } from "@/features/scheduler/exportDailyScheduleXlsx";

import styles from "./SchedulerInteractionPolish.module.css";

function findManualModeButton(): HTMLButtonElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.trim().startsWith("Manual Mode:")
    ) ?? null
  );
}

function findCancelPlacementButton(): HTMLButtonElement | null {
  return (
    Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        ".unplaced-tray .warning-notice button"
      )
    ).find((button) => /cancel placement/i.test(button.textContent ?? "")) ?? null
  );
}

function isUnplacedDragSource(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('.unplaced-tray [title^="Drag this block"]'));
}

function readExportContext(): {
  locationId: string;
  locationName: string;
  date: string;
} | null {
  const container = document.querySelector(".schedule-context-controls");
  if (!container) return null;
  const select = container.querySelector("select") as HTMLSelectElement | null;
  const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement | null;
  const locationId = select?.value?.trim() ?? "";
  const locationName = select?.selectedOptions?.[0]?.textContent?.trim() || "Clinic";
  const date = dateInput?.value?.trim() ?? "";
  if (!locationId || !date) return null;
  return { locationId, locationName, date };
}

function countUnplacedBlocks(tray: Element | null): number {
  if (!tray) return 0;
  return tray.querySelectorAll('button[title^="Drag this block"]').length;
}

/**
 * DOM-level affordance layer for the scheduler workspace.
 *
 * The daily schedule owns the full workspace width until the manager explicitly
 * opens Unplaced Assignments. When open, the original tray is restored beside
 * the schedule so blocks can be dragged a short distance into the calendar.
 */
export function SchedulerInteractionPolish() {
  const [unplacedOpen, setUnplacedOpen] = useState(false);
  const [unplacedCount, setUnplacedCount] = useState(0);
  const [hasUnplacedTray, setHasUnplacedTray] = useState(false);
  const [toolbarTarget, setToolbarTarget] = useState<HTMLElement | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let draggingUnplaced = false;
    let manualModeWasOn = false;

    function handleDragStart(event: DragEvent) {
      if (!isUnplacedDragSource(event.target)) return;
      draggingUnplaced = true;
      manualModeWasOn = /manual mode:\s*on/i.test(
        findManualModeButton()?.textContent ?? ""
      );
    }

    function handleDragEnd(event: DragEvent) {
      if (!draggingUnplaced || !isUnplacedDragSource(event.target)) return;
      draggingUnplaced = false;

      window.setTimeout(() => {
        findCancelPlacementButton()?.click();

        const manualModeButton = findManualModeButton();
        if (
          !manualModeWasOn &&
          manualModeButton &&
          /manual mode:\s*on/i.test(manualModeButton.textContent ?? "")
        ) {
          manualModeButton.click();
        }
      }, 0);
    }

    document.addEventListener("dragstart", handleDragStart, true);
    document.addEventListener("dragend", handleDragEnd, true);

    return () => {
      document.removeEventListener("dragstart", handleDragStart, true);
      document.removeEventListener("dragend", handleDragEnd, true);
    };
  }, []);

  useEffect(() => {
    let currentTray: HTMLElement | null = null;
    let currentLayout: HTMLElement | null = null;
    let trayObserver: MutationObserver | null = null;

    function cleanupCurrentTray() {
      trayObserver?.disconnect();
      trayObserver = null;
      if (currentTray) {
        currentTray.classList.remove(styles.floatingTray, styles.floatingTrayOpen);
        currentTray.removeAttribute("aria-hidden");
      }
      if (currentLayout) {
        currentLayout.classList.remove(styles.singleColumnLayout, styles.drawerLayout);
      }
      currentTray = null;
      currentLayout = null;
    }

    function updateCount() {
      setUnplacedCount(countUnplacedBlocks(currentTray));
    }

    function applyOpenState() {
      if (!currentTray || !currentLayout) return;

      currentTray.classList.add(styles.floatingTray);
      currentTray.classList.toggle(styles.floatingTrayOpen, unplacedOpen);
      currentTray.setAttribute("aria-hidden", unplacedOpen ? "false" : "true");

      currentLayout.classList.toggle(styles.singleColumnLayout, !unplacedOpen);
      currentLayout.classList.toggle(styles.drawerLayout, unplacedOpen);
    }

    function bindWorkspace() {
      const nextTray = document.querySelector(".unplaced-tray") as HTMLElement | null;
      const nextToolbar = document.querySelector(
        ".toolbar-card .toolbar-group"
      ) as HTMLElement | null;
      if (nextToolbar !== toolbarTarget) setToolbarTarget(nextToolbar);

      if (nextTray === currentTray) {
        applyOpenState();
        updateCount();
        return;
      }

      cleanupCurrentTray();
      currentTray = nextTray;
      currentLayout = nextTray?.closest(".schedule-layout") as HTMLElement | null;
      setHasUnplacedTray(Boolean(currentTray));

      if (!currentTray || !currentLayout) {
        setUnplacedCount(0);
        return;
      }

      applyOpenState();
      updateCount();

      trayObserver = new MutationObserver(updateCount);
      trayObserver.observe(currentTray, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }

    const bodyObserver = new MutationObserver(bindWorkspace);
    bodyObserver.observe(document.body, { childList: true, subtree: true });
    bindWorkspace();

    return () => {
      bodyObserver.disconnect();
      cleanupCurrentTray();
    };
  }, [unplacedOpen, toolbarTarget]);

  async function handleExport() {
    const context = readExportContext();
    if (!context) {
      window.alert("Choose a clinic and date before exporting the Daily Schedule.");
      return;
    }

    try {
      setExporting(true);
      await exportDailyScheduleXlsx(context);
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : "The Daily Schedule Excel workbook could not be created."
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      {toolbarTarget &&
        createPortal(
          <button
            type="button"
            className="button button-secondary"
            disabled={exporting}
            onClick={() => void handleExport()}
            title="Export this date as a real Excel workbook (.xlsx)"
          >
            {exporting ? "Exporting Excel..." : "Export Excel (.xlsx)"}
          </button>,
          toolbarTarget
        )}

      {hasUnplacedTray && (
        <button
          type="button"
          className={styles.unplacedLauncher}
          aria-expanded={unplacedOpen}
          aria-label={`${unplacedCount} unplaced assignment${unplacedCount === 1 ? "" : "s"}. ${unplacedOpen ? "Close" : "Open"} Unplaced Assignments.`}
          onClick={() => setUnplacedOpen((current) => !current)}
        >
          <span className={styles.launcherIcon} aria-hidden="true">!</span>
          <span>{unplacedOpen ? "Close Unplaced" : "Unplaced"}</span>
          <span
            className={`${styles.launcherBadge} ${unplacedCount === 0 ? styles.launcherBadgeEmpty : ""}`}
            aria-hidden="true"
          >
            {unplacedCount > 99 ? "99+" : unplacedCount}
          </span>
        </button>
      )}
    </>
  );
}
