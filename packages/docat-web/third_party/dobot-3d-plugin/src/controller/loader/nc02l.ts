import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { Group } from "three";
import mathTool from "../../MathTool/index";
import * as THREE from "three";
import CrWorkspaceLoader from "../workspaceLoader/cr5";
import { IDeviceLoader } from "..";
import { TSecWallType, TWorkZoneType } from "src/protocol";
import sceneHandler from "../scene";
import { handleModel } from ".";
import { CoordinateType } from "../type";
class NC02LLoader implements IDeviceLoader {
  private base: Group | undefined;
  private J1: Group | undefined;
  private J2: Group | undefined;
  private J3: Group | undefined;
  private J4: Group | undefined;
  private J5: Group | undefined;
  private J6: Group | undefined;
  private axisHelp1: THREE.Object3D | undefined;
  private axisHelp2: THREE.Object3D | undefined;
  private axisHelp3: THREE.Object3D | undefined;
  private axisHelp4: THREE.Object3D | undefined;
  private axisHelp5: THREE.Object3D | undefined;
  private axisHelp6: THREE.Object3D | undefined;
  private axisHelp7: THREE.Object3D | undefined;
  private axisHelp8: THREE.Object3D | undefined;

  private virtualAxisHelp1: THREE.Object3D | undefined;
  private virtualAxisHelp2: THREE.Object3D | undefined;
  private virtualAxisHelp3: THREE.Object3D | undefined;
  private virtualAxisHelp4: THREE.Object3D | undefined;
  private virtualAxisHelp5: THREE.Object3D | undefined;
  private virtualAxisHelp6: THREE.Object3D | undefined;
  private virtualAxisHelp7: THREE.Object3D | undefined;
  private zeroGroupHelper: THREE.Object3D | undefined;
  private workspace: THREE.Group | undefined;
  private toolEndPoint: THREE.Mesh | undefined;
  public toolAxes!: THREE.AxesHelper;
  private secWallGroup = new THREE.Group();
  private workZoneGroup = new THREE.Group();
  private userAxisGroup = new THREE.Group();
  private toolAxisGroup = new THREE.Group();
  private wallSphere?: THREE.Object3D;
  private zoneSphere?: THREE.Object3D;
  private timer?: NodeJS.Timeout;
  private axisHelpSphere?: THREE.Object3D;
  private baseHelper: THREE.Object3D | undefined;

  public load(scence: THREE.Scene) {
    return new Promise((res) => {
      let promiseArr: any[] = [];
      const pathArr = [
        "nc02l/1.glb",
        "nc02l/2.glb",
        "nc02l/3.glb",
        "nc02l/4.glb",
        "nc02l/5.glb",
        "nc02l/6.glb",
        "nc02l/7.glb",
      ];
      pathArr.map((path) => promiseArr.push(handleModel(path)));
      Promise.all(promiseArr).then((gltf) => {
        this.base = gltf[0];
        this.J1 = gltf[1];
        this.J2 = gltf[2];
        this.J3 = gltf[3];
        this.J4 = gltf[4];
        this.J5 = gltf[5];
        this.J6 = gltf[6];
        mathTool.moveModelToCenter(this.base!);
        this.initAxesHelper(scence);
        res(true);
      });
    });
  }

  public initWorkspace(scence: THREE.Scene) {
    //workspace
    this.workspace = new CrWorkspaceLoader({
      radius: 850,
      topRadius: 131.9,
      top: 163.4,
    });
    this.workspace.scale.set(0.6, 0.6, 0.6);
    this.workspace.visible = false;
    scence.add(this.workspace);
  }

