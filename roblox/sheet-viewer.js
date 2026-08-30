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
unitCyl.rotateZ(-Math.PI / 2);
const unitBall = new THREE.SphereGeometry(0.5, 18, 12);
for (const p of data.parts) {
  const geo = p.shape === 'Cylinder' ? unitCyl : p.shape === 'Block' ? unitBox : unitBall;
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({ color: new THREE.Color(p.color[0] / 255, p.color[1] / 255, p.color[2] / 255) }),
  );
  const c = p.cf;
  const M = new THREE.Matrix4().set(c[3], c[4], c[5], c[0], c[6], c[7], c[8], c[1], c[9], c[10], c[11], c[2], 0, 0, 0, 1);
  M.multiply(new THREE.Matrix4().makeScale(p.size[0], p.size[1], p.size[2]));
  mesh.applyMatrix4(M);
  scene.add(mesh);
}
const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 60), new THREE.MeshLambertMaterial({ color: 0x8a8378 }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(1280, 640);
document.body.appendChild(renderer.domElement);
const camera = new THREE.PerspectiveCamera(30, 1280 / 640, 1, 500);
camera.position.set(0, 6, 32);
camera.lookAt(0, 4.4, 0);
renderer.render(scene, camera);
window.__shot = renderer.domElement.toDataURL('image/png');
