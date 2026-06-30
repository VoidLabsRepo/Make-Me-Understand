"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion } from "motion/react";
import { bounce } from "@/lib/animations";
import { Plus, X, LayoutGrid, Loader2 } from "lucide-react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
} from "@xyflow/react";
import { CanvasNode } from "@/components/canvas-node";
import {
  listCanvases,
  getCanvas,
  createCanvas,
  updateCanvas,
  deleteCanvas,
  type Canvas,
  type CanvasElement,
} from "@/lib/api";

const nodeTypes = { canvas: CanvasNode };

interface CanvasPanelProps {
  sessionId: number;
  refreshTrigger?: number;
}

export function CanvasPanel({ sessionId, refreshTrigger }: CanvasPanelProps) {
  const [canvases, setCanvases] = useState<Canvas[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeLoading, setActiveLoading] = useState(false);
  const loadedElementsRef = useRef<Set<number>>(new Set());

  const fetchCanvases = useCallback(async () => {
    try {
      const data = await listCanvases(sessionId);
      setCanvases((prev) => {
        const byId = new Map(prev.map((c) => [c.id, c]));
        return data.map((c) => {
          const existing = byId.get(c.id);
          return existing && existing.elements !== undefined
            ? { ...c, elements: existing.elements }
            : c;
        });
      });
      if (data.length > 0 && !data.find((c) => c.id === activeId)) {
        setActiveId(data[0].id);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [sessionId, activeId]);

  useEffect(() => {
    fetchCanvases();
  }, [fetchCanvases]);

  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) {
      fetchCanvases();
    }
  }, [refreshTrigger, fetchCanvases]);

  const activeCanvas = canvases.find((c) => c.id === activeId);

  // Lazy-load elements for the active canvas if missing
  useEffect(() => {
    if (
      !activeCanvas ||
      activeCanvas.elements !== undefined ||
      loadedElementsRef.current.has(activeCanvas.id)
    ) {
      return;
    }
    loadedElementsRef.current.add(activeCanvas.id);
    setActiveLoading(true);
    getCanvas(activeCanvas.id)
      .then((full) => {
        setCanvases((prev) => prev.map((c) => (c.id === full.id ? { ...c, elements: full.elements } : c)));
      })
      .catch(() => {
        loadedElementsRef.current.delete(activeCanvas.id);
      })
      .finally(() => setActiveLoading(false));
  }, [activeCanvas]);

  // Evict deleted canvases from the elements cache
  useEffect(() => {
    const liveIds = new Set(canvases.map((c) => c.id));
    for (const id of loadedElementsRef.current) {
      if (!liveIds.has(id)) loadedElementsRef.current.delete(id);
    }
  }, [canvases]);

  const handleAdd = async () => {
    try {
      const canvas = await createCanvas(sessionId, "Untitled Canvas", []);
      setCanvases((prev) => [...prev, canvas]);
      setActiveId(canvas.id);
    } catch {
      // ignore
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteCanvas(id);
      setCanvases((prev) => prev.filter((c) => c.id !== id));
      loadedElementsRef.current.delete(id);
      if (activeId === id) {
        setActiveId(canvases.find((c) => c.id !== id)?.id ?? null);
      }
    } catch {
      // ignore
    }
  };

  const handleTitleBlur = async (id: number, title: string) => {
    if (!title.trim()) return;
    try {
      await updateCanvas(id, { title });
      setCanvases((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
    } catch {
      // ignore
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Loading canvas...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-3 py-2 border-b overflow-x-auto shrink-0">
        {canvases.map((canvas) => (
          <button
            key={canvas.id}
            onClick={() => setActiveId(canvas.id)}
            className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-t-md border-b-2 transition-colors shrink-0 ${
              activeId === canvas.id
                ? "border-foreground text-foreground bg-white"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            <LayoutGrid size={12} />
            <EditableTitle
              title={canvas.title}
              isActive={activeId === canvas.id}
              onBlur={(t) => handleTitleBlur(canvas.id, t)}
            />
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(canvas.id);
              }}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity ml-0.5"
            >
              <X size={12} />
            </span>
          </button>
        ))}
        <motion.button
          onClick={handleAdd}
          whileTap={{ scale: 0.85 }}
          transition={bounce}
          className="flex items-center justify-center size-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted shrink-0"
        >
          <Plus size={14} />
        </motion.button>
      </div>

      <div className="flex-1 min-h-0">
        {activeCanvas ? (
          activeLoading || activeCanvas.elements === undefined ? (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              <Loader2 size={16} className="animate-spin" />
            </div>
          ) : (
            <CanvasView elements={activeCanvas.elements} />
          )
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3 p-6">
            <LayoutGrid size={32} strokeWidth={1} />
            <p className="text-sm">No canvas yet</p>
            <p className="text-xs text-center max-w-xs">
              Ask the AI to visualize a topic with definitions, formulas, or a flowchart.
            </p>
            <motion.button
              onClick={handleAdd}
              whileTap={{ scale: 0.9 }}
              transition={bounce}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border hover:bg-muted"
            >
              <Plus size={12} /> New Canvas
            </motion.button>
          </div>
        )}
      </div>
    </div>
  );
}

function CanvasView({ elements }: { elements: CanvasElement[] }) {
  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = elements.map((el) => ({
      id: el.id,
      type: "canvas",
      position: el.position,
      data: {
        label: el.label,
        content: el.content,
        type: el.type,
      },
      ...(el.size ? { width: el.size.width, height: el.size.height } : {}),
    }));
    const edgeSet = new Set<string>();
    const edges: Edge[] = [];
    for (const el of elements) {
      for (const targetId of el.connections ?? []) {
        const key = `${el.id}->${targetId}`;
        if (edgeSet.has(key)) continue;
        edgeSet.add(key);
        edges.push({
          id: key,
          source: el.id,
          target: targetId,
          type: "smoothstep",
          animated: true,
          style: { stroke: "oklch(0.6 0 0)", strokeWidth: 1.5 },
        });
      }
    }
    return { nodes, edges };
  }, [elements]);

  if (elements.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2 p-6">
        <p className="text-sm">Empty canvas</p>
        <p className="text-xs text-center max-w-xs">
          Ask the AI to add elements here, e.g. "create definitions for supply and demand on this canvas".
        </p>
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.2 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        minZoom={0.3}
        maxZoom={1.8}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color="oklch(0.92 0 0)" />
        <Controls
          showInteractive={false}
          className="!shadow-sm !border !border-border [&>button]:!border-border [&>button]:!bg-background"
        />
      </ReactFlow>
    </div>
  );
}

function EditableTitle({
  title,
  isActive,
  onBlur,
}: {
  title: string;
  isActive: boolean;
  onBlur: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);

  if (!isActive) return <span className="truncate max-w-[120px]">{title}</span>;

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (value.trim() && value !== title) onBlur(value.trim());
          else setValue(title);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="w-24 text-xs bg-transparent border-b outline-none truncate"
        onClick={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <span
      className="truncate max-w-[120px]"
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
    >
      {title}
    </span>
  );
}

