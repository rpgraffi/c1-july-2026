import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { animTimeScale, LIGHT_PHASES, SCAN_SWEEP_S, type Phase } from "@/lib/phases";

/**
 * Stylized Earth filling the lower-left of the frame — sized/placed so the
 * horizon enters around 60% height at the left edge and curves down past the
 * bottom right, like the sketch. Everything is procedural (value-noise
 * continents + drifting clouds + fresnel atmosphere), no texture assets.
 *
 * The x-ray scan erases it: fragments left of uWipe (screen-space x, mirroring
 * the DOM backdrop wipe in index.tsx) turn transparent, so the sweep leaves
 * nothing but the clean light page behind.
 */
const RADIUS = 14;
const CENTER: [number, number, number] = [-5, -16.1, -4];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (v: number) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};

const surfaceVertex = /* glsl */ `
  varying vec3 vDir;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  varying vec4 vClip;
  void main() {
    vDir = normalize(position);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
    vClip = gl_Position;
  }
`;

const surfaceFragment = /* glsl */ `
  precision highp float;
  varying vec3 vDir;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  varying vec4 vClip;
  uniform float uTime;
  uniform float uWipe;

  float hash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
  }
  float noise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), u.x),
          mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), u.x), u.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), u.x),
          mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), u.x), u.y),
      u.z);
  }
  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p = p * 2.1 + 17.3;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    // vDir is object space, so continents spin with the mesh rotation. Only a
    // small cap of the huge sphere is on screen, hence the high frequencies.
    // Domain-warped fbm → crisp irregular coastlines instead of soft blobs.
    vec3 q = vec3(
      fbm(vDir * 4.0),
      fbm(vDir * 4.0 + vec3(5.2, 1.3, 2.8)),
      fbm(vDir * 4.0 + vec3(1.7, 9.2, 3.5))
    );
    float continents = fbm(vDir * 5.5 + q * 1.1);
    float land = smoothstep(0.485, 0.52, continents);

    float macro = fbm(vDir * 9.0);
    float detail = fbm(vDir * 26.0);
    float micro = fbm(vDir * 60.0); // fine terrain / wave grain

    vec3 ocean = mix(vec3(0.018, 0.075, 0.21), vec3(0.035, 0.125, 0.30), macro);
    ocean *= 0.95 + 0.10 * micro; // open water isn't flat

    // lowlands → highlands → rocky ridges → snow on the highest terrain,
    // with micro-noise relief so land reads as topography, not flat fill
    vec3 landC = mix(vec3(0.15, 0.41, 0.26), vec3(0.28, 0.36, 0.21), smoothstep(0.35, 0.75, detail));
    float relief = detail * 0.65 + micro * 0.35;
    landC = mix(landC, vec3(0.40, 0.40, 0.36), smoothstep(0.60, 0.76, relief));
    landC = mix(landC, vec3(0.85, 0.88, 0.92), smoothstep(0.78, 0.90, relief));
    landC *= 0.84 + 0.32 * micro;

    vec3 shore = vec3(0.10, 0.36, 0.37);
    vec3 surf = mix(ocean, mix(shore, landC, smoothstep(0.52, 0.60, continents)), land);

    // bright shallow-water shelf hugging the coastlines + a crisp foam line
    float shelf = smoothstep(0.42, 0.485, continents) * (1.0 - land);
    surf = mix(surf, vec3(0.05, 0.27, 0.38), shelf * 0.55);
    float foam = smoothstep(0.481, 0.488, continents) * (1.0 - smoothstep(0.490, 0.495, continents));
    surf = mix(surf, vec3(0.55, 0.75, 0.80), foam * 0.4);

    // three cloud layers drifting independently: big systems + wisps + curls,
    // with the finest layer also eroding the rims so edges stay feathery
    float cloudBase = fbm(vDir * 8.0 + vec3(uTime * 0.012, 0.0, uTime * 0.004));
    float wisps = fbm(vDir * 21.0 + vec3(-uTime * 0.006, uTime * 0.009, 0.0));
    float curls = fbm(vDir * 48.0 + vec3(uTime * 0.004, -uTime * 0.006, 0.0));
    float clouds = smoothstep(0.40, 0.72, cloudBase * 0.62 + wisps * 0.30 + curls * 0.18);
    clouds *= 0.75 + 0.35 * curls;
    surf = mix(surf, vec3(0.80, 0.85, 0.94), min(1.0, clouds) * 0.74);

    vec3 lightDir = normalize(vec3(0.35, 0.8, 0.5));
    float ndl = clamp(dot(vNormalW, lightDir), 0.0, 1.0);
    vec3 col = surf * (0.22 + 1.0 * ndl);

    // fresnel rim so the limb reads as atmosphere even inside the silhouette
    float rim = pow(1.0 - clamp(dot(vNormalW, vViewDir), 0.0, 1.0), 3.2);
    col += vec3(0.30, 0.52, 1.0) * rim * 0.55;

    // the x-ray wipe erases everything left of the line
    float sx = vClip.x / vClip.w * 0.5 + 0.5;
    float keep = smoothstep(uWipe, uWipe + 0.015, sx);

    gl_FragColor = vec4(col, keep);
  }
`;