  public initAxesHelper(scence: THREE.Scene) {
    // 初始Helper，控制所有机型初始视角一致
    this.baseHelper = new THREE.Object3D();
    this.baseHelper!.rotation.y = mathTool.transformDeg(135);
    scence.add(this.baseHelper);
    //base
    this.axisHelp1 = new THREE.Object3D();
    this.axisHelp1.position.set(0, -520, 0);
    this.axisHelp1.scale.set(1.15, 1.15, 1.15);
    this.axisHelp1.add(this.base!);
    this.baseHelper.add(this.axisHelp1!);
    //J1
    this.axisHelp2 = new THREE.Object3D();
    this.axisHelp2.position.set(-0.5, 60, 0);
    this.J1!.position.set(0.2, 0, 0);
    this.axisHelp2.add(this.J1!);
    //J2
    this.axisHelp3 = new THREE.Object3D();
    this.axisHelp3.position.set(-65, 88, 0);
    this.J2?.position.set(4.5, 0, 0);
    this.axisHelp3.add(this.J2!);
    //J3
    this.axisHelp4 = new THREE.Object3D();
    this.axisHelp4.position.set(20, 400, 0);
    this.J3!.position.set(-15, -1, 0);
    this.axisHelp4.add(this.J3!);
    //J4
    this.axisHelp5 = new THREE.Object3D();
    this.axisHelp5.position.set(-40, 330, 0);
    this.J4!.position.set(26, -0.5, 0);
    this.axisHelp5.add(this.J4!);
    //J5
    this.axisHelp6 = new THREE.Object3D();
    this.axisHelp6.position.set(-45.5, 70, 0);
    this.J5!.position.set(0, -6, 0);
    this.axisHelp6.add(this.J5!);
    //J6
    this.axisHelp7 = new THREE.Object3D();
    this.axisHelp7.position.set(-58, 50.5, 0);
    this.J6!.position.set(8, 0, 0);
    this.axisHelp7!.rotation.x = mathTool.transformDeg(180);
    this.axisHelp7.add(this.J6!);

    //toolEndPoint
    this.axisHelp8 = new THREE.Object3D();
    this.axisHelp8.rotation.set(0, -Math.PI / 2, 0);
    this.axisHelp8!.position.set(-30, 0, 0);
    var sphereGeometry = new THREE.SphereGeometry(0.1, 20, 20);
    var sphereMaterial = new THREE.MeshBasicMaterial({
      toneMapped: false,
      color: "#ff0000",
      opacity: 0,
    });
    this.toolEndPoint = new THREE.Mesh(sphereGeometry, sphereMaterial);
    this.toolEndPoint.matrixWorldNeedsUpdate = true;
    this.toolEndPoint.position.set(0, 0, 0);
    this.axisHelp8!.add(this.toolEndPoint);
    this.axisHelp8!.add(this.toolAxisGroup);

    // zeroGroupHelper
    this.zeroGroupHelper = new THREE.Object3D();
    this.axisHelp1!.add(this.zeroGroupHelper);
    this.zeroGroupHelper.position.set(-0.5, -67, 0);
    this.zeroGroupHelper!.rotation.z = mathTool.transformDeg(-90);
    this.zeroGroupHelper!.rotation.x = mathTool.transformDeg(-90);
    this.zeroGroupHelper!.add(this.secWallGroup);
    this.zeroGroupHelper!.add(this.workZoneGroup);
    this.zeroGroupHelper!.add(this.userAxisGroup);

    this.initTargetPositionAxis();
  }

  public viewJogRotateCal(value: number) {
    if (!this.axisHelp1) return;
    // 视图点动，保持基于机器基坐标系不变，变化机器角度，同时通知pro更新视图对应的坐标系
    this.axisHelp1!.rotation.y += value;
    const rotationXDegrees = THREE.MathUtils.radToDeg(
      this.axisHelp1!.rotation.y
    );
    const RzAngel = ((rotationXDegrees % 360) + 360) % 360;
    // 视图点动的不断更新视图坐标系
    this.setBaseCoordinateAngle(RzAngel);
    // 经过计算的视图坐标系rz的角度
    const viewJogRzAngel =
      RzAngel >= 0 && RzAngel <= 180 ? -RzAngel : Number(360 - RzAngel);
    return viewJogRzAngel;
  }

