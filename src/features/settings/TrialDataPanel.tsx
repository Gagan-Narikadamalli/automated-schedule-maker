"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import styles from "./TrialDataPanel.module.css";

type TrialStatus = {
  installed: boolean;
  locationId: string;
  locationName: string;
  datasetKey: string;
  dates: {
    monday: string;
    tuesday: string;
    wednesday: string;
    copyDay: string;
  };
  counts: {
    staff: number;
    clients: number;
    teams: number;
    speechSessions: number;
    templates: number;
    callOuts: number;
  } | null;
  generatedDates: string[];
};

type TrialApiResponse = {
  success?: boolean;
  status?: TrialStatus;
  result?: {
    dates?: TrialStatus["dates"];
    created?: TrialStatus["counts"];
    generations?: Record<
      string,
      {
        completeCoverage?: boolean;
        partialBuild?: boolean;
        metrics?: {
          requiredClientSlots?: number;
          coveredClientSlots?: number;
          uncoveredClientSlots?: number;
          coveragePercent?: number;
        };
      }
    >;
    repair?: {
      removedAssignmentCount?: number;
      addedAssignmentCount?: number;
      managerGapCount?: number;
    };
    copyDay?: {
      copiedCount?: number;
      warnings?: string[];
    };
  };
  error?: string;
};

const DEFAULT_DATES = {
  monday: "2026-10-05",
  tuesday: "2026-10-06",
  wednesday: "2026-10-07",
  copyDay: "2026-10-08",
};

