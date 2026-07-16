import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SpecShip — Upload a parts spec, buy in one click" },
      {
        name: "description",
        content:
          "Drop in a parts specification and get a ready-to-checkout bill of materials. One click, one invoice, shipped.",
      },
      { property: "og:title", content: "SpecShip — Spec to cart, instantly" },
      {
        property: "og:description",
        content:
          "Upload your BOM or spec sheet. SpecShip matches every line to a supplier and readies a single checkout.",
      },
    ],
  }),
  component: Index,
});

type Part = {
  id: string;
  sku: string;
  name: string;
  spec: string;
  qty: number;
  unit: number;
  supplier: string;
  lead: string;
};

const MOCK_PARTS: Part[] = [
  {
    id: "1",
    sku: "MC-91290A115",
    name: "Socket Head Cap Screw",
    spec: "M4 × 12, A2 stainless, DIN 912",
    qty: 40,
    unit: 0.18,
    supplier: "McMaster-Carr",
    lead: "Ships today",
  },
  {
    id: "2",
    sku: "IG-EFSM-04",
    name: "Flanged Sleeve Bearing",
    spec: "iglide® G, 4 mm bore, 8 mm OD",
    qty: 12,
    unit: 1.42,
    supplier: "igus",
    lead: "2 day",
  },
  {
    id: "3",
    sku: "MW-2020-500",
    name: "Aluminum Extrusion 20×20",
    spec: "T-slot, 500 mm, anodized",
    qty: 8,
    unit: 6.9,
    supplier: "Misumi",
    lead: "3 day",
  },
  {
    id: "4",
    sku: "DK-497-1461",
    name: "Stepper Motor NEMA 17",
    spec: "1.8°, 1.7 A, 40 N·cm",
    qty: 2,
    unit: 14.5,
    supplier: "Digi-Key",
    lead: "Ships today",
  },
  {
    id: "5",
    sku: "AM-6MM-1M",
    name: "Linear Shaft",
    spec: "Ø6 mm × 1000 mm, hardened chrome",
    qty: 4,
    unit: 8.2,
    supplier: "Automation Direct",
    lead: "2 day",
  },
];

type Stage = "upload" | "parsing" | "review" | "confirmed";

