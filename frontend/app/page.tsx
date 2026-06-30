"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { bounce, stagger, cardPop } from "@/lib/animations";
import { UploadDialog } from "@/components/upload-dialog";
import { listSessions, renameSession, deleteSession, type SessionListItem } from "@/lib/api";
import { MoreHorizontal, Pencil, Trash2, Check, X, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ProgressiveBlur } from "@/components/ui/skiper-ui/skiper41";
import { StudySpaces } from "@/components/study-spaces";
import { Signature } from "@/components/ui/signature";

export default function Dashboard() {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  const [showCreateSpace, setShowCreateSpace] = useState(false);
  const [bottomBlurOpacity, setBottomBlurOpacity] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggered = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listSessions().then(setSessions).catch(console.error);
  }, []);

  useEffect(() => {
    if (editingId !== null && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  useEffect(() => {
    if (menuOpenId === null) return;
    const handle = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    };
    document.addEventListener("mousedown", handle);
    document.addEventListener("touchstart", handle);
    return () => {
      document.removeEventListener("mousedown", handle);
      document.removeEventListener("touchstart", handle);
    };
  }, [menuOpenId]);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handlePointerDown = useCallback((id: number) => {
    longPressTriggered.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      setMenuOpenId(id);
    }, 500);
  }, []);

  const handlePointerUp = useCallback(() => {
    clearLongPress();
  }, [clearLongPress]);

  const handleRename = async (id: number) => {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === sessions.find((s) => s.id === id)?.title) {
      setEditingId(null);
      return;
    }
    await renameSession(id, trimmed);
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title: trimmed } : s)));
    setEditingId(null);
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch {
      // ignore
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="h-dvh bg-[#f0f0f0] flex flex-col overflow-hidden">
      <div className="relative flex-1 overflow-hidden">
        <div
          ref={scrollRef}
          onScroll={() => {
            if (!scrollRef.current) return;
            const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
            const atBottom = scrollHeight - scrollTop - clientHeight < 10;
            setBottomBlurOpacity(atBottom ? 0 : 1);
          }}
          className="absolute inset-0 overflow-y-auto"
          style={{ overflowX: "visible" }}
        >
          <div className="max-w-5xl mx-auto px-4 md:px-6 py-10 md:py-16" style={{ overflow: "visible" }}>
            <div className="flex flex-col items-center text-center mb-16 relative z-10">
              <div className="mb-6 w-full max-w-md mx-auto px-4">
                <Signature
                  text="Make Me Understand"
                  fontSize={32}
                  duration={2}
                  color="currentColor"
                />
              </div>
              <p className="text-muted-foreground text-base md:text-lg max-w-md mb-8">
                Upload your study materials. AI will synthesize notes, explain concepts, and help you truly understand.
              </p>
              <UploadDialog />
            </div>

            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-muted-foreground">Recent Sessions</h2>
              <motion.button
                onClick={() => setShowCreateSpace(true)}
                whileTap={{ scale: 0.9 }}
                transition={bounce}
                className="text-muted-foreground hover:text-foreground"
                title="Create study space"
              >
                <FolderOpen size={18} />
              </motion.button>
            </div>
              <motion.div
                className="grid grid-cols-1 sm:grid-cols-2 gap-4"
                variants={stagger}
                initial="hidden"
                animate="visible"
              >
                {sessions.map((s) => (
                  <motion.div
                    key={s.id}
                    variants={cardPop}
                    whileTap={{ scale: 0.98 }}
                    transition={bounce}
                    className="group relative flex flex-col rounded-3xl border border-border bg-surface h-64 select-none"
                    onPointerDown={() => handlePointerDown(s.id)}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                    onPointerLeave={handlePointerUp}
                  >
                    <div className="flex flex-col gap-3 px-5 pt-6 pb-4 flex-1">
                      {editingId === s.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            ref={inputRef}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleRename(s.id);
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            onBlur={() => handleRename(s.id)}
                            className="font-medium text-xl tracking-tight bg-transparent border-b border-foreground outline-none w-full"
                          />
                          <Button variant="ghost" size="icon-xs" onClick={() => handleRename(s.id)}>
                            <Check size={14} />
                          </Button>
                          <Button variant="ghost" size="icon-xs" onClick={() => setEditingId(null)}>
                            <X size={14} />
                          </Button>
                        </div>
                      ) : (
                        <Link
                          href={`/session/${s.id}`}
                          className="font-medium text-xl tracking-tight text-foreground hover:underline line-clamp-2"
                          onClick={(e) => {
                            if (longPressTriggered.current) {
                              e.preventDefault();
                              longPressTriggered.current = false;
                            }
                          }}
                        >
                          {s.title.replace(/\*\*/g, "").replace(/^Q\d*:\s*/, "")}
                        </Link>
                      )}
                      <span className="text-sm text-muted-foreground">
                        {new Date(s.created_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                    </div>

                    {editingId !== s.id && (
                      <div
                        ref={menuOpenId === s.id ? menuRef : undefined}
                        className={cn(
                          "absolute top-3 right-3 transition-opacity",
                          menuOpenId === s.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                        )}
                      >
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => setMenuOpenId(menuOpenId === s.id ? null : s.id)}
                        >
                          <MoreHorizontal size={14} />
                        </Button>

                        <AnimatePresence>
                          {menuOpenId === s.id && (
                            <motion.div
                              initial={{ opacity: 0, scale: 0.9, y: -4 }}
                              animate={{ opacity: 1, scale: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.9, y: -4 }}
                              transition={bounce}
                              className="absolute right-0 top-full mt-1 w-36 rounded-xl border border-border bg-background shadow-md z-20 py-1"
                            >
                              <button
                                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                                onClick={() => {
                                  setMenuOpenId(null);
                                  setEditingId(s.id);
                                  setEditValue(s.title);
                                }}
                              >
                                <Pencil size={14} /> Rename
                              </button>
                              <button
                                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-destructive hover:bg-muted transition-colors"
                                onClick={() => {
                                  setMenuOpenId(null);
                                  setDeletingId(s.id);
                                }}
                              >
                                <Trash2 size={14} /> Delete
                              </button>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    )}

                    <AnimatePresence>
                      {deletingId === s.id && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.9 }}
                          transition={bounce}
                          className="absolute inset-0 rounded-3xl bg-surface/95 flex flex-col items-center justify-center gap-3 z-10"
                        >
                          <p className="text-sm text-muted-foreground">Delete this session?</p>
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => setDeletingId(null)}>
                              Cancel
                            </Button>
                            <Button variant="destructive" size="sm" onClick={() => handleDelete(s.id)}>
                              Delete
                            </Button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                ))}
                <StudySpaces showCreate={showCreateSpace} onCreateVisible={() => setShowCreateSpace(false)} />
              </motion.div>
          </div>
        </div>
        <ProgressiveBlur position="top" backgroundColor="#f0f0f0" />
        <div style={{ opacity: bottomBlurOpacity, transition: "opacity 0.2s" }}>
          <ProgressiveBlur position="bottom" backgroundColor="#f0f0f0" />
        </div>
      </div>
    </div>
  );
}
