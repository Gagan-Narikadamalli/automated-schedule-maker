import { AppShell } from "@/components/AppShell";
import { SectionHeader } from "@/components/SectionHeader";
import { OverviewDashboard } from "@/features/overview/OverviewDashboard";

export default function OverviewPage() {
  return (
    <AppShell>
      <div className="section-page">
        <SectionHeader
          eyebrow="WEEKLY OPERATIONS"
          title="Weekly Overview"
          description="Compare required client coverage with staff hours, attendance, absences, uncovered time, labor needs, and overall scheduling efficiency."
        />

        <OverviewDashboard />
      </div>
    </AppShell>
  );
}
