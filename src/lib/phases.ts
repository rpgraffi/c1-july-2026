export type Phase =
  "idle" | "consume" | "materialize" | "explode" | "scan" | "assemble" | "present" | "confirmed";

export const LIGHT_PHASES: Phase[] = ["scan", "assemble", "present", "confirmed"];

/** duration of the x-ray beam's left→right sweep, in seconds (before `?slow`).
    Shared by the 3D beam (ProductStage) and the DOM backdrop wipe (index). */
export const SCAN_SWEEP_S = 2.8;
export const SPLIT_PHASES: Phase[] = ["present", "confirmed"];

/** intro beam-up: seconds (before `?slow`) the light streak takes to climb from
    the horizon to the logo-satellite. CONSUME_MIN_MS (index) must leave room for
    beam + pulse + some flight, or the part materializes under the big logo. */
export const INTRO_BEAM_S = 1.7;

/** when the DOM corner wordmark may fade in after consume starts: beam + pulse +
    most of the logo's flight to the corner. Shared by TactoSatellite (3D side of
    the handoff) and index (DOM side) so the crossfade lines up. */
export const WORDMARK_APPEAR_DELAY_S = 2.7;

/** `?slow=N` stretches the whole choreography — handy for demos and debugging */
export function animTimeScale(): number {
  if (typeof window === "undefined") return 1;
  const raw = new URLSearchParams(window.location.search).get("slow");
  if (raw === null) return 1;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 3;
}
