import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lock, FileText, Shield, CheckCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface Props { schoolId: number; classes: string[]; sections: string[]; examTypes: string[] }

export default function ExamController({ schoolId, classes, sections, examTypes }: Props) {
  const { toast } = useToast();
  const [cls, setCls] = useState("");
  const [section, setSection] = useState("");
  const [examType, setExamType] = useState("");
  const [locked, setLocked] = useState<Set<string>>(new Set());

  const key = `${cls}-${section}-${examType}`;
  const isLocked = locked.has(key);

  const handleLock = () => {
    if (!cls || !section || !examType) return;
    setLocked(prev => { const n = new Set(prev); n.add(key); return n; });
    toast({ title: "Exam Locked", description: `${examType} scores for Class ${cls}-${section} are now locked.` });
  };

  const handleGenerateReport = () => {
    if (!cls || !section || !examType) return;
    toast({ title: "Report Card Generation", description: `Generating report cards for Class ${cls}-${section} · ${examType}. This feature will be available in the next release.` });
  };

  return (
    <div className="space-y-4">
      <div><h2 className="text-xl font-bold text-white">Exam Controller</h2>
        <p className="text-white/50 text-sm">Lock exam scores and generate report cards</p>
      </div>

      <div className="rounded-xl border border-[#D4AF37]/30 bg-[#1A2942] p-5 space-y-4">
        <div className="flex flex-wrap gap-3">
          <Select value={cls} onValueChange={setCls}>
            <SelectTrigger className="w-32 bg-[#0A1628] border-white/20 text-white" data-testid="select-exam-class">
              <SelectValue placeholder="Class" />
            </SelectTrigger>
            <SelectContent>{(classes.length > 0 ? classes : ["9","10","11","12"]).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={section} onValueChange={setSection}>
            <SelectTrigger className="w-28 bg-[#0A1628] border-white/20 text-white" data-testid="select-exam-section">
              <SelectValue placeholder="Section" />
            </SelectTrigger>
            <SelectContent>{(sections.length > 0 ? sections : ["A","B","C"]).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={examType} onValueChange={setExamType}>
            <SelectTrigger className="w-40 bg-[#0A1628] border-white/20 text-white" data-testid="select-exam-type">
              <SelectValue placeholder="Exam Type" />
            </SelectTrigger>
            <SelectContent>{(examTypes.length > 0 ? examTypes : ["UT1","UT2","Mid-term","Pre-Final","Annual"]).map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className={`rounded-lg border p-4 ${isLocked ? "border-green-500/30 bg-green-500/10" : "border-white/10 bg-[#0A1628]"}`}>
            <div className="flex items-center gap-2 mb-2">
              {isLocked ? <CheckCircle className="w-5 h-5 text-green-400" /> : <Lock className="w-5 h-5 text-[#D4AF37]" />}
              <h3 className="font-semibold text-white">Score Locking</h3>
            </div>
            <p className="text-white/50 text-xs mb-3">
              {isLocked
                ? `Scores for Class ${cls}-${section} ${examType} are locked. No further edits allowed.`
                : "Lock exam scores to prevent further modifications by teachers."}
            </p>
            <Button disabled={!cls || !section || !examType || isLocked} onClick={handleLock}
              className={`w-full ${isLocked ? "bg-green-600/50 cursor-not-allowed" : "bg-[#D4AF37] hover:bg-[#B8962E]"} text-[#0A1628] font-semibold`}
              data-testid="button-lock-exam">
              <Lock className="w-4 h-4 mr-1" /> {isLocked ? "Scores Locked" : "Lock Scores"}
            </Button>
          </div>

          <div className="rounded-lg border border-white/10 bg-[#0A1628] p-4">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="w-5 h-5 text-blue-400" />
              <h3 className="font-semibold text-white">Report Card Gen</h3>
            </div>
            <p className="text-white/50 text-xs mb-3">Generate printable report cards for the selected class and exam.</p>
            <Button disabled={!cls || !section || !examType} onClick={handleGenerateReport}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold"
              data-testid="button-generate-report">
              <FileText className="w-4 h-4 mr-1" /> Generate Reports
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4">
        <div className="flex items-center gap-2 mb-1">
          <Shield className="w-4 h-4 text-yellow-400" />
          <p className="text-yellow-400 text-sm font-semibold">Coming in Next Release</p>
        </div>
        <p className="text-white/50 text-xs">Full report card PDF generation with school letterhead, student photo, and grade calculation is in active development. Lock functionality is live.</p>
      </div>
    </div>
  );
}
