import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { GraduationCap, Plus, School, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import type { School as SchoolType } from "@shared/schema";

const addSchoolSchema = z.object({
  name: z.string().min(2, "School name must be at least 2 characters"),
  code: z.string().min(2, "School code must be at least 2 characters").max(20, "School code must be at most 20 characters").regex(/^[A-Z0-9]+$/, "Code must be uppercase letters and numbers only"),
});

type AddSchoolForm = z.infer<typeof addSchoolSchema>;

export default function SuperMaster() {
  const { toast } = useToast();

  const { data: schools = [], isLoading } = useQuery<SchoolType[]>({
    queryKey: ["/api/schools"],
  });

  const form = useForm<AddSchoolForm>({
    resolver: zodResolver(addSchoolSchema),
    defaultValues: {
      name: "",
      code: "",
    },
  });

  const createSchoolMutation = useMutation({
    mutationFn: async (data: AddSchoolForm) => {
      const res = await apiRequest("POST", "/api/schools", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "School added", description: "The school has been created successfully." });
      form.reset();
      queryClient.invalidateQueries({ queryKey: ["/api/schools"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  function onSubmit(data: AddSchoolForm) {
    createSchoolMutation.mutate(data);
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b bg-card">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-md bg-primary">
            <GraduationCap className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight" data-testid="text-super-master-title">BENIUS</h1>
            <p className="text-xs text-muted-foreground">Super Admin Panel</p>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-8 space-y-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Plus className="w-5 h-5" />
              Add New School
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col sm:flex-row gap-4 items-end">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem className="flex-1 w-full">
                      <FormLabel>School Name</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. Maple Leaf School"
                          data-testid="input-school-name"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem className="sm:w-40 w-full">
                      <FormLabel>School Code</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. MLS"
                          data-testid="input-school-code"
                          {...field}
                          onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  disabled={createSchoolMutation.isPending}
                  data-testid="button-add-school"
                >
                  {createSchoolMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Add School"
                  )}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <School className="w-5 h-5" />
              Registered Schools
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : schools.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm" data-testid="text-no-schools">
                No schools registered yet. Use the form above to add your first school.
              </div>
            ) : (
              <div className="space-y-2">
                {schools.map((school) => (
                  <div
                    key={school.id}
                    className="flex items-center justify-between gap-4 px-4 py-3 rounded-md bg-muted/50"
                    data-testid={`row-school-${school.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-9 h-9 rounded-md bg-primary/10">
                        <School className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-sm" data-testid={`text-school-name-${school.id}`}>{school.name}</p>
                        <p className="text-xs text-muted-foreground">ID: {school.id}</p>
                      </div>
                    </div>
                    <span className="text-xs font-mono bg-secondary px-2 py-1 rounded-md" data-testid={`text-school-code-${school.id}`}>
                      {school.code}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
