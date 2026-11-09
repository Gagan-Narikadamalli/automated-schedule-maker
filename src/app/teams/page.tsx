import { AppShell } from "@/components/AppShell";
import { SectionHeader } from "@/components/SectionHeader";
import { TeamCardManager } from "@/features/teams/TeamCardManager";

export default function TeamsPage() {
  return (
    <AppShell>
      <div className="section-page">
        <SectionHeader
          eyebrow="TEAM MANAGEMENT"
          title="Teams"
          description="Create optional operational groups. Use Client–Staff Assignments to manage shared therapist preferences independently for each client."
        />

        <TeamCardManager />
      </div>
    </AppShell>
  );
}