function Index() {
  const [stage, setStage] = useState<Stage>("upload");
  const [fileName, setFileName] = useState<string | null>(null);
  const [parts, setParts] = useState<Part[]>(MOCK_PARTS);
  const [dragging, setDragging] = useState(false);
  const [quality, setQuality] = useState(50); // 0 = cheapest, 100 = premium
  const [urgent, setUrgent] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File) => {
    setFileName(file.name);
    setStage("parsing");
    window.setTimeout(() => {
      setParts(MOCK_PARTS);
      setStage("review");
    }, 1400);
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const baseSubtotal = parts.reduce((s, p) => s + p.qty * p.unit, 0);
  // quality multiplier: 0.75x (budget) → 1.6x (premium)
  const qualityMult = 0.75 + (quality / 100) * 0.85;
  const subtotal = baseSubtotal * qualityMult;
  const shipping = urgent ? 42 : 12.5;
  const tax = subtotal * 0.0875;
  const total = subtotal + shipping + tax;
  const arrival = urgent ? "Tomorrow by 5pm" : "In 2–3 business days";


  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground font-black">
              S
            </div>
            <span className="text-base font-semibold tracking-tight">SpecShip</span>
          </div>
          <nav className="hidden gap-6 text-sm text-muted-foreground md:flex">
            <a className="hover:text-foreground" href="#how">How it works</a>
            <a className="hover:text-foreground" href="#suppliers">Suppliers</a>
            <a className="hover:text-foreground" href="#pricing">Pricing</a>
          </nav>
          <button className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent">
            Sign in
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-14">
        {stage === "upload" && (
          <section className="grid gap-10 md:grid-cols-[1.1fr_1fr] md:items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                Spec → Cart in 30 seconds
              </div>
              <h1 className="mt-5 text-4xl font-semibold tracking-tight md:text-5xl">
                Upload a parts spec.<br />
                <span className="text-muted-foreground">Buy the whole BOM in one click.</span>
              </h1>
              <p className="mt-5 max-w-lg text-base text-muted-foreground">
                Drop a PDF, CSV, or spreadsheet. SpecShip matches every line to a live supplier,
                consolidates shipping, and hands you a single checkout.
              </p>
              <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
                {[
                  "Auto-matched across McMaster, Digi-Key, Misumi, igus & more",
                  "One invoice, one tracking page, one return address",
                  "Human review on any part we're not 99% sure about",
                ].map((t) => (
                  <li key={t} className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              className={`group cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition ${
                dragging
                  ? "border-primary bg-accent"
                  : "border-border bg-card hover:border-foreground/40"
              }`}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,.csv,.xlsx,.xls,.txt"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-xl border border-border bg-background">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v12" />
                  <path d="m7 8 5-5 5 5" />
                  <path d="M20 21H4" />
                </svg>
              </div>
              <p className="mt-4 text-base font-medium">Drop your spec here</p>
              <p className="mt-1 text-sm text-muted-foreground">
                PDF, CSV, XLSX, or plain text — up to 20 MB
              </p>
              <button className="mt-5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                Choose file
              </button>
              <p className="mt-4 text-xs text-muted-foreground">
                or try{" "}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleFile(new File([""], "sample-bom.csv"));
                  }}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  a sample BOM
                </button>
              </p>
            </div>
          </section>
        )}

        {stage === "parsing" && (
          <section className="mx-auto max-w-md py-24 text-center">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-border border-t-foreground" />
            <h2 className="mt-6 text-lg font-medium">Reading {fileName}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Extracting line items, matching SKUs across suppliers…
            </p>
          </section>
        )}

        {stage === "review" && (
          <section className="mx-auto max-w-md py-12">
            <p className="text-sm text-muted-foreground">
              Parsed <span className="text-foreground">{fileName}</span>
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">
              Your order is ready.
            </h2>

            <div className="mt-10 space-y-8">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Arrives
                </div>
                <div className="mt-2 text-2xl font-medium tracking-tight">
                  {arrival}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  One shipment. One tracking number.
                </div>
              </div>

              <div className="h-px bg-border" />

              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Total
                </div>
                <div className="mt-2 text-2xl font-medium tabular-nums tracking-tight">
                  ${total.toFixed(2)}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  All-in. Shipping and tax included.
                </div>
              </div>

              <div className="h-px bg-border" />

              <div>
                <div className="flex items-baseline justify-between">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Quality
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {quality < 34 ? "Budget" : quality < 67 ? "Standard" : "Premium"}
                  </div>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={quality}
                  onChange={(e) => setQuality(Number(e.target.value))}
                  className="mt-3 w-full accent-foreground"
                />
                <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                  <span>Cheaper</span>
                  <span>Better</span>
                </div>
              </div>

              <div className="h-px bg-border" />

              <label className="flex cursor-pointer items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium">Urgent shipping</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Next-day delivery · +${(42 - 12.5).toFixed(2)}
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={urgent}
                  onClick={() => setUrgent((v) => !v)}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                    urgent ? "bg-primary" : "bg-border"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition ${
                      urgent ? "left-[22px]" : "left-0.5"
                    }`}
                  />
                </button>
              </label>
            </div>


            <button
              onClick={() => setStage("confirmed")}
              className="mt-12 w-full rounded-md bg-primary py-3.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
            >
              Buy now
            </button>
            <button
              onClick={() => {
                setStage("upload");
                setFileName(null);
              }}
              className="mt-4 w-full text-center text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Upload a different file
            </button>
          </section>
        )}

        {stage === "confirmed" && (
          <section className="mx-auto max-w-lg py-20 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-foreground">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <h2 className="mt-6 text-2xl font-semibold tracking-tight">
              Order placed — SP-{Math.floor(Math.random() * 90000 + 10000)}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {parts.length} parts across {new Set(parts.map((p) => p.supplier)).size} suppliers,
              consolidated onto one invoice. Tracking will hit your inbox within the hour.
            </p>
            <button
              onClick={() => {
                setStage("upload");
                setFileName(null);
                setParts(MOCK_PARTS);
              }}
              className="mt-8 rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
            >
              Upload another spec
            </button>
          </section>
        )}
      </main>
    </div>
  );
}