  public setBaseCoordinateAngle(angle: number) {
    if (!this.zeroGroupHelper) return;
    this.zeroGroupHelper!.rotation.z = mathTool.transformDeg(-angle - 90);
  }
  public setBaseHelpInitAngle() {
    // 视图点动，所有机型都需要通过转换角度，把初始坐标系调整成与视角平行
    if (!this.baseHelper) return;
    this.baseHelper!.rotation.y = mathTool.transformDeg(180);
  }
  public initTargetPositionAxis() {
    // 克隆生成虚拟点位位置
    this.virtualAxisHelp1 = this.axisHelp1!.clone();
    this.axisHelp1!.add(this.axisHelp2!);
    this.virtualAxisHelp2 = this.axisHelp2!.clone();
    this.axisHelp2!.add(this.axisHelp3!);
    this.virtualAxisHelp3 = this.axisHelp3!.clone();
    this.axisHelp3!.add(this.axisHelp4!);
    this.virtualAxisHelp4 = this.axisHelp4!.clone();
    this.axisHelp4!.add(this.axisHelp5!);
    this.virtualAxisHelp5 = this.axisHelp5!.clone();
    this.axisHelp5!.add(this.axisHelp6!);
    this.virtualAxisHelp6 = this.axisHelp6!.clone();
    this.axisHelp6!.add(this.axisHelp7!);
    this.virtualAxisHelp7 = this.axisHelp7!.clone();
    this.axisHelp7!.add(this.axisHelp8!);
    this.baseHelper!.add(this.virtualAxisHelp1!);
    this.virtualAxisHelp1!.add(this.virtualAxisHelp2!);
    this.virtualAxisHelp2!.add(this.virtualAxisHelp3!);
    this.virtualAxisHelp3!.add(this.virtualAxisHelp4!);
    this.virtualAxisHelp4!.add(this.virtualAxisHelp5!);
    this.virtualAxisHelp5!.add(this.virtualAxisHelp6!);
    this.virtualAxisHelp6!.add(this.virtualAxisHelp7!);
    this.virtualAxisHelp1!.visible = false;
  }

  public show3DDTargetPosition(posData: number[]) {
    if (!this.virtualAxisHelp1) return;
    if (!posData.length) {
      this.virtualAxisHelp1!.visible = false;
      return;
    } else {
      this.virtualAxisHelp1!.visible = true;
    }
    this.baseHelper!.add(this.virtualAxisHelp1!);
    this.virtualAxisHelp1!.add(this.virtualAxisHelp2!);
    this.virtualAxisHelp2!.add(this.virtualAxisHelp3!);
    this.virtualAxisHelp3!.add(this.virtualAxisHelp4!);
    this.virtualAxisHelp4!.add(this.virtualAxisHelp5!);
    this.virtualAxisHelp5!.add(this.virtualAxisHelp6!);
    this.virtualAxisHelp6!.add(this.virtualAxisHelp7!);
    const clonedMaterial = new THREE.MeshBasicMaterial({
      toneMapped: false,
      color: 0x056de8,
      transparent: true,
      opacity: 0.5,
    });
    const clonedMaterialTool = new THREE.MeshBasicMaterial({
      toneMapped: false,
      color: 0x191970,
      transparent: true,
      opacity: 0.7,
    });
    this.virtualAxisHelp1!.traverse((node: any) => {
      if (node.isMesh) {
        node.material = clonedMaterial;
      }
    });
    this.virtualAxisHelp7!.traverse((node: any) => {
      if (node.isMesh) {
        node.material = clonedMaterialTool;
      }
    });
    this.virtualAxisHelp2!.rotation.y = mathTool.transformDeg(posData[0] || 0);
    this.virtualAxisHelp3!.rotation.x = mathTool.transformDeg(-posData[1] || 0);
    this.virtualAxisHelp4!.rotation.x = mathTool.transformDeg(-posData[2] || 0);
    this.virtualAxisHelp5!.rotation.x = mathTool.transformDeg(-posData[3] || 0);
    this.virtualAxisHelp6!.rotation.y = mathTool.transformDeg(posData[4] || 0);
    this.virtualAxisHelp7!.rotation.x = mathTool.transformDeg(
      -posData[5] + 180 || 180
    );
  }

