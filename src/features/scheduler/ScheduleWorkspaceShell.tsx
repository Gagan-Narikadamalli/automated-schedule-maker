"use client";

import { useState } from "react";

import { ScheduleAssistant } from "@/components/ScheduleAssistant";

import { ScheduleWorkspaceV3 } from "./ScheduleWorkspaceV3";

export function ScheduleWorkspaceShell() {
  const [scheduleRefreshKey, setScheduleRefreshKey] = useState(0);

  return (
    <>
      <ScheduleWorkspaceV3 key={scheduleRefreshKey} />
      <ScheduleAssistant
        onScheduleChanged={() => setScheduleRefreshKey((current) => current + 1)}
      />
    </>
  );
}