const atmosphereVertex = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  varying vec4 vClip;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
    vClip = gl_Position;
  }
`;

// BackSide shell: visible fragments are the far hemisphere, where
// dot(normal, viewDir) runs from 0 at the shell's own silhouette to about
// -1/3.4 at the planet limb — remapped so the glow hugs the limb and feathers out.
const atmosphereFragment = /* glsl */ `
  precision highp float;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  varying vec4 vClip;
  uniform float uWipe;
  void main() {
    float glow = pow(clamp(dot(vNormalW, vViewDir) * -3.4, 0.0, 1.0), 1.5);
    float sx = vClip.x / vClip.w * 0.5 + 0.5;
    float keep = smoothstep(uWipe, uWipe + 0.015, sx);
    gl_FragColor = vec4(vec3(0.30, 0.52, 1.0) * glow * 1.35, glow * keep);
  }
`;

export function Earth({ phase }: { phase: Phase }) {
  const mesh = useRef<THREE.Mesh>(null);
  const prevPhase = useRef<Phase>(phase);
  const phaseStart = useRef(0);
  const ts = useMemo(() => animTimeScale(), []);

  // shared by surface + atmosphere so both wipe on the exact same line
  const wipeUniform = useMemo(() => ({ value: -0.15 }), []);

  const surface = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: surfaceVertex,
        fragmentShader: surfaceFragment,
        uniforms: { uTime: { value: 0 }, uWipe: wipeUniform },
        transparent: true,
      }),
    [wipeUniform],
  );
  const atmosphere = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: atmosphereVertex,
        fragmentShader: atmosphereFragment,
        uniforms: { uWipe: wipeUniform },
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [wipeUniform],
  );
  useEffect(
    () => () => {
      surface.dispose();
      atmosphere.dispose();
    },
    [surface, atmosphere],
  );

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    if (phase !== prevPhase.current) {
      prevPhase.current = phase;
      phaseStart.current = t;
    }

    surface.uniforms.uTime.value = t;
    if (mesh.current) mesh.current.rotation.y += dt * 0.006;

    // x-ray wipe: identical eased progress/amplitude to the DOM backdrop wipe
    // in index.tsx, so the Earth is erased on the exact same screen line. The
    // light phases hold it erased; going back to idle, the Earth glides back in.
    if (phase === "scan") {
      const p = clamp01((t - phaseStart.current) / ts / SCAN_SWEEP_S);
      wipeUniform.value = 0.5 + (2 * smooth(p) - 1) * 0.52 + 0.08 * smooth((p - 0.92) / 0.08);
    } else if (LIGHT_PHASES.includes(phase)) {
      wipeUniform.value = 1.2;
    } else {
      wipeUniform.value = THREE.MathUtils.damp(wipeUniform.value, -0.15, 2.5, dt);
    }
  });

  return (
    <group position={CENTER}>
      {/* only a ~55° arc of the sphere is on screen, so the segment counts
          need to be this high for a perfectly round limb */}
      <mesh ref={mesh} material={surface}>
        <sphereGeometry args={[RADIUS, 384, 192]} />
      </mesh>
      <mesh material={atmosphere} scale={1.045}>
        <sphereGeometry args={[RADIUS, 192, 96]} />
      </mesh>
    </group>
  );
}
