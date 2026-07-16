import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Phase } from "@/lib/phases";

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uAspect;
  uniform vec2  uMouse;
  uniform float uHover;
  uniform float uFlare;
  uniform float uFade;

  float hash(vec2 p) {
    p = fract(p * vec2(234.34, 435.345));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p = p * 2.03 + vec2(13.7, 7.3);
      a *= 0.5;
    }
    return v;
  }
  vec2 rot(vec2 p, float a) {
    float c = cos(a), s = sin(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  }

  void main() {
    vec2 uv = (vUv - 0.5) * vec2(uAspect, 1.0) * 2.0;
    vec2 centerPull = uMouse * vec2(uAspect, 1.0) * 0.10 * uHover;
    vec2 p = uv - centerPull;

    float r = length(p);
    float ang = atan(p.y, p.x);

    float pull = 1.0 + uHover * 0.45 + uFlare * 2.2;
    float horizon = 0.30 + 0.012 * sin(uTime * 0.7) - uFlare * 0.08;

    // accretion streaks spiraling into the core. The angle only ever enters
    // through cos/sin so the noise domain is continuous — no seam at ±π.
    float swirlAng = ang + (1.9 * pull) / (r + 0.28) - uTime * 0.22 * pull;
    float flow = pow(r, 0.55) * 5.0 - uTime * (0.55 + uFlare * 1.8);
    vec2 dir = vec2(cos(swirlAng), sin(swirlAng));
    float streaks = smoothstep(0.42, 0.92, fbm(dir * 2.6 + vec2(flow * 0.8, -flow * 0.6)));

    float ring = exp(-pow((r - horizon) * 10.0, 2.0)) * (1.1 + uHover * 0.5 + uFlare * 3.5);
    float glow = exp(-r * 1.9) * (0.75 + uFlare * 1.6);
    float diskMask = smoothstep(horizon * 0.85, horizon * 1.7, r)
                   * (1.0 - smoothstep(horizon, 2.1, r) * 0.9);
    float disk = streaks * diskMask * (0.55 + glow);

    vec3 cool   = vec3(0.38, 0.52, 1.05);
    vec3 warm   = vec3(1.05, 0.62, 0.32);
    vec3 violet = vec3(0.60, 0.38, 1.00);
    vec3 col = mix(warm, cool, smoothstep(horizon, 1.0, r));
    vec3 c = col * (disk * 1.5 + ring) + violet * glow * 0.45;

    // gravitationally lensed starfield
    vec2 sp = rot(uv, 0.6 / (r + 0.4) + uTime * 0.012);
    vec2 cell = floor(sp * 34.0);
    vec2 cf = fract(sp * 34.0) - 0.5;
    float h = hash(cell);
    float star = smoothstep(0.10, 0.0, length(cf)) * step(0.93, h);
    star *= 0.5 + 0.5 * sin(uTime * 2.5 + h * 50.0);
    c += vec3(0.7, 0.78, 1.0) * star * smoothstep(horizon * 1.1, horizon * 2.2, r) * 0.8;

    // the void itself
    c *= smoothstep(horizon * 0.72, horizon * 1.05, r);

    // consume climax: white-hot flash from the core
    c += vec3(1.0, 0.96, 0.9) * uFlare * uFlare * exp(-r * 2.6) * 3.2;

    // vignette
    c *= 1.0 - 0.5 * smoothstep(1.1, 2.2, length(uv));

    gl_FragColor = vec4(c * uFade, uFade);
  }
`;

const smoothstepJs = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

export function BlackHole({ phase, dragging }: { phase: Phase; dragging: boolean }) {
  const mesh = useRef<THREE.Mesh>(null);
  const size = useThree((s) => s.size);
  const pointer = useRef({ x: 0, y: 0, dist: 2 });

  // Built imperatively: R3F's uniforms-prop diffing must never get between
  // our per-frame mutations and the GPU.
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uTime: { value: 0 },
          uAspect: { value: 1 },
          uMouse: { value: new THREE.Vector2(0, 0) },
          uHover: { value: 0 },
          uFlare: { value: 0 },
          uFade: { value: 1 },
        },
        transparent: true,
        depthWrite: false,
        depthTest: false,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    // dragover fires with coordinates too, so the hole tracks a dragged file
    const onMove = (e: PointerEvent | DragEvent) => {
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = -((e.clientY / window.innerHeight) * 2 - 1);
      const aspect = window.innerWidth / window.innerHeight;
      pointer.current = { x: nx, y: ny, dist: Math.hypot(nx * aspect, ny) };
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("dragover", onMove);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("dragover", onMove);
    };
  }, []);

  useFrame((state, dt) => {
    const u = material.uniforms;
    u.uTime.value = state.clock.elapsedTime;
    u.uAspect.value = size.width / size.height;

    const damp = (cur: number, target: number, speed: number) =>
      THREE.MathUtils.damp(cur, target, speed, dt);

    const active = phase === "idle" || phase === "consume";
    const proximity = 1 - smoothstepJs(0.2, 0.85, pointer.current.dist);
    const hoverTarget = phase === "idle" ? (dragging ? 1 : proximity) : 0;
    u.uHover.value = damp(u.uHover.value, hoverTarget, 4);

    const flareTarget = phase === "consume" ? 1 : 0;
    u.uFlare.value = damp(u.uFlare.value, flareTarget, phase === "consume" ? 2.2 : 5);
    if (phase === "consume") {
      u.uFlare.value *= 0.92 + 0.08 * Math.sin(state.clock.elapsedTime * 7);
    }

    u.uFade.value = damp(u.uFade.value, active ? 1 : 0, active ? 6 : 2.5);
    u.uMouse.value.x = damp(u.uMouse.value.x, pointer.current.x, 5);
    u.uMouse.value.y = damp(u.uMouse.value.y, pointer.current.y, 5);

    if (mesh.current) mesh.current.visible = u.uFade.value > 0.004;
  });

  return (
    <mesh ref={mesh} frustumCulled={false} renderOrder={-10} material={material}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
}
