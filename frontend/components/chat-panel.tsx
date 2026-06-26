"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { sendMessage } from "@/lib/api";
import { Persona } from "@/components/ai-elements/persona";
import { ThinkingIndicator } from "@/components/ui/thinking-indicator";
import { Plus, Send } from "lucide-react";

interface ChatPanelProps {
  sessionId: number;
  initialMessages: { role: string; content: string }[];
  onVoiceMode?: () => void;
}

export function ChatPanel({ sessionId, initialMessages, onVoiceMode }: ChatPanelProps) {
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPressRef = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: msg }]);
    setLoading(true);

    try {
      const response = await sendMessage(sessionId, msg);
      setMessages((prev) => [...prev, { role: "assistant", content: response }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Failed to get response. Try again." },
      ]);
    } finally {
      setLoading(false);
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

  return (
    <div className="flex flex-col min-h-0 flex-1 overflow-hidden">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
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

      {/* Input bar */}
      <div className="px-3 md:px-5 pb-3 md:pb-5 shrink-0">
        <div className="flex items-center gap-2 md:gap-3">
          <div className="flex-1 flex items-center gap-2 md:gap-3 border rounded-full px-3 md:px-4 py-2.5 md:py-3 bg-white min-w-0">
            <button
              type="button"
              className="hidden md:flex w-8 h-8 rounded-full bg-muted items-center justify-center text-muted-foreground hover:bg-muted/80 transition-colors shrink-0"
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
              disabled={loading || !input.trim()}
              className="w-8 h-8 md:w-9 md:h-9 rounded-full bg-muted flex items-center justify-center text-muted-foreground hover:bg-muted/80 transition-colors disabled:opacity-30 shrink-0"
            >
              <Send size={18} />
            </button>
          </div>

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
