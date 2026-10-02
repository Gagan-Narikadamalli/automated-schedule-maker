import { AppShell } from "@/components/AppShell";
import { SectionHeader } from "@/components/SectionHeader";
import { StaffCardManager } from "@/features/staff/StaffCardManager";

export default function StaffPage() {
  return (
    <AppShell>
      <div className="section-page">
        <SectionHeader
          eyebrow="STAFF MANAGEMENT"
          title="Staff"
          description="Manage staff details, teams, recurring availability, service setting, and weekly hour limits used by the automatic scheduler."
        />

        <StaffCardManager />
      </div>
    </AppShell>
  );
}
