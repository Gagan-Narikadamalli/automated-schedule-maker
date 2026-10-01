import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = scryptSync(password, salt, KEY_LENGTH).toString("hex");

  return `${salt}:${derivedKey}`;
}

export function verifyPassword(
  password: string,
  storedPasswordHash: string
): boolean {
  const [salt, storedKeyHex] = storedPasswordHash.split(":");

  if (!salt || !storedKeyHex) {
    return false;
  }

  const storedKey = Buffer.from(storedKeyHex, "hex");
  const candidateKey = scryptSync(password, salt, KEY_LENGTH);

  if (storedKey.length !== candidateKey.length) {
    return false;
  }

  return timingSafeEqual(storedKey, candidateKey);
}