  public hide() {
    if (this.axisHelp1) {
      this.axisHelp1.visible = false;
    }
    if (this.workspace) {
      this.workspace!.visible = false;
    }
  }
  public async show() {
    if (this.axisHelp1) {
      this.axisHelp1!.visible = true;
      return false;
    }
    await this.load(sceneHandler.getScene()!);
    return true;
  }
  public toggleWorkspace(newValue: boolean) {
    this.workspace && (this.workspace!.visible = newValue);
  }
  public animate(
    J1: number,
    J2: number,
    J3: number,
    J4: number,
    J5: number,
    J6: number
  ) {
    if (!this.axisHelp1) return;
    J1 = J1 || 0;
    J2 = J2 || 0;
    J3 = J3 || 0;
    J4 = J4 || 0;
    J5 = J5 || 0;
    J6 = J6 || 0;
    this.axisHelp2!.rotation.y = mathTool.transformDeg(J1);
    this.axisHelp3!.rotation.x = mathTool.transformDeg(-J2);
    this.axisHelp4!.rotation.x = mathTool.transformDeg(-J3);
    this.axisHelp5!.rotation.x = mathTool.transformDeg(-J4);
    this.axisHelp6!.rotation.y = mathTool.transformDeg(J5);
    this.axisHelp7!.rotation.x = mathTool.transformDeg(-J6 + 180);

    // this.checkCollideMesh();

    return this.toolEndPoint;
  }
  public getInstall(data: { slopeAngle: number; rotationAngle: number }) {
    this.axisHelp1!.rotation.y = mathTool.transformDeg(data.rotationAngle + 90);
  }
  public secWall(data: TSecWallType[]) {
    this.removeAxisHelpSphere(data);
    this.removeSphere(data, "wallSphere");
    while (this.secWallGroup.children.length) {
      mathTool.deleteGroup(this.secWallGroup);
    }
    if (data && data.length) {
      this.setAxisHelpSphere(data);
      this.setSphere(data, "wallSphere");
      data.map((item) => {
        const point1 = new THREE.Vector3(
          item.point1[0],
          item.point1[1],
          item.point1[2]
        );
        const point2 = new THREE.Vector3(
          item.point2[0],
          item.point2[1],
          item.point2[2]
        );
        const point3 = new THREE.Vector3(
          item.point3[0],
          item.point3[1],
          item.point3[2]
        );
        if (item.enable && item.type !== 3) {
          const targetPlane = mathTool.creatPlane(
            point1,
            point2,
            point3,
            item.type,
            "NC02L",
            !!item.pv,
            item.isSideinverted
          );
          this.secWallGroup.add(targetPlane);
        }
      });
    }
  }
  public setWorkZone(data: TWorkZoneType[]) {
    this.removeSphere(data, "zoneSphere");
    while (this.workZoneGroup.children.length) {
      mathTool.deleteGroup(this.workZoneGroup);
    }
    if (data && data.length) {
      this.setSphere(data, "zoneSphere");
      data.map((item) => {
        if (item.enable) {
          const zone = mathTool.creatWorkZone(item.acmePoints, item.type);
          this.workZoneGroup.add(zone);
        }
      });
    }
  }

