import { AppShell } from "@/components/AppShell";
import { SectionHeader } from "@/components/SectionHeader";
import { ClientManager } from "@/features/clients/ClientManager";
import { ClientRotationManager } from "@/features/clients/ClientRotationManager";

export default function ClientsPage() {
  return (
    <AppShell>
      <div className="section-page">
        <SectionHeader
          eyebrow="CLIENT MANAGEMENT"
          title="Clients"
          description="Manage client attendance, staffing support, rotation rules, team assignments, BCBA and intern relationships, colors, and staff preferences or hard restrictions."
        />

        <ClientManager />
        <ClientRotationManager />
      </div>
    </AppShell>
  );
}
