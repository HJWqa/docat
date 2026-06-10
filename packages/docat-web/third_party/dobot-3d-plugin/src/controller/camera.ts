import mathTool from "../MathTool";
import * as THREE from "three";
class CameraHandler {
  public camera: THREE.PerspectiveCamera | undefined;
  public helperCamera: THREE.PerspectiveCamera | undefined;
  public cameraMap = new Map();
  private cameraPosition = { x: 100, y: 50, z: 1400 };
  private slopeAngle = 0;
  public init(WHRatio: number) {
    this.camera = new THREE.PerspectiveCamera(45, WHRatio, 0.1, 6000);
    this.camera.position.set(
      this.cameraPosition.x,
      this.cameraPosition.y,
      this.cameraPosition.z
    );
    this.camera.zoom = 0.5;
    this.cameraMap.set(0, this.camera);
  }
  public initHelperCamera() {
    this.helperCamera = new THREE.PerspectiveCamera(45, 1, .1, 6000);
    this.helperCamera.position.set(
      150,
      100,
      -150
    );
    this.helperCamera.lookAt(1, 1, -1);
  }
  public resizeViewport(container: HTMLElement) {
    this.camera!.aspect = container.clientWidth / container.clientHeight;
    this.camera!.updateProjectionMatrix();
  }
  public setZoom(zoom: number) {
    let limit = Math.max(0.1, zoom);
    limit = Math.min(1.5, zoom);
    this.camera!.zoom = limit;
  }
  public setPosition(coordinate: { x?: number; y?: number; z?: number }) {
    this.cameraPosition = Object.assign(this.cameraPosition, coordinate);
    this.camera!.position.set(
      this.cameraPosition.x,
      this.cameraPosition.y,
      this.cameraPosition.z
    );
  }
  public setRotation(value: number) {
    this.slopeAngle = value;
    const target = this.cameraMap.get(value);
    if (!target) {
      const target = this.camera!.clone();
      target.rotation.z = mathTool.transformDeg(this.slopeAngle);
      this.camera = target;
      this.cameraMap.set(value, this.camera);
    } else {
      this.camera = target;
    }
  }
}

export default new CameraHandler();
