import { AppShell } from "@/components/AppShell";
import { SectionHeader } from "@/components/SectionHeader";
import { ClientAttendanceManager } from "@/features/fixed-events/ClientAttendanceManager";
import { FixedEventsManager } from "@/features/fixed-events/FixedEventsManager";

export default function FixedEventsPage() {
  return (
    <AppShell>
      <div className="section-page">
        <SectionHeader
          eyebrow="FIXED CLIENT EVENTS"
          title="Speech, Nap & Attendance Changes"
          description="Manage color-coded Speech and Nap event cards plus client call-outs and call-ins. Nap windows describe allowed 30-minute START times, including their end time. A 2:00 PM nap start finishes at 2:30 PM if attendance permits; younger-child naps are prioritized before older-child naps."
        />

        <FixedEventsManager />
        <ClientAttendanceManager />
      </div>
    </AppShell>
  );
}
