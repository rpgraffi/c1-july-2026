import * as THREE from "three";

/**
 * Dev-only workaround: the Lovable vite config enables TanStack devtools'
 * `injectSource`, which stamps every JSX element with
 * `data-tsd-source="file:line:col"`. react-three-fiber resolves dashed props
 * as nested paths, so on <mesh>/<group>/… it tries to set
 * `object.data.tsd.source` and throws, killing the canvas on every HMR
 * update. Giving the three prototypes a shared `data: { tsd: {} }` bag lets
 * that write land harmlessly.
 */
if (import.meta.env.DEV) {
  for (const proto of [
    THREE.Object3D.prototype,
    THREE.BufferGeometry.prototype,
    THREE.Material.prototype,
  ]) {
    if (!Object.getOwnPropertyDescriptor(proto, "data")) {
      Object.defineProperty(proto, "data", {
        value: { tsd: {} },
        writable: true,
        configurable: true,
      });
    }
  }
}
