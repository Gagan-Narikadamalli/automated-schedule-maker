import { AppShell } from "@/components/AppShell";
import { SectionHeader } from "@/components/SectionHeader";
import { ClientStaffAssignments } from "@/features/clients/ClientStaffAssignments";

export default function ClientStaffAssignmentsPage() {
  return (
    <AppShell>
      <div className="section-page">
        <SectionHeader
          eyebrow="SCHEDULING RELATIONSHIPS"
          title="Client–Staff Assignments"
          description="Manage shared therapist preferences for each client. A therapist can be preferred by multiple clients without creating exclusive team assignments."
        />
        <ClientStaffAssignments />
      </div>
    </AppShell>
  );
}
