import { GraduationCap, BookOpen, Users, Shield } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-md bg-primary">
            <GraduationCap className="w-5 h-5 text-primary-foreground" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight" data-testid="text-app-title">BENIUS</h1>
          <span className="text-sm text-muted-foreground ml-1">School Management</span>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-2xl w-full text-center space-y-10">
          <div className="space-y-3">
            <h2 className="text-3xl font-bold tracking-tight" data-testid="text-hero-title">
              Welcome to BENIUS
            </h2>
            <p className="text-muted-foreground text-lg max-w-lg mx-auto">
              A modern school management platform built for administrators, teachers, and students.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="hover-elevate">
              <CardContent className="pt-6 flex flex-col items-center gap-3 text-center">
                <div className="flex items-center justify-center w-12 h-12 rounded-md bg-primary/10">
                  <BookOpen className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-sm">Academics</p>
                  <p className="text-xs text-muted-foreground mt-1">Manage curriculum and classes</p>
                </div>
              </CardContent>
            </Card>

            <Card className="hover-elevate">
              <CardContent className="pt-6 flex flex-col items-center gap-3 text-center">
                <div className="flex items-center justify-center w-12 h-12 rounded-md bg-primary/10">
                  <Users className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-sm">Students</p>
                  <p className="text-xs text-muted-foreground mt-1">Track enrollment and records</p>
                </div>
              </CardContent>
            </Card>

            <Card className="hover-elevate">
              <CardContent className="pt-6 flex flex-col items-center gap-3 text-center">
                <div className="flex items-center justify-center w-12 h-12 rounded-md bg-primary/10">
                  <Shield className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-sm">Administration</p>
                  <p className="text-xs text-muted-foreground mt-1">Secure school operations</p>
                </div>
              </CardContent>
            </Card>
          </div>

          <p className="text-xs text-muted-foreground">
            Contact your school administrator for access credentials.
          </p>
        </div>
      </main>

      <footer className="border-t py-4 text-center text-xs text-muted-foreground">
        BENIUS School Management System
      </footer>
    </div>
  );
}
