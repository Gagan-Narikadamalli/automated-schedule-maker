import { AppShell } from "@/components/AppShell";
import { SectionHeader } from "@/components/SectionHeader";

const SUPERVISION_ROWS = [
  {
    staff: "RBT Demo A",
    serviceHours: 82,
    supervisionHours: 3.5,
    targetHours: 4.1,
    status: "Needs 0.6 h",
  },
  {
    staff: "BT Demo B",
    serviceHours: 64,
    supervisionHours: 3.4,
    targetHours: 3.2,
    status: "On target",
  },
];

export default function SupervisionPage() {
  return (
    <AppShell>
      <div className="section-page">
        <SectionHeader
          eyebrow="SUPERVISION PLANNING"
          title="Supervision Tracker"
          description="Plan supervision coverage alongside the schedule. This view is a planning estimate and is not the compliance record itself."
        />

        <section className="section-card">
          <div className="notice warning-notice">
            <strong>No BCBAs to provide supervision</strong>
            <p>
              If RBTs or BTs require supervision but no eligible BCBA is available,
              the scheduler should surface the gap instead of silently treating it as
              covered.
            </p>
          </div>
        </section>

        <section className="section-card">
          <h2>Monthly Planning Estimate</h2>
          <p className="helper-text">
            Clinic planning target: 5% for the selected month. Keep this target
            configurable in Clinic Settings. This scheduling estimate should not be
            presented as the official compliance record.
          </p>

          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Service hours</th>
                  <th>Supervision hours</th>
                  <th>5% planning target</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {SUPERVISION_ROWS.map((row) => (
                  <tr key={row.staff}>
                    <td>{row.staff}</td>
                    <td>{row.serviceHours.toFixed(1)} h</td>
                    <td>{row.supervisionHours.toFixed(1)} h</td>
                    <td>{row.targetHours.toFixed(1)} h</td>
                    <td>{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
