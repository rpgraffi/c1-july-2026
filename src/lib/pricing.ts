import { addBusinessDays } from "date-fns";
import type { ModelStats } from "./step-loader";

export type DeliverySpeed = "standard" | "express" | "rush";

export type QuoteInput = {
  stats: ModelStats;
  qty: number;
  /** 0 (budget) … 100 (aerospace) */
  quality: number;
  delivery: DeliverySpeed;
};

export type Quote = {
  unit: number;
  total: number;
  tiers: { qty: number; unit: number }[];
  /** savings of the current qty tier vs. buying a single unit, 0..1 */
  savings: number;
  leadDays: number;
  shipDate: Date;
};

export const TIER_QTYS = [1, 10, 25, 100, 250];

export const DELIVERY_META: Record<
  DeliverySpeed,
  { label: string; mult: number; leadFactor: number }
> = {
  standard: { label: "Standard", mult: 1, leadFactor: 1 },
  express: { label: "Express", mult: 1.18, leadFactor: 0.5 },
  rush: { label: "Rush", mult: 1.45, leadFactor: 0.22 },
};

export function qualityLabel(quality: number): string {
  if (quality < 25) return "Budget";
  if (quality < 55) return "Standard";
  if (quality < 82) return "Precision";
  return "Aerospace";
}

export function toleranceLabel(quality: number): string {
  if (quality < 25) return "±0.2 mm · as-machined finish";
  if (quality < 55) return "±0.1 mm · bead-blasted";
  if (quality < 82) return "±0.02 mm · anodized, QA report";
  return "±0.005 mm · full PPAP + material certs";
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function computeQuote({ stats, qty, quality, delivery }: QuoteInput): Quote {
  const complexity = clamp(stats.triangles / 6000, 0.6, 14);
  const massKg = (stats.volumeCm3 * 2.7) / 1000; // aluminum
  const material = Math.max(0.4, massKg * 7.2);
  const machining = 14 + complexity * 6.5;
  const assembly = Math.max(0, stats.bodyCount - 1) * 2.8;
  const qualityMult = 0.82 + (quality / 100) * 0.95;
  const deliveryMult = DELIVERY_META[delivery].mult;
  const setup = 180 + complexity * 22;

  const unitAt = (q: number) =>
    (material + machining + assembly) * qualityMult * deliveryMult * Math.pow(q, -0.13) + setup / q;

  const unit = unitAt(qty);
  const baseLead = Math.round(8 + complexity * 1.1) + (quality >= 82 ? 3 : 0);
  const leadDays = Math.max(2, Math.round(baseLead * DELIVERY_META[delivery].leadFactor));

  return {
    unit,
    total: unit * qty,
    tiers: TIER_QTYS.map((q) => ({ qty: q, unit: unitAt(q) })),
    savings: 1 - unit / unitAt(1),
    leadDays,
    shipDate: addBusinessDays(new Date(), leadDays),
  };
}

const eur = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

export function formatEur(value: number): string {
  return eur.format(value);
}
