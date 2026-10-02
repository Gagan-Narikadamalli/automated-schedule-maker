import { AppShell } from "@/components/AppShell";
import { SectionHeader } from "@/components/SectionHeader";
import { DataMaintenancePanel } from "@/features/settings/DataMaintenancePanel";
import { TrialDataPanel } from "@/features/settings/TrialDataPanel";

export default function DataMaintenancePage() {
  return (
    <AppShell>
      <div className="section-page">
        <SectionHeader
          eyebrow="CLINIC CONFIGURATION"
          title="Data Maintenance"
          description="Create a safe Livingston trial dataset for scheduler testing, or preview and manage date-scoped scheduling records while preserving the permanent clinic setup."
        />

        <TrialDataPanel />
        <DataMaintenancePanel />
      </div>
    </AppShell>
  );
}
