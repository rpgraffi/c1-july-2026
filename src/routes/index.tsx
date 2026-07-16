import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BuyPanel } from "@/components/BuyPanel";
import { useIsMobile } from "@/hooks/use-mobile";
import { animTimeScale, LIGHT_PHASES, SCAN_SWEEP_S, SPLIT_PHASES, type Phase } from "@/lib/phases";
import { loadModelFromFiles, loadSampleModel, type LoadedModel } from "@/lib/step-loader";

const Experience = lazy(() =>
  import("@/components/three/Experience").then((m) => ({ default: m.Experience })),
);

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "tacto — The Perfect Buy" },
      {
        name: "description",
        content:
          "Feed tacto your CAD dreams. Drop a STEP file, watch it materialize, and buy the perfect part in one click.",
      },
      { property: "og:title", content: "tacto — The Perfect Buy" },
      {
        property: "og:description",
        content: "Drop files. Magic happens. Just buy it.",
      },
    ],
  }),
  component: Index,
});

const CONSUME_MIN_MS = 1100;
const MATERIALIZE_MS = 2500;
const EXPLODE_MS = 1400;
const SCAN_MS = SCAN_SWEEP_S * 1000 + 200;
const ASSEMBLE_MS = 1450;

const CONSUME_STATUS = [
  "Consuming geometry…",
  "Extracting surfaces & solids…",
  "Matching vetted suppliers…",
  "Negotiating your unit price…",
];

const BG_BY_PHASE: Record<Phase, string> = {
  idle: "#04040a",
  consume: "#04040a",
  materialize: "#070812",
  explode: "#0a0b17",
  // during scan the base stays dark — the beam-synced wipe overlay paints the
  // light color behind the line; assemble then snaps the base to light (the
  // wipe already covers the whole screen at that point, so nothing visibly changes)
  scan: "#0a0b17",
  assemble: "#f1f2f4",
  present: "#f1f2f4",
  confirmed: "#f1f2f4",
};

function ConsumeStatus({ fileLabel }: { fileLabel: string | null }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = window.setInterval(
      () => setStep((s) => Math.min(s + 1, CONSUME_STATUS.length - 1)),
      450,
    );
    return () => window.clearInterval(id);
  }, []);
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="pointer-events-none absolute inset-x-0 bottom-[12%] z-10 text-center"
    >
      {fileLabel && <div className="font-mono text-xs text-white/80">{fileLabel}</div>}
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
          className="mt-2 text-sm tracking-wide text-white/50"
        >
          {CONSUME_STATUS[step]}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}

