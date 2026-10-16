import { useEffect, useMemo, useState } from "react";
import { useThree } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import * as THREE from "three";
import type { Quality } from "./quality";

/**
 * Deep space around the board: a nebula and a field of stars. The nebula's noise is far too costly
 * to run for every pixel every frame, so it is painted once into a cube map and the sky just looks that up.
 * The stars hold still: drei pulses every star in unison, and drifting sparkles bloom into bright blobs when
 * they pass near the camera, which both read as the background flashing.
 */
export function Sky({ quality }: { quality: Quality }) {
  const { gl } = useThree();
  const paint = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { uTime: { value: 0 } },
        vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          varying vec3 vDir; uniform float uTime;
          vec3 hash3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(vec3(p.x*p.y*p.z, p.x+p.y*p.z, p.x*p.y+p.z)); }
          float noise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
            float n000 = hash3(i).x, n100 = hash3(i+vec3(1,0,0)).x, n010 = hash3(i+vec3(0,1,0)).x, n110 = hash3(i+vec3(1,1,0)).x;
            float n001 = hash3(i+vec3(0,0,1)).x, n101 = hash3(i+vec3(1,0,1)).x, n011 = hash3(i+vec3(0,1,1)).x, n111 = hash3(i+vec3(1,1,1)).x;
            return mix(mix(mix(n000,n100,f.x), mix(n010,n110,f.x), f.y), mix(mix(n001,n101,f.x), mix(n011,n111,f.x), f.y), f.z); }
          float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
          void main(){
            vec3 d = normalize(vDir);
            float t = uTime * 0.012;
            float n = fbm(d * 2.2 + vec3(t, -t * 0.7, t * 0.4));
            float m = fbm(d * 4.5 - vec3(t * 0.5, t, 0.0) + n);
            vec3 deep = vec3(0.02, 0.005, 0.06);
            vec3 purple = vec3(0.32, 0.06, 0.62);
            vec3 pink = vec3(0.85, 0.08, 0.5);
            vec3 cyan = vec3(0.05, 0.55, 0.85);
            vec3 col = deep;
            col = mix(col, purple, smoothstep(0.38, 0.75, n) * 0.85);
            col = mix(col, pink, smoothstep(0.55, 0.85, m) * 0.6 * smoothstep(0.3, 0.7, n));
            col = mix(col, cyan, smoothstep(0.62, 0.9, m * n * 1.6) * 0.4);
            // a brighter band of gas behind the board
            float band = exp(-pow(d.y * 3.2 + 0.4, 2.0));
            col += purple * band * 0.25;
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    [],
  );
  const [cube, setCube] = useState<THREE.CubeTexture | null>(null);
  useEffect(() => {
    const size = quality === "high" ? 1024 : 512;
    const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
    const scene = new THREE.Scene();
    const sphere = new THREE.SphereGeometry(300, 48, 24);
    scene.add(new THREE.Mesh(sphere, paint));
    new THREE.CubeCamera(1, 1000, rt).update(gl, scene);
    sphere.dispose();
    setCube(rt.texture);
    return () => rt.dispose();
  }, [gl, paint, quality]);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { uSky: { value: null } },
        vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `varying vec3 vDir; uniform samplerCube uSky; void main(){ gl_FragColor = vec4(textureCube(uSky, normalize(vDir)).rgb, 1.0); }`,
      }),
    [],
  );
  mat.uniforms.uSky.value = cube;
  return (
    <>
      {cube && (
        <mesh material={mat} renderOrder={-10}>
          <sphereGeometry args={[300, 48, 24]} />
        </mesh>
      )}
      <Stars radius={180} depth={80} count={quality === "high" ? 6000 : 2500} factor={5} saturation={0.6} fade speed={0} />
    </>
  );
}
