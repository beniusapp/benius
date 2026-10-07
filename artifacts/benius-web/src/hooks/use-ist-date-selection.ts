import { useCallback, useEffect, useRef, useState } from "react";
import { todayInIST } from "@shared/ist-time";
import { advanceAutomaticDateSelection } from "@/lib/ist-date-selection-state";

const DATE_REFRESH_INTERVAL_MS = 30_000;

export function useIstDateSelection() {
  const [today, setToday] = useState(() => todayInIST());
  const [selectedDate, setSelectedDate] = useState(today);
  const automaticDateRef = useRef<string | null>(today);

  useEffect(() => {
    const refreshIstDate = () => {
      const nextToday = todayInIST();
      setToday(nextToday);

      const nextSelection = advanceAutomaticDateSelection(
        selectedDate,
        automaticDateRef.current,
        nextToday,
      );
      automaticDateRef.current = nextSelection.automaticDate;
      if (nextSelection.selectedDate !== selectedDate) {
        setSelectedDate(nextSelection.selectedDate);
      }
    };

    const interval = window.setInterval(refreshIstDate, DATE_REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refreshIstDate);
    document.addEventListener("visibilitychange", refreshIstDate);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshIstDate);
      document.removeEventListener("visibilitychange", refreshIstDate);
    };
  }, [selectedDate]);

  const selectDate = useCallback((date: string) => {
    automaticDateRef.current = null;
    setSelectedDate(date);
  }, []);

  return { today, selectedDate, selectDate };
}
