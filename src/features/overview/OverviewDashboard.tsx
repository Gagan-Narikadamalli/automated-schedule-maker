"use client";

const DAILY_METRICS = [
  {
    day: "Monday",
    clientHoursNeeded: 126,
    clientHoursCovered: 123.5,
    staffHoursScheduled: 132,
    additionalLaborHours: 2.5,
    staffPresent: 18,
    staffAbsent: 1,
    uncoveredHours: 2.5,
  },
  {
    day: "Tuesday",
    clientHoursNeeded: 128,
    clientHoursCovered: 128,
    staffHoursScheduled: 134,
    additionalLaborHours: 0,
    staffPresent: 19,
    staffAbsent: 0,
    uncoveredHours: 0,
  },
  {
    day: "Wednesday",
    clientHoursNeeded: 124,
    clientHoursCovered: 121,
    staffHoursScheduled: 129,
    additionalLaborHours: 3,
    staffPresent: 17,
    staffAbsent: 2,
    uncoveredHours: 3,
  },
  {
    day: "Thursday",
    clientHoursNeeded: 130,
    clientHoursCovered: 128.5,
    staffHoursScheduled: 135,
    additionalLaborHours: 1.5,
    staffPresent: 19,
    staffAbsent: 0,
    uncoveredHours: 1.5,
  },
  {
    day: "Friday",
    clientHoursNeeded: 120,
    clientHoursCovered: 120,
    staffHoursScheduled: 126,
    additionalLaborHours: 0,
    staffPresent: 18,
    staffAbsent: 1,
    uncoveredHours: 0,
  },
];

function downloadCsv() {
  const header = [
    "Day",
    "Client Hours Needed",
    "Client Hours Covered",
    "Staff Hours Scheduled",
    "Additional Labor Hours",
    "Staff Present",
    "Staff Absent",
    "Uncovered Hours",
  ];

  const rows = DAILY_METRICS.map((metric) => [
    metric.day,
    metric.clientHoursNeeded,
    metric.clientHoursCovered,
    metric.staffHoursScheduled,
    metric.additionalLaborHours,
    metric.staffPresent,
    metric.staffAbsent,
    metric.uncoveredHours,
  ]);

  const csv = [header, ...rows]
    .map((row) => row.map((value) => `"${value}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = downloadUrl;
  link.download = "sos-weekly-scheduling-overview.csv";
  link.click();

  URL.revokeObjectURL(downloadUrl);
}

export function OverviewDashboard() {
  const totalClientHoursNeeded = DAILY_METRICS.reduce(
    (sum, metric) => sum + metric.clientHoursNeeded,
    0
  );
  const totalClientHoursCovered = DAILY_METRICS.reduce(
    (sum, metric) => sum + metric.clientHoursCovered,
    0
  );
  const totalStaffHours = DAILY_METRICS.reduce(
    (sum, metric) => sum + metric.staffHoursScheduled,
    0
  );
  const totalAdditionalLabor = DAILY_METRICS.reduce(
    (sum, metric) => sum + metric.additionalLaborHours,
    0
  );
  const coveragePercent =
    totalClientHoursNeeded === 0
      ? 0
      : (totalClientHoursCovered / totalClientHoursNeeded) * 100;

  return (
    <div className="management-layout">
      <section className="metric-grid">
        <article className="metric-card">
          <span>Client hours needed</span>
          <strong>{totalClientHoursNeeded.toFixed(1)}</strong>
        </article>
        <article className="metric-card">
          <span>Client hours covered</span>
          <strong>{totalClientHoursCovered.toFixed(1)}</strong>
        </article>
        <article className="metric-card">
          <span>Staff hours scheduled</span>
          <strong>{totalStaffHours.toFixed(1)}</strong>
        </article>
        <article className="metric-card">
          <span>Additional labor needed</span>
          <strong>{totalAdditionalLabor.toFixed(1)}</strong>
        </article>
        <article className="metric-card">
          <span>Scheduling coverage</span>
          <strong>{coveragePercent.toFixed(1)}%</strong>
        </article>
      </section>

      <section className="section-card">
        <div className="panel-heading-row">
          <div>
            <h2>Weekly Scheduling Overview</h2>
            <p>
              This view will be calculated from the published schedule, staff
              commitments, client attendance, absences, and uncovered assignments.
            </p>
          </div>

          <div className="toolbar-group">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => window.print()}
            >
              Print / Save PDF
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={downloadCsv}
            >
              Export Excel/CSV
            </button>
          </div>
        </div>

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Client needed</th>
                <th>Client covered</th>
                <th>Staff scheduled</th>
                <th>Additional labor</th>
                <th>Staff present</th>
                <th>Staff absent</th>
                <th>Uncovered</th>
              </tr>
            </thead>
            <tbody>
              {DAILY_METRICS.map((metric) => (
                <tr key={metric.day}>
                  <td>{metric.day}</td>
                  <td>{metric.clientHoursNeeded.toFixed(1)} h</td>
                  <td>{metric.clientHoursCovered.toFixed(1)} h</td>
                  <td>{metric.staffHoursScheduled.toFixed(1)} h</td>
                  <td>{metric.additionalLaborHours.toFixed(1)} h</td>
                  <td>{metric.staffPresent}</td>
                  <td>{metric.staffAbsent}</td>
                  <td>{metric.uncoveredHours.toFixed(1)} h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section-card">
        <h2>Additional Labor Breakdown</h2>
        <p className="helper-text">
          When the final scheduler cannot cover all client blocks inside normal
          employee availability and hour limits, this section will identify the
          exact day/time gaps and eligible employees who could cover overtime.
        </p>
        <div className="notice warning-notice">
          Example: Wednesday has 3.0 uncovered client hours. The final version will
          list eligible staff or mark the blocks as waiting for manager coverage.
        </div>
      </section>
    </div>
  );
}
