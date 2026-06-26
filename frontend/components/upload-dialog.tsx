"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Upload, X, Loader2, Check, AlertTriangle, AlertCircle } from "lucide-react";
import { createSession } from "@/lib/api";
import { useRouter } from "next/navigation";

type UploadStep = "idle" | "uploading" | "extracting" | "synthesizing" | "done";

const STEPS: { key: UploadStep; label: string }[] = [
  { key: "uploading", label: "Uploading images..." },
  { key: "extracting", label: "Extracting text from images..." },
  { key: "synthesizing", label: "AI synthesizing notes..." },
];

export function UploadDialog() {
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<UploadStep>("idle");
  const [open, setOpen] = useState(false);
  const [showConfirmCancel, setShowConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const router = useRouter();

  const onDrop = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    setFiles((prev) => [...prev, ...selected]);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (!files.length) return;
    setLoading(true);
    setStep("uploading");
    setShowConfirmCancel(false);
    setError(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const session = await createSession(
        files,
        (currentStep) => {
          setStep(currentStep);
        },
        controller.signal
      );
      setStep("done");
      setTimeout(() => {
        setOpen(false);
        setFiles([]);
        setStep("idle");
        router.push(`/session/${session.id}`);
      }, 600);
    } catch (err: any) {
      if (err.name === "AbortError") {
        console.log("Upload aborted by user.");
      } else {
        console.error(err);
        setError(err.message || "Failed to create session. Please check your connection.");
      }
      setStep("idle");
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleSkipUpload = async () => {
    setLoading(true);
    setError(null);
    try {
      const session = await createSession([], undefined, undefined);
      setOpen(false);
      resetDialog();
      router.push(`/session/${session.id}`);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to create empty session. Please check your connection.");
    } finally {
      setLoading(false);
    }
  };

  const resetDialog = () => {
    setFiles([]);
    setStep("idle");
    setLoading(false);
    setShowConfirmCancel(false);
    setError(null);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  const handleCancelContinue = () => {
    setShowConfirmCancel(false);
  };

  const handleCancelStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setShowConfirmCancel(false);
    setOpen(false);
    resetDialog();
  };

  const handleOpenChange = (isOpen: boolean, eventDetails?: any) => {
    const reason = eventDetails?.reason;

    if (!isOpen) {
      // Prevent outside clicks or escape key from dismissing during progress
      if (reason === "outside-press" || reason === "escape-key" || reason === "focus-out") {
        return;
      }

      if (loading && step !== "done") {
        setShowConfirmCancel(true);
        return;
      }
    }

    setOpen(isOpen);
    if (!isOpen) {
      resetDialog();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      disablePointerDismissal={true}
    >
      <DialogTrigger render={<Button className="text-lg px-10 py-6 rounded-2xl" />}>
        Understand Now
      </DialogTrigger>
      <DialogContent className="sm:max-w-md" showCloseButton={!showConfirmCancel}>
        <DialogHeader>
          <DialogTitle>
            {showConfirmCancel ? "Cancel Session Creation?" : "Upload Study Material"}
          </DialogTitle>
        </DialogHeader>

        {showConfirmCancel ? (
          <div className="py-6 text-center space-y-4 animate-in fade-in-50 duration-200">
            <div className="mx-auto w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center text-amber-600">
              <AlertTriangle size={24} />
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                Are you sure you want to stop uploading and parsing your study material? This session will not be saved.
              </p>
            </div>
            <div className="flex gap-3 justify-center pt-2">
              <Button variant="outline" onClick={handleCancelContinue} className="px-6">
                Continue
              </Button>
              <Button variant="destructive" onClick={handleCancelStop} className="px-6">
                Stop
              </Button>
            </div>
          </div>
        ) : step === "idle" ? (
          <>
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 text-xs rounded-xl p-3 flex items-start gap-2 animate-in fade-in-50 duration-200">
                <AlertCircle className="shrink-0 size-4 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            <div
              onClick={() => inputRef.current?.click()}
              className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer hover:border-muted-foreground/50 transition-colors"
            >
              <Upload className="mx-auto mb-3 text-muted-foreground" size={32} />
              <p className="text-sm text-muted-foreground">
                Drop images here or click to browse
              </p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                PNG, JPG, PDF — up to 20 files
              </p>
            </div>

            <input
              ref={inputRef}
              type="file"
              multiple
              accept="image/*,.pdf"
              className="hidden"
              onChange={onDrop}
            />

            {files.length > 0 && (
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {files.map((file, i) => (
                  <div key={i} className="flex items-center justify-between text-sm bg-muted/50 rounded-lg px-3 py-2">
                    <span className="truncate mr-2">{file.name}</span>
                    <button onClick={() => removeFile(i)} className="text-muted-foreground hover:text-foreground">
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <Button
              onClick={handleUpload}
              disabled={!files.length}
              className="w-full font-medium"
            >
              Create Session
            </Button>

            <div className="text-center pt-2">
              <button
                type="button"
                onClick={handleSkipUpload}
                disabled={loading}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4 cursor-pointer transition-colors"
              >
                Skip and start with an empty session
              </button>
            </div>
          </>
        ) : (
          <div className="py-6 space-y-4">
            {STEPS.map((s, i) => {
              const currentIndex = STEPS.findIndex((x) => x.key === step);
              const isDone = i < currentIndex || step === "done";
              const isCurrent = s.key === step && step !== "done";

              return (
                <div key={s.key} className="flex items-center gap-3">
                  <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${
                    isDone ? "bg-green-100 text-green-600" :
                    isCurrent ? "bg-black text-white" :
                    "bg-gray-100 text-gray-400"
                  }`}>
                    {isDone ? <Check size={14} /> :
                     isCurrent ? <Loader2 size={14} className="animate-spin" /> :
                     <span className="text-xs">{i + 1}</span>}
                  </div>
                  <span className={`text-sm ${
                    isDone ? "text-green-600" :
                    isCurrent ? "text-foreground font-medium" :
                    "text-muted-foreground"
                  }`}>
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
