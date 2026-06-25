"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { HoverFeatureCards } from "@/components/unlumen-ui/hover-feature-cards";
import { UploadDialog } from "@/components/upload-dialog";
import { listSessions, type SessionListItem } from "@/lib/api";
import { BookOpen } from "lucide-react";

export default function Dashboard() {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);

  useEffect(() => {
    console.log("DASHBOARD: useEffect fired");
    listSessions().then((data) => {
      console.log("DASHBOARD: got sessions:", data.length, data);
      setSessions(data);
    }).catch((e) => console.error("DASHBOARD: listSessions failed:", e));
  }, []);

  return (
    <div className="h-dvh bg-[#f0f0f0] flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 md:px-6 py-10 md:py-16">
          <div className="flex flex-col items-center text-center mb-16">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-foreground flex items-center justify-center">
                <BookOpen className="text-background" size={20} />
              </div>
              <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Make Me Understand</h1>
            </div>
            <p className="text-muted-foreground text-base md:text-lg max-w-md mb-8">
              Upload your study materials. AI will synthesize notes, explain concepts, and help you truly understand.
            </p>
            <UploadDialog />
          </div>

          {sessions.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-muted-foreground mb-4">Recent Sessions</h2>
              <HoverFeatureCards
                items={sessions.map((s) => ({
                  name: s.title.replace(/\*\*/g, "").replace(/^Q\d*:\s*/, ""),
                  description: new Date(s.created_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  }),
                  href: `/session/${s.id}`,
                }))}
                renderLink={(href, children) => (
                  <Link href={href} className="block">
                    {children}
                  </Link>
                )}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
