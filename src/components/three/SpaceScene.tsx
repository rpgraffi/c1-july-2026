import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Earth } from "./Earth";
import { TactoSatellite } from "./TactoSatellite";
import { LIGHT_PHASES, type Phase } from "@/lib/phases";

function Starfield({ phase }: { phase: Phase }) {
  const points = useRef<THREE.Points>(null);

  const [geometry, material] = useMemo(() => {
    const count = 1600;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // uniform directions on a far shell — parallax stays subtle, and the
      // Earth naturally occludes the ones behind it
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = 22 + Math.random() * 26;
      const xy = Math.sqrt(1 - u * u);
      positions[i * 3] = Math.cos(a) * xy * r;
      positions[i * 3 + 1] = Math.sin(a) * xy * r;
      positions[i * 3 + 2] = u * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xcdd6ff,
      size: 0.14,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    return [geo, mat] as const;
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame((_, dt) => {
    const p = points.current;
    if (!p) return;
    p.rotation.y += dt * 0.005;
    // stars dissolve when the backdrop wipes to light — they'd read as specks
    const target = LIGHT_PHASES.includes(phase) ? 0 : 0.85;
    material.opacity = THREE.MathUtils.damp(material.opacity, target, 1.8, dt);
    p.visible = material.opacity > 0.01;
  });

  return <points ref={points} geometry={geometry} material={material} frustumCulled={false} />;
}

/** The intro: stars + Earth horizon + the tacto logo floating like a satellite.
    The x-ray scan wipes it all away — stars fade, the Earth is erased along the
    beam line — leaving the clean light page. */
export function SpaceScene({ phase, dragging }: { phase: Phase; dragging: boolean }) {
  return (
    <>
      <Starfield phase={phase} />
      <Earth phase={phase} />
      <TactoSatellite phase={phase} dragging={dragging} />
    </>
  );
}
