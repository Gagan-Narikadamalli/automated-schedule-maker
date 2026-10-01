import { AppShell } from "@/components/AppShell";
import { ScheduleWorkspaceV2 } from "@/features/scheduler/ScheduleWorkspaceV2";

export default function HomePage() {
  return (
    <AppShell>
      <ScheduleWorkspaceV2 />
    </AppShell>
  );
}
