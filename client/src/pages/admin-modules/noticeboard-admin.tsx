import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Bell, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

interface Props { schoolId: number; classes: string[]; sections: string[] }

const TARGET_TYPES = [
  { value: "whole_school", label: "Whole School" },
  { value: "teacher", label: "All Teachers" },
  { value: "class", label: "Specific Class" },
];

export default function NoticeboardAdmin({ schoolId, classes, sections }: Props) {
  const { toast } = useToast();
  const [content, setContent] = useState("");
  const [targetType, setTargetType] = useState("whole_school");
  const [targetClass, setTargetClass] = useState("");
  const [targetSection, setTargetSection] = useState("");

  const { data: notices = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/notices", schoolId],
    queryFn: async () => {
      const r = await fetch(`/api/notices/${schoolId}`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!schoolId,
  });

  const postMutation = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("content", content);
      fd.append("targetType", targetType);
      fd.append("schoolId", String(schoolId));
      if (targetType === "class" && targetClass) { fd.append("targetClass", targetClass); fd.append("targetSection", targetSection); }
      const r = await fetch("/api/notices", { method: "POST", body: fd, credentials: "include" });
      if (!r.ok) { const e = await r.json(); throw new Error(e.message); }
    },
    onSuccess: () => {
      toast({ title: "Notice Posted" });
      setContent(""); setTargetClass(""); setTargetSection("");
      queryClient.invalidateQueries({ queryKey: ["/api/notices", schoolId] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-white">Noticeboard</h2>
        <p className="text-white/50 text-sm">Post notices to teachers, classes, or the whole school</p>
      </div>

      <div className="rounded-xl border border-[#D4AF37]/30 bg-[#1A2942] p-5 space-y-3">
        <h3 className="font-semibold text-white flex items-center gap-2"><Bell className="w-4 h-4 text-[#D4AF37]" /> Post New Notice</h3>
        <div className="flex gap-3 flex-wrap">
          <Select value={targetType} onValueChange={setTargetType}>
            <SelectTrigger className="w-44 bg-[#0A1628] border-white/20 text-white" data-testid="select-notice-target">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>{TARGET_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
          </Select>
          {targetType === "class" && (
            <>
              <Select value={targetClass} onValueChange={setTargetClass}>
                <SelectTrigger className="w-28 bg-[#0A1628] border-white/20 text-white" data-testid="select-notice-class">
                  <SelectValue placeholder="Class" />
                </SelectTrigger>
                <SelectContent>{(classes.length > 0 ? classes : ["1","2","3","4","5","6","7","8","9","10","11","12"]).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={targetSection} onValueChange={setTargetSection}>
                <SelectTrigger className="w-28 bg-[#0A1628] border-white/20 text-white" data-testid="select-notice-section">
                  <SelectValue placeholder="Section" />
                </SelectTrigger>
                <SelectContent>{(sections.length > 0 ? sections : ["A","B","C","D"]).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </>
          )}
        </div>
        <Textarea value={content} onChange={e => setContent(e.target.value)}
          placeholder="Write your notice here..."
          className="bg-[#0A1628] border-white/20 text-white placeholder:text-white/30 min-h-[100px]"
          data-testid="textarea-notice-content" />
        <Button disabled={!content || postMutation.isPending} onClick={() => postMutation.mutate()}
          className="bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold" data-testid="button-post-notice">
          {postMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Send className="w-4 h-4 mr-1" /> Post Notice</>}
        </Button>
      </div>

      <div className="space-y-3">
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-white/40" /></div>
        ) : notices.length === 0 ? (
          <p className="text-center text-white/40 py-8">No notices posted yet</p>
        ) : notices.slice(0, 20).map((n: any) => (
          <div key={n.id} className="rounded-lg border border-white/10 bg-[#1A2942] p-4" data-testid={`card-notice-${n.id}`}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs px-2 py-0.5 rounded-full bg-[#D4AF37]/20 text-[#D4AF37] border border-[#D4AF37]/30">{n.targetType}</span>
              <span className="text-white/30 text-xs">{new Date(n.createdAt).toLocaleDateString("en-GB")}</span>
            </div>
            <p className="text-white/80 text-sm">{n.content}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
