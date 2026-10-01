import { NextResponse } from "next/server";

import { sendLoginOtpEmail } from "@/lib/auth/email";
import {
  generateOneTimeCode,
  hashOneTimeCode,
} from "@/lib/auth/otp";
import { verifyPassword } from "@/lib/auth/passwords";
import { createSessionCookie } from "@/lib/auth/session";
import { connectToDatabase } from "@/lib/db";
import { User } from "@/models/User";
import { VerificationCode } from "@/models/VerificationCode";

type LoginRequest = {
  usernameOrEmail?: string;
  password?: string;
};

type TemporaryCredentials = {
  username: string;
  password: string;
};

function getTemporaryCredentials(): TemporaryCredentials | null {
  const username = process.env.TEMP_LOGIN_USERNAME?.trim();
  const password = process.env.TEMP_LOGIN_PASSWORD;

  if (!username || !password) {
    return null;
  }

  return {
    username,
    password,
  };
}

function maskEmail(email: string): string {
  const [localPart, domain] = email.split("@");

  if (!localPart || !domain) {
    return "your email";
  }

  const visibleCharacters = localPart.slice(0, Math.min(2, localPart.length));
  const maskedCharacters = "*".repeat(Math.max(localPart.length - 2, 3));

  return `${visibleCharacters}${maskedCharacters}@${domain}`;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as LoginRequest;
    const usernameOrEmail = body.usernameOrEmail?.trim() ?? "";
    const password = body.password ?? "";

    if (!usernameOrEmail || !password) {
      return NextResponse.json(
        { error: "Username/email and password are required." },
        { status: 400 }
      );
    }

    const temporaryCredentials = getTemporaryCredentials();

    if (
      temporaryCredentials &&
      usernameOrEmail === temporaryCredentials.username
    ) {
      if (password !== temporaryCredentials.password) {
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
    }

    await connectToDatabase();

    const user = await User.findOne({
      active: true,
      $or: [
        { username: usernameOrEmail },
        { email: usernameOrEmail.toLowerCase() },
      ],
    }).select("+passwordHash");

    if (!user || !verifyPassword(password, user.passwordHash)) {
      return NextResponse.json(
        { error: "Invalid username/email or password." },
        { status: 401 }
      );
    }

    const oneMinuteAgo = new Date(Date.now() - 60_000);
    const recentChallenge = await VerificationCode.findOne({
      userId: user._id,
      purpose: "LOGIN",
      usedAt: null,
      createdAt: { $gte: oneMinuteAgo },
    });

    if (recentChallenge) {
      return NextResponse.json(
        {
          error:
            "A verification code was already sent recently. Wait a moment before requesting another code.",
        },
        { status: 429 }
      );
    }

    await VerificationCode.deleteMany({
      userId: user._id,
      purpose: "LOGIN",
      usedAt: null,
    });

    const oneTimeCode = generateOneTimeCode();
    const challenge = await VerificationCode.create({
      userId: user._id,
      codeHash: hashOneTimeCode(oneTimeCode),
      purpose: "LOGIN",
      expiresAt: new Date(Date.now() + 10 * 60_000),
      usedAt: null,
      attemptCount: 0,
    });

    try {
      await sendLoginOtpEmail(user.email, oneTimeCode);
    } catch (emailError) {
      await VerificationCode.deleteOne({ _id: challenge._id });
      throw emailError;
    }

    return NextResponse.json({
      success: true,
      temporaryMode: false,
      requiresOtp: true,
      challengeId: String(challenge._id),
      email: maskEmail(user.email),
    });
  } catch (error) {
    console.error("Login request failed:", error);

    return NextResponse.json(
      {
        error:
          "Sign-in could not be completed. If you are using a normal account, confirm MongoDB and email settings and try again.",
      },
      { status: 500 }
    );
  }
}
