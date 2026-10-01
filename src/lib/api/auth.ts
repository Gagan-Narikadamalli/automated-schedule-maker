import { NextResponse } from "next/server";

export type SessionRole =
  | "ADMIN"
  | "CLINIC_MANAGER"
  | "SCHEDULER"
  | "BCBA"
  | "READ_ONLY";

export type OpenAccessSession = {
  userId: string;
  username: string;
  email: string;
  role: SessionRole;
  locationIds: string[];
};

export type ApiAuthResult = {
  session: OpenAccessSession;
  error: null;
};

const OPEN_ACCESS_SESSION: OpenAccessSession = {
  userId: "schedule-builder",
  username: "Schedule Builder",
  email: "",
  role: "ADMIN",
  locationIds: [],
};

/**
 * Authentication is intentionally disabled while the scheduling product is
 * being built and tested. API routes still receive a stable actor identity so
 * audit records can be written without changing every scheduling endpoint.
 */
export async function requireApiSession(): Promise<ApiAuthResult> {
  return {
    session: OPEN_ACCESS_SESSION,
    error: null,
  };
}

/**
 * Open builder mode allows access to every configured clinic location.
 */
export function sessionCanAccessLocation(
  _session: OpenAccessSession,
  _locationId: string
): boolean {
  return true;
}

/**
 * Role restrictions are disabled together with authentication for now.
 */
export function sessionHasAnyRole(
  _session: OpenAccessSession,
  _allowedRoles: SessionRole[]
): boolean {
  return true;
}

export function forbiddenResponse(
  message = "This action is not available."
): NextResponse {
  return NextResponse.json(
    { error: message },
    { status: 403 }
  );
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
