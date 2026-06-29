"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { sendMessage, appendImages } from "@/lib/api";
import { Persona } from "@/components/ai-elements/persona";
import { ThinkingIndicator } from "@/components/ui/thinking-indicator";
import { ProgressiveBlur } from "@/components/ui/skiper-ui/skiper41";
import { Plus, Send, Paperclip, Image as ImageIcon, X, Loader2 } from "lucide-react";

interface ChatPanelProps {
  sessionId: number;
  initialMessages: { role: string; content: string }[];
  onVoiceMode?: () => void;
  onNotesUpdated?: (notes: string | null) => void;
  onNoteChange?: () => void;
}

interface ImageAttachment {
  file: File;
  preview: string;
}

export function ChatPanel({ sessionId, initialMessages, onVoiceMode, onNotesUpdated, onNoteChange }: ChatPanelProps) {
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollOpacity, setScrollOpacity] = useState(0);
  const recognitionRef = useRef<any>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPressRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop } = scrollRef.current;
    const maxScroll = 80;
    setScrollOpacity(Math.min(1, scrollTop / maxScroll));
  }, []);

  // Cleanup previews on unmount
  useEffect(() => {
    return () => {
      attachments.forEach((a) => URL.revokeObjectURL(a.preview));
    };
  }, []);

  const addFiles = useCallback((files: FileList | File[]) => {
    const newAttachments: ImageAttachment[] = Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .map((file) => ({
        file,
        preview: URL.createObjectURL(file),
      }));
    if (newAttachments.length > 0) {
      setAttachments((prev) => [...prev, ...newAttachments]);
      setExpanded(false); // collapse toolbar after selecting
    }
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => {
      URL.revokeObjectURL(prev[index].preview);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments((prev) => {
      prev.forEach((a) => URL.revokeObjectURL(a.preview));
      return [];
    });
  }, []);

  const handleSend = async (text?: string) => {
    const msg = (text ?? input).trim();
    const hasImages = attachments.length > 0;

    if (!msg && !hasImages) return;
    if (loading) return;

    // If there are images, upload them for persistent context
    if (hasImages) {
      const imagesToUpload = attachments.map((a) => a.file);
      setUploading(true);
      clearAttachments();

      // Fire and forget — extracts text and stores permanently
      appendImages(sessionId, imagesToUpload)
        .then(() => {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: `📸 **${imagesToUpload.length} image${imagesToUpload.length > 1 ? "s" : ""} uploaded** — I've read and remembered the content. Ask me anything about it!`,
            },
          ]);
        })
        .catch(() => {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: "Failed to upload images. Try again." },
          ]);
        })
        .finally(() => setUploading(false));
    }

    // If there's also a text message, send it as chat
    if (msg) {
      setInput("");
      setMessages((prev) => [...prev, { role: "user", content: msg }]);
      setLoading(true);

      try {
        const data = await sendMessage(sessionId, msg);
        setMessages((prev) => [...prev, { role: "assistant", content: data.response }]);
        if (data.note_changes?.length) {
          onNoteChange?.();
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Failed to get response. Try again." },
        ]);
      } finally {
        setLoading(false);
      }
    }
  };

  const startRecording = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setInput(transcript);
    };

    recognition.onend = () => {
      setRecording(false);
      recognitionRef.current = null;
    };

    recognition.onerror = () => {
      setRecording(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    recognition.start();
    setRecording(true);
  }, []);

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  }, []);

  const handleHaloDown = useCallback(() => {
    didLongPressRef.current = false;
    pressTimerRef.current = setTimeout(() => {
      didLongPressRef.current = true;
      startRecording();
    }, 300);
  }, [startRecording]);

  const handleHaloUp = useCallback(() => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    if (didLongPressRef.current) {
      stopRecording();
      didLongPressRef.current = false;
    } else {
      onVoiceMode?.();
    }
  }, [stopRecording, onVoiceMode]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) recognitionRef.current.abort();
      if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    };
  }, []);

  const hasContent = input.trim() || attachments.length > 0;

  return (
    <div className="flex flex-col min-h-0 flex-1 overflow-hidden">
      {/* Messages */}
      <div className="relative flex-1 overflow-hidden">
        <div ref={scrollRef} onScroll={handleScroll} className="absolute inset-0 overflow-y-auto p-4 md:p-6 space-y-4">
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full text-muted-foreground text-base">
              Ask anything about your study material
            </div>
          )}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[75%] rounded-2xl px-5 py-3 text-[15px] leading-relaxed ${
                  msg.role === "user"
                    ? "bg-foreground text-background"
                    : "bg-muted"
                }`}
              >
                {msg.role === "assistant" ? (
                  <div className="chat-markdown">
                    <Markdown remarkPlugins={[remarkGfm]}>{msg.content}</Markdown>
                  </div>
                ) : (
                  msg.content
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start py-2">
              <ThinkingIndicator />
            </div>
          )}
          <div ref={bottomRef} />
        </div>
        <div style={{ opacity: scrollOpacity }} className="pointer-events-none transition-opacity duration-150">
          <ProgressiveBlur position="top" backgroundColor="#f0f0f0" />
        </div>
      </div>

      {/* Input area */}
      <div className="px-3 md:px-5 pb-3 md:pb-5 shrink-0">
        {/* Image attachment thumbnails */}
        {attachments.length > 0 && (
          <div className="flex gap-2 mb-2 px-1 overflow-x-auto pb-1">
            {attachments.map((att, i) => (
              <div key={i} className="relative shrink-0 group">
                <img
                  src={att.preview}
                  alt={att.file.name}
                  className="w-16 h-16 md:w-20 md:h-20 rounded-xl object-contain bg-muted border border-border/50"
                />
                <button
                  onClick={() => removeAttachment(i)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Uploading indicator */}
        {uploading && (
          <div className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded-lg bg-blue-50 text-blue-600 text-xs font-medium">
            <Loader2 size={12} className="animate-spin" />
            Processing images & updating notes...
          </div>
        )}

        <div className="flex items-center gap-2 md:gap-3">
          <div className={`flex-1 flex flex-col border rounded-2xl bg-white min-w-0 transition-all ${expanded ? "rounded-2xl" : "rounded-full"}`}>
            {/* Expanded toolbar */}
            {expanded && (
              <div className="flex items-center gap-1 px-3 pt-2.5 pb-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:bg-muted/60 transition-colors"
                >
                  <Plus size={14} />
                  Attach files
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted/60 transition-colors"
                >
                  <ImageIcon size={16} />
                </button>
              </div>
            )}

            <div className={`flex items-center gap-2 md:gap-3 px-3 md:px-4 ${expanded ? "py-2" : "py-2.5 md:py-3"}`}>
              <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className={`hidden md:flex w-8 h-8 rounded-full items-center justify-center text-muted-foreground transition-all shrink-0 ${
                  expanded
                    ? "bg-foreground text-background rotate-45"
                    : "bg-muted hover:bg-muted/80"
                }`}
              >
                <Plus size={18} />
              </button>
              {/* Mobile: direct file trigger */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="md:hidden flex w-8 h-8 rounded-full bg-muted items-center justify-center text-muted-foreground hover:bg-muted/80 transition-colors shrink-0"
              >
                <Plus size={18} />
              </button>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                placeholder={recording ? "Listening..." : "Ask anything..."}
                disabled={loading}
                className="flex-1 min-w-0 bg-transparent outline-none text-sm md:text-base placeholder:text-muted-foreground"
              />
              <button
                onClick={() => handleSend()}
                disabled={loading || !hasContent}
                className="w-8 h-8 md:w-9 md:h-9 rounded-full bg-muted flex items-center justify-center text-muted-foreground hover:bg-muted/80 transition-colors disabled:opacity-30 shrink-0"
              >
                <Send size={18} />
              </button>
            </div>
          </div>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />

          {/* Halo: tap = voice mode, long press = push-to-talk */}
          <button
            onMouseDown={handleHaloDown}
            onMouseUp={handleHaloUp}
            onMouseLeave={handleHaloUp}
            onTouchStart={handleHaloDown}
            onTouchEnd={handleHaloUp}
            className={`w-10 h-10 md:w-12 md:h-12 rounded-xl border bg-white flex items-center justify-center transition-all shrink-0 select-none active:scale-95 ${
              recording
                ? "border-red-400 bg-red-50 shadow-[0_0_12px_rgba(239,68,68,0.25)]"
                : "hover:bg-muted"
            }`}
          >
            <Persona
              variant="halo"
              state={recording ? "listening" : "idle"}
              className="!size-6 md:!size-8"
            />
          </button>
        </div>
      </div>
    </div>
  );
}