  public initCoordinate(data: any) {
    if (data) {
      while (this.userAxisGroup.children.length) {
        mathTool.deleteGroup(this.userAxisGroup);
      }
      while (this.toolAxisGroup.children.length) {
        mathTool.deleteGroup(this.toolAxisGroup);
      }
      Object.keys(data).forEach((key: any) => {
        if (data[key] && data[key].length > 0) {
          const coordinate = mathTool.creatAxis({
            isGlobal: false,
            lens: key === "user" ? 400 : 200,
          });
          coordinate?.rotateOnWorldAxis(
            new THREE.Vector3(1, 0, 0),
            mathTool.transformDeg(data[key][3])
          );
          coordinate?.rotateOnWorldAxis(
            new THREE.Vector3(0, 1, 0),
            mathTool.transformDeg(data[key][4])
          );
          coordinate?.rotateOnWorldAxis(
            new THREE.Vector3(0, 0, 1),
            mathTool.transformDeg(data[key][5])
          );
          coordinate.position.set(data[key][0], data[key][1], data[key][2]);
          key === "user" && this.userAxisGroup.add(coordinate);
          key === "tool" && this.toolAxisGroup.add(coordinate);

          // 工具坐标系变动后，更新安全区域、安全墙的末端球位置
          if (key === "tool") {
            this.axisHelp8!.children!.forEach((item) => {
              if (
                ["wallSphere", "zoneSphere"].includes(
                  item.userData.customToolSphereType
                )
              ) {
                // 获取坐标系点
                const positionPoint: any = this.toolAxisGroup.children[0];
                // 转换世界坐标
                const itemWorldPosition = positionPoint.getWorldPosition(
                  new THREE.Vector3()
                );
                // 转换为基于 axisHelp8 实际坐标
                const localPosition = this.axisHelp8!.worldToLocal(
                  itemWorldPosition.clone()
                );
                // 改变坐标位置
                item.position.copy(localPosition);
              }
            });
          }
        }
      });
    }
  }
  public updateCoordinate(type: CoordinateType) {
    if (type === CoordinateType.All) {
      if (this.userAxisGroup) {
        this.userAxisGroup.visible = true;
      }
      if (this.toolAxisGroup) {
        this.toolAxisGroup.visible = true;
      }
      return;
    }
    if (this.userAxisGroup) {
      this.userAxisGroup.visible = type === CoordinateType.Cartesian;
    }
    if (this.toolAxisGroup) {
      this.toolAxisGroup.visible = type === CoordinateType.Tool;
    }
  }
  public setAxisHelpSphere(data: any) {
    if (this.axisHelpSphere) {
      this.axisHelp4!.remove(this.axisHelpSphere!);
    }
    if (!data.some((item: any) => item.enable)) {
      return;
    }
    this.axisHelpSphere = mathTool.creatSphereMaterial(80);
    this.axisHelpSphere!.position.set(40, 0, 0);
    this.axisHelp4!.add(this.axisHelpSphere!);
    this.axisHelpSphere!.visible = data[0].isElbowLimited;
  }
  public setSphere(data: any, type: "wallSphere" | "zoneSphere") {
    if (this[type]) {
      this.axisHelp8!.remove(this[type]!);
    }
    if (!data.some((item: any) => item.enable)) {
      return;
    }

    // 创建球
    const tempMesh = mathTool.creatSphereMaterial(data[0].radius);
    // 自定义的标记属性
    tempMesh.userData.customToolSphereType = type;
    // 设置位置
    tempMesh.position.set(0, 0, 0);
    if (this.toolAxisGroup.children.length !== 0) {
      // 获取坐标系点
      const positionPoint: any = this.toolAxisGroup.children[0];
      // 转换世界坐标
      const itemWorldPosition = positionPoint.getWorldPosition(
        new THREE.Vector3()
      );
      // 转换为基于 axisHelp8 实际坐标
      const localPosition = this.axisHelp8!.worldToLocal(
        itemWorldPosition.clone()
      );
      // 改变坐标位置
      tempMesh.position.copy(localPosition);
    }

    // 设置到本地，以及联合到坐标系上
    this[type] = tempMesh;
    this.axisHelp8!.add(this[type]!);
  }
  public removeAxisHelpSphere(data: any) {
    if (!data.length && this.axisHelpSphere) {
      this.axisHelp4!.remove(this.axisHelpSphere!);
    }
  }
  public removeSphere(data: any, type: "wallSphere" | "zoneSphere") {
    if (!data.length && this[type]) {
      this.axisHelp8!.remove(this[type]!);
    }
  }
  private checkCollideMesh() {
    if (!this.wallSphere! || !this.secWallGroup || !this.secWallGroup.children)
      return;
    const result = mathTool.checkCollideMesh(
      this.wallSphere!,
      this.secWallGroup.children
    );
    const { crash, collisionResults } = result;
    if (crash) {
      if (this.timer) {
        clearInterval(this.timer!);
      }
      this.timer = setInterval(() => {
        let opacity = collisionResults[0].object.material.opacity;
        if (opacity > 1) {
          opacity = 0.1;
        }
        collisionResults[0].object.material.opacity = opacity + 0.3;
      }, 120);
    } else {
      clearInterval(this.timer!);
    }
  }
}

export default new NC02LLoader();
