import { AppShell } from "@/components/AppShell";
import { SectionHeader } from "@/components/SectionHeader";
import { DataMaintenancePanel } from "@/features/settings/DataMaintenancePanel";

export default function DataMaintenancePage() {
  return (
    <AppShell>
      <div className="section-page">
        <SectionHeader
          eyebrow="CLINIC CONFIGURATION"
          title="Data Maintenance"
          description="Preview and manage date-scoped scheduling records while preserving the clinic roster, teams, templates, locations, and scheduling rules."
        />

        <DataMaintenancePanel />
      </div>
    </AppShell>
  );
}
