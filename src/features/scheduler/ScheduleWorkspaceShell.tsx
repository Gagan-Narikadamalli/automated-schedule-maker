"use client";

import { ScheduleAssistant } from "@/components/ScheduleAssistant";

import { ScheduleWorkspaceV3 } from "./ScheduleWorkspaceV3";

export function ScheduleWorkspaceShell() {
  return (
    <>
      <ScheduleWorkspaceV3 />
      <ScheduleAssistant />
    </>
  );
}
