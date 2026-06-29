"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, Loader2, Trash2 } from "lucide-react";
import {
  getStudySpace,
  listSessions,
  addSessionToSpace,
  removeSessionFromSpace,
  type StudySpaceDetail,
  type SessionListItem,
} from "@/lib/api";

export default function SpaceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [space, setSpace] = useState<StudySpaceDetail | null>(null);
  const [allSessions, setAllSessions] = useState<SessionListItem[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [loading, setLoading] = useState(true);

  const id = Number(params.id);

  const fetchData = useCallback(async () => {
    try {
      const [spaceData, sessionsData] = await Promise.all([
        getStudySpace(id),
        listSessions(),
      ]);
      setSpace(spaceData);
      setAllSessions(sessionsData);
    } catch {
      router.push("/");
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const spaceSessionIds = new Set(space?.sessions.map((s) => s.id) ?? []);
  const availableSessions = allSessions.filter((s) => !spaceSessionIds.has(s.id));

  const handleAdd = async (sessionId: number) => {
    try {
      await addSessionToSpace(id, sessionId);
      const session = allSessions.find((s) => s.id === sessionId);
      if (session && space) {
        setSpace({
          ...space,
          sessions: [{ id: session.id, title: session.title, created_at: session.created_at }, ...space.sessions],
          session_count: space.session_count + 1,
        });
      }
    } catch {
      // ignore
    }
  };

  const handleRemove = async (sessionId: number) => {
    try {
      await removeSessionFromSpace(id, sessionId);
      if (space) {
        setSpace({
          ...space,
          sessions: space.sessions.filter((s) => s.id !== sessionId),
          session_count: space.session_count - 1,
        });
      }
    } catch {
      // ignore
    }
  };

  if (loading) {
    return (
      <div className="h-dvh flex items-center justify-center">
        <Loader2 className="animate-spin text-muted-foreground" size={24} />
      </div>
    );
  }

  if (!space) return null;

  return (
    <div className="h-dvh bg-[#f0f0f0] flex flex-col overflow-hidden">
      <div className="relative flex-1 overflow-hidden">
        <div className="absolute inset-0 overflow-y-auto">
          <div className="max-w-5xl mx-auto px-4 md:px-6 py-10 md:py-16">
            {/* Header */}
            <div className="flex items-center gap-3 mb-10">
              <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
                <ArrowLeft size={18} />
              </Link>
              <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">{space.name}</h1>
              <span className="text-sm text-muted-foreground">
                {space.session_count} session{space.session_count !== 1 ? "s" : ""}
              </span>
              <div className="flex-1" />
              <button
                onClick={() => setShowAdd(!showAdd)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-foreground text-background text-sm font-medium"
              >
                <Plus size={14} />
                Add Sessions
              </button>
            </div>

            {/* Add sessions panel */}
            {showAdd && availableSessions.length > 0 && (
              <div className="mb-6 p-4 rounded-2xl border border-border bg-white space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Add sessions to this space</p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {availableSessions.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => handleAdd(s.id)}
                      className="w-full text-left flex items-center justify-between px-3 py-2 rounded-lg hover:bg-muted text-sm transition-colors"
                    >
                      <span className="truncate">
                        {s.title.replace(/\*\*/g, "").replace(/^Q\d*:\s*/, "")}
                      </span>
                      <Plus size={14} className="text-muted-foreground shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Sessions */}
            {space.sessions.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground text-sm">
                <p>No sessions in this space yet.</p>
                <button onClick={() => setShowAdd(true)} className="mt-2 underline text-xs">
                  Add some sessions
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {space.sessions.map((s) => (
                  <div key={s.id} className="group relative flex flex-col rounded-3xl border border-border bg-surface h-64 transition-colors hover:border-border/80 select-none">
                    <div className="flex flex-col gap-3 px-5 pt-6 pb-4 flex-1">
                      <Link
                        href={`/session/${s.id}`}
                        className="font-medium text-xl tracking-tight text-foreground hover:underline line-clamp-2"
                      >
                        {s.title.replace(/\*\*/g, "").replace(/^Q\d*:\s*/, "")}
                      </Link>
                      <span className="text-sm text-muted-foreground">
                        {new Date(s.created_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                    </div>
                    <button
                      onClick={() => handleRemove(s.id)}
                      className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
                      title="Remove from space"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
