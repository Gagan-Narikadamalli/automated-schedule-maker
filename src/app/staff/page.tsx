import { AppShell } from "@/components/AppShell";
import { SectionHeader } from "@/components/SectionHeader";
import { StaffManager } from "@/features/staff/StaffManager";

export default function StaffPage() {
  return (
    <AppShell>
      <div className="section-page">
        <SectionHeader
          eyebrow="STAFF MANAGEMENT"
          title="Staff"
          description="Manage staff details, teams, recurring availability, service setting, and weekly hour limits used by the automatic scheduler."
        />

        <StaffManager />
      </div>
    </AppShell>
  );
}
