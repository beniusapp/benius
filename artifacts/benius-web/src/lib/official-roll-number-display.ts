export function officialRollNumberDisplayValue(
  rollNumber: number | null | undefined,
): string {
  return rollNumber == null ? "—" : String(rollNumber);
}
