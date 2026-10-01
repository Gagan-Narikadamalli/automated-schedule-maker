import { AppShell } from "@/components/AppShell";
import { ScheduleWorkspace } from "@/features/scheduler/ScheduleWorkspace";

export default function HomePage() {
  return (
    <AppShell>
      <ScheduleWorkspace />
    </AppShell>
  );
}
