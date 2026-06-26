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
import { Upload, X, Loader2, Check } from "lucide-react";
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
  const inputRef = useRef<HTMLInputElement>(null);
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

    try {
      const session = await createSession(files, (currentStep) => {
        setStep(currentStep);
      });
      setStep("done");
      setTimeout(() => {
        setOpen(false);
        setFiles([]);
        setStep("idle");
        router.push(`/session/${session.id}`);
      }, 600);
    } catch (err) {
      console.error(err);
      setStep("idle");
    } finally {
      setLoading(false);
    }
  };

  const resetDialog = () => {
    setFiles([]);
    setStep("idle");
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetDialog(); }}>
      <DialogTrigger render={<Button className="text-lg px-10 py-6 rounded-2xl" />}>
        Understand Now
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Study Material</DialogTitle>
        </DialogHeader>

        {step === "idle" ? (
          <>
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
              className="w-full"
            >
              Create Session
            </Button>
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
