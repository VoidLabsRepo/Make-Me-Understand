"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { getSession, type Session } from "@/lib/api";
import { ChatPanel } from "@/components/chat-panel";
import { NotesPanel } from "@/components/notes-panel";
import { VoiceMode } from "@/components/voice-mode";
import { MatrixLoader } from "@/components/matrix-loader";
import { SidebarToggleIcon } from "@/components/unlumen-ui/sidebar-toggle-icon";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

const panelVariants = {
  hidden: {
    width: 0,
    opacity: 0,
    scale: 0.95,
    x: 40,
  },
  visible: {
    width: "40%",
    opacity: 1,
    scale: 1,
    x: 0,
    transition: {
      type: "spring" as const,
      stiffness: 300,
      damping: 24,
      mass: 0.8,
      opacity: { duration: 0.25, ease: "easeOut" as const },
    },
  },
  exit: {
    width: 0,
    opacity: 0,
    scale: 0.95,
    x: 40,
    transition: {
      type: "spring" as const,
      stiffness: 400,
      damping: 30,
      mass: 0.6,
      opacity: { duration: 0.2, ease: "easeIn" as const },
    },
  },
};

const mobilePanelVariants = {
  hidden: { y: "100%", opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: { type: "spring" as const, stiffness: 300, damping: 30 },
  },
  exit: {
    y: "100%",
    opacity: 0,
    transition: { type: "spring" as const, stiffness: 400, damping: 35 },
  },
};

const chatVariants = {
  wide: { flex: 1, transition: { type: "spring" as const, stiffness: 300, damping: 24 } },
  full: { flex: 1, transition: { type: "spring" as const, stiffness: 300, damping: 24 } },
};

const contentVariants = {
  hidden: { opacity: 0, y: 12, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: "spring" as const,
      stiffness: 400,
      damping: 25,
      delay: 0.1,
    },
  },
  exit: {
    opacity: 0,
    y: -8,
    scale: 0.98,
    transition: { duration: 0.15 },
  },
};

function MobileNotesPanel({ sessionId, refreshTrigger, onClose }: { sessionId: number; refreshTrigger?: number; onClose: () => void }) {
  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/30 z-40"
      />
      <motion.aside
        variants={mobilePanelVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="fixed inset-x-0 bottom-0 top-12 bg-white rounded-t-2xl border-t overflow-hidden flex flex-col z-50"
      >
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h2 className="text-base font-medium text-muted-foreground">Notes</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <SidebarToggleIcon isOpen={true} className="size-5" />
          </button>
        </div>
        <NotesPanel sessionId={sessionId} refreshTrigger={refreshTrigger} />
      </motion.aside>
    </>
  );
}

function DesktopNotesPanel({ sessionId, refreshTrigger, delay = 0 }: { sessionId: number; refreshTrigger?: number; delay?: number }) {
  return (
    <motion.aside
      variants={panelVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="shrink-0 bg-white rounded-2xl border overflow-hidden flex flex-col min-w-0"
    >
      <motion.div
        variants={contentVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        transition={{ delay }}
        className="h-full flex flex-col"
      >
        <div className="px-5 py-4 border-b">
          <h2 className="text-base font-medium text-muted-foreground">Notes</h2>
        </div>
        <NotesPanel sessionId={sessionId} refreshTrigger={refreshTrigger} />
      </motion.div>
    </motion.aside>
  );
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return isMobile;
}

export default function SessionPage() {
  const params = useParams();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [voiceMode, setVoiceMode] = useState(false);
  const [notesOpen, setNotesOpen] = useState(true);
  const [notesRefresh, setNotesRefresh] = useState(0);
  const isMobile = useIsMobile();

  useEffect(() => {
    const id = Number(params.id);
    if (!id) return;
    getSession(id)
      .then(setSession)
      .catch(() => router.push("/"));
  }, [params.id, router]);

  const closeNotes = useCallback(() => setNotesOpen(false), []);

  const handleNoteChange = useCallback(() => {
    setNotesRefresh((n) => n + 1);
  }, []);

  const handleNotesUpdated = useCallback((notes: string | null) => {
    setSession((prev) => prev ? { ...prev, notes } : prev);
  }, []);

  if (!session) {
    return (
      <div className="h-dvh flex items-center justify-center">
        <MatrixLoader />
      </div>
    );
  }

  if (voiceMode) {
    return (
      <div className="h-dvh bg-[#f0f0f0] flex flex-col overflow-hidden font-sans">
        <header className="h-12 flex items-center px-4 md:px-5 shrink-0 gap-3">
          <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <div className="flex-1" />
          <button
            onClick={() => setNotesOpen(!notesOpen)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <SidebarToggleIcon isOpen={notesOpen} className="size-6" />
          </button>
        </header>
        <div className="flex-1 flex gap-3 md:gap-5 overflow-hidden px-3 md:px-5 pb-3 md:pb-5">
          <div className="flex-1 min-w-0">
            <VoiceMode sessionId={session.id} notes={session.notes || ""} onClose={() => setVoiceMode(false)} onNoteChange={handleNoteChange} />
          </div>
          <AnimatePresence mode="popLayout">
            {notesOpen && (
              isMobile ? (
                <MobileNotesPanel sessionId={session.id} refreshTrigger={notesRefresh} onClose={closeNotes} />
              ) : (
                <DesktopNotesPanel sessionId={session.id} refreshTrigger={notesRefresh} />
              )
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  return (
    <div className="h-dvh bg-[#f0f0f0] flex flex-col overflow-hidden font-sans">
      <header className="h-12 flex items-center px-4 md:px-5 shrink-0 gap-3">
        <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft size={18} />
        </Link>
        <div className="flex-1" />
        <button
          onClick={() => setNotesOpen(!notesOpen)}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <SidebarToggleIcon isOpen={notesOpen} className="size-6" />
        </button>
      </header>

      <div className="flex-1 flex gap-3 md:gap-5 overflow-hidden px-3 md:px-5 pb-3 md:pb-5">
        {/* Chat area */}
        <motion.div
          layout
          variants={chatVariants}
          animate={notesOpen && !isMobile ? "wide" : "full"}
          className="min-w-0 min-h-0 bg-white rounded-2xl border overflow-hidden flex flex-col"
        >
          <ChatPanel
            sessionId={session.id}
            initialMessages={session.messages || []}
            onVoiceMode={() => setVoiceMode(true)}
            onNotesUpdated={handleNotesUpdated}
            onNoteChange={handleNoteChange}
          />
        </motion.div>

        {/* Notes panel */}
        <AnimatePresence mode="popLayout">
          {notesOpen && (
            isMobile ? (
              <MobileNotesPanel sessionId={session.id} refreshTrigger={notesRefresh} onClose={closeNotes} />
            ) : (
              <DesktopNotesPanel sessionId={session.id} refreshTrigger={notesRefresh} />
            )
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
