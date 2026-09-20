import { and, eq, gt, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "./db";
import {
  passwordResetChallenges,
  teachers,
  users,
} from "@shared/schema";
import {
  generatePasswordRecoveryToken,
  hashPasswordRecoverySecret,
  passwordRecoverySecretsEqual,
} from "./password-recovery";

export type TeacherOtpVerificationResult =
  | { success: false }
  | { success: true; resetToken: string };

export async function verifyTeacherPasswordRecoveryOtp(
  challengeId: number,
  userId: number,
  schoolId: number,
  otp: string,
  now = new Date(),
): Promise<TeacherOtpVerificationResult> {
  return db.transaction(async (tx) => {
    const [challenge] = await tx.select().from(passwordResetChallenges)
      .where(and(
        eq(passwordResetChallenges.id, challengeId),
        eq(passwordResetChallenges.userId, userId),
        eq(passwordResetChallenges.schoolId, schoolId),
        isNull(passwordResetChallenges.verifiedAt),
        isNull(passwordResetChallenges.consumedAt),
        gt(passwordResetChallenges.otpExpiresAt, now),
        lt(passwordResetChallenges.attemptCount, 5),
        isNotNull(passwordResetChallenges.otpHash),
      ))
      .limit(1)
      .for("update");
    if (!challenge) return { success: false };

    const [account] = await tx.select({ userId: users.id, teacherId: teachers.id })
      .from(users)
      .innerJoin(teachers, eq(teachers.userId, users.id))
      .where(and(
        eq(users.id, userId),
        eq(users.schoolId, schoolId),
        eq(users.role, "teacher"),
        eq(users.isActive, true),
        eq(teachers.schoolId, schoolId),
        eq(teachers.isActive, true),
      ))
      .limit(1)
      .for("update");
    if (!account) return { success: false };

    const suppliedOtpHash = hashPasswordRecoverySecret(otp);
    if (!passwordRecoverySecretsEqual(challenge.otpHash, suppliedOtpHash)) {
      await tx.update(passwordResetChallenges)
        .set({
          attemptCount: sql`LEAST(${passwordResetChallenges.attemptCount} + 1, 5)`,
        })
        .where(and(
          eq(passwordResetChallenges.id, challengeId),
          isNull(passwordResetChallenges.verifiedAt),
          isNull(passwordResetChallenges.consumedAt),
          lt(passwordResetChallenges.attemptCount, 5),
        ));
      return { success: false };
    }

    const resetToken = generatePasswordRecoveryToken();
    const resetTokenHash = hashPasswordRecoverySecret(resetToken);
    const resetTokenExpiresAt = new Date(now.getTime() + 15 * 60 * 1000);
    const [verified] = await tx.update(passwordResetChallenges)
      .set({
        verifiedAt: now,
        resetTokenHash,
        resetTokenExpiresAt,
      })
      .where(and(
        eq(passwordResetChallenges.id, challengeId),
        eq(passwordResetChallenges.userId, userId),
        eq(passwordResetChallenges.schoolId, schoolId),
        isNull(passwordResetChallenges.verifiedAt),
        isNull(passwordResetChallenges.consumedAt),
        gt(passwordResetChallenges.otpExpiresAt, now),
        lt(passwordResetChallenges.attemptCount, 5),
      ))
      .returning({ id: passwordResetChallenges.id });
    if (!verified) return { success: false };
    return { success: true, resetToken };
  });
}