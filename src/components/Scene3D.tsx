import { OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo } from "react";
import * as THREE from "three";
import { buildCityGroup, disposeObject } from "../lib/buildCity";
import type { CityModel } from "../types";

function CameraRig({ side }: { side: number }) {
  const camera = useThree((state) => state.camera);
  useLayoutEffect(() => {
    camera.position.set(side * 0.78, side * 0.62, side * 0.86);
    camera.near = Math.max(0.1, side / 400);
    camera.far = side * 40;
    camera.lookAt(0, side * 0.03, 0);
    camera.updateProjectionMatrix();
  }, [camera, side]);
  return null;
}

function City({ model }: { model: CityModel }) {
  const group = useMemo(() => {
    const city = buildCityGroup(model);
    const ground = city.getObjectByName("Ground");
    if (ground && ground instanceof THREE.Mesh) {
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(ground.geometry),
        new THREE.LineBasicMaterial({ color: "#2c2924" }),
      );
      edges.position.copy(ground.position);
      edges.name = "GroundEdge";
      city.add(edges);
    }
    return city;
  }, [model]);
  useEffect(() => () => disposeObject(group), [group]);
  return <primitive object={group} />;
}

export function Scene3D({ model }: { model: CityModel }) {
  return (
    <Canvas
      className="scene-canvas"
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: false }}
      camera={{ fov: 32, position: [model.sideM, model.sideM, model.sideM] }}
    >
      <color attach="background" args={["#e7e4dc"]} />
      <hemisphereLight args={["#f7f4ee", "#c9c0b2", 0.7]} />
      <ambientLight intensity={0.28} />
      <directionalLight position={[model.sideM * 0.4, model.sideM, model.sideM * 0.2]} intensity={1.35} />
      <City model={model} />
      <CameraRig side={model.sideM} />
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        target={[0, model.sideM * 0.02, 0]}
        maxPolarAngle={Math.PI / 2.02}
        minDistance={model.sideM * 0.2}
        maxDistance={model.sideM * 3.4}
      />
    </Canvas>
  );
}
