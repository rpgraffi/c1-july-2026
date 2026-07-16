export type Phase =
  "idle" | "consume" | "materialize" | "explode" | "assemble" | "present" | "confirmed";

export const LIGHT_PHASES: Phase[] = ["assemble", "present", "confirmed"];
export const SPLIT_PHASES: Phase[] = ["present", "confirmed"];

/** `?slow=N` stretches the whole choreography — handy for demos and debugging */
export function animTimeScale(): number {
  if (typeof window === "undefined") return 1;
  const raw = new URLSearchParams(window.location.search).get("slow");
  if (raw === null) return 1;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 3;
}
