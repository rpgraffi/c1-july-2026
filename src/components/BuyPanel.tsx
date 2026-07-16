import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useSpring, useTransform } from "framer-motion";
import { format } from "date-fns";
import { Slider } from "@/components/ui/slider";
import {
  computeQuote,
  DELIVERY_META,
  formatEur,
  qualityLabel,
  TIER_QTYS,
  toleranceLabel,
  type DeliverySpeed,
} from "@/lib/pricing";
import type { LoadedModel } from "@/lib/step-loader";
import type { Phase } from "@/lib/phases";

/* Quantity lives on a log scale so 1 → 500 feels natural, with magnetic
   stops at the Staffelpreis tiers. */
const QTY_MIN = 1;
const QTY_MAX = 500;
const LN_MIN = Math.log(QTY_MIN);
const LN_MAX = Math.log(QTY_MAX);
const qtyToPct = (q: number) => ((Math.log(q) - LN_MIN) / (LN_MAX - LN_MIN)) * 100;
const pctToQty = (p: number) => Math.exp(LN_MIN + (p / 100) * (LN_MAX - LN_MIN));

function snapQty(pct: number): number {
  for (const tier of TIER_QTYS) {
    if (Math.abs(qtyToPct(tier) - pct) < 2.6) return tier;
  }
  const raw = pctToQty(pct);
  if (raw < 20) return Math.max(1, Math.round(raw));
  if (raw < 100) return Math.round(raw / 5) * 5;
  return Math.round(raw / 10) * 10;
}

function AnimatedPrice({ value, className }: { value: number; className?: string }) {
  const spring = useSpring(value, { stiffness: 130, damping: 22 });
  useEffect(() => {
    spring.set(value);
  }, [spring, value]);
  const display = useTransform(spring, (v) => formatEur(v));
  return <motion.span className={className}>{display}</motion.span>;
}

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.25 } },
};
const item = {
  hidden: { opacity: 0, y: 26 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 220, damping: 26 } as const,
  },
};

