import * as THREE from "three";
interface ILightHandler {
  init: (scene: any, renderer: any) => void;
}
class LightHandler implements ILightHandler {
  spotLight?: THREE.SpotLight;
  spotLight2?: THREE.SpotLight;
  ambientLight?: THREE.AmbientLight;
  isInitDarkLight = false;
  public init(scene: any, renderer: any) {
    const intensity = 0.75;
    let directionLight1 = new THREE.DirectionalLight("#ffffff", intensity);
    directionLight1.position.set(0, 0, -1);
    scene.add(directionLight1);
    directionLight1 = new THREE.DirectionalLight("#ffffff", intensity);
    directionLight1.position.set(0, 0, 1);
    scene.add(directionLight1);
    directionLight1 = new THREE.DirectionalLight("#ffffff", intensity);
    directionLight1.position.set(1, 0, 0);
    scene.add(directionLight1);
    directionLight1 = new THREE.DirectionalLight("#ffffff", intensity);
    directionLight1.position.set(-1, 0, 0);
    scene.add(directionLight1);
    directionLight1 = new THREE.DirectionalLight("#ffffff", intensity);
    directionLight1.position.set(0, 1, 0);
    scene.add(directionLight1);
    directionLight1 = new THREE.DirectionalLight("#ffffff", intensity);
    directionLight1.position.set(0, -1, 0);
    scene.add(directionLight1);
    const ambientLight = new THREE.AmbientLight("#ffffff", 0.8);
    scene.add(ambientLight);

    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
  }
}

export default new LightHandler();
