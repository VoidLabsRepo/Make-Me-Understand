"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";

export interface CursorImageTrailProps {
  items: React.ReactNode[];
  itemSize?: number;
  trailLength?: number;
  spawnDistance?: number;
  rotationRange?: number;
  containerRef?: React.RefObject<HTMLElement>;
  className?: string;
  children?: React.ReactNode;
}

interface TrailItem {
  id: number;
  x: number;
  y: number;
  rotation: number;
  itemIndex: number;
}

let _id = 0;
const nextId = () => ++_id;

export function CursorImageTrail({
  items,
  itemSize = 120,
  trailLength = 8,
  spawnDistance = 80,
  rotationRange = 20,
  containerRef,
  className,
  children,
}: CursorImageTrailProps) {
  const [trail, setTrail] = React.useState<TrailItem[]>([]);
  const lastPos = React.useRef<{ x: number; y: number } | null>(null);
  const itemCounter = React.useRef(0);
  const containerElRef = React.useRef<HTMLDivElement>(null);
  const lastMoveTime = React.useRef(0);

  const itemsRef = React.useRef(items);
  itemsRef.current = items;

  React.useEffect(() => {
    const el = containerRef?.current ?? containerElRef.current ?? window;

    const onLeave = () => setTrail([]);

    const onMove = (e: Event) => {
      // ponytail: throttle to ~20fps to avoid reconciliation overhead
      const now = Date.now();
      if (now - lastMoveTime.current < 50) return;
      lastMoveTime.current = now;

      const mouseEvent = e as MouseEvent;
      const rect =
        containerRef?.current?.getBoundingClientRect() ??
        containerElRef.current?.getBoundingClientRect();

      const x = rect ? mouseEvent.clientX - rect.left : mouseEvent.clientX;
      const y = rect ? mouseEvent.clientY - rect.top : mouseEvent.clientY;

      if (lastPos.current) {
        const dx = x - lastPos.current.x;
        const dy = y - lastPos.current.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < spawnDistance) return;
      }

      lastPos.current = { x, y };

      const rotation = (Math.random() * 2 - 1) * rotationRange;
      const currentItems = itemsRef.current;
      const itemIndex = itemCounter.current % currentItems.length;
      itemCounter.current += 1;

      setTrail((prev) => {
        const next = [...prev, { id: nextId(), x, y, rotation, itemIndex }];
        return next.slice(-trailLength);
      });
    };

    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, [spawnDistance, rotationRange, trailLength, containerRef]);

  const total = trail.length;

  return (
    <div
      ref={containerElRef}
      className={cn("relative", className)}
    >
      {children}

      <AnimatePresence>
        {trail.map((item, i) => {
          const age = total - 1 - i;
          const scale = 0.6 + 0.4 * (1 - age / trailLength);

          return (
            <motion.div
              key={item.id}
              className="pointer-events-none absolute select-none"
              style={{
                left: item.x,
                top: item.y,
                width: itemSize,
                x: "-50%",
                y: "-50%",
                zIndex: i,
              }}
              initial={{
                opacity: 0,
                scale: 0.5,
                rotate: item.rotation * 1.5,
              }}
              animate={{
                opacity: 1,
                scale,
                rotate: item.rotation,
              }}
              exit={{
                opacity: 0,
                scale: 0.3,
                rotate: item.rotation * 0.5,
                filter: "blur(4px)",
              }}
              transition={{
                duration: 0.4,
                ease: [0.23, 1, 0.32, 1],
              }}
            >
              <div className="w-full [&>svg]:h-auto [&>svg]:w-full [&>img]:h-auto [&>img]:w-full">
                {items[item.itemIndex]}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
