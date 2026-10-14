// Світлове середовище «кімната» для відбиттів на моделях (PMREMGenerator.fromScene).
// Це копія класу RoomEnvironment із three r160 (MIT, © 2010-2023 three.js authors) з тією самою слабкою головною лампою (intensity 5),
// з якою довідники були затверджені. У новіших версіях three вона 900, середовище яскравіше, і моделі виглядають світлішими й плоскішими.
// Сцену взято з https://github.com/google/model-viewer/blob/master/packages/model-viewer/src/three-components/EnvironmentScene.ts
import {BackSide, BoxGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial, PointLight, Scene} from 'three';

export class RoomEnvironment extends Scene {
  constructor() {
    super();
    const geometry = new BoxGeometry();
    geometry.deleteAttribute('uv');
    const roomMaterial = new MeshStandardMaterial({side: BackSide});
    const boxMaterial = new MeshStandardMaterial();

    const mainLight = new PointLight(0xffffff, 5, 28, 2);
    mainLight.position.set(0.418, 16.199, 0.300);
    this.add(mainLight);

    const room = new Mesh(geometry, roomMaterial);
    room.position.set(-0.757, 13.219, 0.717);
    room.scale.set(31.713, 28.305, 28.591);
    this.add(room);

    const box = (p, r, s) => {
      const m = new Mesh(geometry, boxMaterial);
      m.position.set(...p); m.rotation.set(0, r, 0); m.scale.set(...s);
      this.add(m);
    };
    box([-10.906, 2.009, 1.846], -0.195, [2.328, 7.905, 4.651]);
    box([-5.607, -0.754, -0.758], 0.994, [1.970, 1.534, 3.955]);
    box([6.167, 0.857, 7.803], 0.561, [3.927, 6.285, 3.687]);
    box([-2.017, 0.018, 6.124], 0.333, [2.002, 4.566, 2.064]);
    box([2.291, -0.756, -2.621], -0.286, [1.546, 1.552, 1.496]);
    box([-2.193, -0.369, -5.547], 0.516, [3.875, 3.487, 2.986]);

    // Панелі світла: -x праворуч, -x ліворуч, +x, +z, -z, +y.
    const panel = (k, p, s) => {
      const m = new Mesh(geometry, areaLightMaterial(k));
      m.position.set(...p); m.scale.set(...s);
      this.add(m);
    };
    panel(50, [-16.116, 14.37, 8.208], [0.1, 2.428, 2.739]);
    panel(50, [-16.109, 18.021, -8.207], [0.1, 2.425, 2.751]);
    panel(17, [14.904, 12.198, -1.832], [0.15, 4.265, 6.331]);
    panel(43, [-0.462, 8.89, 14.520], [4.38, 5.441, 0.088]);
    panel(20, [3.235, 11.486, -12.541], [2.5, 2.0, 0.1]);
    panel(100, [0.0, 20.0, 0.0], [1.0, 0.1, 1.0]);
  }

  dispose() {
    const resources = new Set();
    this.traverse((o) => { if (o.isMesh) { resources.add(o.geometry); resources.add(o.material); } });
    for (const r of resources) r.dispose();
  }
}

function areaLightMaterial(intensity) {
  const material = new MeshBasicMaterial();
  material.color.setScalar(intensity);
  return material;
}
