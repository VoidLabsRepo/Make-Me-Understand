"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Persona } from "@/components/ai-elements/persona";
import type { PersonaState } from "@/components/ai-elements/persona";
import { sendVoiceMessage } from "@/lib/api";
import type { WordTiming } from "@/lib/api";

interface VoiceModeProps {
  sessionId: number;
  notes: string;
  onClose: () => void;
}

export function VoiceMode({ sessionId, notes, onClose }: VoiceModeProps) {
  const [personaState, setPersonaState] = useState<PersonaState>("idle");
  const [transcript, setTranscript] = useState("");
  const [aiSubtitle, setAiSubtitle] = useState("");
  const [wordTimings, setWordTimings] = useState<WordTiming[]>([]);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);

  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const transcriptRef = useRef("");
  const abortRef = useRef<AbortController | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const subtitleRef = useRef<HTMLDivElement>(null);

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
      if (el.ontimeupdate !== undefined) el.ontimeupdate = null;
      if (el.onloadedmetadata !== undefined) el.onloadedmetadata = null;
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current.load();
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    setAudioCurrentTime(0);
    setAudioDuration(0);
  }, []);

  const stopAll = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    killAudio();
    abortRef.current?.abort();
    abortRef.current = null;
    setAiSubtitle("");
    setWordTimings([]);
  }, [killAudio]);

  const speakResponse = useCallback(async (question: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setPersonaState("thinking");
      killAudio();
      setAiSubtitle("");
      setWordTimings([]);

      // 1. Fetch LLM response first to get subtitle text & save chat messages
      const { response: responseText, word_timings } = await sendVoiceMessage(sessionId, question);
      if (controller.signal.aborted) return;

      setAiSubtitle(responseText);
      setWordTimings(word_timings);

      // 2. Play TTS passing the pre-generated text (zero additional LLM latency)
      const url = `/api/sessions/${sessionId}/tts?text=${encodeURIComponent(responseText)}`;
      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onplaying = () => {
        if (!controller.signal.aborted) {
          setPersonaState("speaking");
        }
      };

      audio.ontimeupdate = () => {
        if (!controller.signal.aborted) {
          setAudioCurrentTime(audio.currentTime);
        }
      };

      audio.onloadedmetadata = () => {
        if (!controller.signal.aborted) {
          setAudioDuration(audio.duration || 0);
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
    }
    setTranscript("");
    setAiSubtitle("");
    setWordTimings([]);

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

  // Auto-scroll subtitles as words appear
  useEffect(() => {
    if (subtitleRef.current) {
      subtitleRef.current.scrollTop = subtitleRef.current.scrollHeight;
    }
  }, [audioCurrentTime]);

  return (
    <div className="flex flex-col h-full w-full relative">
      <div className="absolute top-3 left-3 z-10">
        <button
          onClick={(e) => { e.stopPropagation(); stopAll(); onClose(); }}
          className="px-4 py-2 rounded-full bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors cursor-pointer"
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

        <div className="pb-16 flex flex-col items-center gap-4 w-full max-w-md">
          {transcript && (
            <div className="text-sm text-muted-foreground text-center px-4 italic">
              "{transcript}"
            </div>
          )}

          {wordTimings.length > 0 && (
            <div ref={subtitleRef} className="bg-transparent border-none shadow-none text-center px-6 max-h-[140px] overflow-y-auto leading-relaxed max-w-lg antialiased tracking-wide text-lg md:text-xl font-medium transition-all duration-300">
              {wordTimings.map((item, idx) => {
                const isSpoken = personaState === "idle" || audioCurrentTime >= item.start;
                return (
                  <span
                    key={idx}
                    className={`inline-block transition-all duration-500 ease-out mr-1.5 ${
                      isSpoken
                        ? "text-slate-800 opacity-100 translate-y-0 scale-100 font-medium"
                        : "opacity-0 translate-y-2 scale-95 pointer-events-none"
                    }`}
                  >
                    {item.word}
                  </span>
                );
              })}
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
