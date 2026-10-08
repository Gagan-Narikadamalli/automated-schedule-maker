import { AppShell } from "@/components/AppShell";
import { SectionHeader } from "@/components/SectionHeader";
import { AttendanceManager } from "@/features/attendance/AttendanceManager";

export default function AttendancePage() {
  return <AppShell><div className="section-page">
    <SectionHeader eyebrow="DAILY OPERATIONS" title="Call Ins & Call Outs"
      description="Manage date-specific attendance for staff and clients without changing their recurring schedules." />
    <AttendanceManager />
  </div></AppShell>;
}
