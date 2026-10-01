import { NextResponse } from "next/server";

import {
  getCurrentSession,
  type SessionPayload,
  type SessionRole,
} from "@/lib/auth/session";

export type ApiAuthResult =
  | {
      session: SessionPayload;
      error: null;
    }
  | {
      session: null;
      error: NextResponse;
    };

export async function requireApiSession(): Promise<ApiAuthResult> {
  const session = await getCurrentSession();

  if (!session) {
    return {
      session: null,
      error: NextResponse.json(
        { error: "Authentication is required." },
        { status: 401 }
      ),
    };
  }

  return {
    session,
    error: null,
  };
}

export function sessionCanAccessLocation(
  session: SessionPayload,
  locationId: string
): boolean {
  if (session.role === "ADMIN") {
    return true;
  }

  return session.locationIds.includes(locationId);
}

export function sessionHasAnyRole(
  session: SessionPayload,
  allowedRoles: SessionRole[]
): boolean {
  return allowedRoles.includes(session.role);
}

export function forbiddenResponse(
  message = "You do not have permission to perform this action."
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
