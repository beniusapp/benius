import { useEffect, useState } from "react";
import { millisecondsUntilNextISTMidnight, todayInIST } from "@shared/ist-time";

/** Reactive Asia/Kolkata business date, updated exactly at IST midnight. */
export function useISTToday(): string {
  const [today, setToday] = useState(todayInIST);

  useEffect(() => {
    const now = new Date();
    const timeout = window.setTimeout(
      () => setToday(todayInIST()),
      millisecondsUntilNextISTMidnight(now) + 25,
    );
    return () => window.clearTimeout(timeout);
  }, [today]);

  return today;
}