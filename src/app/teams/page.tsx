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
          description="Group staff and clients together, share team colors, and give the automatic scheduler a preferred matching structure before it fills remaining coverage."
        />

        <TeamCardManager />
      </div>
    </AppShell>
  );
}
