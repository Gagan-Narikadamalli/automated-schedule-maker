import { AppShell } from "@/components/AppShell";
import { SectionHeader } from "@/components/SectionHeader";
import { OverviewDashboard } from "@/features/overview/OverviewDashboard";

export default function OverviewPage() {
  return (
    <AppShell>
      <div className="section-page">
        <SectionHeader
          eyebrow="CLINIC OPERATIONS"
          title="Schedule Overview"
          description="Switch between daily and weekly views to review client coverage, staff availability, absences, uncovered time, and labor needs."
        />

        <OverviewDashboard />
      </div>
    </AppShell>
  );
}
