"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Persona } from "@/components/ai-elements/persona";
import type { PersonaState } from "@/components/ai-elements/persona";

interface VoiceModeProps {
  sessionId: number;
  notes: string;
  onClose: () => void;
}

export function VoiceMode({ sessionId, notes, onClose }: VoiceModeProps) {
  const [personaState, setPersonaState] = useState<PersonaState>("idle");
  const [transcript, setTranscript] = useState("");
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const transcriptRef = useRef("");
  const abortRef = useRef<AbortController | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Get or create a shared AudioContext (unlocked on user gesture)
  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
  }, []);

  // Unlock audio on user gesture — play a silent buffer so future play() calls succeed
  const unlockAudio = useCallback(() => {
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    // Play a tiny silent buffer to fully unlock the context
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start();
  }, [getAudioCtx]);

  const killAudio = useCallback(() => {
    if (audioRef.current) {
      // Null handlers BEFORE clearing source — otherwise setting src="" and
      // calling load() fires onerror, which triggers the Web Audio fallback
      // and re-plays the same audio (the "repeating" bug on interrupt).
      const el = audioRef.current as any;
      if (el.onended !== undefined) el.onended = null;
      if (el.onerror !== undefined) el.onerror = null;
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current.load();
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }, []);

  const stopAll = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    killAudio();
    abortRef.current?.abort();
    abortRef.current = null;
  }, [killAudio]);

  // Fallback: decode and play via Web Audio API (bypasses autoplay restrictions
  // because AudioContext was unlocked during the original user gesture)
  const playViaWebAudio = useCallback(async (blob: Blob) => {
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") await ctx.resume();
    const arrayBuf = await blob.arrayBuffer();
    const audioBuf = await ctx.decodeAudioData(arrayBuf);
    const source = ctx.createBufferSource();
    source.buffer = audioBuf;
    source.connect(ctx.destination);
    source.onended = () => {
      setPersonaState("idle");
    };
    source.start();
    // Store a kill handle — null onended before stopping so it doesn't
    // race with the new state when we interrupt intentionally
    audioRef.current = {
      pause: () => {
        try { source.onended = null; source.stop(); source.disconnect(); } catch {}
      },
      src: "",
      load: () => {},
    } as any;
  }, [getAudioCtx]);

  const speakResponse = useCallback(async (question: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setPersonaState("thinking");
      killAudio();

      const url = `/api/sessions/${sessionId}/tts?question=${encodeURIComponent(question)}`;
      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onplaying = () => {
        if (!controller.signal.aborted) {
          setPersonaState("speaking");
        }
      };

      audio.onended = () => {
        killAudio();
        setPersonaState("idle");
      };

      audio.onerror = () => {
        killAudio();
        setPersonaState("idle");
      };

      await audio.play();
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setPersonaState("idle");
      }
    }
  }, [sessionId, killAudio]);

  const startListening = useCallback(() => {
    if (personaState === "speaking" || personaState === "thinking") {
      stopAll();
      setTranscript("");
    }

    // Unlock audio on the user gesture so playback later succeeds
    unlockAudio();

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      setPersonaState("listening");
      setTranscript("");
      transcriptRef.current = "";
    };

    recognition.onresult = (event: any) => {
      const result = Array.from(event.results)
        .map((r: any) => r[0].transcript)
        .join("");
      setTranscript(result);
      transcriptRef.current = result;
    };

    recognition.onend = () => {
      const q = transcriptRef.current.trim();
      if (q) {
        speakResponse(q);
      } else {
        setPersonaState("idle");
      }
    };

    recognition.onerror = () => {
      setPersonaState("idle");
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [personaState, stopAll, speakResponse, unlockAudio]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const handleDown = useCallback(() => {
    startListening();
  }, [startListening]);

  const handleUp = useCallback(() => {
    stopListening();
  }, [stopListening]);

  useEffect(() => {
    return () => {
      stopAll();
      audioCtxRef.current?.close().catch(() => {});
    };
  }, [stopAll]);

  return (
    <div className="flex flex-col h-full w-full relative">
      <div className="absolute top-3 left-3 z-10">
        <button
          onClick={(e) => { e.stopPropagation(); stopAll(); onClose(); }}
          className="px-4 py-2 rounded-full bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors"
        >
          Close
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center select-none">
        <div
          className="flex items-center justify-center cursor-pointer"
          onMouseDown={handleDown}
          onMouseUp={handleUp}
          onMouseLeave={handleUp}
          onTouchStart={handleDown}
          onTouchEnd={handleUp}
        >
          <Persona variant="halo" state={personaState} className="size-64" forceColor={[0, 0, 0]} />
        </div>

        <div className="pb-16 flex flex-col items-center gap-3 w-full max-w-md">
          {transcript && (
            <div className="text-sm text-muted-foreground text-center px-4">
              {transcript}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {personaState === "listening"
              ? "Listening... release to send"
              : personaState === "thinking"
                ? "Thinking..."
                : personaState === "speaking"
                  ? "Speaking... hold to interrupt"
                  : "Hold to speak"}
          </p>
        </div>
      </div>
    </div>
  );
}
