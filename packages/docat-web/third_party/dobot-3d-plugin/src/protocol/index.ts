import messageCenterDispense from "./messageCenterDispense";
import "../utils/relocalStorage";
import { SettingEventHandler } from "src/utils/reSettingEvent";
import { customSetItem } from "../utils/relocalStorage";
import { Resource } from "i18next";

const DeviceType_MAPPING: any = {
  CR: ["CR", "CR5", "CR5A", "CR5V2"],
  CR3: ["CR3", "CR3A", "CR3V2"],
  CR10: ["CR10", "CR10A", "CR10V2"],
  CR16: ["CR16", "CR16A", "CR16V2"],
  CR3L: ["CR3L"],
  CR7: ["CR7", "CR7A", "CR7V2"],
  CR12: ["CR12", "CR12A", "CR12V2"],
  NC02: ["NC02", "Nova 2"],
  NC02L: ["NC02L"],
  NC02s: ["Nova 2s", "NC02s", "NC02S"],
  NC05: ["NC05", "Nova 5"],
  MG6: ["MG6", "MG400", "Magician E6"],
  CR20: ["CR20", "CR20A", "CR20V2"],
  CR3V: ["CR3V"],
  CR5V: ["CR5V"],
  CR7V: ["CR7V"],
  CR10V: ["CR10V"],
  CR12V: ["CR12V"],
  CR16V: ["CR16V"],
  CR20V: ["CR20V"],
  CR5AF: ["CR5AF"],
  CR10AF: ["CR10AF"],
  CR20AF: ["CR20AF"],
  CR30: ["CR30 Pro", "CR30 Max", "CR 30H", "CR 30HT", "CR 30H-Food"],
};

export enum TDeviceType {
  CR = "CR",
  CR3 = "CR3",
  CR10 = "CR10",
  CR16 = "CR16",
  CR3L = "CR3L",
  CR7 = "CR7",
  CR12 = "CR12",
  NC02 = "NC02",
  NC02s = "NC02s",
  NC02L = "NC02L",
  NC05 = "NC05",
  MG6 = "MG6",
  CR20 = "CR20",
  CR3V = "CR3V",
  CR5V = "CR5V",
  CR7V = "CR7V",
  CR10V = "CR10V",
  CR12V = "CR12V",
  CR16V = "CR16V",
  CR20V = "CR20V",
  CR5AF = "CR5AF",
  CR10AF = "CR10AF",
  CR20AF = "CR20AF",
  CR30 = "CR30",
}
export type TPose = {
  J1: number;
  J2: number;
  J3: number;
  J4: number;
  J5?: number;
  J6?: number;
  X: number;
  Y: number;
  Z: number;
  R?: number;
  A?: number;
  B?: number;
  C?: number;
};

export type TSecWallType = {
  enable: boolean;
  type: 0 | 1 | 2 | 3;
  name: string;
  radius: number;
  point1: number[];
  point2: number[];
  point3: number[];
  isElbowLimited: boolean;
  pv: number[];
  isSideinverted: boolean;
  mode: number;
};

export type TWorkZoneType = {
  name: string; //空间名称定义
  enable: boolean; //空间是否使用
  type: number; //0：报警，1：缩减，2：IO输出
  radius: number; //末端工具球半径
  DO_Index: number; //IO墙的DO索引
  zoneType: number; //0:正立方体 1:斜立方体
  point: number[][]; //数组长度2或者4
  isInsideSafe: boolean; //true:安全方向为内侧，false为外侧
  acmePoints: number[][]; // 六面体所有顶点
};

// const checkEqual = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b)
class BaseMessageCenter {
  constructor() {
    messageCenterDispense.messageCenter!.listen(this.methodsHandler.bind(this));
  }
  private methodsHandler(event: any) {
    const method = event.method;
    const data = event.data;
    if (!method || !(this as any)[method]) return;
    (this as any)[method](data);
  }
  public send(data: any) {
    // messageCenterDispense.sendMessage(JSON.stringify(data));
    messageCenterDispense.sendMessage(data);
  }
  public freshListener() {
    messageCenterDispense.messageCenter!.listen(this.methodsHandler.bind(this));
  }
  public getDeviceType(data: any) {
    // let type: any = TDeviceType.CR30;
    let type = data.type ? decodeURIComponent(data.type) : data.type;

    if (!(type in DeviceType_MAPPING)) {
      for (const key in DeviceType_MAPPING) {
        const types = DeviceType_MAPPING[key];
        if (types.includes(type)) {
          type = key;
          break;
        }
      }
    }

    console.log(data, type);

    if (type) {
      customSetItem("deviceType", JSON.stringify(type));
    } else {
      customSetItem("deviceType", JSON.stringify(null));
    }
  }
  public getPose(pose: TPose) {
    customSetItem("pose", JSON.stringify(pose));
  }
  public toggleWorkspace(visible: boolean) {
    customSetItem("workspaceVisible", JSON.stringify(visible));
  }
  public toggleTrack(visible: boolean) {
    customSetItem("trackVisible", JSON.stringify(visible));
  }
  public setZoom(zoom: number) {
    customSetItem("zoom", JSON.stringify(zoom));
  }
  public setCoordVisible(visible: boolean) {
    customSetItem("coordVisible", JSON.stringify(visible));
  }
  public setCoordListVisible(visible: boolean) {
    customSetItem("coordListVisible", JSON.stringify(visible));
  }
  public toggleBgc(bgc: string) {
    customSetItem("toggleBgc", JSON.stringify(bgc));
  }
  public changeBgc(bgc: string) {
    SettingEventHandler("toggleBgc", JSON.stringify(bgc));
  }
  public getInstall(data: { slopeAngle: number; rotationAngle: number }) {
    customSetItem("getInstall", JSON.stringify(data));
  }
  public secWall(data: TSecWallType[]) {
    customSetItem("secWall", JSON.stringify(data));
  }
  public setWorkZone(data: TWorkZoneType[]) {
    customSetItem("setWorkZone", JSON.stringify(data));
  }
  public setSkinValue(data: number[]) {
    customSetItem("setSkinValue", JSON.stringify(data));
  }
  public setCameraPosition(data: { x: number; y: number; z: number }) {
    customSetItem("setCameraPosition", JSON.stringify(data));
  }
  public changeLocale(lang: string) {
    customSetItem("changeLocale", JSON.stringify(lang));
  }
  public addLocale(lang: Resource) {
    customSetItem("addLocale", JSON.stringify(lang));
  }
  public setCoordinate(data: any) {
    customSetItem("setCoordinate", JSON.stringify(data));
  }
  public setJogMode(data: any) {
    customSetItem("setJogMode", JSON.stringify(data));
  }
  public set3DTargetPosition(data: number[]) {
    customSetItem("set3DTargetPosition", JSON.stringify(data));
  }
  public setRenderLimit(data: boolean) {
    customSetItem("setRenderLimit", JSON.stringify(data));
  }
}
export default new BaseMessageCenter();
