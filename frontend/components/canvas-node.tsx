"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  BaseNode,
  BaseNodeHeader,
  BaseNodeHeaderTitle,
  BaseNodeContent,
} from "@/components/ui/base-node";
import { cn } from "@/lib/utils";
import {
  BookOpen,
  Sigma,
  Workflow,
  StickyNote,
  Lightbulb,
  Heading2,
  type LucideIcon,
} from "lucide-react";
import type { CanvasElementType } from "@/lib/api";

export type CanvasNodeData = {
  label: string;
  content: string;
  type: CanvasElementType;
  [key: string]: unknown;
};

const TYPE_STYLES: Record<
  CanvasElementType,
  { border: string; bg: string; text: string; accent: string; icon: LucideIcon; label: string }
> = {
  definition: {
    border: "border-blue-500",
    bg: "bg-blue-50",
    text: "text-blue-900",
    accent: "bg-blue-500",
    icon: BookOpen,
    label: "Definition",
  },
  formula: {
    border: "border-green-500",
    bg: "bg-green-50",
    text: "text-green-900",
    accent: "bg-green-500",
    icon: Sigma,
    label: "Formula",
  },
  flowchart: {
    border: "border-orange-500",
    bg: "bg-orange-50",
    text: "text-orange-900",
    accent: "bg-orange-500",
    icon: Workflow,
    label: "Flowchart",
  },
  note: {
    border: "border-purple-500",
    bg: "bg-purple-50",
    text: "text-purple-900",
    accent: "bg-purple-500",
    icon: StickyNote,
    label: "Note",
  },
  example: {
    border: "border-pink-500",
    bg: "bg-pink-50",
    text: "text-pink-900",
    accent: "bg-pink-500",
    icon: Lightbulb,
    label: "Example",
  },
  heading: {
    border: "border-gray-500",
    bg: "bg-gray-50",
    text: "text-gray-900",
    accent: "bg-gray-500",
    icon: Heading2,
    label: "Heading",
  },
};

export const CanvasNode = memo(({ data, selected }: NodeProps) => {
  const d = data as CanvasNodeData;
  const style = TYPE_STYLES[d.type] ?? TYPE_STYLES.note;
  const Icon = style.icon;

  const isHeading = d.type === "heading";

  return (
    <BaseNode
      className={cn(
        "p-0 border-2 shadow-sm",
        style.border,
        isHeading && "bg-white",
        !isHeading && style.bg,
        selected && "shadow-lg ring-2 ring-foreground/30",
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-foreground/40 !border-background !size-2"
      />
      <BaseNodeHeader className="border-b border-black/5 px-3 py-1.5">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <div className={cn("size-2 rounded-full shrink-0", style.accent)} />
          <Icon size={12} className={cn("shrink-0", style.text)} />
          <span className={cn("text-[10px] font-medium uppercase tracking-wide shrink-0", style.text)}>
            {style.label}
          </span>
        </div>
      </BaseNodeHeader>
      <BaseNodeHeaderTitle className={cn("px-3 pt-2 text-sm font-semibold", style.text)}>
        {d.label}
      </BaseNodeHeaderTitle>
      {!isHeading && (
        <BaseNodeContent className="px-3 pb-3 pt-1">
          <p className={cn("text-xs leading-relaxed whitespace-pre-wrap break-words", style.text, "opacity-90")}>
            {d.content}
          </p>
        </BaseNodeContent>
      )}
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-foreground/40 !border-background !size-2"
      />
    </BaseNode>
  );
});

CanvasNode.displayName = "CanvasNode";
