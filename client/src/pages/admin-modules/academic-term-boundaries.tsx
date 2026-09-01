import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarRange, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type Session = { id: number; sessionName: string; startDate: string; endDate: string; isActive: boolean };
type Policy = { examWeights: string };
type Boundary = { term: string; startDate: string; endDate: string };

export default function AcademicTermBoundaries({ isArchiveMode = false }: { isArchiveMode?: boolean }) {
  const { toast } = useToast();
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [values, setValues] = useState<Record<string, Boundary>>({});
  const { data: sessions = [] } = useQuery<Session[]>({ queryKey: ["/api/admin/academic-sessions"] });
  const { data: policies = [] } = useQuery<Policy[]>({ queryKey: ["/api/admin/exam-policy-tiers"] });
  const terms = useMemo(() => {
    const names = new Set<string>();
    for (const policy of policies) {
      try { Object.keys(JSON.parse(policy.examWeights || "{}")).forEach(term => names.add(term)); } catch {}
    }
    return [...names].sort();
  }, [policies]);

  useEffect(() => {
    if (sessionId === null && sessions.length) setSessionId((sessions.find(session => session.isActive) ?? sessions[0]).id);
  }, [sessions, sessionId]);

  const { data, isLoading } = useQuery<{ boundaries: Boundary[]; sessionStartDate: string; sessionEndDate: string }>({
    queryKey: ["/api/admin/academic-term-boundaries", sessionId],
    queryFn: async () => {
      const response = await fetch(`/api/admin/academic-term-boundaries?sessionId=${sessionId}`, { credentials: "include" });
      if (!response.ok) throw new Error((await response.json()).message || "Failed to load term boundaries");
      return response.json();
    },
    enabled: sessionId !== null,
  });

  useEffect(() => {
    if (!data) return;
    setValues(Object.fromEntries(terms.map(term => {
      const saved = data.boundaries.find(boundary => boundary.term === term);
      return [term, saved ?? { term, startDate: "", endDate: "" }];
    })));
  }, [data, terms]);

  const save = useMutation({
    mutationFn: async () => {
      if (!sessionId) throw new Error("Select an academic session.");
      await apiRequest("PUT", "/api/admin/academic-term-boundaries", {
        sessionId,
        boundaries: terms.map(term => values[term] ?? { term, startDate: "", endDate: "" }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/academic-term-boundaries", sessionId] });
      toast({ title: "Term boundaries saved", description: "Rule 2 will use these exact session dates." });
    },
    onError: (error: Error) => toast({ title: "Could not save term boundaries", description: error.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="p-2 rounded-lg bg-cyan-500/15"><CalendarRange className="w-4 h-4 text-cyan-300" /></div>
        <div className="flex-1">
          <h3 className="font-semibold text-white">Academic term boundaries</h3>
          <p className="text-xs text-white/45 mt-1">Rule 2 attendance uses only these school- and session-specific inclusive dates.</p>
        </div>
        <select value={sessionId ?? ""} onChange={event => setSessionId(Number(event.target.value))}
          className="h-9 rounded-md border border-white/15 bg-[#0A1628] px-3 text-sm text-white"
          data-testid="select-term-boundary-session">
          {sessions.map(session => <option key={session.id} value={session.id}>{session.sessionName}{session.isActive ? " (Active)" : ""}</option>)}
        </select>
      </div>
      {data && <p className="text-xs text-white/40">Session range: {data.sessionStartDate} to {data.sessionEndDate}</p>}
      {!isLoading && terms.length === 0 && <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-white/35">Configure Exam & Promotion Policy terms first.</div>}
      <div className="space-y-3">
        {terms.map(term => (
          <div key={term} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr] gap-3 rounded-xl border border-white/10 bg-[#1A2942] p-4">
            <div><p className="text-xs text-white/35">Term</p><p className="text-sm font-semibold text-white mt-1">{term}</p></div>
            <label className="text-xs text-white/50">Start date
              <Input type="date" value={values[term]?.startDate ?? ""} disabled={isArchiveMode}
                min={data?.sessionStartDate} max={data?.sessionEndDate}
                onChange={event => setValues(previous => ({ ...previous, [term]: { ...(previous[term] ?? { term, endDate: "" }), startDate: event.target.value } }))}
                className="mt-1 bg-[#0A1628] border-white/15 text-white" data-testid={`input-term-start-${term}`} />
            </label>
            <label className="text-xs text-white/50">End date
              <Input type="date" value={values[term]?.endDate ?? ""} disabled={isArchiveMode}
                min={data?.sessionStartDate} max={data?.sessionEndDate}
                onChange={event => setValues(previous => ({ ...previous, [term]: { ...(previous[term] ?? { term, startDate: "" }), endDate: event.target.value } }))}
                className="mt-1 bg-[#0A1628] border-white/15 text-white" data-testid={`input-term-end-${term}`} />
            </label>
          </div>
        ))}
      </div>
      {!isArchiveMode && terms.length > 0 && <Button onClick={() => save.mutate()} disabled={save.isPending}
        className="bg-cyan-500 hover:bg-cyan-400 text-[#06121f] font-semibold" data-testid="button-save-term-boundaries">
        <Save className="w-4 h-4 mr-1.5" />{save.isPending ? "Saving…" : "Save Term Boundaries"}
      </Button>}
    </div>
  );
}