function Index() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [dragging, setDragging] = useState(false);
  const [nearCenter, setNearCenter] = useState(false);
  const [model, setModel] = useState<LoadedModel | null>(null);
  const [fileLabel, setFileLabel] = useState<string | null>(null);
  const [orderNo, setOrderNo] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const isMobile = useIsMobile();
  const inputRef = useRef<HTMLInputElement>(null);
  const wipeRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // Backdrop wipe, synced to the 3D x-ray beam: identical eased progress and
  // amplitude (±52% ≈ the beam's ±1.04 × half-width), light strictly trailing
  // the line. Only while the beam fades out at the very end does the wipe push
  // a few extra percent to close out the right screen edge.
  useEffect(() => {
    if (phase !== "scan") return;
    const durMs = SCAN_SWEEP_S * 1000 * animTimeScale();
    const started = performance.now();
    const ease = (v: number) => {
      const c = Math.min(1, Math.max(0, v));
      return c * c * (3 - 2 * c);
    };
    let raf = 0;
    const tick = () => {
      const p = Math.min(1, (performance.now() - started) / durMs);
      const closeout = 8 * ease((p - 0.92) / 0.08);
      const edge = 50 + (2 * ease(p) - 1) * 52 + closeout;
      if (wipeRef.current) {
        wipeRef.current.style.background = `linear-gradient(90deg, #f1f2f4 0%, #f1f2f4 ${edge - 6}%, rgba(241,242,244,0) ${edge + 1}%)`;
      }
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  useEffect(() => setMounted(true), []);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const schedule = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  const ingest = useCallback(
    async (files: File[] | null) => {
      if (phaseRef.current !== "idle") return;
      setPhase("consume");
      setFileLabel(files?.[0]?.name ?? "Machined Bracket 84130403.step");

      const scale = animTimeScale();
      const started = performance.now();
      const loaded = files ? await loadModelFromFiles(files) : await loadSampleModel();
      const wait = Math.max(0, CONSUME_MIN_MS * scale - (performance.now() - started));

      schedule(() => {
        setModel(loaded);
        setPhase("materialize");
        schedule(() => setPhase("explode"), MATERIALIZE_MS * scale);
        schedule(() => setPhase("scan"), (MATERIALIZE_MS + EXPLODE_MS) * scale);
        schedule(() => setPhase("assemble"), (MATERIALIZE_MS + EXPLODE_MS + SCAN_MS) * scale);
        schedule(
          () => setPhase("present"),
          (MATERIALIZE_MS + EXPLODE_MS + SCAN_MS + ASSEMBLE_MS) * scale,
        );
      }, wait);
    },
    [schedule],
  );

  const reset = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    setOrderNo(null);
    setFileLabel(null);
    setPhase("idle");
    // keep the model mounted briefly so it can dissolve back into the void
    schedule(() => setModel(null), 900);
  }, [schedule]);

  const buy = useCallback(() => {
    setOrderNo(`TAC-${Math.floor(Math.random() * 90_000 + 10_000)}`);
    setPhase("confirmed");
  }, []);

  // Keyboard: Enter feeds the sample part while idle
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && phaseRef.current === "idle") void ingest(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ingest]);

  const onPointerMove = (e: React.PointerEvent) => {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
    setNearCenter(dist < Math.min(cx, cy) * 0.62);
  };

  const isSplit = SPLIT_PHASES.includes(phase);
  const isLight = LIGHT_PHASES.includes(phase);

  return (
    <div
      className="fixed inset-0 overflow-hidden"
      onPointerMove={onPointerMove}
      onDragOver={(e) => {
        e.preventDefault();
        if (phase === "idle") setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.relatedTarget) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) void ingest(files);
      }}
    >
      {/* phase-driven backdrop: void black → deep space → one simple light color.
          The assemble flip is instant because the scan wipe already painted it. */}
      <motion.div
        className="absolute inset-0"
        initial={false}
        animate={{ backgroundColor: BG_BY_PHASE[phase] }}
        transition={{ duration: phase === "assemble" ? 0 : 1.3, ease: "easeInOut" }}
      />

      {/* scan wipe: the light backdrop sweeps in behind the x-ray beam */}
      {phase === "scan" && <div ref={wipeRef} className="absolute inset-0" />}

      {/* the canvas stays fullscreen forever — the model itself glides aside */}
      <div className="absolute inset-0">
        {mounted && (
          <Suspense fallback={null}>
            <Experience phase={phase} model={model} dragging={dragging} isMobile={isMobile} />
          </Suspense>
        )}
      </div>

      {/* wordmark */}
      <div className="pointer-events-none absolute left-7 top-6 z-20 flex items-center gap-2">
        <img src="/tacto-star.svg" alt="" className="h-6 w-6 object-contain" />
        {/* Official tacto wordmark, as vector paths lifted from the main app's
            TactoIconWithCaption. fill=currentColor lets the phase color animation
            (light backdrop → dark text) still drive it. */}
        <motion.svg
          role="img"
          aria-label="tacto"
          viewBox="50.859 10.102 73.561 21.8"
          fill="currentColor"
          xmlns="http://www.w3.org/2000/svg"
          initial={false}
          animate={{ color: isLight ? "#18181b" : "#fafafa" }}
          transition={{ duration: 1 }}
          className="h-[15px] w-auto"
        >
          <path d="M53.9028 27.3035V17.3132H50.8594V14.8321H53.9028V10.1016H56.6154V14.8321H60.9821V17.3132H56.6154V27.2705C56.6154 28.6929 57.1116 29.2222 58.5672 29.2222H61.2467V31.7033H58.3025C55.0606 31.7033 53.9028 30.2808 53.9028 27.3035Z" />
          <path d="M77.9274 29.2222H78.7875V31.7033H77.2989C75.0494 31.7033 74.2885 30.7439 74.2555 29.0899C73.1969 30.6116 71.5098 31.9018 68.5986 31.9018C64.8936 31.9018 62.3795 30.0492 62.3795 26.9727C62.3795 23.5985 64.7282 21.7129 69.161 21.7129H74.1231V20.5551C74.1231 18.3717 72.5683 17.0485 69.9219 17.0485C67.5401 17.0485 65.9522 18.1733 65.6214 19.8935H62.9088C63.3057 16.5854 65.9853 14.6336 70.0542 14.6336C74.3547 14.6336 76.8358 16.7839 76.8358 20.7205V28.0975C76.8358 28.9907 77.1666 29.2222 77.9274 29.2222ZM74.1231 24.8225V23.9955H68.8964C66.4815 23.9955 65.1252 24.8886 65.1252 26.8073C65.1252 28.4614 66.5476 29.5861 68.7971 29.5861C72.1714 29.5861 74.1231 27.6343 74.1231 24.8225Z" />
          <path d="M87.9237 31.9018C82.9947 31.9018 79.7528 28.5606 79.7528 23.3008C79.7528 18.1402 83.094 14.6336 87.9899 14.6336C92.125 14.6336 94.7384 16.9493 95.4331 20.6543H92.5881C92.0919 18.4048 90.4379 17.0485 87.9568 17.0485C84.7149 17.0485 82.5316 19.6288 82.5316 23.3008C82.5316 26.9727 84.7149 29.4869 87.9568 29.4869C90.3717 29.4869 92.0257 28.0975 92.555 25.9472H95.4331C94.7714 29.5861 92.0257 31.9018 87.9237 31.9018Z" />
          <path d="M99.3332 27.3035V17.3132H96.2898V14.8321H99.3332V10.1016H102.046V14.8321H106.412V17.3132H102.046V27.2705C102.046 28.6929 102.542 29.2222 103.998 29.2222H106.677V31.7033H103.733C100.491 31.7033 99.3332 30.2808 99.3332 27.3035Z" />
          <path d="M116.051 31.9018C111.122 31.9018 107.681 28.3952 107.681 23.2677C107.681 18.1402 111.122 14.6336 116.051 14.6336C120.98 14.6336 124.42 18.1402 124.42 23.2677C124.42 28.3952 120.98 31.9018 116.051 31.9018ZM116.051 29.4869C119.392 29.4869 121.642 26.8735 121.642 23.2677C121.642 19.6619 119.392 17.0485 116.051 17.0485C112.71 17.0485 110.46 19.6619 110.46 23.2677C110.46 26.8735 112.71 29.4869 116.051 29.4869Z" />
        </motion.svg>
      </div>

      {/* idle overlay: the invitation */}
      <AnimatePresence>
        {phase === "idle" && (
          <motion.div
            key="idle-overlay"
            exit={{ opacity: 0, transition: { duration: 0.5 } }}
            className="absolute inset-0 z-10 cursor-pointer"
            onClick={() => inputRef.current?.click()}
          >
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="relative px-6 text-center">
                <motion.h1
                  initial={{ opacity: 0, y: 18 }}
                  animate={{
                    opacity: dragging || nearCenter ? 0 : 1,
                    y: dragging || nearCenter ? -14 : 0,
                    scale: dragging || nearCenter ? 0.98 : 1,
                  }}
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  className="font-display bg-gradient-to-b from-white via-white to-white/40 bg-clip-text text-5xl font-semibold tracking-tight text-transparent md:text-7xl"
                >
                  Feed me your dreams.
                </motion.h1>
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: dragging || nearCenter ? 0 : 1 }}
                  transition={{ duration: 0.4 }}
                  className="mt-5 text-sm text-white/45 md:text-base"
                >
                  Drop a STEP file — or any file — and watch it become the perfect buy.
                </motion.p>
                <AnimatePresence>
                  {dragging && (
                    <motion.div
                      key="letgo"
                      initial={{ opacity: 0, scale: 0.85 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 1.1 }}
                      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                      className="font-display absolute inset-x-0 top-1/2 -translate-y-1/2 text-6xl font-semibold tracking-tight text-white md:text-8xl"
                    >
                      Let go.
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: dragging ? 0 : 1 }}
              transition={{ delay: 0.3 }}
              className="pointer-events-none absolute inset-x-0 bottom-8 z-10 text-center text-xs text-white/35"
            >
              STEP · IGES · anything — or press{" "}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void ingest(null);
                }}
                className="pointer-events-auto rounded border border-white/20 px-1.5 py-0.5 font-mono text-[10px] text-white/60 transition hover:border-white/50 hover:text-white"
              >
                Enter ↵
              </button>{" "}
              for a sample part
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* consume overlay: status ticker while the hole digests the file */}
      <AnimatePresence>
        {phase === "consume" && <ConsumeStatus key="consume" fileLabel={fileLabel} />}
      </AnimatePresence>

      {/* the buy panel */}
      <AnimatePresence>
        {isSplit && model && (
          <motion.aside
            key="panel"
            initial={isMobile ? { y: "10%", opacity: 0 } : { x: "8%", opacity: 0 }}
            animate={isMobile ? { y: 0, opacity: 1 } : { x: 0, opacity: 1 }}
            exit={
              isMobile
                ? { y: "10%", opacity: 0, transition: { duration: 0.4 } }
                : { x: "8%", opacity: 0, transition: { duration: 0.4 } }
            }
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
            className={
              isMobile
                ? "absolute inset-x-0 bottom-0 z-10 h-[56%] border-t border-zinc-200 bg-[#f1f2f4]"
                : "absolute inset-y-0 right-0 z-10 w-1/2 border-l border-zinc-950/5 bg-[#f1f2f4]"
            }
          >
            <BuyPanel model={model} phase={phase} orderNo={orderNo} onBuy={buy} onReset={reset} />
          </motion.aside>
        )}
      </AnimatePresence>

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : [];
          e.target.value = "";
          if (files.length > 0) void ingest(files);
        }}
      />
    </div>
  );
}
