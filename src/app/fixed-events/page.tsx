import { AppShell } from "@/components/AppShell";
import { SectionHeader } from "@/components/SectionHeader";
import { FixedEventsManager } from "@/features/fixed-events/FixedEventsManager";

export default function FixedEventsPage() {
  return (
    <AppShell>
      <div className="section-page">
        <SectionHeader
          eyebrow="FIXED CLIENT EVENTS"
          title="Speech & Nap Events"
          description="Manage color-coded Speech and Nap event cards. Nap times are protected between 11:00 AM and 2:00 PM, with younger-child naps prioritized before older-child naps when the automatic scheduler places staff breaks."
        />

        <FixedEventsManager />
      </div>
    </AppShell>
  );
}
