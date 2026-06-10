import renderHandler from "./renderer";
import sceneHandler from "./scene";
import LightHandler from "./light";
import cameraHandler from "./camera";
import { RoboticArmLoader } from "./loader/roboticArmLoader";
import cr3lLoader from "./loader/cr3l";
import nc02lLoader from "./loader/nc02l";
import floorHandler from "./floor";
import { TDeviceType, TSecWallType, TWorkZoneType } from "src/protocol";
import { store } from "src/reducer";
import {
  changePoseAction,
  toggleCoord,
  setSecWall,
  setWorkZone,
} from "src/reducer/pose";
import * as THREE from "three";
import { BufferGeometry } from "three";
import orbitControl from "./orbitControl";
import baseMessageCenter from "../protocol";
import i18n, { addLocale } from "../utils/i18n";
import { debounce } from "src/utils/relocalStorage";
import mathTool from "../MathTool";
import { CoordinateType } from "./type";
import { Resource } from "i18next";
// import stats from "./stats";
interface IThreeController {
  loadModel: () => void;
  animate: () => void;
  initTrackLine: () => void;
}

export interface IDeviceLoader {
  load: (scence: THREE.Scene) => void;
  initWorkspace: (scence: THREE.Scene) => void;
  initAxesHelper: (scence: THREE.Scene) => void;
  show: () => void;
  hide: () => void;
  toggleWorkspace: (newValue: boolean) => void;
  animate: (
    J1: number,
    J2: number,
    J3: number,
    J4: number,
    J5: number,
    J6: number
  ) => THREE.Mesh | undefined;
}
class ThreeController implements IThreeController {
  private container: HTMLElement | null = null;
  private device: string | undefined;
  private rotationAngle = 0;
  private loaders: { [key: string]: RoboticArmLoader | any } = {
    CR3L: cr3lLoader,
    NC02L: nc02lLoader,
  };
  protected deviceList: TDeviceType[] = [];

  private trackLine: THREE.Line | undefined;
  private pointVectors: THREE.Vector3[] = [];
  private loadModelFlag = false;
  private isDragging = false;
  private isMainRendererNeeded = false;
  private deltaMove = {
    x: 0,
    y: 0,
  };
  private previousMousePosition = {
    x: 0,
    y: 0,
  };
  private viewJogRzAngel = 0;
  private jogMode = CoordinateType.Cartesian;

  oldTriangleCount = 0;
  iframeVisible = true;
  freeze = false;
  activeTime = Date.now();
  lastPose: any = null;
  mousePress = false;

