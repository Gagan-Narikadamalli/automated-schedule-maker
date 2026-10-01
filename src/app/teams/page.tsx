import { AppShell } from "@/components/AppShell";
import { SectionHeader } from "@/components/SectionHeader";
import { TeamManager } from "@/features/teams/TeamManager";

export default function TeamsPage() {
  return (
    <AppShell>
      <div className="section-page">
        <SectionHeader
          eyebrow="TEAM MANAGEMENT"
          title="Teams"
          description="Group staff and clients together, share team colors, and give the automatic scheduler a preferred matching structure before it fills remaining coverage."
        />

        <TeamManager />
      </div>
    </AppShell>
  );
}
