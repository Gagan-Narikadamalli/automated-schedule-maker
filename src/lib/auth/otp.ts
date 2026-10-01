import {
  createHmac,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

function getAuthSecret(): string {
  const authSecret = process.env.AUTH_SECRET;

  if (!authSecret) {
    throw new Error(
      "AUTH_SECRET is not configured. Add a long random value to the Vercel environment variables."
    );
  }

  return authSecret;
}

export function generateOneTimeCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashOneTimeCode(code: string): string {
  return createHmac("sha256", getAuthSecret())
    .update(code)
    .digest("hex");
}

export function verifyOneTimeCode(
  code: string,
  storedCodeHash: string
): boolean {
  const candidateHash = hashOneTimeCode(code);
  const storedBuffer = Buffer.from(storedCodeHash, "hex");
  const candidateBuffer = Buffer.from(candidateHash, "hex");

  if (storedBuffer.length !== candidateBuffer.length) {
    return false;
  }

  return timingSafeEqual(storedBuffer, candidateBuffer);
}
