"use client";

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface NotesSidebarProps {
  notes: string | null;
}

export function NotesSidebar({ notes }: NotesSidebarProps) {
  if (!notes) {
    return (
      <div className="p-5 text-base text-muted-foreground">
        Notes will appear after processing your images.
      </div>
    );
  }

  return (
    <div className="p-5 overflow-y-auto h-full chat-markdown">
      <Markdown remarkPlugins={[remarkGfm]}>{notes}</Markdown>
    </div>
  );
}
