export type Phase =
  "idle" | "consume" | "materialize" | "explode" | "scan" | "assemble" | "present" | "confirmed";

export const LIGHT_PHASES: Phase[] = ["scan", "assemble", "present", "confirmed"];

/** duration of the x-ray beam's left→right sweep, in seconds (before `?slow`).
    Shared by the 3D beam (ProductStage) and the DOM backdrop wipe (index). */
export const SCAN_SWEEP_S = 2.8;
export const SPLIT_PHASES: Phase[] = ["present", "confirmed"];

/** `?slow=N` stretches the whole choreography — handy for demos and debugging */
export function animTimeScale(): number {
  if (typeof window === "undefined") return 1;
  const raw = new URLSearchParams(window.location.search).get("slow");
  if (raw === null) return 1;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 3;
}
