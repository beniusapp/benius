export const DEV_REMINDERS_DISABLED_ENV = "BENIUS_DEV_REMINDERS_DISABLED";

type ReminderSafetyEnvironment = Record<string, string | undefined>;

/**
 * Development reminder processing is opt-in. Production keeps its historical
 * behavior regardless of this Development-only flag.
 */
export function isReminderDeliveryEnabled(
  env: ReminderSafetyEnvironment = process.env,
): boolean {
  if (env.NODE_ENV === "development") {
    return env[DEV_REMINDERS_DISABLED_ENV] === "false";
  }
  return true;
}

export const REMINDERS_DISABLED_MESSAGE =
  "Reminder processing and delivery are disabled by Development safety mode.";

export function assertReminderDeliveryEnabled(
  env: ReminderSafetyEnvironment = process.env,
): void {
  if (!isReminderDeliveryEnabled(env)) {
    throw new Error(REMINDERS_DISABLED_MESSAGE);
  }
}

