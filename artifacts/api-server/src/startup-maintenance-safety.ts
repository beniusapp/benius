export const DEV_STARTUP_MAINTENANCE_ENABLED_ENV =
  "BENIUS_DEV_STARTUP_MAINTENANCE_ENABLED";

type StartupMaintenanceEnvironment = Record<string, string | undefined>;

/**
 * Keep legacy startup schema/data maintenance off by default in Development.
 * Outside Development, preserve the existing startup behavior.
 */
export function isStartupMaintenanceEnabled(
  env: StartupMaintenanceEnvironment = process.env,
): boolean {
  if (env.NODE_ENV === "development") {
    return env[DEV_STARTUP_MAINTENANCE_ENABLED_ENV] === "true";
  }
  return true;
}

/**
 * Runs the complete maintenance block only when the environment allows it.
 * Read-only startup validation deliberately remains outside this wrapper.
 */
export async function runStartupMaintenance(
  work: () => void | Promise<void>,
  env: StartupMaintenanceEnvironment = process.env,
): Promise<boolean> {
  if (!isStartupMaintenanceEnabled(env)) return false;
  await work();
  return true;
}
