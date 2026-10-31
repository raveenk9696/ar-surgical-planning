import React, { Suspense } from "react";
import * as THREE from "three";
import { Canvas, useLoader } from "@react-three/fiber";
import { OrbitControls, Environment } from "@react-three/drei";
import "./style.css";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { Camera } from "three";

const red = new THREE.MeshLambertMaterial({ color: "red" });

const Scene = () => {
  const obj = useLoader(OBJLoader, "/Heart.obj", (loader) => {
    // loader.setMaterials(red);
  });

  console.log(obj);
  return <primitive object={obj} scale={0.1} />;
};

const Scene2 = () => {
  const obj = useLoader(PLYLoader, "/head2.ply", (loader) => {});

  console.log(obj);
  return <points object={obj} scale={1} />;
};

function App() {
  return (
    <Canvas style={{ background: "hotpink" }}>
      <ambientLight intensity={0.1} />
      <directionalLight color="red" position={[0, 0, 5]} />
      {/* <mesh>
        <boxGeometry />
        <meshStandardMaterial />
      </mesh> */}
      {/* <Suspense fallback={null}>
        <Scene />
      </Suspense> */}
      <Suspense fallback={null}>
        <Scene2 />
      </Suspense>
      <OrbitControls />
    </Canvas>
  );
}

export default App;
