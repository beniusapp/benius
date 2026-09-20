import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET must be configured with at least 16 characters for password recovery");
  }
  return secret;
}

export function generatePasswordRecoveryOtp(): string {
  return String(randomInt(100000, 1000000));
}

export function generatePasswordRecoveryToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashPasswordRecoverySecret(secret: string): string {
  return createHmac("sha256", sessionSecret()).update(secret).digest("hex");
}

export function passwordRecoverySecretsEqual(expectedHash: string, actualHash: string): boolean {
  const expected = Buffer.from(expectedHash, "hex");
  const actual = Buffer.from(actualHash, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}