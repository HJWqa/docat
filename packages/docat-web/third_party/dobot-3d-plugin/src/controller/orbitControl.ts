import * as THREE from "three";
import OrbitControls from "three-orbitcontrols";
import cameraHandler from "./camera";
class OrbitControl {
  public control: any;
  enableZoom: boolean = false;
  init(camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer) {
    this.control = new OrbitControls(camera, renderer.domElement);
    this.control.maxDistance = 2000;
    this.control.minDistance = 1100;
    this.control.enableRotate = true;
    this.control.enablePan = false;
    this.control.enableZoom = true;
    this.control!.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
    // 设置上下运动范围
    this.control.minPolarAngle = THREE.MathUtils.degToRad(45); // 将角度转换为弧度
    this.control.maxPolarAngle = THREE.MathUtils.degToRad(135);
  }
  public update(value: number) {
    cameraHandler.setRotation(value);
    // this.control.object = cameraHandler.camera
  }
}

export default new OrbitControl();
