import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { LoadedPart } from "@/lib/step-loader";
import { animTimeScale, type Phase } from "@/lib/phases";

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (v: number) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

// deterministic per-part jitter so the explosion feels organic, not radial-perfect
const jitter = (i: number) => (((i + 1) * 2654435761) % 1000) / 1000;

export function ProductStage({ parts, phase }: { parts: LoadedPart[]; phase: Phase }) {
  const group = useRef<THREE.Group>(null);
  const partRefs = useRef<(THREE.Group | null)[]>([]);
  const prevPhase = useRef<Phase>(phase);
  const phaseStart = useRef(0);
  const irid = useRef(1);

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
      parts.map(
        (p) =>
          new THREE.MeshPhysicalMaterial({
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
          }),
      ),
    [parts],
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

  useEffect(() => {
    return () => {
      solidMaterials.forEach((m) => m.dispose());
      wireMaterials.forEach((m) => m.dispose());
      pointMaterials.forEach((m) => m.dispose());
    };
  }, [solidMaterials, wireMaterials, pointMaterials]);

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
      phase === "assemble" ||
      phase === "present" ||
      phase === "confirmed";

    // Going back to the void: dissolve instead of vanishing.
    if (!active) {
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

    // split-apart progress for this frame
    let explode = 0;
    if (phase === "explode") explode = easeInOutCubic(clamp01(pt / 1.15));
    if (phase === "assemble") explode = 1 - easeInOutCubic(clamp01(pt / 1.25));

    const settled = phase === "present" || phase === "confirmed";
    g.scale.setScalar(THREE.MathUtils.damp(g.scale.x, 1, 6, dt));
    g.position.z = THREE.MathUtils.damp(g.position.z, -3.1 * explode, 8, dt);
    g.position.y = -0.08 + (settled ? Math.sin(t * 0.9) * 0.05 : 0);

    const rotSpeed =
      phase === "explode" || phase === "assemble" ? 0.55 : phase === "materialize" ? 0.18 : 0.3;
    g.rotation.y += dt * rotSpeed;

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
  );
}
