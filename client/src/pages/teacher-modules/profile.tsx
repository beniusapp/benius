import { User, Mail, Phone, BookOpen, GraduationCap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TeacherMe } from "@/pages/teacher-dashboard";

export default function ProfileModule({ teacher }: { teacher: TeacherMe }) {
  const fields = [
    { icon: User, label: "Full Name", value: teacher.fullName },
    { icon: Mail, label: "Email", value: teacher.email },
    { icon: Phone, label: "Phone", value: teacher.phone },
    { icon: BookOpen, label: "Subject", value: teacher.subject },
    { icon: GraduationCap, label: "Assigned Class", value: `${teacher.assignedClass} - ${teacher.assignedSection}` },
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto flex items-center justify-center w-20 h-20 rounded-full bg-primary/10 mb-2">
            <User className="w-10 h-10 text-primary" />
          </div>
          <CardTitle className="text-xl" data-testid="text-profile-name">{teacher.fullName}</CardTitle>
          <p className="text-sm text-muted-foreground">{teacher.schoolName} ({teacher.schoolCode})</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {fields.map((f) => {
            const Icon = f.icon;
            return (
              <div key={f.label} className="flex items-center gap-3 p-3 rounded-md bg-muted/50" data-testid={`field-${f.label.toLowerCase().replace(/\s/g, "-")}`}>
                <Icon className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">{f.label}</p>
                  <p className="text-sm font-medium">{f.value}</p>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
