import * as THREE from "three";
interface ISceneHandler {
  init: (camera: any) => void;
}
class SceneHandler implements ISceneHandler {
  public scene: THREE.Scene | undefined;
  private helperScene: THREE.Scene | undefined;
  private defaultBgc = "#fafdff";
  private bgc = new Map([
    ["white", "#fafdff"],
    ["black", "#202228"],
    ["dobotBlue", "#EDF2F8"],
    ['dobotCinerous', '#F6F9FB']
  ]);
  public getScene() {
    return this.scene;
  }
  public init() {
    this.scene = new THREE.Scene();
    this.scene.updateMatrixWorld(true);
    const color = localStorage.getItem("toggleBgc");
    this.scene.background = new THREE.Color(
      color ? this.bgc.get(JSON.parse(color)) : this.defaultBgc
    );
  }
  public getHelperScene() {
    return this.helperScene;
  }
  public initHelperScene() {
    this.helperScene = new THREE.Scene();
    this.helperScene.updateMatrixWorld(true);
  }
  public toggleBgc(color: string) {
    if (this.scene) {
      this.scene.background = new THREE.Color(this.bgc.get(color));
    } else {
      this.defaultBgc = this.bgc.get(color) as string;
    }
  }
}

export default new SceneHandler();
