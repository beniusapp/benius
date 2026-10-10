export const DEV_OVERDUE_CHECK_DISABLED_ENV = "BENIUS_DEV_OVERDUE_CHECK_DISABLED";

type OverdueSafetyEnvironment = Record<string, string | undefined>;

/**
 * Automatic overdue processing stays disabled in Development unless explicitly
 * opted in. Outside Development, preserve the application's existing behavior.
 */
export function isAutomaticOverdueFeeProcessingEnabled(
  env: OverdueSafetyEnvironment = process.env,
): boolean {
  if (env.NODE_ENV === "development") {
    return env[DEV_OVERDUE_CHECK_DISABLED_ENV] === "false";
  }
  return true;
}

/** Returns false without invoking the work callback when safety mode blocks it. */
export async function runAutomaticOverdueFeeWork(
  work: () => void | Promise<void>,
  env: OverdueSafetyEnvironment = process.env,
): Promise<boolean> {
  if (!isAutomaticOverdueFeeProcessingEnabled(env)) return false;
  await work();
  return true;
}
