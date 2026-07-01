"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "motion/react";
import { bounce } from "@/lib/animations";
import { Plus, X, FileText, Loader2 } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { listNotes, getNote, createNote, updateNote, deleteNote, type Note } from "@/lib/api";

interface NotesPanelProps {
  sessionId: number;
  refreshTrigger?: number;
  isMobile?: boolean;
  onClose?: () => void;
}

export function NotesPanel({ sessionId, refreshTrigger, isMobile, onClose }: NotesPanelProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeContentLoading, setActiveContentLoading] = useState(false);
  const loadedContentRef = useRef<Set<number>>(new Set());

  const fetchNotes = useCallback(async () => {
    try {
      const data = await listNotes(sessionId);
      setNotes((prev) => {
        const byId = new Map(prev.map((n) => [n.id, n]));
        return data.map((n) => {
          const existing = byId.get(n.id);
          return existing && existing.content !== undefined
            ? { ...n, content: existing.content }
            : n;
        });
      });
      if (data.length > 0 && !data.find((n) => n.id === activeId)) {
        setActiveId(data[0].id);
      }
    } catch (e) {
      console.error("Failed to load notes:", e);
    } finally {
      setLoading(false);
    }
  }, [sessionId, activeId]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  // Re-fetch when parent signals notes changed
  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) {
      fetchNotes();
    }
  }, [refreshTrigger, fetchNotes]);

  const activeNote = notes.find((n) => n.id === activeId);

  // Lazy-load content for the active note if missing
  useEffect(() => {
    if (!activeNote || activeNote.content !== undefined || loadedContentRef.current.has(activeNote.id)) {
      return;
    }
    loadedContentRef.current.add(activeNote.id);
    setActiveContentLoading(true);
    getNote(activeNote.id)
      .then((full) => {
        setNotes((prev) => prev.map((n) => (n.id === full.id ? { ...n, content: full.content } : n)));
      })
      .catch(() => {
        loadedContentRef.current.delete(activeNote.id);
      })
      .finally(() => setActiveContentLoading(false));
  }, [activeNote]);

  // When a note is deleted or unselected, evict its content from the cache
  useEffect(() => {
    const liveIds = new Set(notes.map((n) => n.id));
    for (const id of loadedContentRef.current) {
      if (!liveIds.has(id)) loadedContentRef.current.delete(id);
    }
  }, [notes]);

  const handleAdd = async () => {
    try {
      const note = await createNote(sessionId, "Untitled", "");
      setNotes((prev) => [...prev, note]);
      setActiveId(note.id);
      setEditing(note.id);
      setEditContent("");
    } catch (e) {
      console.error("Failed to create note:", e);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteNote(id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
      if (activeId === id) {
        setActiveId(notes.find((n) => n.id !== id)?.id ?? null);
      }
    } catch (e) {
      console.error("Failed to delete note:", e);
    }
  };

  const handleSave = async (id: number) => {
    const note = notes.find((n) => n.id === id);
    if (!note) return;
    try {
      await updateNote(id, { content: editContent });
      setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, content: editContent } : n)));
      setEditing(null);
    } catch (e) {
      console.error("Failed to save note:", e);
    }
  };

  const handleTitleBlur = async (id: number, title: string) => {
    if (!title.trim()) return;
    try {
      await updateNote(id, { title });
      setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, title } : n)));
    } catch (e) {
      console.error("Failed to rename note:", e);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Loading notes...
      </div>
    );
  }

  const content = (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div className="flex items-center gap-1 px-3 py-2 border-b overflow-x-auto shrink-0">
        {notes.map((note) => (
          <button
            key={note.id}
            onClick={() => {
              setActiveId(note.id);
              setEditing(null);
            }}
            className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-t-md border-b-2 transition-colors shrink-0 ${
              activeId === note.id
                ? "border-foreground text-foreground bg-white"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            <FileText size={12} />
            <EditableTitle
              title={note.title}
              isActive={activeId === note.id}
              onBlur={(t) => handleTitleBlur(note.id, t)}
            />
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(note.id);
              }}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity ml-0.5"
            >
              <X size={12} />
            </span>
          </button>
        ))}
        <motion.button
          onClick={handleAdd}
          whileTap={{ scale: 0.85 }}
          transition={bounce}
          className="flex items-center justify-center size-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted shrink-0"
        >
          <Plus size={14} />
        </motion.button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeNote ? (
          editing === activeNote.id ? (
            <div className="h-full flex flex-col gap-2">
              <textarea
                autoFocus
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="flex-1 w-full resize-none rounded-lg border bg-white p-3 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-foreground"
              />
              <div className="flex gap-2 justify-end">
                <motion.button
                  onClick={() => setEditing(null)}
                  whileTap={{ scale: 0.9 }}
                  transition={bounce}
                  className="px-3 py-1 text-xs rounded-md border hover:bg-muted"
                >
                  Cancel
                </motion.button>
                <motion.button
                  onClick={() => handleSave(activeNote.id)}
                  whileTap={{ scale: 0.9 }}
                  transition={bounce}
                  className="px-3 py-1 text-xs rounded-md bg-foreground text-white hover:bg-foreground/90"
                >
                  Save
                </motion.button>
              </div>
            </div>
          ) : (
            <div
              onDoubleClick={() => {
                if (activeNote.content === undefined) return;
                setEditing(activeNote.id);
                setEditContent(activeNote.content);
              }}
              className="cursor-text min-h-full"
            >
              {activeContentLoading || activeNote.content === undefined ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 size={16} className="animate-spin" />
                </div>
              ) : activeNote.content ? (
                <div className="text-sm leading-relaxed
                  [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mt-6 [&_h1]:mb-2
                  [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:border-b [&_h2]:pb-1 [&_h2]:border-muted
                  [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-1.5
                  [&_p]:my-2.5 [&_p]:leading-relaxed
                  [&_ul]:my-2 [&_ul]:pl-5 [&_ul]:list-disc
                  [&_ol]:my-2 [&_ol]:pl-5 [&_ol]:list-decimal
                  [&_li]:my-1 [&_li]:leading-relaxed
                  [&_strong]:font-semibold
                  [&_hr]:my-4 [&_hr]:border-muted
                  [&_blockquote]:my-3 [&_blockquote]:pl-3 [&_blockquote]:border-l-2 [&_blockquote]:border-muted [&_blockquote]:text-muted-foreground
                  [&_code]:text-xs [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded
                  [&_pre]:my-3 [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto
                ">
                  <Markdown remarkPlugins={[remarkGfm]}>{activeNote.content}</Markdown>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm italic">
                  Double-click to start writing...
                </p>
              )}
            </div>
          )
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3">
            <FileText size={32} strokeWidth={1} />
            <p className="text-sm">No notes yet</p>
            <motion.button
              onClick={handleAdd}
              whileTap={{ scale: 0.9 }}
              transition={bounce}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border hover:bg-muted"
            >
              <Plus size={12} /> Add Note
            </motion.button>
          </div>
        )}
      </div>
    </div>
  );

  if (isMobile) {
    return content;
  }

  return content;
}

function EditableTitle({
  title,
  isActive,
  onBlur,
}: {
  title: string;
  isActive: boolean;
  onBlur: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);

  if (!isActive) return <span className="truncate max-w-[100px]">{title}</span>;

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (value.trim() && value !== title) onBlur(value.trim());
          else setValue(title);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="w-20 text-xs bg-transparent border-b outline-none truncate"
        onClick={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <span
      className="truncate max-w-[100px]"
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
    >
      {title}
    </span>
  );
}