export function TrialDataPanel() {
  const [status, setStatus] = useState<TrialStatus | null>(null);
  const [lastRun, setLastRun] = useState<TrialApiResponse["result"]>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState(
    "Loading the Livingston trial-data status..."
  );

  useEffect(() => {
    void loadStatus();
  }, []);

  async function loadStatus() {
    try {
      setLoading(true);

      const response = await fetch("/api/trial-data/livingston", {
        cache: "no-store",
      });
      const data = (await response.json()) as TrialApiResponse;

      if (!response.ok || !data.status) {
        throw new Error(data.error || "Trial-data status could not be loaded.");
      }

      setStatus(data.status);
      setMessage(
        data.status.installed
          ? "The Livingston trial dataset is installed and ready for hands-on testing."
          : "The Livingston trial dataset is not installed yet."
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Trial-data status could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }

  async function runAction(action: "seed-and-run" | "reset") {
    if (
      action === "reset" &&
      !window.confirm(
        "Remove the tracked Livingston trial roster, clients, teams, trial schedules, speech sessions, call-out, and trial template?"
      )
    ) {
      return;
    }

    try {
      setWorking(true);
      setLastRun(null);
      setMessage(
        action === "seed-and-run"
          ? "Creating the workbook-inspired roster and clients, previewing the schedule, generating three days, testing Repair Schedule, and testing Copy Day..."
          : "Removing only the tracked Livingston trial dataset..."
      );

      const response = await fetch("/api/trial-data/livingston", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action }),
      });
      const data = (await response.json()) as TrialApiResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.error || "The trial-data action failed.");
      }

      if (action === "seed-and-run") {
        setLastRun(data.result ?? null);
        setMessage(
          "Trial run completed. Open Calendar, Auto Schedule Preview, Staff, Clients, Templates, and Speech & Fixed Events to test the populated Livingston example."
        );
      } else {
        setMessage("The tracked Livingston trial dataset was removed.");
      }

      await loadStatus();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The trial-data action failed."
      );
    } finally {
      setWorking(false);
    }
  }

  const dates = status?.dates ?? DEFAULT_DATES;
  const counts = status?.counts;
  const generationEntries = Object.entries(lastRun?.generations ?? {});

  return (
    <section className={`section-card ${styles.labCard}`}>
      <div className="panel-heading-row">
        <div>
          <p className="page-eyebrow">SAFE TEST WORKSPACE</p>
          <h2>Livingston Trial Data Lab</h2>
          <p>
            Load a workbook-inspired sample roster and client set based on the
            recent Livingston schedule examples. The dataset is tracked so it can
            be removed without touching unrelated clinic records.
          </p>
        </div>

        <span
          className={`${styles.statusPill} ${
            status?.installed ? styles.statusInstalled : ""
          }`}
        >
          {loading
            ? "Checking..."
            : status?.installed
              ? "Trial data installed"
              : "Not installed"}
        </span>
      </div>

      <div className={styles.scenarioGrid}>
        <article>
          <strong>Monday · {dates.monday}</strong>
          <span>Balanced automatic build with staggered breaks and naps.</span>
        </article>
        <article>
          <strong>Tuesday · {dates.tuesday}</strong>
          <span>
            Automatic build followed by a Keila partial-day call-out and targeted
            Repair Schedule test.
          </span>
        </article>
        <article>
          <strong>Wednesday · {dates.wednesday}</strong>
          <span>
            Shorter staff availability, rotation/high-support clients, nap, and
            speech testing.
          </span>
        </article>
        <article>
          <strong>Thursday · {dates.copyDay}</strong>
          <span>Copy Day test created from Monday and revalidated for Thursday.</span>
        </article>
      </div>

      <div className={styles.sampleNotes}>
        <strong>Workbook-inspired sample</strong>
        <span>
          Staff names include Areyana, Anias, Ariana, Danna, Devonyah, Juwell,
          Keila, Lamya, Jalani, Marisol, Siobhan, Bella (wil), Latoya, and
          Stephanie. Client codes include MiSm, CaGr, ZiBo, MaHa, IsMo, JeMa,
          CaMe, ReMa, AmAb, StAb, EyNa, and JiMa.
        </span>
      </div>

      {counts ? (
        <div className={styles.countGrid}>
          <div><span>Staff</span><strong>{counts.staff}</strong></div>
          <div><span>Clients</span><strong>{counts.clients}</strong></div>
          <div><span>Teams</span><strong>{counts.teams}</strong></div>
          <div><span>Speech blocks</span><strong>{counts.speechSessions}</strong></div>
          <div><span>Call-outs</span><strong>{counts.callOuts}</strong></div>
          <div><span>Templates</span><strong>{counts.templates}</strong></div>
        </div>
      ) : null}

      <div className={styles.actionRow}>
        <button
          type="button"
          className="button button-primary"
          disabled={loading || working}
          onClick={() => void runAction("seed-and-run")}
        >
          {working ? "Running Trial..." : "Create / Rebuild and Run Trial"}
        </button>

        <button
          type="button"
          className="button button-secondary"
          disabled={loading || working || !status?.installed}
          onClick={() => void runAction("reset")}
        >
          Remove Trial Data
        </button>
      </div>

      <div className={styles.testLinks}>
        <Link href="/">Calendar</Link>
        <Link href="/schedule-preview">Auto Schedule Preview</Link>
        <Link href="/staff">Staff</Link>
        <Link href="/clients">Clients</Link>
        <Link href="/templates">Templates</Link>
        <Link href="/fixed-events">Speech & Fixed Events</Link>
      </div>

      {generationEntries.length > 0 ? (
        <div className={styles.resultPanel}>
          <strong>Last automatic run</strong>
          {generationEntries.map(([date, result]) => (
            <span key={date}>
              {date}: {result.metrics?.coveredClientSlots ?? 0}/
              {result.metrics?.requiredClientSlots ?? 0} client blocks covered
              {result.completeCoverage ? " · complete" : " · partial"}
            </span>
          ))}
          <span>
            Repair: removed {lastRun?.repair?.removedAssignmentCount ?? 0}, added{" "}
            {lastRun?.repair?.addedAssignmentCount ?? 0}, manager gaps{" "}
            {lastRun?.repair?.managerGapCount ?? 0}
          </span>
          <span>
            Copy Day: {lastRun?.copyDay?.copiedCount ?? 0} blocks copied with{" "}
            {lastRun?.copyDay?.warnings?.length ?? 0} warning(s)
          </span>
        </div>
      ) : null}

      <div className="inline-message" aria-live="polite">
        {message}
      </div>
    </section>
  );
}
