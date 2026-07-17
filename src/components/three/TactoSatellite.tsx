import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { animTimeScale, INTRO_BEAM_S, type Phase } from "@/lib/phases";

/**
 * The tacto star as a physical object — "the logo is the satellite". It floats
 * zero-g above the Earth horizon while idle. When a file drops, a dashed light
 * streak beams up from the horizon (the sketch's arrow), the logo pulses on
 * impact, then flies into the top-left corner where the DOM wordmark takes
 * over via crossfade.
 */

// same star as /tacto-star.svg, inlined so SVGLoader.parse stays synchronous —
// no fetch, no suspense boundary needed
const TACTO_STAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 162 162"><path d="M80.9894 0C81.8147 -3.60707e-08 82.4838 0.668647 82.4839 1.49381V40.0757C82.4839 61.8492 100.135 79.5001 121.908 79.5001H160.5C161.326 79.5003 161.994 80.1694 161.994 80.9945C161.994 81.8196 161.326 82.4882 160.5 82.4884H121.908C100.135 82.4884 82.4839 100.139 82.4839 121.913V160.506C82.4839 161.331 81.8147 162 80.9894 162C80.1642 162 79.495 161.331 79.495 160.506V121.913C79.495 100.139 61.8441 82.4884 40.0706 82.4884H1.48872C0.663505 82.4884 -0.00561811 81.8197 -0.0057373 80.9945C-0.0057373 80.1693 0.663431 79.5001 1.48872 79.5001H40.0706C61.8441 79.5001 79.495 61.8492 79.495 40.0757V1.49381C79.4951 0.668692 80.1643 7.20679e-05 80.9894 0Z" fill="#FF6414"/></svg>`;

/** must match the Experience camera's y — screen center sits at this world y */
const CAM_Y = 0.35;
/** where the big logo hovers while idle (upper-middle, like the sketch) */
const IDLE_Y = 1.15;
/** the beam's horizon anchor — just below the viewport, over the Earth */
const BEAM_START = new THREE.Vector2(-1.5, -2.35);
/** the DOM corner icon: left-7 top-6 + h-6 w-6 → center (40px, 36px), 24px tall */
const DOCK_PX = { x: 40, y: 36, size: 24 };
const POP_S = 0.18;

const beamVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const beamFragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uProgress;
  uniform float uAlpha;
  void main() {
    float along = vUv.y;
    float across = vUv.x - 0.5;
    float core = exp(-pow(across * 6.0, 2.0));
    // dashes crawling upward, like the sketch's dashed arrow
    float dash = 0.35 + 0.65 * smoothstep(0.30, 0.55, fract(along * 11.0 - uTime * 2.8));
    float grown = smoothstep(0.0, 0.05, uProgress - along);
    float head = exp(-pow((along - uProgress) * 18.0, 2.0)) * 1.5;
    vec3 col = mix(vec3(1.0, 0.55, 0.20), vec3(1.0, 0.92, 0.78), clamp(head, 0.0, 1.0));
    float a = (core * dash * grown * 0.7 + head * core) * uAlpha;
    gl_FragColor = vec4(col * a, a);
  }
