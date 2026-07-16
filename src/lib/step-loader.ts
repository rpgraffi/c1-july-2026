import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { WorkerMeshPayload, WorkerRequest, WorkerResponse } from "./step-worker";

export type LoadedPart = {
  name: string;
  geometry: THREE.BufferGeometry;
  color: THREE.Color | null;
  /** unit vector from model center to part centroid — the explosion direction */
  dir: THREE.Vector3;
};

export type ModelStats = {
  /** distinct solids in the file */
  bodyCount: number;
  /** B-rep faces (machined surfaces) across all bodies */
  faceCount: number;
  triangles: number;
  /** bounding box in source units (mm for STEP) */
  dimsMm: [number, number, number];
  volumeCm3: number;
  source: "step" | "sample" | "mystery";
};

export type LoadedModel = {
  name: string;
  parts: LoadedPart[];
  stats: ModelStats;
};

const CAD_KINDS: Record<string, WorkerRequest["kind"]> = {
  step: "step",
  stp: "step",
  iges: "iges",
  igs: "iges",
  brep: "brep",
  brp: "brep",
};

/** how many fragments a single solid gets shattered into for the explosion */
const TARGET_FRAGMENTS = 12;

function extensionOf(file: File): string {
  return file.name.split(".").pop()?.toLowerCase() ?? "";
}

function cleanName(fileName: string): string {
  const base = fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim();
  return base.length > 0 ? base.replace(/\b\w/g, (c) => c.toUpperCase()) : "Custom Part";
}

/** Signed volume of a (hopefully closed) triangle mesh, in source units³. */
function meshVolume(geo: THREE.BufferGeometry): number {
  const pos = geo.getAttribute("position");
  const index = geo.getIndex();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let volume = 0;
  const triCount = index ? index.count / 3 : pos.count / 3;
  for (let i = 0; i < triCount; i++) {
    const i0 = index ? index.getX(i * 3) : i * 3;
    const i1 = index ? index.getX(i * 3 + 1) : i * 3 + 1;
    const i2 = index ? index.getX(i * 3 + 2) : i * 3 + 2;
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    volume += a.dot(b.clone().cross(c)) / 6;
  }
  return Math.abs(volume);
}

function triangleCount(geo: THREE.BufferGeometry): number {
  const idx = geo.getIndex();
  return Math.floor((idx ? idx.count : geo.getAttribute("position").count) / 3);
}

/** Deterministic direction on a sphere for parts whose centroid sits at the origin. */
function fallbackDir(i: number): THREE.Vector3 {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - ((i % 12) / 11) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = golden * i;
  return new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r).normalize();
}

type RawPart = {
  name: string;
  geometry: THREE.BufferGeometry;
  color: THREE.Color | null;
};

/**
 * Center the whole model at the origin, scale it to a nice viewport size and
 * derive explosion directions. Stats (mm, cm³) are computed before the display
 * normalization from `statsGeometries` — for shattered solids these are the
 * original closed bodies, not the open-shell fragments.
 */
function finalize(
  raw: RawPart[],
  statsGeometries: THREE.BufferGeometry[],
  name: string,
  source: ModelStats["source"],
  counts: { bodyCount: number; faceCount: number },
): LoadedModel {
  const unionBox = new THREE.Box3();
  let triangles = 0;
  let volumeMm3 = 0;

  for (const geo of statsGeometries) {
    geo.computeBoundingBox();
    unionBox.union(geo.boundingBox!);
    triangles += triangleCount(geo);
    volumeMm3 += meshVolume(geo);
  }

  const size = unionBox.getSize(new THREE.Vector3());
  const center = unionBox.getCenter(new THREE.Vector3());
  const bboxVolume = size.x * size.y * size.z;
  // Open or degenerate meshes give nonsense volumes — fall back to a fill-factor estimate.
  if (!Number.isFinite(volumeMm3) || volumeMm3 < bboxVolume * 0.005) {
    volumeMm3 = bboxVolume * 0.35;
  }

  const radius = Math.max(size.length() / 2, 1e-6);
  const displayScale = 1.55 / radius;

  // Fragments of a shattered solid share one position attribute — transform
  // each unique attribute exactly once.
  const seen = new Set<THREE.BufferAttribute>();
  for (const part of raw) {
    const attr = part.geometry.getAttribute("position") as THREE.BufferAttribute;
    if (seen.has(attr)) continue;
    seen.add(attr);
    for (let i = 0; i < attr.count; i++) {
      attr.setXYZ(
        i,
        (attr.getX(i) - center.x) * displayScale,
        (attr.getY(i) - center.y) * displayScale,
        (attr.getZ(i) - center.z) * displayScale,
      );
    }
    attr.needsUpdate = true;
  }

  const parts: LoadedPart[] = raw.map((part, i) => {
    part.geometry.computeBoundingBox();
    part.geometry.computeBoundingSphere();
    const centroid = part.geometry.boundingBox!.getCenter(new THREE.Vector3());
    const dir = centroid.length() > 0.02 ? centroid.clone().normalize() : fallbackDir(i);
    return { ...part, dir };
  });

  return {
    name,
    parts,
    stats: {
      bodyCount: counts.bodyCount,
      faceCount: counts.faceCount,
      triangles,
      dimsMm: [size.x, size.y, size.z],
      volumeCm3: volumeMm3 / 1000,
      source,
    },
  };
}

