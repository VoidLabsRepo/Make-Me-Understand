"use client";

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, AlertCircle, Upload } from "lucide-react";

interface NotesSidebarProps {
  notes: string | null;
}

export function NotesSidebar({ notes }: NotesSidebarProps) {
  if (notes === null) {
    return (
      <div className="p-8 flex flex-col items-center justify-center text-center space-y-4 h-full">
        <Loader2 className="animate-spin text-muted-foreground" size={32} />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">AI is reading your study material...</p>
          <p className="text-xs text-muted-foreground max-w-[200px]">
            Extracting text and generating structured study notes.
          </p>
        </div>
      </div>
    );
  }

  if (notes === "") {
    return (
      <div className="p-8 flex flex-col items-center justify-center text-center space-y-4 h-full">
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
          <Upload size={20} />
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-foreground">No study notes generated yet</p>
          <p className="text-xs text-muted-foreground max-w-[220px] mx-auto leading-normal">
            You can type your queries here or upload images in the chat bar below to automatically build study notes!
          </p>
        </div>
      </div>
    );
  }

  if (notes.startsWith("ERROR:")) {
    const errorDetails = notes.replace("ERROR:", "").trim();
    return (
      <div className="p-6 flex flex-col h-full overflow-y-auto justify-center">
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-center space-y-4">
          <div className="mx-auto w-10 h-10 rounded-full bg-red-100 flex items-center justify-center text-red-600">
            <AlertCircle size={20} />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-medium text-red-800">Processing Failed</h3>
            <p className="text-xs text-red-600 max-w-xs mx-auto">
              {errorDetails || "An unexpected error occurred while analyzing the files."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-5 overflow-y-auto h-full chat-markdown">
      <Markdown remarkPlugins={[remarkGfm]}>{notes}</Markdown>
    </div>
  );
}
