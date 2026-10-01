import { AppShell } from "@/components/AppShell";
import { ScheduleWorkspaceV2 } from "@/features/scheduler/ScheduleWorkspaceV2";

import styles from "./page.module.css";

export default function HomePage() {
  return (
    <AppShell>
      <div className={styles.page}>
        <ScheduleWorkspaceV2 />
      </div>
    </AppShell>
  );
}
