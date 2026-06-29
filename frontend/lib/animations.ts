import type { Transition, Variants } from "motion/react"

// ponytail: shared animation configs — single source of truth
export const bounce: Transition = { type: "spring", stiffness: 400, damping: 17 }

export const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
}

export const cardPop: Variants = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  visible: { opacity: 1, y: 0, scale: 1, transition: bounce },
}
