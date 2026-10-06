export function filterSupportStaffAllowedModules(
  allowedModules: readonly string[] | null | undefined,
): string[] {
  return (allowedModules ?? []).filter(
    module => module !== "school-setup" && !module.startsWith("school-setup:"),
  );
}
