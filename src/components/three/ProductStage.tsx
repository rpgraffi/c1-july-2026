import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { LoadedPart } from "@/lib/step-loader";
import { animTimeScale, SCAN_SWEEP_S, type Phase } from "@/lib/phases";

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (v: number) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

// deterministic per-part jitter so the explosion feels organic, not radial-perfect
const jitter = (i: number) => (((i + 1) * 2654435761) % 1000) / 1000;

const scanWorldPos = new THREE.Vector3();
const scanWorldScale = new THREE.Vector3();

export function ProductStage({ parts, phase }: { parts: LoadedPart[]; phase: Phase }) {
  const group = useRef<THREE.Group>(null);
  const spin = useRef<THREE.Group>(null);
  const beam = useRef<THREE.Mesh>(null);
  const beamMat = useRef<THREE.MeshBasicMaterial>(null);
  const partRefs = useRef<(THREE.Group | null)[]>([]);
  const prevPhase = useRef<Phase>(phase);
  const phaseStart = useRef(0);
  const irid = useRef(1);
  const rotVel = useRef(0.3);

  // One shared uniform set drives the x-ray sweep across every part material.
  const scanUniforms = useMemo(() => ({ uScanX: { value: -1000 }, uXray: { value: 0 } }), []);

  const totalTriangles = useMemo(
    () =>
      parts.reduce((sum, p) => {
        const idx = p.geometry.getIndex();
        return sum + (idx ? idx.count : p.geometry.getAttribute("position").count) / 3;
      }, 0),
    [parts],
  );
  const showOverlays = totalTriangles < 350_000;

  const solidMaterials = useMemo(
    () =>
      parts.map((p) => {
        const mat = new THREE.MeshPhysicalMaterial({
          color: p.color ?? new THREE.Color("#c9cdd4"),
          metalness: 0.88,
          roughness: 0.3,
          clearcoat: 0.6,
          clearcoatRoughness: 0.25,
          iridescence: 1,
          iridescenceIOR: 1.3,
          iridescenceThicknessRange: [120, 480],
          envMapIntensity: 1.25,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide, // face fragments are open shells
        });
        // X-ray scan: inject a world-x sweep into the standard shading.
        // Behind the beam (x < uScanX) the metal turns into a fresnel-edged
        // see-through ghost; right at the line a hot slice band glows where
        // the beam cuts the surfaces.
        mat.onBeforeCompile = (shader) => {
          shader.uniforms.uScanX = scanUniforms.uScanX;
          shader.uniforms.uXray = scanUniforms.uXray;
          shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nvarying vec3 vScanWorld;")
            .replace(
              "#include <begin_vertex>",
              "#include <begin_vertex>\nvScanWorld = (modelMatrix * vec4( position, 1.0 )).xyz;",
            );
          shader.fragmentShader = shader.fragmentShader
            .replace(
              "#include <common>",
              "#include <common>\nvarying vec3 vScanWorld;\nuniform float uScanX;\nuniform float uXray;",
            )
            .replace(
              "#include <opaque_fragment>",
              /* glsl */ `
              {
                float scanned = (1.0 - smoothstep(-0.18, 0.05, vScanWorld.x - uScanX)) * uXray;
                float beamBand = exp(-pow((vScanWorld.x - uScanX) * 10.0, 2.0)) * uXray;
                float fres = pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), 1.4);
                // ghost: tinted-glass interior with dark steel-blue fresnel
                // edges — needs real contrast against the light backdrop
                vec3 ghostCol = mix(vec3(0.68, 0.76, 0.88), vec3(0.13, 0.25, 0.47), fres);
                outgoingLight = mix(outgoingLight, ghostCol, scanned);
                diffuseColor.a = mix(diffuseColor.a, 0.16 + 0.72 * fres, scanned);
                // hot orange slice where the beam cuts the surfaces
                outgoingLight = mix(outgoingLight, vec3(1.0, 0.42, 0.10), min(1.0, beamBand * (0.9 + 0.9 * fres)));
                diffuseColor.a = max(diffuseColor.a, min(1.0, beamBand * 1.6) * uXray);
              }
              #include <opaque_fragment>`,
            );
        };
        return mat;
      }),
    [parts, scanUniforms],
  );

  const wireMaterials = useMemo(
    () =>
      parts.map(
        () =>
          new THREE.MeshBasicMaterial({
            color: new THREE.Color("#9ec5ff"),
            wireframe: true,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
      ),
    [parts],
  );

  const pointMaterials = useMemo(
    () =>
      parts.map(
        () =>
          new THREE.PointsMaterial({
            color: new THREE.Color("#ffc9a3"),
            size: 0.05,
            sizeAttenuation: true,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
      ),
    [parts],
  );

  // The visible scan line: a quad with a pre-baked gradient texture (hot core,
  // soft orange halo, faded ends) on a standard material. A custom
  // ShaderMaterial would be the obvious choice, but its very first program —
  // compiled mid-choreography when the beam first becomes visible — comes up
  // blank on some GPUs, so we bake the look into a texture instead.
  const beamTexture = useMemo(() => {
    const W = 64;
    const H = 256;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      // tileable energy ripple along the line (integer frequencies so the
      // texture wraps seamlessly) — scrolled per-frame to feel alive
      const ph = (y / H) * Math.PI * 2;
      const ripple = 0.6 * Math.sin(ph * 3 + 1.3) + 0.4 * Math.sin(ph * 7 + 4.2);
      const energy = 0.86 + 0.14 * ripple;
      for (let x = 0; x < W; x++) {
        const dx = Math.abs(x / (W - 1) - 0.5) * 2;
        const core = Math.exp(-((dx * 16) ** 2)); // razor-thin white-hot center
        const glow = Math.exp(-((dx * 4.5) ** 2)) * 0.55; // saturated orange
        const halo = Math.exp(-((dx * 1.6) ** 2)) * 0.16; // faint wide falloff
        const a = Math.min(1, core * 1.6 + glow + halo) * energy;
        const t = Math.min(1, core * 1.2);
        const i = (y * W + x) * 4;
        img.data[i] = 255;
        img.data[i + 1] = Math.round(255 * (0.35 + (0.92 - 0.35) * t));
        img.data[i + 2] = Math.round(255 * (0.06 + (0.8 - 0.06) * t));
        img.data[i + 3] = Math.round(255 * a);
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }, []);

  useEffect(() => {
    return () => {
      solidMaterials.forEach((m) => m.dispose());
      wireMaterials.forEach((m) => m.dispose());
      pointMaterials.forEach((m) => m.dispose());
      beamTexture.dispose();
    };
  }, [solidMaterials, wireMaterials, pointMaterials, beamTexture]);

  useFrame((state, dt) => {
    const g = group.current;
    if (!g) return;

    const t = state.clock.elapsedTime;
    if (phase !== prevPhase.current) {
      prevPhase.current = phase;
      phaseStart.current = t;
    }
    const pt = (t - phaseStart.current) / animTimeScale();

    const active =
      phase === "materialize" ||
      phase === "explode" ||
      phase === "scan" ||
      phase === "assemble" ||
      phase === "present" ||
      phase === "confirmed";

    // Going back to the void: dissolve instead of vanishing.
    if (!active) {
      scanUniforms.uXray.value = Math.max(0, scanUniforms.uXray.value - dt * 3);
      if (beamMat.current) beamMat.current.opacity = 0;
      if (!g.visible) return;
      let anyVisible = false;
      for (let i = 0; i < parts.length; i++) {
        const solid = solidMaterials[i];
        const wire = wireMaterials[i];
        const points = pointMaterials[i];
        solid.opacity = Math.max(0, solid.opacity - dt * 3.2);
        wire.opacity = Math.max(0, wire.opacity - dt * 3.2);
        points.opacity = Math.max(0, points.opacity - dt * 3.2);
        if (solid.opacity > 0.01) anyVisible = true;
      }
      const s = Math.max(0.35, g.scale.x - dt * 1.1);
      g.scale.setScalar(s);
      g.position.z -= dt * 2.4; // sucked back into the hole
      if (!anyVisible) g.visible = false;
      return;
    }

    g.visible = true;

    // split-apart progress for this frame — the scan holds it at maximum
    let explode = 0;
    if (phase === "explode") explode = easeInOutCubic(clamp01(pt / 1.15));
    if (phase === "scan") explode = 1;
    if (phase === "assemble") explode = 1 - easeInOutCubic(clamp01(pt / 1.25));

    const settled = phase === "present" || phase === "confirmed";
    g.scale.setScalar(THREE.MathUtils.damp(g.scale.x, 1, 6, dt));
    g.position.z = THREE.MathUtils.damp(g.position.z, -3.1 * explode, 8, dt);
    g.position.y = -0.08 + (settled ? Math.sin(t * 0.9) * 0.05 : 0);

    // rotation stops entirely while the beam inspects the exploded part
    const rotTarget =
      phase === "scan"
        ? 0
        : phase === "explode" || phase === "assemble"
          ? 0.55
          : phase === "materialize"
            ? 0.18
            : 0.3;
    rotVel.current = THREE.MathUtils.damp(rotVel.current, rotTarget, 5, dt);
    if (spin.current) spin.current.rotation.y += dt * rotVel.current;

    // x-ray sweep: beam slides left → right, ghosting everything behind it;
    // once assemble starts, uXray decays and the ghost re-solidifies mid-flight
    if (phase === "scan") {
      const p = clamp01(pt / SCAN_SWEEP_S);
      const b = beam.current;
      const cam = state.camera as THREE.PerspectiveCamera;
      if (b && beamMat.current) {
        // the sweep spans the full visible width at the beam's depth so the
        // line enters/exits at the screen edges — the DOM backdrop wipe in
        // index.tsx maps the same eased progress onto the screen alongside it
        b.getWorldPosition(scanWorldPos);
        const depth = cam.position.z - scanWorldPos.z;
        const halfH = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * depth;
        const halfW = halfH * (state.size.width / state.size.height);
        // parent chain scale only — reading the beam's own world scale would
        // feed its previous frame's scale back into itself
        const ws = g.getWorldScale(scanWorldScale).x || 1;
        const range = (halfW * 1.04) / ws;
        b.position.x = -range + 2 * range * smooth(p);
        b.scale.set(0.4 / ws, (halfH * 2.2) / ws, 1);
        beamMat.current.opacity =
          smooth(clamp01(p / 0.05)) * (1 - smooth(clamp01((p - 0.95) / 0.05)));
        // energy flows along the line
        beamTexture.offset.y = (t * 0.3) % 1;
        b.getWorldPosition(scanWorldPos);
        scanUniforms.uScanX.value = scanWorldPos.x;
      }
      scanUniforms.uXray.value = THREE.MathUtils.damp(scanUniforms.uXray.value, 1, 9, dt);
    } else {
      if (beamMat.current) beamMat.current.opacity = 0;
      scanUniforms.uXray.value = THREE.MathUtils.damp(scanUniforms.uXray.value, 0, 4.5, dt);
    }

    // the iridescent shimmer settles into a machined-metal look once assembled
    irid.current = THREE.MathUtils.damp(irid.current, settled ? 0.16 : 1, 2.2, dt);

    const splitScale = parts.length > 1 ? 1.35 : 0;
    const stagger = Math.min(0.09, 0.9 / Math.max(1, parts.length - 1));

    for (let i = 0; i < parts.length; i++) {
      const holder = partRefs.current[i];
      if (!holder) continue;
      const part = parts[i];
      const solid = solidMaterials[i];
      const wire = wireMaterials[i];
      const points = pointMaterials[i];

      const dist = explode * splitScale * (0.85 + jitter(i) * 0.6);
      holder.position.set(part.dir.x * dist, part.dir.y * dist, part.dir.z * dist);
      holder.rotation.set(
        part.dir.y * explode * 0.5,
        part.dir.z * explode * 0.35,
        part.dir.x * explode * 0.3,
      );

      if (phase === "materialize") {
        // vertices spark in → wireframe traces the topology → surfaces solidify
        const local = clamp01((pt - i * stagger) / 1.6);
        points.opacity = smooth(local / 0.16) * (1 - smooth((local - 0.4) / 0.3));
        points.size = 0.065 - 0.04 * smooth(local / 0.5);
        wire.opacity = smooth((local - 0.1) / 0.28) * (1 - smooth((local - 0.62) / 0.32)) * 0.9;
        solid.opacity = smooth((local - 0.42) / 0.4);
        holder.scale.setScalar(0.94 + 0.06 * easeOutCubic(clamp01(local * 1.25)));
      } else {
        points.opacity = Math.max(0, points.opacity - dt * 3);
        wire.opacity = Math.max(0, wire.opacity - dt * 2.5);
        solid.opacity = Math.min(1, solid.opacity + dt * 2.5);
        holder.scale.setScalar(1);
      }
      solid.iridescence = irid.current;
    }
  });

  return (
    <group ref={group} visible={false}>
      {/* rotation lives on an inner group so the scan beam sweeps in a
          straight world-space line instead of orbiting with the model */}
      <group ref={spin}>
        {parts.map((part, i) => (
          <group
            key={i}
            ref={(el) => {
              partRefs.current[i] = el;
            }}
          >
            <mesh geometry={part.geometry} material={solidMaterials[i]} />
            {showOverlays && (
              <>
                <mesh geometry={part.geometry} material={wireMaterials[i]} scale={1.002} />
                <points geometry={part.geometry} material={pointMaterials[i]} />
              </>
            )}
          </group>
        ))}
      </group>
      {/* always mounted & visible — presence is driven purely by opacity so the
          material/program pipeline is warm long before the scan needs it.
          Unit quad; the scan loop scales it to the visible screen each frame. */}
      <mesh ref={beam} renderOrder={5}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          ref={beamMat}
          map={beamTexture}
          transparent
          opacity={0}
          depthWrite={false}
          depthTest={false}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}
