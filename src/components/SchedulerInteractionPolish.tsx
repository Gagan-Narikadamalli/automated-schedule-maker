"use client";

import { useEffect } from "react";

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
  return Boolean(target.closest('.unplaced-tray [draggable="true"]'));
}

/**
 * Small DOM-level affordance layer for the scheduler workspace.
 *
 * Unplaced blocks still use the scheduler's existing drag/drop implementation,
 * but the temporary placement state is automatically cleaned up when the drag
 * ends. This prevents a canceled drag from leaving the grid in click-to-place
 * mode and restores Manual Mode to the manager's previous setting.
 */
export function SchedulerInteractionPolish() {
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
        // The existing scheduler internally enters placement state while an
        // external block is being dragged. Clear it immediately after the drag
        // finishes so placement remains drag-only from the manager's perspective.
        findCancelPlacementButton()?.click();

        // Dragging an Unplaced assignment temporarily enables Manual Mode in the
        // current scheduler implementation. If the manager had it off before the
        // drag, return it to Auto-safe after the drop/cancel completes.
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

  return null;
}
