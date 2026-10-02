import { AppShell } from "@/components/AppShell";
import { ScheduleWorkspaceShell } from "@/features/scheduler/ScheduleWorkspaceShell";

import styles from "./page.module.css";

export default function HomePage() {
  return (
    <AppShell>
      <div className={styles.page}>
        <div className={styles.scheduleWorkspace}>
          <ScheduleWorkspaceShell />
        </div>
      </div>
    </AppShell>
  );
}
