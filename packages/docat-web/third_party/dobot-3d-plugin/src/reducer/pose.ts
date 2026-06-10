import { TPose, TSecWallType, TWorkZoneType } from "src/protocol";

export const CHANGE = "changePose";
export const TOGGLECOORD = "toggleCoord";
export const SET_SECWALL = "setSecWall";
export const SET_WORKZONE = "setWorkZone";

export const changePoseAction = (value: TPose) => ({
  type: CHANGE,
  value,
});
export const toggleCoord = (value: boolean) => ({
  type: TOGGLECOORD,
  value,
});
export const setSecWall = (value: TSecWallType[]) => ({
  type: SET_SECWALL,
  value,
});
export const setWorkZone = (value: TWorkZoneType[]) => ({
  type: SET_WORKZONE,
  value,
});

export interface ReduxState {
  pose: TPose;
  coordinateVisible: boolean;
  secWall: TSecWallType[];
  workZoneData: TWorkZoneType[];
}

interface Action {
  type: string;
  value: TPose | boolean | TSecWallType[] | TWorkZoneType[];
}

const initData = {
  pose: {
    J1: 0,
    J2: 0,
    J3: 0,
    J4: 0,
    J5: 0,
    J6: 0,
    X: 0,
    Y: 0,
    Z: 0,
    Rx: 0,
    Ry: 0,
    Rz: 0,
  },
  coordinateVisible: false,
  secWall: [],
  workZoneData: [],
};

const getPose = (state: ReduxState = initData, action: Action) => {
  switch (action.type) {
    case CHANGE:
      return { ...state, pose: action.value };
    case TOGGLECOORD:
      return { ...state, coordinateVisible: action.value };
    case SET_SECWALL:
      return { ...state, secWall: action.value };
    case SET_WORKZONE:
      return { ...state, workZoneData: action.value };
    default:
      return state;
  }
};

export { getPose };
