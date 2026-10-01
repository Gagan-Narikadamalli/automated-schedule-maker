import { NextResponse } from "next/server";

export type SessionRole =
  | "ADMIN"
  | "CLINIC_MANAGER"
  | "SCHEDULER"
  | "BCBA"
  | "READ_ONLY";

export type SessionPayload = {
  userId: string;
  username: string;
  email: string;
  role: SessionRole;
  locationIds: string[];
};

export type ApiAuthResult = {
  session: SessionPayload;
  error: null;
};

const schedulerSession: SessionPayload = {
  userId: "scheduler-system",
  username: "Scheduler",
  email: "",
  role: "ADMIN",
  locationIds: [],
};

export async function requireApiSession(): Promise<ApiAuthResult> {
  return {
    session: schedulerSession,
    error: null,
  };
}

export function sessionCanAccessLocation(
  _session: SessionPayload,
  _locationId: string
): boolean {
  return true;
}

export function sessionHasAnyRole(
  _session: SessionPayload,
  _allowedRoles: SessionRole[]
): boolean {
  return true;
}

export function forbiddenResponse(
  message = "This operation is unavailable."
): NextResponse {
  return NextResponse.json({ error: message }, { status: 403 });
}

export const SCHEDULE_WRITE_ROLES: SessionRole[] = [
  "ADMIN",
  "CLINIC_MANAGER",
  "SCHEDULER",
];

export const PEOPLE_WRITE_ROLES: SessionRole[] = [
  "ADMIN",
  "CLINIC_MANAGER",
  "SCHEDULER",
];

export const SETTINGS_WRITE_ROLES: SessionRole[] = [
  "ADMIN",
  "CLINIC_MANAGER",
];
