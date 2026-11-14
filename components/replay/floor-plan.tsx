"use client";

import { Canvas } from "@react-three/fiber";

export default function FloorPlan({
  waiting,
  serving,
  stations,
  selected,
  select,
}: {
  waiting: string[];
  serving: [string, number][];
  stations: number;
  selected: string;
  select: (id: string) => void;
}) {
  const customers = [
    ...waiting.map((id, index) => ({
      id,
      x: -3 + (index % 8) * 0.8,
      z: 1 + Math.floor(index / 8) * 0.6,
    })),
    ...serving.map(([id, station]) => ({
      id,
      x: station * 2.5 - 1.25,
      z: -0.3,
    })),
  ];
  return (
    <Canvas
      orthographic
      camera={{ position: [0, 11, 8], zoom: 37 }}
      fallback={
        <p className="p-4">
          The 3D layout needs WebGL. Customer details are available below.
        </p>
      }
    >
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[9, 7]} />
        <meshBasicMaterial color="#e2efdf" />
      </mesh>
      {Array.from({ length: stations }, (_, index) => (
        <mesh key={index} position={[index * 2.5 - 1.25, 0.35, -1.45]}>
          <boxGeometry args={[1.9, 0.7, 0.85]} />
          <meshBasicMaterial color="#1b4937" />
        </mesh>
      ))}
      {customers.map(({ id, x, z }) => (
        <mesh
          key={id}
          position={[x, 0.35, z]}
          onClick={(event) => {
            event.stopPropagation();
            select(id);
          }}
        >
          <sphereGeometry args={[0.27, 16, 12]} />
          <meshBasicMaterial color={id === selected ? "#b05317" : "#407baf"} />
        </mesh>
      ))}
    </Canvas>
  );
}
