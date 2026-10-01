import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { hashPassword } from "@/lib/auth/passwords";
import { connectToDatabase } from "@/lib/db";
import { ensureDefaultLocations } from "@/lib/locations";
import { User } from "@/models/User";

type SetupRequest = {
  setupKey?: string;
  username?: string;
  email?: string;
  password?: string;
};

function setupKeyMatches(providedKey: string, expectedKey: string): boolean {
  const providedBuffer = Buffer.from(providedKey);
  const expectedBuffer = Buffer.from(expectedKey);

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

function isMongoConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === "MongooseServerSelectionError" ||
    error.message.includes("Could not connect to any servers") ||
    error.message.includes("ReplicaSetNoPrimary")
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SetupRequest;
    const expectedSetupKey = process.env.SETUP_KEY;

    if (!expectedSetupKey) {
      return NextResponse.json(
        { error: "SETUP_KEY is not configured on the server." },
        { status: 500 }
      );
    }

    if (!body.setupKey || !setupKeyMatches(body.setupKey, expectedSetupKey)) {
      return NextResponse.json(
        { error: "Invalid setup key." },
        { status: 403 }
      );
    }

    const username = body.username?.trim();
    const email = body.email?.trim().toLowerCase();
    const password = body.password ?? "";

    if (!username || !email || !password) {
      return NextResponse.json(
        { error: "Username, email, and password are required." },
        { status: 400 }
      );
    }

    if (password.length < 12) {
      return NextResponse.json(
        { error: "Use a password with at least 12 characters." },
        { status: 400 }
      );
    }

    await connectToDatabase();

    const existingUserCount = await User.countDocuments();

    if (existingUserCount > 0) {
      return NextResponse.json(
        { error: "Initial setup has already been completed." },
        { status: 409 }
      );
    }

    const locations = await ensureDefaultLocations();
    const passwordHash = hashPassword(password);

    await User.create({
      username,
      email,
      passwordHash,
      role: "ADMIN",
      locationIds: locations.map((location) => String(location._id)),
      emailVerified: true,
      active: true,
    });

    return NextResponse.json({
      success: true,
      message: "Administrator account created. You can now sign in.",
    });
  } catch (error) {
    console.error("Initial setup failed:", error);

    if (isMongoConnectionError(error)) {
      return NextResponse.json(
        {
          error:
            "The scheduler cannot reach MongoDB Atlas. In MongoDB Atlas, allow network access for the deployed Vercel application, then try setup again.",
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: "Initial setup could not be completed." },
      { status: 500 }
    );
  }
}
