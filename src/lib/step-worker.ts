/// <reference lib="webworker" />
// Parses CAD kernel files (STEP / IGES / BREP) off the main thread so the
// black-hole animation never stutters while OpenCascade chews on geometry.
import occtimportjs from "occt-import-js";
import wasmUrl from "occt-import-js/dist/occt-import-js.wasm?url";

export type WorkerRequest = {
  buffer: ArrayBuffer;
  kind: "step" | "iges" | "brep";
};

export type WorkerMeshPayload = {
  name: string;
  color: [number, number, number] | null;
  position: Float32Array;
  normal: Float32Array | null;
  index: Uint32Array | null;
  /** triangle-index ranges of the B-rep faces, used to shatter single solids */
  faces: { first: number; last: number }[] | null;
};

export type WorkerResponse =
  { ok: true; meshes: WorkerMeshPayload[] } | { ok: false; error: string };

const occtPromise = occtimportjs({ locateFile: () => wasmUrl });

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  try {
    const { buffer, kind } = event.data;
    const occt = await occtPromise;
    const bytes = new Uint8Array(buffer);
    const result =
      kind === "iges"
        ? occt.ReadIgesFile(bytes, null)
        : kind === "brep"
          ? occt.ReadBrepFile(bytes, null)
          : occt.ReadStepFile(bytes, null);

    if (!result.success || result.meshes.length === 0) {
      self.postMessage({ ok: false, error: "no meshes" } satisfies WorkerResponse);
      return;
    }

    const meshes: WorkerMeshPayload[] = result.meshes.map((m, i) => ({
      name: m.name || `Part ${i + 1}`,
      color: m.color ?? null,
      position: new Float32Array(m.attributes.position.array),
      normal: m.attributes.normal ? new Float32Array(m.attributes.normal.array) : null,
      index: m.index ? new Uint32Array(m.index.array) : null,
      faces: m.brep_faces?.map((f) => ({ first: f.first, last: f.last })) ?? null,
    }));

    const transfer: ArrayBuffer[] = [];
    for (const m of meshes) {
      transfer.push(m.position.buffer as ArrayBuffer);
      if (m.normal) transfer.push(m.normal.buffer as ArrayBuffer);
      if (m.index) transfer.push(m.index.buffer as ArrayBuffer);
    }
    self.postMessage({ ok: true, meshes } satisfies WorkerResponse, { transfer });
  } catch (err) {
    self.postMessage({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    } satisfies WorkerResponse);
  }
};
