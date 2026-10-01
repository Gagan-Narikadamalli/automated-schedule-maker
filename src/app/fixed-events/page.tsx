import { AppShell } from "@/components/AppShell";
import { SectionHeader } from "@/components/SectionHeader";
import { FixedEventsManager } from "@/features/fixed-events/FixedEventsManager";

export default function FixedEventsPage() {
  return (
    <AppShell>
      <div className="section-page">
        <SectionHeader
          eyebrow="FIXED CLIENT EVENTS"
          title="Speech & Fixed Events"
          description="Manage one-time and recurring speech sessions that the automatic scheduler must honor before assigning normal client coverage."
        />

        <FixedEventsManager />
      </div>
    </AppShell>
  );
}
