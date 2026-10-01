import { AppShell } from "@/components/AppShell";
import { SectionHeader } from "@/components/SectionHeader";
import { TemplateManager } from "@/features/templates/TemplateManager";

export default function TemplatesPage() {
  return (
    <AppShell>
      <div className="section-page">
        <SectionHeader
          eyebrow="SCHEDULE TEMPLATES"
          title="Templates"
          description="Create reusable day templates or copy a previous date into a new date, then revalidate it against the current clinic constraints."
        />

        <TemplateManager />
      </div>
    </AppShell>
  );
}
