import Link from "next/link";

import { AppShell } from "@/components/AppShell";
import { ScheduleWorkspaceV2 } from "@/features/scheduler/ScheduleWorkspaceV2";

import styles from "./page.module.css";

const workflowSteps = [
  {
    step: "01",
    title: "Check readiness",
    description: "Review staffing, client demand, breaks, and coverage risk.",
    href: "/schedule-preview",
    linkLabel: "Open preview",
  },
  {
    step: "02",
    title: "Auto build",
    description: "Generate the safe schedule and keep partial gaps visible.",
    href: "#daily-schedule-workspace",
    linkLabel: "Use scheduler",
  },
  {
    step: "03",
    title: "Fine tune",
    description: "Copy, paste, multi-select, drag, and use temporary scratch space.",
    href: "#daily-schedule-workspace",
    linkLabel: "Edit in grid",
  },
];

export default function HomePage() {
  return (
    <AppShell>
      <div className={styles.page}>
        <section className={styles.commandCenter}>
          <div className={styles.commandCopy}>
            <div className={styles.commandBadge}>SOS AUTOMATIC SCHEDULER</div>
            <h1>Build the schedule automatically. Keep Excel-style control.</h1>
            <p>
              The scheduler applies clinic rules, availability, client needs,
              breaks, call-outs, templates, and recent scheduling patterns first.
              Managers can then adjust the result directly in the spreadsheet grid.
            </p>
          </div>

          <div className={styles.commandActions}>
            <Link className={styles.primaryAction} href="/schedule-preview">
              Preview Auto Schedule
            </Link>
            <Link className={styles.secondaryAction} href="/settings">
              Scheduling Rules
            </Link>
          </div>
        </section>

        <section className={styles.workflowStrip} aria-label="Scheduling workflow">
          {workflowSteps.map((item) => (
            <article className={styles.workflowCard} key={item.step}>
              <span className={styles.workflowStep}>{item.step}</span>
              <div>
                <strong>{item.title}</strong>
                <p>{item.description}</p>
                <Link href={item.href}>{item.linkLabel} →</Link>
              </div>
            </article>
          ))}
        </section>

        <div id="daily-schedule-workspace" className={styles.scheduleWorkspace}>
          <ScheduleWorkspaceV2 />
        </div>
      </div>
    </AppShell>
  );
}
