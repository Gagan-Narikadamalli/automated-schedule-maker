"use client";

import { useEffect, useRef, useState } from "react";

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
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const [preferences, setPreferences] = useState<WorkspacePreferences>(
    DEFAULT_PREFERENCES
  );
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [searchMatchCount, setSearchMatchCount] = useState(0);

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

  function clearSearchHighlights() {
    const workspace = workspaceRef.current;

    if (!workspace) {
      return;
    }

    workspace
      .querySelectorAll(`.${styles.searchMatch}`)
      .forEach((element) => element.classList.remove(styles.searchMatch));

    setSearchMatchCount(0);
  }

  function clearSearch() {
    setSearchText("");
    clearSearchHighlights();
  }

  function findInSchedule() {
    const workspace = workspaceRef.current;
    const normalizedSearch = searchText.trim().toLowerCase();

    clearSearchHighlights();

    if (!workspace || !normalizedSearch) {
      return;
    }

    const candidates = Array.from(
      workspace.querySelectorAll<HTMLElement>(
        ".schedule-grid thead th, .schedule-grid tbody td"
      )
    );

    const matches = candidates.filter((element) => {
      const cellText = element.textContent?.trim().toLowerCase() ?? "";
      return cellText.length > 0 && cellText.includes(normalizedSearch);
    });

    matches.forEach((element) => element.classList.add(styles.searchMatch));
    setSearchMatchCount(matches.length);

    matches[0]?.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "center",
    });
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
    <div ref={workspaceRef} className={workspaceClassName}>
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

      <section className={styles.findBar} aria-label="Find in schedule">
        <div className={styles.findLabel}>
          <span className={styles.displayEyebrow}>FIND IN GRID</span>
          <strong>Jump to a staff member or client code</strong>
        </div>

        <div className={styles.findControls}>
          <input
            type="search"
            value={searchText}
            placeholder="Example: Areyana or CaGr"
            aria-label="Find staff member or client code in schedule"
            onChange={(event) => {
              setSearchText(event.target.value);

              if (!event.target.value.trim()) {
                clearSearchHighlights();
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                findInSchedule();
              }
            }}
          />

          <button
            type="button"
            className={styles.findButton}
            disabled={!searchText.trim()}
            onClick={findInSchedule}
          >
            Find
          </button>

          <button
            type="button"
            className={styles.clearButton}
            disabled={!searchText && searchMatchCount === 0}
            onClick={clearSearch}
          >
            Clear
          </button>

          <span className={styles.matchCount} aria-live="polite">
            {searchMatchCount > 0
              ? `${searchMatchCount} match${searchMatchCount === 1 ? "" : "es"}`
              : "No highlighted matches"}
          </span>
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
