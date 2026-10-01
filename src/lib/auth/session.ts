import { createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const SESSION_COOKIE_NAME = "sos_scheduler_session";
const SESSION_DURATION_SECONDS = 8 * 60 * 60;

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
  expiresAt: number;
};

function getAuthSecret(): string {
  const authSecret = process.env.AUTH_SECRET;

  if (!authSecret) {
    throw new Error(
      "AUTH_SECRET is not configured. Add a long random value to the Vercel environment variables."
    );
  }

  return authSecret;
}

function signPayload(encodedPayload: string): string {
  return createHmac("sha256", getAuthSecret())
    .update(encodedPayload)
    .digest("base64url");
}

function createSessionToken(payload: SessionPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signPayload(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

function parseSessionToken(token: string): SessionPayload | null {
  const [encodedPayload, providedSignature] = token.split(".");

  if (!encodedPayload || !providedSignature) {
    return null;
  }

  const expectedSignature = signPayload(encodedPayload);
  const providedBuffer = Buffer.from(providedSignature, "base64url");
  const expectedBuffer = Buffer.from(expectedSignature, "base64url");

  if (providedBuffer.length !== expectedBuffer.length) {
    return null;
  }

  if (!timingSafeEqual(providedBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf-8")
    ) as SessionPayload;

    if (!payload.expiresAt || payload.expiresAt <= Date.now()) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export async function createSessionCookie(
  user: Omit<SessionPayload, "expiresAt">
): Promise<void> {
  const expiresAt = Date.now() + SESSION_DURATION_SECONDS * 1000;
  const token = createSessionToken({
    ...user,
    expiresAt,
  });
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function getCurrentSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  return parseSessionToken(token);
}

export async function requirePageSession(): Promise<SessionPayload> {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  return session;
}
