"use client";

import { useEffect, useState } from "react";

import { ScheduleWorkspaceV2 } from "./ScheduleWorkspaceV2";
import styles from "./ScheduleWorkspaceShell.module.css";

type WorkspacePreferences = {
  compactRows: boolean;
  showManagerTray: boolean;
  showShortcuts: boolean;
};

const STORAGE_KEY = "sos-schedule-workspace-preferences";

const DEFAULT_PREFERENCES: WorkspacePreferences = {
  compactRows: false,
  showManagerTray: true,
  showShortcuts: true,
};

const legendItems = [
  {
    label: "Client 1:1",
    className: styles.legendClient,
  },
  {
    label: "Break",
    className: styles.legendBreak,
  },
  {
    label: "Nap / Break + Nap",
    className: styles.legendNap,
  },
  {
    label: "Speech / Break + Speech",
    className: styles.legendSpeech,
  },
  {
    label: "Unavailable",
    className: styles.legendUnavailable,
  },
  {
    label: "Scratch space",
    className: styles.legendScratch,
  },
];

function readSavedPreferences(): WorkspacePreferences {
  if (typeof window === "undefined") {
    return DEFAULT_PREFERENCES;
  }

  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY);

    if (!rawValue) {
      return DEFAULT_PREFERENCES;
    }

    const parsed = JSON.parse(rawValue) as Partial<WorkspacePreferences>;

    return {
      compactRows:
        typeof parsed.compactRows === "boolean"
          ? parsed.compactRows
          : DEFAULT_PREFERENCES.compactRows,
      showManagerTray:
        typeof parsed.showManagerTray === "boolean"
          ? parsed.showManagerTray
          : DEFAULT_PREFERENCES.showManagerTray,
      showShortcuts:
        typeof parsed.showShortcuts === "boolean"
          ? parsed.showShortcuts
          : DEFAULT_PREFERENCES.showShortcuts,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function ScheduleWorkspaceShell() {
  const [preferences, setPreferences] = useState<WorkspacePreferences>(
    DEFAULT_PREFERENCES
  );
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);

  useEffect(() => {
    setPreferences(readSavedPreferences());
    setPreferencesLoaded(true);
  }, []);

  useEffect(() => {
    if (!preferencesLoaded) {
      return;
    }

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(preferences)
    );
  }, [preferences, preferencesLoaded]);

  function updatePreference(
    key: keyof WorkspacePreferences,
    value: boolean
  ) {
    setPreferences((currentPreferences) => ({
      ...currentPreferences,
      [key]: value,
    }));
  }

  const workspaceClassName = [
    styles.workspace,
    preferences.compactRows ? styles.compactRows : "",
    preferences.showManagerTray ? "" : styles.hideManagerTray,
    preferences.showShortcuts ? "" : styles.hideShortcuts,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={workspaceClassName}>
      <section className={styles.displayBar} aria-label="Schedule display options">
        <div className={styles.displayHeading}>
          <div>
            <span className={styles.displayEyebrow}>WORKSPACE VIEW</span>
            <strong>Keep the spreadsheet clear while you work</strong>
          </div>

          <span className={styles.savedHint}>
            View choices are remembered on this device
          </span>
        </div>

        <div className={styles.displayActions}>
          <button
            type="button"
            className={`${styles.viewButton} ${
              preferences.showShortcuts ? styles.viewButtonActive : ""
            }`}
            aria-pressed={preferences.showShortcuts}
            onClick={() =>
              updatePreference(
                "showShortcuts",
                !preferences.showShortcuts
              )
            }
          >
            Shortcuts
          </button>

          <button
            type="button"
            className={`${styles.viewButton} ${
              preferences.showManagerTray ? styles.viewButtonActive : ""
            }`}
            aria-pressed={preferences.showManagerTray}
            onClick={() =>
              updatePreference(
                "showManagerTray",
                !preferences.showManagerTray
              )
            }
          >
            Manager Tray
          </button>

          <button
            type="button"
            className={`${styles.viewButton} ${
              preferences.compactRows ? styles.viewButtonActive : ""
            }`}
            aria-pressed={preferences.compactRows}
            onClick={() =>
              updatePreference(
                "compactRows",
                !preferences.compactRows
              )
            }
          >
            Compact Rows
          </button>
        </div>
      </section>

      <details className={styles.legendPanel}>
        <summary>
          <span>Schedule key</span>
          <small>
            Colors and workspace areas used in the Excel-style calendar
          </small>
        </summary>

        <div className={styles.legendGrid}>
          {legendItems.map((item) => (
            <div className={styles.legendItem} key={item.label}>
              <span
                className={`${styles.legendSwatch} ${item.className}`}
                aria-hidden="true"
              />
              <span>{item.label}</span>
            </div>
          ))}

          <div className={styles.legendNote}>
            <strong>Auto-safe mode</strong>
            <span>
              Existing assignments stay protected. Turn on Manual Mode only when
              you intentionally need to replace or move occupied cells.
            </span>
          </div>
        </div>
      </details>

      <ScheduleWorkspaceV2 />
    </div>
  );
}
