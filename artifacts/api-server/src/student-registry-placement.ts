export interface StudentRegistryPlacementMetadata {
  metaKey: string;
  metaValue: string;
}

export interface StudentPlacementSnapshot {
  isActive: boolean;
  class: string;
  section: string;
  rollNumber: number | null;
}

export interface StudentPlacementInput {
  class: string;
  section: string;
  rollNumber: number | null;
}

function parseStringArray(value: string | undefined): string[] | null {
  if (value === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every(item => typeof item === "string")
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function isConfiguredStudentPlacement(
  metadata: StudentRegistryPlacementMetadata[],
  className: string,
  sectionName: string,
): boolean {
  const values = new Map(metadata.map(row => [row.metaKey, row.metaValue]));
  const classes = parseStringArray(values.get("classes")) ?? [];
  const sections = parseStringArray(values.get("sections")) ?? [];
  if (!classes.includes(className) || !sections.includes(sectionName)) return false;

  const mappingValue = values.get("class_sections");
  if (mappingValue === undefined) return true;

  try {
    const mapping: unknown = JSON.parse(mappingValue);
    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) return false;
    const classSections = (mapping as Record<string, unknown>)[className];
    return Array.isArray(classSections)
      && classSections.every(item => typeof item === "string")
      && classSections.includes(sectionName);
  } catch {
    return false;
  }
}

export function hasActiveStudentPlacementChanged(
  current: StudentPlacementSnapshot,
  next: StudentPlacementInput,
): boolean {
  return current.isActive && (
    current.class !== next.class
    || current.section !== next.section
    || current.rollNumber !== next.rollNumber
  );
}
