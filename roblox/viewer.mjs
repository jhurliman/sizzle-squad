// Reconstructs the converted Roblox parts in three.js for a visual sanity
// render. Geometry is built from parts.json exactly as Roblox would interpret
// it: Block -> box, Cylinder -> cylinder along local X, Ball/SphereMesh ->
// (ellipsoid) sphere.
import * as THREE from '../node_modules/three/build/three.module.js';

const data = window.__PARTS__;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9db4c4);

const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
sun.position.set(30, 80, 60);
scene.add(sun);
scene.add(new THREE.AmbientLight(0xb0a090, 1.6));
scene.add(new THREE.HemisphereLight(0xcfd8e6, 0x6b5a44, 0.7));

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
unitCyl.rotateZ(-Math.PI / 2); // axis along X, like a Roblox cylinder
const unitBall = new THREE.SphereGeometry(0.5, 18, 12);

const mats = new Map();
function matFor(p) {
  const key = p.color.join() + p.material;
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({
      color: new THREE.Color(p.color[0] / 255, p.color[1] / 255, p.color[2] / 255),
    });
    mats.set(key, m);
  }
  return m;
}

for (const p of data.parts) {
  const geo = p.shape === 'Cylinder' ? unitCyl : p.shape === 'Block' ? unitBox : unitBall;
  const mesh = new THREE.Mesh(geo, matFor(p));
  const c = p.cf;
  const M = new THREE.Matrix4().set(
    c[3], c[4], c[5], c[0],
    c[6], c[7], c[8], c[1],
    c[9], c[10], c[11], c[2],
    0, 0, 0, 1,
  );
  M.multiply(new THREE.Matrix4().makeScale(p.size[0], p.size[1], p.size[2]));
  mesh.applyMatrix4(M);
  scene.add(mesh);
}

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(1280, 800);
document.body.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(40, 1280 / 800, 1, 500);

window.__shoot = (mode) => {
  if (mode === 'top') {
    camera.position.set(37.5, 150, 38);
    camera.up.set(0, 0, -1);
    camera.lookAt(37.5, 0, 38);
  } else {
    // roughly the game's own framing: front-above, looking at the back wall
    camera.position.set(37.5, 55, 105);
    camera.up.set(0, 1, 0);
    camera.lookAt(37.5, 4, 22);
  }
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL('image/png');
};
window.__ready = true;