export function BuyPanel({
  model,
  phase,
  orderNo,
  onBuy,
  onReset,
}: {
  model: LoadedModel;
  phase: Phase;
  orderNo: string | null;
  onBuy: () => void;
  onReset: () => void;
}) {
  const [qty, setQty] = useState(25);
  const [quality, setQuality] = useState(55);
  const [delivery, setDelivery] = useState<DeliverySpeed>("standard");

  const quote = useMemo(
    () => computeQuote({ stats: model.stats, qty, quality, delivery }),
    [model.stats, qty, quality, delivery],
  );

  const deliveryOptions = useMemo(
    () =>
      (Object.keys(DELIVERY_META) as DeliverySpeed[]).map((speed) => ({
        speed,
        ...DELIVERY_META[speed],
        quote: computeQuote({ stats: model.stats, qty, quality, delivery: speed }),
      })),
    [model.stats, qty, quality],
  );

  const [w, d, h] = model.stats.dimsMm;
  const composition =
    model.stats.bodyCount === 1
      ? `${model.stats.faceCount} precision surfaces`
      : `${model.stats.bodyCount} parts`;

  return (
    <div className="flex h-full flex-col justify-center overflow-y-auto px-8 py-10 md:px-12 lg:px-16">
      <AnimatePresence mode="wait">
        {phase === "confirmed" ? (
          <motion.div
            key="confirmed"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="mx-auto w-full max-w-md text-center"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 16, delay: 0.15 }}
              className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-zinc-950 text-white shadow-[0_18px_50px_-12px_rgba(24,24,27,0.45)]"
            >
              <svg
                width="34"
                height="34"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </motion.div>
            <h2 className="font-display mt-8 text-4xl font-semibold tracking-tight text-zinc-950">
              Bought.
            </h2>
            <p className="mt-2 text-sm text-zinc-500">
              Order {orderNo} — tacto is on it. Supplier confirmed, QA scheduled.
            </p>
            <div className="mt-8 space-y-3 rounded-2xl border border-zinc-200 bg-white/70 p-6 text-left text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-500">Part</span>
                <span className="font-medium text-zinc-900">{model.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Quantity</span>
                <span className="font-medium tabular-nums text-zinc-900">{qty} units</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Total</span>
                <span className="font-medium tabular-nums text-zinc-900">
                  {formatEur(quote.total)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Arrives</span>
                <span className="font-medium text-zinc-900">
                  {format(quote.shipDate, "d MMM yyyy")}
                </span>
              </div>
            </div>
            <button
              onClick={onReset}
              className="mt-8 w-full rounded-2xl border border-zinc-300 py-4 text-sm font-medium text-zinc-700 transition hover:border-zinc-950 hover:text-zinc-950"
            >
              Feed another dream
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="order"
            variants={container}
            initial="hidden"
            animate="show"
            exit={{ opacity: 0, y: -12, transition: { duration: 0.25 } }}
            className="mx-auto w-full max-w-md"
          >
            <motion.div variants={item} className="flex items-center gap-2 text-xs">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              <span className="font-medium uppercase tracking-[0.18em] text-zinc-500">
                Sourced &amp; ready to buy
              </span>
            </motion.div>

            <motion.h1
              variants={item}
              className="font-display mt-4 text-4xl font-semibold tracking-tight text-zinc-950"
            >
              {model.name}
            </motion.h1>

            <motion.p variants={item} className="mt-2 text-sm text-zinc-500">
              {composition} · {Math.round(w)} × {Math.round(d)} × {Math.round(h)} mm ·{" "}
              {model.stats.volumeCm3 >= 10
                ? Math.round(model.stats.volumeCm3)
                : model.stats.volumeCm3.toFixed(1)}{" "}
              cm³ machined aluminum
            </motion.p>

            <motion.div variants={item} className="mt-8">
              <div className="flex items-baseline gap-2">
                <AnimatedPrice
                  value={quote.unit}
                  className="font-display text-6xl font-semibold tabular-nums tracking-tight text-zinc-950"
                />
                <span className="text-sm text-zinc-400">/ unit</span>
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs">
                {quote.savings > 0.01 && (
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 font-medium text-emerald-700">
                    −{Math.round(quote.savings * 100)}% volume pricing
                  </span>
                )}
                <span className="text-zinc-400">excl. VAT · QA &amp; shipping included</span>
              </div>
            </motion.div>

            <motion.div variants={item} className="mt-8">
              <div className="mb-3 flex items-baseline justify-between">
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-400">
                  Quantity · volume pricing
                </div>
                <input
                  type="number"
                  min={1}
                  value={qty}
                  onChange={(e) =>
                    setQty(Math.max(1, Math.min(100_000, Number(e.target.value) || 1)))
                  }
                  className="h-8 w-20 rounded-lg border border-zinc-200 bg-transparent text-center text-sm font-semibold tabular-nums text-zinc-900 outline-none focus:border-zinc-950"
                />
              </div>
              <div className="relative">
                <Slider
                  value={[Math.max(0, Math.min(100, qtyToPct(qty)))]}
                  onValueChange={(v) => setQty(snapQty(v[0]))}
                  min={0}
                  max={100}
                  step={0.5}
                />
                {/* Staffelpreis stops on the track */}
                <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2">
                  {TIER_QTYS.map((tier) => (
                    <span
                      key={tier}
                      className={`absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border ${
                        qty >= tier ? "border-zinc-950 bg-zinc-950" : "border-zinc-300 bg-white"
                      }`}
                      style={{ left: `${qtyToPct(tier)}%` }}
                    />
                  ))}
                </div>
              </div>
              <div className="relative mt-2 h-9">
                {quote.tiers.map((tier) => {
                  const pct = qtyToPct(tier.qty);
                  return (
                    <button
                      key={tier.qty}
                      onClick={() => setQty(tier.qty)}
                      className={`absolute top-0 text-center transition ${
                        pct > 4 ? "-translate-x-1/2" : ""
                      } ${qty === tier.qty ? "text-zinc-950" : "text-zinc-400 hover:text-zinc-600"}`}
                      style={{ left: `${Math.min(pct, 97)}%` }}
                    >
                      <span className="block text-[11px] font-semibold">{tier.qty}×</span>
                      <span className="block text-[10px] tabular-nums">{formatEur(tier.unit)}</span>
                    </button>
                  );
                })}
              </div>
            </motion.div>

            <motion.div variants={item} className="mt-6">
              <div className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-zinc-400">
                Delivery
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {deliveryOptions.map((opt) => (
                  <button
                    key={opt.speed}
                    onClick={() => setDelivery(opt.speed)}
                    className={`rounded-xl border px-2 py-2.5 text-left transition ${
                      delivery === opt.speed
                        ? "border-zinc-950 bg-zinc-950 text-white"
                        : "border-zinc-200 bg-white/60 text-zinc-600 hover:border-zinc-400"
                    }`}
                  >
                    <div className="text-xs font-semibold">{opt.label}</div>
                    <div className="mt-0.5 text-[11px] opacity-70">
                      {format(opt.quote.shipDate, "d MMM")}
                      {opt.mult > 1 && ` · +${Math.round((opt.mult - 1) * 100)}%`}
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>

            <motion.div variants={item} className="mt-6">
              <div className="mb-3 flex items-baseline justify-between">
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-400">
                  Quality
                </div>
                <div className="text-xs font-semibold text-zinc-900">{qualityLabel(quality)}</div>
              </div>
              <Slider
                value={[quality]}
                onValueChange={(v) => setQuality(v[0])}
                min={0}
                max={100}
                step={1}
              />
              <div className="mt-2 text-[11px] text-zinc-400">{toleranceLabel(quality)}</div>
            </motion.div>

            <motion.div variants={item} className="mt-8 border-t border-zinc-200 pt-5">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-zinc-500">
                  Total · {qty} {qty === 1 ? "unit" : "units"}
                </span>
                <AnimatedPrice
                  value={quote.total}
                  className="text-xl font-semibold tabular-nums text-zinc-950"
                />
              </div>
              <div className="mt-1 text-right text-[11px] text-zinc-400">
                arrives {format(quote.shipDate, "d MMM")} · one invoice, via tacto
              </div>
            </motion.div>

            <motion.button
              variants={item}
              whileHover={{ scale: 1.015 }}
              whileTap={{ scale: 0.97 }}
              onClick={onBuy}
              className="relative mt-5 w-full overflow-hidden rounded-2xl bg-zinc-950 py-5 text-base font-semibold text-white shadow-[0_24px_60px_-16px_rgba(255,92,0,0.45)]"
            >
              <motion.span
                aria-hidden
                className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/25 to-transparent"
                animate={{ left: ["-40%", "120%"] }}
                transition={{
                  duration: 2.4,
                  repeat: Infinity,
                  ease: "easeInOut",
                  repeatDelay: 0.6,
                }}
              />
              <span className="relative flex items-center justify-center gap-2">
                Buy it
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14" />
                  <path d="m13 6 6 6-6 6" />
                </svg>
              </span>
            </motion.button>

            <motion.div
              variants={item}
              className="mt-5 flex items-center justify-between text-[11px] text-zinc-400"
            >
              <span>tacto owns the supplier relationship. You just buy.</span>
              <button
                onClick={onReset}
                className="underline underline-offset-2 transition hover:text-zinc-700"
              >
                ↺ new part
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
