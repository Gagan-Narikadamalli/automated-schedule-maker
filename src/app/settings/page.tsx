import { AppShell } from "@/components/AppShell";
import { SectionHeader } from "@/components/SectionHeader";
import { HistoricalTrainingSettings } from "@/features/settings/HistoricalTrainingSettings";
import { SchedulingSettings } from "@/features/settings/SchedulingSettings";

export default function SettingsPage() {
  return (
    <AppShell>
      <div className="section-page">
        <SectionHeader
          eyebrow="CLINIC CONFIGURATION"
          title="Clinic Settings"
          description="Configure location-specific schedule hours, staff commitments, breaks, client rotation limits, staff capacity, automatic scheduling priorities, and historical pattern learning."
        />

        <SchedulingSettings />
        <HistoricalTrainingSettings />
      </div>
    </AppShell>
  );
}