  public loadModel = async () => {
    this.init();
    renderHandler.renderModel(this.container!);
    renderHandler.resizeRender(this.container!, "renderer");
    this.initTrackLine();
    this.setItemEvent();
    this.animate();

    if (window!.frameElement) {
      document.addEventListener("DOMContentLoaded", () => {
        const observer = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              console.log("Iframe is visible");
              this.iframeVisible = true;
            } else {
              console.log("Iframe is not visible");
              this.iframeVisible = false;
            }
          });
        });

        // 观察自身的 iframe 元素
        window.frameElement && observer.observe(window.frameElement);
      });
    }
  };

  public initTrackLine = () => {
    const bufferGeometry = new THREE.BufferGeometry();
    bufferGeometry.setFromPoints([]);
    const material = new THREE.LineBasicMaterial({
      color: 0xff0000,
      linecap: "round",
      linejoin: "round",
    });
    this.trackLine = new THREE.Line(bufferGeometry, material);
    this.trackLine.visible = false;
    sceneHandler.getScene()!.add(this.trackLine);
  };

  private clock = new THREE.Clock(); //计时器
  private FPS = 15; // 限制渲染帧
  private singleFrameTime = 1 / this.FPS;
  private timeStamp = 0;
  id = (Math.random() * 1000).toFixed(0);
  public animate = () => {
    const delta = this.clock.getDelta(); //获取距离上次请求渲染的时间
    this.timeStamp += delta;
    if (this.timeStamp > this.singleFrameTime) {
      this.updateScene();
      this.timeStamp = this.timeStamp % this.singleFrameTime;
    }
    window.requestAnimationFrame(this.animate);
  };
  public updateResize = () => {
    const container = document.getElementById("Three");
    cameraHandler.resizeViewport(container!);
    renderHandler.resizeRender(container!, "renderer");
    const axisContainer = document.getElementById("axisContainer");
    renderHandler.resizeRender(axisContainer!, "helperRenderer");
    this.refreshActiveTime();
  };
  private countSceneTriangles = () => {
    let triangleCount = 0;
    const scene: any = sceneHandler.getScene();
    scene.traverse((child: any) => {
      if (
        child instanceof THREE.Mesh &&
        child.geometry instanceof THREE.BufferGeometry
      ) {
        const geometry = child.geometry;
        triangleCount += geometry.index
          ? geometry.index.count / 3
          : geometry.attributes.position.count / 3;
      }
    });

    const helperScene: any = sceneHandler.getHelperScene();
    helperScene.traverse((child: any) => {
      if (
        child instanceof THREE.Mesh &&
        child.geometry instanceof THREE.BufferGeometry
      ) {
        const geometry = child.geometry;
        triangleCount += geometry.index
          ? geometry.index.count / 3
          : geometry.attributes.position.count / 3;
      }
    });

    if (this.oldTriangleCount !== triangleCount) {
      this.oldTriangleCount = triangleCount;
      console.log("triangleCount", this.oldTriangleCount);
    }
  };
  private updateScene = () => {
    if (Date.now() - this.activeTime > 2000) {
      this.freeze = true;
    }
    if (this.freeze) return;

    if (!this.iframeVisible) return;

    // console.log(`animate${this.id}: ${window!.frameElement!.id}`);

    // stats.stats.update();

    renderHandler!.renderer!.render(
      sceneHandler.getScene()!,
      cameraHandler.camera!
    );
    // 渲染辅助坐标系
    renderHandler!.helperRenderer!.render(
      sceneHandler.getHelperScene()!,
      cameraHandler.helperCamera!
    );
    this.isMainRendererNeeded = false;
    this.countSceneTriangles();
  };
  private init = () => {
    this.container = document.getElementById("Three");
    cameraHandler.init(
      this.container!.clientWidth / this.container!.clientHeight
    );
    cameraHandler.resizeViewport(this.container!);
    renderHandler.init(this.container!);
    renderHandler.resizeRender(this.container!, "renderer");
    sceneHandler.init();
    const scene = sceneHandler.getScene()!;
    LightHandler.init(scene, renderHandler!.renderer!);
    orbitControl.init(cameraHandler!.camera!, renderHandler!.renderer!);
    floorHandler.init(scene);
    // stats.init(this.container, 10, "50%");
    this.axisHelperInit();
  };

  private axisHelperInit() {
    const axisContainer = document.getElementById("axisContainer");
    renderHandler.initHelperRenderer(axisContainer!);
    sceneHandler.initHelperScene();
    cameraHandler.initHelperCamera();
    const helperScene = sceneHandler.getHelperScene()!;
    helperScene.add(cameraHandler!.helperCamera!);
    renderHandler.resizeRender(axisContainer!, "helperRenderer");
  }
  private updateAxisHelper(type: CoordinateType) {
    const axis = mathTool.creatAxis({ isGlobal: true, lens: 80 });
    sceneHandler.getHelperScene()!.add(axis);
    const axisContainer = document.getElementById("axisContainer");
    axisContainer!.style.visibility =
      type === CoordinateType.Tool || type === CoordinateType.Cartesian
        ? "visible"
        : "hidden";
  }

  private onMouseMove = (event: any) => {
    this.deltaMove = {
      x: event.clientX,
      y: event.clientY,
    };
    const rotationSpeed = 0.005;
    if (this.isDragging) {
      if (
        this.previousMousePosition.x !== 0 &&
        this.previousMousePosition.y !== 0
      ) {
        // 自定义上下移动
        const dy = this.deltaMove.y - this.previousMousePosition.y;
        cameraHandler!.camera!.position.y += dy * 0.5;
        // 自定义左右旋转
        const dx = this.deltaMove.x - this.previousMousePosition.x;
        // 场景旋转会导致末端轨迹问题
        // sceneHandler.getScene()!.rotation.y += dx * rotationSpeed;
        // 视图点动，计算更新模型位置，得到视图坐标系Rz角度
        if (!this.device) return;
        this.viewJogRzAngel = this.loaders[this.device].viewJogRotateCal(
          dx * rotationSpeed
        );
        this.previousMousePosition = {
          x: event.clientX,
          y: event.clientY,
        };
      } else {
        this.previousMousePosition = {
          x: event.clientX,
          y: event.clientY,
        };
      }
    }
  };
  private onMouseDown = (event: any) => {
    this.isDragging = true;
  };
  private onMouseUp = (event: any) => {
    this.isDragging = false;
    this.deltaMove = {
      x: 0,
      y: 0,
    };
    this.previousMousePosition = {
      x: 0,
      y: 0,
    };
    this.updateUserCoordinate(this.viewJogRzAngel);
  };

  private initCustomOrbitControl = () => {
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    orbitControl.control.enableRotate = false;
    orbitControl.control.enablePan = false;
    orbitControl.control.enableZoom = false;
    orbitControl.control.reset();
  };

  private removeCustomOrbitControl = () => {
    window.removeEventListener("mousemove", this.onMouseMove, false);
    window.removeEventListener("mousedown", this.onMouseDown, false);
    window.removeEventListener("mouseup", this.onMouseUp, false);
    orbitControl.control.enableRotate = true;
    orbitControl.control.enablePan = true;
    orbitControl.control.enableZoom = true;
    orbitControl.control.reset();
  };

  private updateUserCoordinate = (angle: number) => {
    baseMessageCenter.send({
      method: "updateUserCoordinate",
      iframeName: "3dmodelplugin",
      data: angle,
    });
  };

  private notifyLoadOver = () => {
    baseMessageCenter.send({
      method: "loadModelOver",
      iframeName: "3dmodelplugin",
      data: true,
    });
  };

  private toggleTrackVisible = (visible: boolean) => {
    this.trackLine && (this.trackLine.visible = Boolean(visible));
    if (!visible) {
      this.pointVectors = [];
      this.updateTrackLine();
    }
  };
  private handleModelShow = async (deviceType: TDeviceType) => {
    if (deviceType) {
      Object.values(TDeviceType)
        .filter((item: any) => item != deviceType)
        .forEach((item: any) => {
          item in this.loaders && this.loaders[item].hide();
        });
      if (this.deviceList.includes(deviceType)) return;
      this.deviceList.push(deviceType);
      this.device = deviceType;

      const loader =
        deviceType in this.loaders
          ? this.loaders[deviceType]
          : (this.loaders[deviceType] = new RoboticArmLoader(deviceType));

      const result = await loader.show();
      this.loadModelFlag = true;
      result && this.notifyLoadOver();
      await this.hideOtherDevices(deviceType);
      // loader.setSkinValue([
      //   10, 10, 10, 10, 10, 1, 20, 20, 20, 20, 2000, 2000, 20,
      // ]);

      this.initTrackLine();
      this.pointVectors = [];
    } else {
      // await this.hideAllDevices();
      Object.values(TDeviceType)
        .filter((item: any) => item != deviceType)
        .forEach((item: any) => {
          item in this.loaders && this.loaders[item].hide();
        });
      this.pointVectors = [];
      this.updateTrackLine();
      this.deviceList = [];
      this.device = undefined;
    }
    this.refreshActiveTime();
    // this.updateScene();
    this.lastPose && this.handleModelFollowPosition(this.lastPose);
  };

  private hideOtherDevices = async (deviceType: TDeviceType) => {
    const promises = this.deviceList
      .filter((device) => device !== deviceType)
      .map(async (device) => {
        device in this.loaders && this.loaders[device].hide();
      });
    await Promise.all(promises);
    this.deviceList = this.deviceList.filter((device) => device === deviceType);
    this.refreshActiveTime();
  };

  private hideAllDevices = async () => {
    const promises = this.deviceList.map(async (device) => {
      device in this.loaders && this.loaders[device]!.hide();
    });
    await Promise.all(promises);
    this.refreshActiveTime();
  };

  handleModelShowDebounce = debounce(this.handleModelShow, 200, true);

  private updateTrackLine = (disappear?: boolean) => {
    if (!this.trackLine) return;
    if (this.pointVectors.length > 100) {
      this.pointVectors = this.pointVectors.slice(50);
    }

    if (disappear) {
      if (this.pointVectors.length < 3) {
        return;
      } else {
        this.pointVectors.shift();
      }
    }

    if (this.pointVectors.length === 1) {
      this.pointVectors.push(this.pointVectors[0].clone());
    }
    const curve = new THREE.CatmullRomCurve3(this.pointVectors);
    const newPoint = curve.getPoints(100 * this.pointVectors.length - 1);
    (this.trackLine?.geometry as BufferGeometry).setFromPoints(newPoint);
    this.refreshActiveTime();
  };

  private getPointData = (tool: THREE.Mesh) => {
    const endPoint = new THREE.Vector3();
    tool!.getWorldPosition(endPoint);
    return endPoint;
  };
  private handleModelFollowPosition = (coordinate: {
    J1: number;
    J2: number;
    J3: number;
    J4: number;
    J5?: number;
    J6?: number;
  }) => {
    if (!coordinate) return;
    const { J1, J2, J3, J4, J5, J6 } = coordinate;
    for (const device in TDeviceType) {
      if (device === this.device) {
        // eslint-disable-next-line
        if (!(device in this.loaders)) return;
        const tool = this.loaders[device].animate(J1, J2, J3, J4, J5, J6);
        if (tool && this.trackLine?.visible) {
          const point = this.getPointData(tool);
          this.pointVectors.push(point);
          this.updateTrackLine();
        }
        this.updateScene();
      }
    }
  };
  private handleEvent = (key: string, newValue: any) => {
    const methods: { [index: string]: (newValue: any) => void } = {
      deviceType: async (newValue) => {
        if (newValue === this.device) return;
        await this.handleModelShowDebounce(newValue);
        this.refreshActiveTime();
        this.rotationAngle = 0;
      },
      pose: (newValue) => {
        if (this.lastPose) {
          let diff = false;
          for (let key in newValue) {
            if (key != "promiseId" && newValue[key] !== this.lastPose[key]) {
              // console.log(newValue, key, newValue[key], this.lastPose[key]);
              diff = true;
              break;
            }
          }

          if (!diff) {
            this.trackLine?.visible && this.updateTrackLine(true);
          }
        }
        this.lastPose = newValue;
        this.handleModelFollowPosition(newValue);
        this.refreshActiveTime();
        const newValueKeys = Object.keys(newValue);
        if (newValueKeys.length > 8) {
          const newPose = {
            J1: newValue.J1 + this.rotationAngle,
            J2: newValue.J2,
            J3: newValue.J3,
            J4: newValue.J4,
            J5: newValue.J5,
            J6: newValue.J6,
            X: newValue.X,
            Y: newValue.Y,
            Z: newValue.Z,
            Rx: newValue.Rx,
            Ry: newValue.Ry,
            Rz: newValue.Rz,
          };
          store.dispatch(changePoseAction(newPose));
        } else {
          const newPose = {
            J1: newValue.J1,
            J2: newValue.J2,
            J3: newValue.J3,
            J4: newValue.J4,
            X: newValue.X,
            Y: newValue.Y,
            Z: newValue.Z,
            R: newValue.R,
          };
          store.dispatch(changePoseAction(newPose));
        }
      },
      workspaceVisible: (newValue) => {
        if (!this.device || !(this.device in this.loaders)) return;
        this.loaders[this.device].toggleWorkspace(newValue);
        this.refreshActiveTime();
      },
      trackVisible: (newValue) => {
        this.pointVectors = [];
        this.toggleTrackVisible(newValue);
        this.refreshActiveTime();
      },
      zoom: (newValue) => {
        cameraHandler!.setZoom(newValue);
        this.refreshActiveTime();
      },
      coordVisible: (newValue) => {
        // this.SALoader.setCoordVisible(newValue);
      },
      coordListVisible: (newValue) => {
        store.dispatch(toggleCoord(newValue));
      },
      toggleBgc: (color) => {
        sceneHandler.toggleBgc(color);
        floorHandler.toggleBgc(color);
        this.refreshActiveTime();
      },
      getInstall: (data: { slopeAngle: number; rotationAngle: number }) => {
        this.rotationAngle = data.rotationAngle;
        orbitControl.update(data.slopeAngle);
        if (this.device) {
          this.loaders[this.device].getInstall(data);
        }
        this.refreshActiveTime();
      },
      secWall: (data: TSecWallType[]) => {
        const deviceTypeJSON = localStorage.getItem("deviceType");
        const deviceType: TDeviceType =
          deviceTypeJSON && JSON.parse(deviceTypeJSON);
        if (!deviceType) return;
        if (this.loadModelFlag) {
          try {
            store.dispatch(setSecWall(data));
            this.loaders[deviceType].secWall(data);
          } catch (error) {
            console.log("secWall is Not Found");
          }
        }
        this.refreshActiveTime();
      },
      setWorkZone: (data: TWorkZoneType[]) => {
        const deviceTypeJSON = localStorage.getItem("deviceType");
        const deviceType: TDeviceType =
          deviceTypeJSON && JSON.parse(deviceTypeJSON);
        if (!deviceType) return;
        if (this.loadModelFlag) {
          try {
            store.dispatch(setWorkZone(data));
            this.loaders[deviceType].setWorkZone(data);
          } catch (error) {
            console.log("setWorkZone is Not Found");
          }
        }
        this.refreshActiveTime();
      },
      setSkinValue: (data: number[]) => {
        const deviceTypeJSON = localStorage.getItem("deviceType");
        const deviceType: TDeviceType =
          deviceTypeJSON && JSON.parse(deviceTypeJSON);
        // if (
        //   !deviceType ||
        //   ![
        //     "CR",
        //     "CR5V",
        //     "CR5AF",
        //     "CR3",
        //     "CR3V",
        //     "CR10",
        //     "CR10V",
        //     "CR10AF",
        //   ].includes(deviceType)
        // )
        //   return;
        if (!deviceType) return;
        if (this.loadModelFlag) {
          try {
            this.loaders[deviceType].setSkinValue(data);
          } catch (error) {
            console.log("setSkinValue is Not Found");
          }
        }
        this.refreshActiveTime();
      },
      setCoordinate: (data: any) => {
        const deviceTypeJSON = localStorage.getItem("deviceType");
        const deviceType: TDeviceType =
          deviceTypeJSON && JSON.parse(deviceTypeJSON);
        if (!deviceType) return;
        try {
          this.loadModelFlag && this.loaders[deviceType].initCoordinate(data);
        } catch (error) {
          console.log("setCoordinate is Not Found");
        }
        this.refreshActiveTime();
      },
      setCameraPosition: (data: { x: number; y: number; z: number }) => {
        cameraHandler.setPosition(data);
        this.refreshActiveTime();
      },
      changeLocale: (lang: string) => {
        i18n.changeLanguage(lang.slice(0, 2));
      },
      addLocale: (newResources: Resource) => {
        addLocale(newResources);
      },
      setJogMode: (mode: CoordinateType) => {
        // 视角点动切换到其他点动模式，解绑事件监听，重置坐标系位置
        if (this.jogMode === CoordinateType.View && this.jogMode !== mode) {
          this.removeCustomOrbitControl();
          this.device && this.loaders[this.device].setBaseCoordinateAngle(0);
          this.refreshActiveTime();
        }
        this.jogMode = mode;
        const deviceTypeJSON = localStorage.getItem("deviceType");
        const deviceType: TDeviceType =
          deviceTypeJSON && JSON.parse(deviceTypeJSON);
        if (!deviceType) return;
        if (this.loadModelFlag) {
          try {
            this.loaders[deviceType].updateCoordinate(mode);
            this.updateAxisHelper(mode);
            // 暂时注释，视角点动需求暂不处理
            // if (this.jogMode === CoordinateType.View) {
            //   this.initCustomOrbitControl();
            //   // this.updateUserCoordinate(0);
            //   this.loaders[deviceType].setBaseHelpInitAngle();
            //   // 视角点动时不需要实时通知pro更新坐标系位置，调试用，显示出坐标系
            //   // const data = {
            //   //   user: [0, 0, 0, 0, 0, 0],
            //   //   tool: [0, 0, 0, 0, 0, 0],
            //   // };
            //   // this.loaders[deviceType].initCoordinate(data);
            // }
          } catch (error) {
            console.log("setJogMode is Not Found");
          }
        }
      },
      set3DTargetPosition: (data: number[]) => {
        const deviceTypeJSON = localStorage.getItem("deviceType");
        const deviceType: TDeviceType =
          deviceTypeJSON && JSON.parse(deviceTypeJSON);
        if (!deviceType) return;
        try {
          this.loadModelFlag &&
            this.loaders[deviceType]!.show3DDTargetPosition(data);
        } catch (error) {
          console.log("set3DTargetPosition is Not Found");
        }
        this.refreshActiveTime();
      },
      setRenderLimit: (data: boolean) => {
        renderHandler.setRenderLimit(data);
        this.updateResize();
        this.refreshActiveTime();
      },
    };
    return methods[key](newValue);
  };
  private eventHander = (e: any) => {
    if (e.newValue) {
      const newValue = JSON.parse(e.newValue);
      this.handleEvent(e.key, newValue);
    }
  };
  private refreshActiveTime = () => {
    this.activeTime = Date.now();
    this.freeze = false;
  };
  private refreshMouseDown = () => {
    this.mousePress = true;
    this.refreshActiveTime();
  };
  private refreshMouseUp = () => {
    this.mousePress = false;
  };
  private refreshMouseMove = () => {
    if (this.mousePress) {
      this.refreshActiveTime();
    }
  };
  private setItemEvent = () => {
    window.addEventListener("setItemEvent", this.eventHander);

    window.addEventListener("mousedown", this.refreshMouseDown, {
      capture: true,
    });
    window.addEventListener("mouseup", this.refreshMouseUp, {
      capture: true,
    });
    window.addEventListener("mousemove", this.refreshMouseMove, {
      capture: true,
    });

    window.addEventListener("touchstart", this.refreshMouseDown, {
      capture: true,
    });
    window.addEventListener("touchend", this.refreshMouseUp, {
      capture: true,
    });
    window.addEventListener("touchmove", this.refreshMouseMove, {
      capture: true,
    });

    window.addEventListener("wheel", this.refreshActiveTime, {
      capture: true,
    });
  };
  public removeListener = () => {
    window.removeEventListener("setItemEvent", this.eventHander);
    window.removeEventListener("mousedown", this.refreshMouseDown);
    window.removeEventListener("mouseup", this.refreshMouseUp);
    window.removeEventListener("mousemove", this.refreshMouseMove);

    window.removeEventListener("touchstart", this.refreshMouseDown);
    window.removeEventListener("touchend", this.refreshMouseUp);
    window.removeEventListener("touchmove", this.refreshMouseMove);

    window.removeEventListener("wheel", this.refreshActiveTime);
  };
  private followPosition = () => {
    const coordinateJson = localStorage.getItem("pose");
    if (coordinateJson) {
      const coordinate = JSON.parse(coordinateJson);
      this.handleModelFollowPosition(coordinate!);
    }
  };
}

export default new ThreeController();