`;

const smoothstepJs = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

export function TactoSatellite({ phase, dragging }: { phase: Phase; dragging: boolean }) {
  const group = useRef<THREE.Group>(null);
  const logo = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Sprite>(null);
  const beam = useRef<THREE.Mesh>(null);
  const viewport = useThree((s) => s.viewport);
  const size = useThree((s) => s.size);
  const pointer = useRef({ x: 0, y: 0 });
  const consumeStart = useRef<number | null>(null);
  const ts = useMemo(() => animTimeScale(), []);

  const geometry = useMemo(() => {
    const { paths } = new SVGLoader().parse(TACTO_STAR_SVG);
    const shapes = paths.flatMap((p) => SVGLoader.createShapes(p));
    // the star's bars are only ~3 SVG units wide, so depth/bevel stay in that
    // range — a delicate slab, not a brick
    const geo = new THREE.ExtrudeGeometry(shapes, {
      depth: 4,
      bevelEnabled: true,
      bevelThickness: 0.7,
      bevelSize: 0.5,
      bevelSegments: 2,
      curveSegments: 32,
    });
    geo.center();
    // SVG y points down → mirror; normalize the 162-unit viewBox to height 1
    geo.scale(1 / 162, -1 / 162, 1 / 162);
    return geo;
  }, []);

  const material = useMemo(
    () =>
      // brand-orange is fragile: ACES desaturates it (→ toneMapped: false) and
      // any white specular from the key lights turns it salmon (→ fully matte,
      // near-zero env). Diffuse + emissive carry hue AND shading.
      new THREE.MeshPhysicalMaterial({
        color: "#8a2800",
        metalness: 0,
        roughness: 0.85,
        clearcoat: 0,
        envMapIntensity: 0.05,
        emissive: "#ff6414",
        emissiveIntensity: 0.5,
        transparent: true,
        toneMapped: false,
      }),
    [],
  );

  const [glowTexture, glowMaterial] = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, "rgba(255, 150, 70, 0.85)");
    g.addColorStop(0.4, "rgba(255, 110, 25, 0.25)");
    g.addColorStop(1, "rgba(255, 100, 20, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    const texture = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return [texture, mat] as const;
  }, []);

  const beamGeometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, 0.5, 0); // pivot at the bottom so scale.y stretches upward
    return geo;
  }, []);
  const beamMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: beamVertex,
        fragmentShader: beamFragment,
        uniforms: {
          uTime: { value: 0 },
          uProgress: { value: 0 },
          uAlpha: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
      glowTexture.dispose();
      glowMaterial.dispose();
      beamGeometry.dispose();
      beamMaterial.dispose();
    },
    [geometry, material, glowTexture, glowMaterial, beamGeometry, beamMaterial],
  );

  useEffect(() => {
    // dragover fires with coordinates too, so the logo tilts toward a dragged file
    const onMove = (e: PointerEvent | DragEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("dragover", onMove);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("dragover", onMove);
    };
  }, []);

  useFrame((state, dt) => {
    const g = group.current;
    const l = logo.current;
    if (!g || !l) return;
    const t = state.clock.elapsedTime;

    if (phase === "consume" && consumeStart.current === null) consumeStart.current = t;
    if (phase === "idle") consumeStart.current = null;
    const sinceConsume = consumeStart.current === null ? Infinity : t - consumeStart.current;

    // the logo holds still while the beam climbs + pulses, then flies to the
    // corner. Every phase after consume keeps it docked.
    const flying =
      phase !== "idle" && (phase !== "consume" || sinceConsume > (INTRO_BEAM_S + POP_S) * ts);

    const wpp = viewport.height / size.height; // world units per CSS pixel
    const dockX = -viewport.width / 2 + DOCK_PX.x * wpp;
    const dockY = CAM_Y + viewport.height / 2 - DOCK_PX.y * wpp;
    const dockScale = DOCK_PX.size * wpp;
    const bigScale = Math.min(2.1, viewport.width * 0.62); // fits on mobile too

    // λ=2 → the glide to the corner takes ~1.6s to visually arrive
    const flightSpeed = 2 / ts;
    const posSpeed = flying ? flightSpeed : 3;
    const tx = flying ? dockX : 0;
    const ty = flying ? dockY : IDLE_Y + Math.sin(t * 0.55) * 0.06;
    g.position.x = THREE.MathUtils.damp(g.position.x, tx, posSpeed, dt);
    g.position.y = THREE.MathUtils.damp(g.position.y, ty, posSpeed, dt);

    // scale: big float (+drag swell, +beam-impact pop) → 24px corner icon
    let targetScale = flying ? dockScale : bigScale * (dragging ? 1.07 : 1);
    if (!flying && sinceConsume > INTRO_BEAM_S * ts) {
      targetScale += bigScale * 0.26 * Math.exp((-(sinceConsume - INTRO_BEAM_S * ts) * 9) / ts);
    }
    g.scale.setScalar(THREE.MathUtils.damp(g.scale.x, targetScale, flying ? flightSpeed : 6, dt));

    // zero-g wobble while idle; settle flat so the corner handoff matches the
    // flat DOM icon
    const rotSpeed = flying ? flightSpeed : 2.5;
    const rx = flying ? 0 : Math.sin(t * 0.42) * 0.15 + pointer.current.y * 0.1;
    const ry = flying ? 0 : Math.sin(t * 0.31) * 0.3 + pointer.current.x * 0.22;
    const rz = flying ? 0 : Math.sin(t * 0.19) * 0.07;
    l.rotation.x = THREE.MathUtils.damp(l.rotation.x, rx, rotSpeed, dt);
    l.rotation.y = THREE.MathUtils.damp(l.rotation.y, ry, rotSpeed, dt);
    l.rotation.z = THREE.MathUtils.damp(l.rotation.z, rz, rotSpeed, dt);

    // crossfade to the DOM wordmark once the flight is nearly home
    const nearDock =
      flying && Math.hypot(g.position.x - dockX, g.position.y - dockY) < dockScale * 2.5;
    material.opacity = THREE.MathUtils.damp(
      material.opacity,
      nearDock ? 0 : 1,
      nearDock ? 12 : 8,
      dt,
    );
    material.emissiveIntensity = THREE.MathUtils.damp(
      material.emissiveIntensity,
      dragging && !flying ? 0.85 : 0.55,
      5,
      dt,
    );
    l.visible = material.opacity > 0.01;

    if (glow.current) {
      const target = flying ? 0 : dragging ? 0.95 : 0.6;
      glowMaterial.opacity = THREE.MathUtils.damp(glowMaterial.opacity, target, 4, dt);
      glow.current.visible = glowMaterial.opacity > 0.01;
    }

    const b = beam.current;
    if (b) {
      const u = beamMaterial.uniforms;
      u.uTime.value = t / ts;
      const p = Math.min(1, sinceConsume / (INTRO_BEAM_S * ts));
      u.uProgress.value = 1 - Math.pow(1 - p, 3); // ease-out climb
      const aIn = smoothstepJs(0, 0.12 * ts, sinceConsume);
      const aOut =
        1 - smoothstepJs((INTRO_BEAM_S + 0.05) * ts, (INTRO_BEAM_S + 0.45) * ts, sinceConsume);
      u.uAlpha.value = phase === "consume" ? aIn * aOut : 0;
      b.visible = u.uAlpha.value > 0.005;
      if (b.visible) {
        // stretch from the fixed horizon anchor to wherever the logo is right now
        const dx = g.position.x - BEAM_START.x;
        const dy = g.position.y - BEAM_START.y;
        b.position.set(BEAM_START.x, BEAM_START.y, -0.2);
        b.scale.set(0.16, Math.hypot(dx, dy), 1);
        b.rotation.z = Math.atan2(dy, dx) - Math.PI / 2;
      }
    }
  });

  return (
    <>
      <group ref={group} position={[0, IDLE_Y, 0]} scale={0.001}>
        <mesh ref={logo} geometry={geometry} material={material} />
        <sprite ref={glow} material={glowMaterial} scale={[2.3, 2.3, 1]} position={[0, 0, -0.45]} />
      </group>
      <mesh
        ref={beam}
        geometry={beamGeometry}
        material={beamMaterial}
        visible={false}
        frustumCulled={false}
      />
    </>
  );
}
