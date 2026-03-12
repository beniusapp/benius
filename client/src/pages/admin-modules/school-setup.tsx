import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, X, Save, BookOpen, Grid3X3, FlaskConical, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Props { schoolId: number }

function TagList({ items, onRemove }: { items: string[]; onRemove: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {items.map(v => (
        <span key={v} className="flex items-center gap-1 px-3 py-1 rounded-full text-sm bg-[#D4AF37]/20 text-[#D4AF37] border border-[#D4AF37]/40">
          {v}
          <button onClick={() => onRemove(v)} className="hover:text-red-400 transition-colors">
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

function MetaSection({ title, icon: Icon, items, onAdd, onRemove, onSave, input, setInput, testId, isPending }: {
  title: string; icon: any; items: string[]; onAdd: () => void; onRemove: (v: string) => void;
  onSave: () => void; input: string; setInput: (v: string) => void; testId: string; isPending: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#1A2942] p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className="p-2 rounded-lg bg-[#D4AF37]/20">
          <Icon className="w-4 h-4 text-[#D4AF37]" />
        </div>
        <h3 className="font-semibold text-white">{title}</h3>
        <span className="ml-auto text-xs text-white/40">{items.length} configured</span>
      </div>
      <div className="flex gap-2 mb-2">
        <Input
          value={input} onChange={e => setInput(e.target.value)}
          placeholder={`Add ${title.toLowerCase()}...`}
          className="bg-[#0A1628] border-white/20 text-white placeholder:text-white/30 flex-1"
          data-testid={`input-${testId}`}
          onKeyDown={e => e.key === "Enter" && onAdd()}
        />
        <Button onClick={onAdd} size="sm" variant="outline" className="border-[#D4AF37]/40 text-[#D4AF37] hover:bg-[#D4AF37]/10" data-testid={`button-add-${testId}`}>
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      <TagList items={items} onRemove={onRemove} />
      <Button onClick={onSave} disabled={isPending} size="sm" className="mt-3 bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold" data-testid={`button-save-${testId}`}>
        <Save className="w-3.5 h-3.5 mr-1" /> Save {title}
      </Button>
    </div>
  );
}

export default function SchoolSetup({ schoolId }: Props) {
  const { toast } = useToast();
  const [classes, setClasses] = useState<string[]>([]);
  const [sections, setSections] = useState<string[]>([]);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [examTypes, setExamTypes] = useState<string[]>([]);
  const [classInput, setClassInput] = useState("");
  const [sectionInput, setSectionInput] = useState("");
  const [subjectInput, setSubjectInput] = useState("");
  const [examInput, setExamInput] = useState("");
  const [loaded, setLoaded] = useState(false);

  const { data: meta } = useQuery({
    queryKey: ["/api/school-metadata", schoolId],
    queryFn: async () => {
      const r = await fetch(`/api/school-metadata/${schoolId}`, { credentials: "include" });
      return r.ok ? r.json() : { classes: [], sections: [], subjects: [], exam_types: [] };
    },
    enabled: !!schoolId,
  });

  useEffect(() => {
    if (meta && !loaded) {
      setClasses(meta.classes || []);
      setSections(meta.sections || []);
      setSubjects(meta.subjects || []);
      setExamTypes(meta.exam_types || []);
      setLoaded(true);
    }
  }, [meta, loaded]);

  const saveMutation = useMutation({
    mutationFn: async ({ key, values }: { key: string; values: string[] }) => {
      await apiRequest("PUT", `/api/school-metadata/${schoolId}/${key}`, { values });
    },
    onSuccess: () => {
      toast({ title: "Saved", description: "School configuration updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/school-metadata", schoolId] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addTo = (arr: string[], set: (v: string[]) => void, val: string, setInput: (v: string) => void) => {
    const trimmed = val.trim();
    if (trimmed && !arr.includes(trimmed)) { set([...arr, trimmed]); setInput(""); }
  };
  const removeFrom = (arr: string[], set: (v: string[]) => void, val: string) => set(arr.filter(x => x !== val));

  return (
    <div className="space-y-4">
      <div className="mb-2">
        <h2 className="text-xl font-bold text-white">School Setup</h2>
        <p className="text-white/50 text-sm">Configure master lists for classes, sections, subjects and exam types.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MetaSection title="Classes" icon={Grid3X3} items={classes} input={classInput} setInput={setClassInput}
          onAdd={() => addTo(classes, setClasses, classInput, setClassInput)}
          onRemove={v => removeFrom(classes, setClasses, v)}
          onSave={() => saveMutation.mutate({ key: "classes", values: classes })}
          testId="classes" isPending={saveMutation.isPending} />
        <MetaSection title="Sections" icon={Grid3X3} items={sections} input={sectionInput} setInput={setSectionInput}
          onAdd={() => addTo(sections, setSections, sectionInput, setSectionInput)}
          onRemove={v => removeFrom(sections, setSections, v)}
          onSave={() => saveMutation.mutate({ key: "sections", values: sections })}
          testId="sections" isPending={saveMutation.isPending} />
        <MetaSection title="Subjects" icon={BookOpen} items={subjects} input={subjectInput} setInput={setSubjectInput}
          onAdd={() => addTo(subjects, setSubjects, subjectInput, setSubjectInput)}
          onRemove={v => removeFrom(subjects, setSubjects, v)}
          onSave={() => saveMutation.mutate({ key: "subjects", values: subjects })}
          testId="subjects" isPending={saveMutation.isPending} />
        <MetaSection title="Exam Types" icon={FileText} items={examTypes} input={examInput} setInput={setExamInput}
          onAdd={() => addTo(examTypes, setExamTypes, examInput, setExamInput)}
          onRemove={v => removeFrom(examTypes, setExamTypes, v)}
          onSave={() => saveMutation.mutate({ key: "exam_types", values: examTypes })}
          testId="exam-types" isPending={saveMutation.isPending} />
      </div>
    </div>
  );
}
