import { NextResponse } from "next/server";

import { createSessionCookie } from "@/lib/auth/session";

type LoginRequest = {
  usernameOrEmail?: string;
  password?: string;
};

function getTemporaryCredentials() {
  const username = process.env.TEMP_LOGIN_USERNAME;
  const password = process.env.TEMP_LOGIN_PASSWORD;

  if (!username || !password) {
    throw new Error(
      "Temporary login is not configured. Add TEMP_LOGIN_USERNAME and TEMP_LOGIN_PASSWORD in Vercel."
    );
  }

  return {
    username,
    password,
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as LoginRequest;
    const enteredUsername = body.usernameOrEmail?.trim() ?? "";
    const enteredPassword = body.password ?? "";

    if (!enteredUsername || !enteredPassword) {
      return NextResponse.json(
        { error: "Username and password are required." },
        { status: 400 }
      );
    }

    const temporaryCredentials = getTemporaryCredentials();

    if (
      enteredUsername !== temporaryCredentials.username ||
      enteredPassword !== temporaryCredentials.password
    ) {
      return NextResponse.json(
        { error: "Invalid temporary username or password." },
        { status: 401 }
      );
    }

    await createSessionCookie({
      userId: "temporary-test-admin",
      username: temporaryCredentials.username,
      email: "temporary@sos-scheduler.local",
      role: "ADMIN",
      locationIds: [],
    });

    return NextResponse.json({
      success: true,
      temporaryMode: true,
    });
  } catch (error) {
    console.error("Temporary login failed:", error);

    return NextResponse.json(
      { error: "Temporary sign-in could not be completed." },
      { status: 500 }
    );
  }
}
