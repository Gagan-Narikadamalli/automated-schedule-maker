import { AppShell } from "@/components/AppShell";
import { SectionHeader } from "@/components/SectionHeader";
import { ActivityDashboard } from "@/features/activity/ActivityDashboard";

export default function ActivityPage() {
  return (
    <AppShell>
      <div className="section-page">
        <SectionHeader
          eyebrow="AUDIT HISTORY"
          title="Activity & Changes"
          description="Track who changed schedules, staff, clients, templates, rules, or call-outs and preserve a durable history for clinic accountability."
        />

        <ActivityDashboard />
      </div>
    </AppShell>
  );
}
