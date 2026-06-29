"use client";

import { Matrix, pulse } from "@/components/unlumen-ui/matrix";

export function MatrixLoader({ className }: { className?: string }) {
  return (
    <div className={`flex flex-col items-center gap-3 ${className ?? ""}`}>
      <Matrix
        rows={7}
        cols={7}
        frames={pulse}
        fps={12}
        autoplay
        loop
        size={6}
        gap={3}
        palette={{ on: "#262626", off: "#e5e5e5" }}
      />
    </div>
  );
}
