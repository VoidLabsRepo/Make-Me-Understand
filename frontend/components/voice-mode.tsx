"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { generateTTS } from "@/lib/api";
import { Persona } from "@/components/ai-elements/persona";
import type { PersonaState } from "@/components/ai-elements/persona";

interface VoiceModeProps {
  sessionId: number;
  notes: string;
  onClose: () => void;
}

// ponytail: minimal markdown strip for voice output
const stripMd = (s: string) => s.replace(/[#*_~`>|]/g, "").replace(/\n{2,}/g, "\n").trim();

export function VoiceMode({ sessionId, notes, onClose }: VoiceModeProps) {
  const [personaState, setPersonaState] = useState<PersonaState>("idle");
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [response, setResponse] = useState("");
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) recognitionRef.current.stop();
      if (audioRef.current) audioRef.current.pause();
    };
  }, []);

  const speakResponse = async (question: string) => {
    try {
      const blob = await generateTTS(sessionId, question);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;

      setPersonaState("speaking");

      audio.onended = () => {
        URL.revokeObjectURL(url);
        setPersonaState("idle");
      };

      audio.onerror = () => {
        URL.revokeObjectURL(url);
        setPersonaState("idle");
      };

      const res = await fetch(
        `/api/sessions/${sessionId}/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: question }),
        }
      );
      if (res.ok) {
        const data = await res.json();
        setResponse(stripMd(data.response));
      }

      audio.play();
    } catch {
      setPersonaState("idle");
    }
  };

  const startListening = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      setIsListening(true);
      setPersonaState("listening");
      setTranscript("");
      setResponse("");
    };

    recognition.onresult = (event: any) => {
      const result = Array.from(event.results)
        .map((r: any) => r[0].transcript)
        .join("");
      setTranscript(result);
    };

    recognition.onend = async () => {
      setIsListening(false);
      setPersonaState("thinking");

      if (transcript) {
        await speakResponse(transcript);
      } else {
        setPersonaState("idle");
      }
    };

    recognition.onerror = () => {
      setIsListening(false);
      setPersonaState("idle");
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [transcript]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const handleToggle = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  return (
    <div className="flex flex-col h-full w-full relative">
      <div className="absolute top-3 left-3 z-10">
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="px-4 py-2 rounded-full bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors"
        >
          Close
        </button>
      </div>

      <div
        className="flex-1 flex flex-col items-center justify-center cursor-pointer select-none"
        onMouseDown={handleToggle}
        onTouchStart={(e) => {
          e.preventDefault();
          handleToggle();
        }}
      >
      <div className="flex-1 flex items-center justify-center">
        <Persona variant="halo" state={personaState} className="size-64" forceColor={[0, 0, 0]} />
      </div>

      <div className="pb-16 flex flex-col items-center gap-3 w-full max-w-md">
        {transcript && (
          <div className="text-sm text-muted-foreground text-center px-4">
            {transcript}
          </div>
        )}
        {response && (
          <div className="text-sm text-center px-4 max-h-32 overflow-y-auto">
            {response}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {personaState === "listening"
            ? "Listening..."
            : personaState === "thinking"
              ? "Thinking..."
              : personaState === "speaking"
                ? "Speaking..."
                : "Tap to ask a question"}
        </p>
      </div>
      </div>
    </div>
  );
}
