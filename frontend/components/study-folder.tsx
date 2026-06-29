"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

interface StudyFolderProps {
  sessions: { id: number; title: string }[];
  className?: string;
  href?: string;
}

export function StudyFolder({ sessions, className, href }: StudyFolderProps) {
  const [isHovered, setIsHovered] = useState(false);
  const displaySessions = sessions.slice(0, 3);

  const Component = href ? "a" : "div";

  return (
    <Component
      href={href}
      className={cn(
        "inline-flex cursor-pointer items-center gap-2 perspective-[1000px] transform-3d",
        className,
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Folder */}
      <motion.div
        className="relative"
        style={{ width: 120, height: 90, transformStyle: "preserve-3d" }}
      >
        {/* Folder back */}
        <div className="absolute inset-0 rounded-[10px] bg-gradient-to-b from-amber-400 to-amber-500 shadow-sm dark:from-amber-500 dark:to-amber-600">
          <div
            className="absolute left-1 rounded-t-[4px] bg-gradient-to-b from-amber-300 to-amber-400 dark:from-amber-400 dark:to-amber-500"
            style={{ top: -7, width: 36, height: 10 }}
          />
        </div>

        {/* Session files that pop out */}
        {displaySessions.map((session, index) => {
          const total = displaySessions.length;
          const baseRotation = total === 1 ? 0 : (index - (total - 1) / 2) * 15;
          const hoverY = -55 - (total - 1 - index) * 5;
          const hoverX = total === 1 ? 0 : (index - (total - 1) / 2) * 25;
          const teaseY = -5 - (total - 1 - index) * 2;
          const teaseRotation = total === 1 ? 0 : (index - (total - 1) / 2) * 3;

          const shortTitle = session.title.replace(/\*\*/g, "").replace(/^Q\d*:\s*/, "").slice(0, 40);

          return (
            <motion.div
              key={session.id}
              className="absolute top-1 left-1/2 origin-bottom overflow-hidden rounded-lg shadow-sm border border-border/60"
              style={{ backgroundColor: "#e5e5e5", zIndex: 10 + index }}
              animate={{
                x: `calc(-50% + ${isHovered ? hoverX : 0}px)`,
                y: isHovered ? hoverY : teaseY,
                rotate: isHovered ? baseRotation : teaseRotation,
                width: isHovered ? 160 : 75,
                height: isHovered ? 80 : 50,
              }}
              transition={{
                type: "spring",
                stiffness: 400,
                damping: 25,
                delay: index * 0.03,
              }}
            >
              <span className="text-[10px] font-medium text-foreground leading-tight line-clamp-3 p-2 block">
                {shortTitle}
              </span>
            </motion.div>
          );
        })}

        {/* Folder front */}
        <motion.div
          className="absolute inset-x-0 bottom-0 h-[85%] origin-bottom rounded-[10px] bg-gradient-to-b from-amber-300 to-amber-400 shadow-sm dark:from-amber-400 dark:to-amber-500"
          animate={{
            rotateX: isHovered ? -45 : -25,
            scaleY: isHovered ? 0.8 : 1,
          }}
          transition={{ type: "spring", stiffness: 400, damping: 25 }}
          style={{ transformStyle: "preserve-3d", zIndex: 20 }}
        >
          <div className="absolute top-1.5 right-2 left-2 h-px bg-amber-200/50 dark:bg-amber-300/50" />
        </motion.div>
      </motion.div>
    </Component>
  );
}
