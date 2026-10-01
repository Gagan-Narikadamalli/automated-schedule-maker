import { NextResponse } from "next/server";

import { verifyOneTimeCode } from "@/lib/auth/otp";
import {
  createSessionCookie,
  type SessionRole,
} from "@/lib/auth/session";
import { connectToDatabase } from "@/lib/db";
import { User } from "@/models/User";
import { VerificationCode } from "@/models/VerificationCode";

type VerifyRequest = {
  challengeId?: string;
  code?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as VerifyRequest;
    const challengeId = body.challengeId?.trim();
    const code = body.code?.trim();

    if (!challengeId || !code) {
      return NextResponse.json(
        { error: "Challenge ID and verification code are required." },
        { status: 400 }
      );
    }

    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json(
        { error: "Enter the 6-digit verification code." },
        { status: 400 }
      );
    }

    await connectToDatabase();

    const challenge = await VerificationCode.findById(challengeId).select(
      "+codeHash"
    );

    if (
      !challenge ||
      challenge.purpose !== "LOGIN" ||
      challenge.usedAt ||
      challenge.expiresAt.getTime() <= Date.now()
    ) {
      return NextResponse.json(
        { error: "This verification challenge is invalid or expired." },
        { status: 401 }
      );
    }

    if (challenge.attemptCount >= 5) {
      return NextResponse.json(
        { error: "Too many incorrect attempts. Request a new verification code." },
        { status: 429 }
      );
    }

    if (!verifyOneTimeCode(code, challenge.codeHash)) {
      challenge.attemptCount += 1;
      await challenge.save();

      return NextResponse.json(
        { error: "Incorrect verification code." },
        { status: 401 }
      );
    }

    const user = await User.findOne({
      _id: challenge.userId,
      active: true,
    });

    if (!user) {
      return NextResponse.json(
        { error: "The user account is not available." },
        { status: 401 }
      );
    }

    challenge.usedAt = new Date();
    await challenge.save();

    user.emailVerified = true;
    user.lastLoginAt = new Date();
    await user.save();

    await createSessionCookie({
      userId: String(user._id),
      username: user.username,
      email: user.email,
      role: user.role as SessionRole,
      locationIds: user.locationIds.map((locationId: unknown) =>
        String(locationId)
      ),
    });

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error("OTP verification failed:", error);

    return NextResponse.json(
      { error: "Verification could not be completed." },
      { status: 500 }
    );
  }
}
