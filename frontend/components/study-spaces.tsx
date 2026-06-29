"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { bounce } from "@/lib/animations";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import {
  listStudySpaces,
  createStudySpace,
  renameStudySpace,
  deleteStudySpace,
  type StudySpace,
} from "@/lib/api";
import { StudyFolder } from "@/components/study-folder";

export function StudySpaces({ onCreated, showCreate, onCreateVisible }: { onCreated?: () => void; showCreate?: boolean; onCreateVisible?: () => void }) {
  const [spaces, setSpaces] = useState<StudySpace[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [showInput, setShowInput] = useState(false);

  // Sync with parent trigger
  useEffect(() => {
    if (showCreate) {
      setShowInput(true);
      onCreateVisible?.();
    }
  }, [showCreate, onCreateVisible]);
  const [menuSpaceId, setMenuSpaceId] = useState<number | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);

  const fetchSpaces = useCallback(async () => {
    try {
      const data = await listStudySpaces();
      setSpaces(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSpaces();
  }, [fetchSpaces]);

  // Close menu on outside click
  useEffect(() => {
    if (menuSpaceId === null) return;
    const handle = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuSpaceId(null);
      }
    };
    document.addEventListener("mousedown", handle);
    document.addEventListener("touchstart", handle);
    return () => {
      document.removeEventListener("mousedown", handle);
      document.removeEventListener("touchstart", handle);
    };
  }, [menuSpaceId]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const space = await createStudySpace(name);
      setSpaces((prev) => [{ ...space, session_count: 0, sessions: [] }, ...prev]);
      setNewName("");
      setShowInput(false);
      onCreated?.();
    } catch {
      // ignore
    } finally {
      setCreating(false);
    }
  };

  const handleRename = async (id: number) => {
    const name = renameValue.trim();
    if (!name) return;
    try {
      await renameStudySpace(id, name);
      setSpaces((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)));
    } catch {
      // ignore
    } finally {
      setRenamingId(null);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteStudySpace(id);
      setSpaces((prev) => prev.filter((s) => s.id !== id));
    } catch {
      // ignore
    } finally {
      setDeletingId(null);
    }
  };

  const handleContextMenu = useCallback((e: React.MouseEvent, spaceId: number) => {
    e.preventDefault();
    setMenuSpaceId(spaceId);
  }, []);

  const handlePointerDown = useCallback((spaceId: number) => {
    didLongPress.current = false;
    pressTimer.current = setTimeout(() => {
      didLongPress.current = true;
      setMenuSpaceId(spaceId);
    }, 500);
  }, []);

  const handlePointerUp = useCallback(() => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 size={14} className="animate-spin" />
      </div>
    );
  }

  return (
    <>
      {spaces.map((space) => (
        <div key={space.id} className="relative">
          <motion.div whileTap={{ scale: 0.98 }} transition={bounce}>
            <Link
              href={`/spaces/${space.id}`}
              className="group relative flex flex-col items-center justify-between h-64 select-none p-5 hover:opacity-80"
              onContextMenu={(e) => handleContextMenu(e, space.id)}
              onPointerDown={() => handlePointerDown(space.id)}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onPointerLeave={handlePointerUp}
              onClick={(e) => {
                if (didLongPress.current) {
                  e.preventDefault();
                  didLongPress.current = false;
                }
              }}
            >
            <div />
            <div className="flex-1 flex items-center justify-center">
              <StudyFolder sessions={space.sessions} />
            </div>
            {renamingId === space.id ? (
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename(space.id);
                  if (e.key === "Escape") setRenamingId(null);
                }}
                onBlur={() => handleRename(space.id)}
                className="font-medium text-sm text-center bg-transparent border-b border-foreground outline-none w-full"
              />
            ) : (
              <span className="font-medium text-sm">{space.name}</span>
            )}
          </Link>
          </motion.div>

          {/* Context menu */}
          <AnimatePresence>
            {menuSpaceId === space.id && (
              <motion.div
                ref={menuRef}
                initial={{ opacity: 0, scale: 0.9, y: 4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 4 }}
                transition={bounce}
                className="absolute right-0 bottom-full mb-2 w-36 rounded-xl border border-border bg-background shadow-md z-30 py-1"
              >
                <button
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                  onClick={() => {
                    setMenuSpaceId(null);
                    setRenamingId(space.id);
                    setRenameValue(space.name);
                  }}
                >
                  <Pencil size={14} /> Rename
                </button>
                <button
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-destructive hover:bg-muted transition-colors"
                  onClick={() => {
                    setMenuSpaceId(null);
                    setDeletingId(space.id);
                  }}
                >
                  <Trash2 size={14} /> Delete
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Delete confirm */}
          <AnimatePresence>
            {deletingId === space.id && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={bounce}
                className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-20 bg-background/95 rounded-lg"
              >
                <p className="text-sm text-muted-foreground">Delete this space?</p>
                <div className="flex gap-2">
                  <motion.button
                    onClick={() => setDeletingId(null)}
                    whileTap={{ scale: 0.9 }}
                    transition={bounce}
                    className="px-3 py-1 text-xs rounded-lg border hover:bg-muted"
                  >
                    Cancel
                  </motion.button>
                  <motion.button
                    onClick={() => handleDelete(space.id)}
                    whileTap={{ scale: 0.9 }}
                    transition={bounce}
                    className="px-3 py-1 text-xs rounded-lg bg-destructive text-white hover:bg-destructive/90"
                  >
                    Delete
                  </motion.button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}

      <AnimatePresence>
        {showInput && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={bounce}
            className="flex flex-col h-64 p-5"
          >
            <div className="flex-1 flex flex-col justify-center">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") setShowInput(false);
                }}
                placeholder="Space name..."
                className="text-sm bg-muted/50 rounded-xl px-4 py-2.5 outline-none focus:ring-1 focus:ring-foreground/20 placeholder:text-muted-foreground mb-3"
              />
            </div>
            <div className="flex gap-2">
              <motion.button
                onClick={handleCreate}
                disabled={!newName.trim() || creating}
                whileTap={{ scale: 0.95 }}
                transition={bounce}
                className="flex-1 py-2 rounded-xl bg-foreground text-background text-sm font-medium disabled:opacity-30"
              >
                {creating ? <Loader2 size={14} className="animate-spin mx-auto" /> : "Create"}
              </motion.button>
              <motion.button
                onClick={() => setShowInput(false)}
                whileTap={{ scale: 0.95 }}
                transition={bounce}
                className="px-4 py-2 rounded-xl border text-sm text-muted-foreground hover:bg-muted"
              >
                Cancel
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