function geometryFromPayload(payload: WorkerMeshPayload): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(payload.position, 3));
  if (payload.index) geo.setIndex(new THREE.BufferAttribute(payload.index, 1));
  if (payload.normal) {
    geo.setAttribute("normal", new THREE.BufferAttribute(payload.normal, 3));
  } else {
    geo.computeVertexNormals();
  }
  return geo;
}

/**
 * A single solid can't split into parts — shatter it into spatially coherent
 * clusters of B-rep faces instead (k-means over face centroids) so the
 * explosion has something to throw around.
 */
function shatterByFaces(
  payload: WorkerMeshPayload,
  master: THREE.BufferGeometry,
): RawPart[] | null {
  const faces = payload.faces;
  const index = payload.index;
  if (!faces || faces.length < 2 || !index) return null;

  const pos = payload.position;
  const centroidOf = (face: { first: number; last: number }) => {
    const c = new THREE.Vector3();
    let n = 0;
    for (let t = face.first; t <= face.last; t++) {
      for (let k = 0; k < 3; k++) {
        const v = index[t * 3 + k] * 3;
        c.x += pos[v];
        c.y += pos[v + 1];
        c.z += pos[v + 2];
        n++;
      }
    }
    return n > 0 ? c.divideScalar(n) : c;
  };
  const centroids = faces.map(centroidOf);

  const k = Math.min(TARGET_FRAGMENTS, faces.length);
  let means = Array.from({ length: k }, (_, i) =>
    centroids[Math.floor((i * faces.length) / k)].clone(),
  );
  let assignment = new Array<number>(faces.length).fill(0);

  for (let iter = 0; iter < 8; iter++) {
    assignment = centroids.map((c) => {
      let best = 0;
      let bestDist = Infinity;
      for (let m = 0; m < k; m++) {
        const d = c.distanceToSquared(means[m]);
        if (d < bestDist) {
          bestDist = d;
          best = m;
        }
      }
      return best;
    });
    means = Array.from({ length: k }, (_, m) => {
      const members = centroids.filter((_, i) => assignment[i] === m);
      if (members.length === 0) return means[m];
      const sum = members.reduce((acc, c) => acc.add(c), new THREE.Vector3());
      return sum.divideScalar(members.length);
    });
  }

  const positionAttr = master.getAttribute("position");
  const normalAttr = master.getAttribute("normal");
  const fragments: RawPart[] = [];

  for (let m = 0; m < k; m++) {
    const memberFaces = faces.filter((_, i) => assignment[i] === m);
    if (memberFaces.length === 0) continue;
    let triTotal = 0;
    for (const f of memberFaces) triTotal += f.last - f.first + 1;
    const fragIndex = new Uint32Array(triTotal * 3);
    let offset = 0;
    for (const f of memberFaces) {
      const slice = index.subarray(f.first * 3, (f.last + 1) * 3);
      fragIndex.set(slice, offset);
      offset += slice.length;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", positionAttr);
    if (normalAttr) geo.setAttribute("normal", normalAttr);
    geo.setIndex(new THREE.BufferAttribute(fragIndex, 1));
    fragments.push({
      name: `${payload.name} · segment ${fragments.length + 1}`,
      geometry: geo,
      color: payload.color
        ? new THREE.Color(payload.color[0], payload.color[1], payload.color[2])
        : null,
    });
  }

  return fragments.length >= 2 ? fragments : null;
}

function modelFromPayloads(
  payloads: WorkerMeshPayload[],
  name: string,
  source: ModelStats["source"],
): LoadedModel {
  const faceCount = payloads.reduce((sum, p) => sum + (p.faces?.length ?? 0), 0);
  const masters = payloads.map(geometryFromPayload);

  if (payloads.length === 1) {
    const shattered = shatterByFaces(payloads[0], masters[0]);
    if (shattered) {
      return finalize(shattered, masters, name, source, {
        bodyCount: 1,
        faceCount,
      });
    }
  }

  const raw: RawPart[] = payloads.map((p, i) => ({
    name: p.name,
    geometry: masters[i],
    color: p.color ? new THREE.Color(p.color[0], p.color[1], p.color[2]) : null,
  }));
  return finalize(raw, masters, name, source, {
    bodyCount: payloads.length,
    faceCount,
  });
}

function parseInWorker(buffer: ArrayBuffer, kind: WorkerRequest["kind"]) {
  return new Promise<WorkerMeshPayload[]>((resolve, reject) => {
    const worker = new Worker(new URL("./step-worker.ts", import.meta.url), {
      type: "module",
    });
    const fail = (reason: string) => {
      worker.terminate();
      reject(new Error(reason));
    };
    const timeout = window.setTimeout(() => fail("CAD parse timed out"), 45_000);
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      window.clearTimeout(timeout);
      worker.terminate();
      if (event.data.ok) resolve(event.data.meshes);
      else reject(new Error(event.data.error));
    };
    worker.onerror = () => {
      window.clearTimeout(timeout);
      fail("CAD worker crashed");
    };
    worker.postMessage({ buffer, kind } satisfies WorkerRequest, [buffer]);
  });
}

