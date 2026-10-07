export type AutomaticDateSelection = {
  selectedDate: string;
  automaticDate: string | null;
};

export function advanceAutomaticDateSelection(
  selectedDate: string,
  automaticDate: string | null,
  todayInIST: string,
): AutomaticDateSelection {
  if (automaticDate === null || selectedDate !== automaticDate) {
    return { selectedDate, automaticDate: null };
  }

  if (todayInIST === automaticDate) {
    return { selectedDate, automaticDate };
  }

  return { selectedDate: todayInIST, automaticDate: todayInIST };
}
