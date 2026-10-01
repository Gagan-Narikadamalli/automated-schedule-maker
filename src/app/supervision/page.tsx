import { AppShell } from "@/components/AppShell";
import { SectionHeader } from "@/components/SectionHeader";
import { SupervisionDashboard } from "@/features/supervision/SupervisionDashboard";

export default function SupervisionPage() {
  return (
    <AppShell>
      <div className="section-page">
        <SectionHeader
          eyebrow="SUPERVISION PLANNING"
          title="Supervision Tracker"
          description="Plan supervision coverage alongside the schedule and identify BT/RBT supervision needs when BCBA availability is limited."
        />

        <SupervisionDashboard />
      </div>
    </AppShell>
  );
}