/* ------------------------------------------------------------------ */
/* Procedural fallback: a small machined hub assembly, modeled in mm.  */
/* Only used when nothing else can be parsed — the magic must never    */
/* fail on stage.                                                      */
/* ------------------------------------------------------------------ */

function proceduralAssembly(): RawPart[] {
  const parts: RawPart[] = [];
  const alu = null; // default material color
  const steel = new THREE.Color("#6b7280");
  const anodized = new THREE.Color("#3556c9");

  const plate = new THREE.CylinderGeometry(45, 45, 10, 64);
  plate.translate(0, 5, 0);
  parts.push({ name: "Base Plate", geometry: plate, color: alu });

  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const shank = new THREE.CylinderGeometry(2.6, 2.6, 14, 20);
    shank.translate(0, 7, 0);
    const head = new THREE.CylinderGeometry(4.8, 4.8, 3.4, 6);
    head.translate(0, 15.7, 0);
    const bolt = mergeGeometries([shank, head], false)!;
    bolt.translate(Math.cos(angle) * 35, 3, Math.sin(angle) * 35);
    parts.push({ name: `Bolt M5 · ${i + 1}`, geometry: bolt, color: steel });
  }

  const hub = new THREE.CylinderGeometry(17, 20, 26, 64);
  hub.translate(0, 10 + 13, 0);
  parts.push({ name: "Hub", geometry: hub, color: alu });

  const ring = new THREE.TorusGeometry(27, 4.2, 24, 96);
  ring.rotateX(Math.PI / 2);
  ring.translate(0, 24, 0);
  parts.push({ name: "Retainer Ring", geometry: ring, color: anodized });

  const shaft = new THREE.CylinderGeometry(6.5, 6.5, 58, 40);
  shaft.translate(0, 10 + 29, 0);
  parts.push({ name: "Drive Shaft", geometry: shaft, color: steel });

  const cap = new THREE.CylinderGeometry(9.5, 11, 7, 40);
  cap.translate(0, 10 + 58 + 3, 0);
  parts.push({ name: "End Cap", geometry: cap, color: anodized });

  return parts;
}

function proceduralModel(name: string, source: ModelStats["source"]): LoadedModel {
  const raw = proceduralAssembly();
  return finalize(
    raw,
    raw.map((p) => p.geometry),
    name,
    source,
    { bodyCount: raw.length, faceCount: raw.length * 3 },
  );
}

export async function loadModelFromFiles(files: File[]): Promise<LoadedModel> {
  const cadFile = files.find((f) => CAD_KINDS[extensionOf(f)] !== undefined);

  if (cadFile) {
    try {
      const buffer = await cadFile.arrayBuffer();
      const payloads = await parseInWorker(buffer, CAD_KINDS[extensionOf(cadFile)]);
      return modelFromPayloads(payloads, cleanName(cadFile.name), "step");
    } catch (err) {
      console.warn("STEP parse failed, falling back to sample assembly:", err);
      return proceduralModel(cleanName(cadFile.name), "mystery");
    }
  }

  // Non-CAD file: we still deliver the dream (demo never dead-ends).
  const first = files[0];
  return proceduralModel(first ? cleanName(first.name) : "Custom Part", "mystery");
}

/** The bundled real STEP file from /public — used by the sample shortcut. */
export async function loadSampleModel(): Promise<LoadedModel> {
  try {
    const res = await fetch("/84130403_.step");
    if (!res.ok) throw new Error(`sample fetch: ${res.status}`);
    const blob = await res.blob();
    const file = new File([blob], "Machined Bracket 84130403.step");
    return await loadModelFromFiles([file]);
  } catch (err) {
    console.warn("Bundled sample unavailable, using procedural assembly:", err);
    return proceduralModel("Hub Assembly HA-220", "sample");
  }
}
