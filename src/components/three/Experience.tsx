import "@/lib/r3f-devtools-patch";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Sparkles } from "@react-three/drei";
import { useEffect, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { BlackHole } from "./BlackHole";
import { ProductStage } from "./ProductStage";
import type { LoadedModel } from "@/lib/step-loader";
import type { Phase } from "@/lib/phases";

/** Image-based lighting without any network fetch — generated on the GPU. */
function StudioEnvironment() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;
    return () => {
      scene.environment = null;
      envRT.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  return null;
}

/**
 * The canvas always stays fullscreen — resizing a WebGL canvas mid-animation
 * stutters. Instead the whole product rig glides to the left half (or upper
 * half on mobile) when the buy panel arrives.
 */
function Rig({
  split,
  mobile,
  children,
}: {
  split: boolean;
  mobile: boolean;
  children: ReactNode;
}) {
  const group = useRef<THREE.Group>(null);
  const viewport = useThree((s) => s.viewport);
  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const tx = split && !mobile ? -viewport.width / 4 : 0;
    const ty = split && mobile ? viewport.height * 0.24 : 0;
    g.position.x = THREE.MathUtils.damp(g.position.x, tx, 3.2, dt);
    g.position.y = THREE.MathUtils.damp(g.position.y, ty, 3.2, dt);
    // fit the model (radius ~1.55) into whatever screen region it owns
    const halfW = viewport.width / 2;
    const halfH = viewport.height / 2;
    let allowed = Math.min(halfW, halfH) * 0.95;
    if (split) {
      allowed = mobile
        ? Math.min(halfW * 0.95, viewport.height * 0.2)
        : Math.min(halfW * 0.48, halfH * 0.95);
    }
    const ts = Math.min(1, allowed / 1.65);
    const s = THREE.MathUtils.damp(g.scale.x, ts, 3.2, dt);
    g.scale.setScalar(s);
  });
  return <group ref={group}>{children}</group>;
}

export function Experience({
  phase,
  model,
  dragging,
  isMobile,
}: {
  phase: Phase;
  model: LoadedModel | null;
  dragging: boolean;
  isMobile: boolean;
}) {
  const magicDust = phase === "materialize" || phase === "explode" || phase === "scan";
  const settled = phase === "present" || phase === "confirmed";

  return (
    <Canvas
      camera={{ position: [0, 0.35, 5.4], fov: 42 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
      }}
      style={{ position: "absolute", inset: 0 }}
    >
      <StudioEnvironment />
      <ambientLight intensity={0.25} />
      <directionalLight position={[3, 5, 4]} intensity={1.5} />
      <directionalLight position={[-4, 2, -3]} intensity={0.8} color="#8b7cf6" />

      <BlackHole phase={phase} dragging={dragging} />

      <Rig split={settled} mobile={isMobile}>
        {model && (
          <ProductStage
            key={`${model.name}-${model.stats.bodyCount}-${model.parts.length}`}
            parts={model.parts}
            phase={phase}
          />
        )}
        {settled && (
          <ContactShadows position={[0, -1.85, 0]} opacity={0.3} scale={8} blur={2.8} far={3.5} />
        )}
      </Rig>

      {magicDust && (
        <Sparkles
          count={120}
          scale={[8, 5, 8]}
          size={2.4}
          speed={0.45}
          color="#ffb27d"
          opacity={0.5}
        />
      )}
    </Canvas>
  );
}
