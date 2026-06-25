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
import { Upload, X } from "lucide-react";
import { createSession } from "@/lib/api";
import { useRouter } from "next/navigation";

export function UploadDialog() {
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const onDrop = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    setFiles((prev) => [...prev, ...selected]);
  }, []);

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (!files.length) return;
    setLoading(true);
    try {
      const session = await createSession(files);
      setOpen(false);
      setFiles([]);
      router.push(`/session/${session.id}`);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="text-lg px-10 py-6 rounded-2xl" />}>
        Understand Now
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Study Material</DialogTitle>
        </DialogHeader>

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
          disabled={!files.length || loading}
          className="w-full"
        >
          {loading ? "Processing..." : "Create Session"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
