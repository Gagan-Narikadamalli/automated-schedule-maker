import { AppShell } from "@/components/AppShell";
import { SectionHeader } from "@/components/SectionHeader";
import { SchedulePreviewPanel } from "@/features/scheduler/SchedulePreviewPanel";

export default function SchedulePreviewPage() {
  return (
    <AppShell>
      <div className="section-page">
        <SectionHeader
          eyebrow="AUTOMATIC SCHEDULER"
          title="Schedule Preview"
          description="Simulate the automatic schedule before changing the saved calendar. Review staffing capacity, breaks, coverage gaps, role usage, templates, and learned Livingston patterns first."
        />

        <SchedulePreviewPanel />
      </div>
    </AppShell>
  );
}
