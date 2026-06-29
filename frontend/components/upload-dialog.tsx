"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { createSession } from "@/lib/api";
import { useRouter } from "next/navigation";

export function UploadDialog() {
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const handleCreate = async () => {
    setLoading(true);
    try {
      const session = await createSession();
      setOpen(false);
      router.push(`/session/${session.id}`);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="text-lg px-10 py-6 rounded-2xl" />}>
        Start Learning
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Session</DialogTitle>
        </DialogHeader>
        <div className="py-4 text-center space-y-4">
          <p className="text-sm text-muted-foreground">
            Start a new learning session. You can upload study material anytime during the conversation.
          </p>
          <Button
            onClick={handleCreate}
            disabled={loading}
            className="w-full font-medium"
          >
            {loading ? <Loader2 className="animate-spin mr-2" size={16} /> : null}
            {loading ? "Creating..." : "Start Chatting"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
