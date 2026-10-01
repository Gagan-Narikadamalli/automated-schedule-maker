import { AppShell } from "@/components/AppShell";
import { SectionHeader } from "@/components/SectionHeader";

const ACTIVITY = [
  {
    time: "8:42 AM",
    user: "Manager",
    action: "Manual schedule change",
    details: "Danielle 10:00-10:30 changed from CaGr to EyNa.",
  },
  {
    time: "8:37 AM",
    user: "Scheduler",
    action: "Schedule generated",
    details: "Livingston schedule generated for the selected week.",
  },
  {
    time: "8:31 AM",
    user: "Manager",
    action: "Call-out recorded",
    details: "Ariana marked unavailable for the selected date.",
  },
];

export default function ActivityPage() {
  return (
    <AppShell>
      <div className="section-page">
        <SectionHeader
          eyebrow="AUDIT HISTORY"
          title="Activity & Changes"
          description="Track who changed schedules, staff, clients, templates, rules, or call-outs and preserve before/after information for accountability."
        />

        <section className="section-card">
          <h2>Recent Activity</h2>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {ACTIVITY.map((entry) => (
                  <tr key={`${entry.time}-${entry.action}`}>
                    <td>{entry.time}</td>
                    <td>{entry.user}</td>
                    <td>{entry.action}</td>
                    <td>{entry.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="helper-text">
            These rows are demonstration data. The AuditLog MongoDB model is now in
            the project so later API mutations can record the real user, entity,
            before state, and after state for every important change.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
