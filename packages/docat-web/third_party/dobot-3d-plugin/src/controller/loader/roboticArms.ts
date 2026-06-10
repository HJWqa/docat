export interface RoboticArmConfig {
  path: string;
  workspace: {
    radius: number;
    topRadius: number;
    top?: number;
    yOffset: number;
    scale: number;
  };
  scale: number;
  skins: Array<string>;
  bowLimit: {
    radius: number;
    offset: number;
  };
}

type RoboticArmMap = {
  [key: string]: RoboticArmConfig;
};

export const roboticArmConfigs: RoboticArmMap = {
  CR3: {
    path: "cr3/all.glb",
    workspace: {
      radius: 660.8,
      topRadius: 128.3,
      yOffset: 20,
      scale: 0.7,
    },
    scale: 1.2,
    skins: [
      "J3SkinKey3",
      "J3SkinKey2",
      "J3SkinKey1",
      "J3SkinKey4",
      "J3SkinKey5",
      "J3SkinKey7",
      "J3SkinKey6",
      "J4SkinKey3",
      "J4SkinKey1",
      "J4SkinKey2",
      "J5SkinKey2",
      "J5SkinKey1",
      "J5SkinKey3",
    ],
    bowLimit: {
      radius: 70,
      offset: 0,
    },
  },
  CR3V: {
    path: "cr3v/all.glb",
    workspace: {
      radius: 660.8,
      topRadius: 128.3,
      yOffset: 20,
      scale: 0.7,
    },
    scale: 1.2,
    skins: [
      "J3SkinKey3",
      "J3SkinKey2",
      "J3SkinKey1",
      "J3SkinKey4",
      "J3SkinKey5",
      "J3SkinKey7",
      "J3SkinKey6",
      "J4SkinKey3",
      "J4SkinKey1",
      "J4SkinKey2",
      "J5SkinKey2",
      "J5SkinKey1",
      "J5SkinKey3",
    ],
    bowLimit: {
      radius: 70,
      offset: 0,
    },
  },
  // CR3L: {
  //   path: "cr3l/all.glb",
  //   workspace: {
  //     radius: 1740,
  //     topRadius: 191,
  //     yOffset: -15,
  //     scale: 0.5,
  //   },
  //   scale: 0.6,
  //   skins: [],
  // },
  CR: {
    path: "cr5/all.glb",
    workspace: {
      radius: 1047,
      topRadius: 120,
      yOffset: -50,
      scale: 0.6,
    },
    scale: 1.0,
    skins: [
      "J3SkinKey3",
      "J3SkinKey2",
      "J3SkinKey1",
      "J3SkinKey4",
      "J3SkinKey7",
      "J3SkinKey5",
      "J3SkinKey6",
      "J4SkinKey3",
      "J4SkinKey1",
      "J4SkinKey2",
      "J5SkinKey2",
      "J5SkinKey1",
      "J5SkinKey3",
    ],
    bowLimit: {
      radius: 100,
      offset: 0,
    },
  },
  CR5V: {
    path: "cr5v/all.glb",
    workspace: {
      radius: 1047,
      topRadius: 120,
      yOffset: -50,
      scale: 0.6,
    },
    scale: 1.0,
    skins: [
      "J3SkinKey3",
      "J3SkinKey2",
      "J3SkinKey1",
      "J3SkinKey4",
      "J3SkinKey7",
      "J3SkinKey5",
      "J3SkinKey6",
      "J4SkinKey3",
      "J4SkinKey1",
      "J4SkinKey2",
      "J5SkinKey2",
      "J5SkinKey1",
      "J5SkinKey3",
    ],
    bowLimit: {
      radius: 100,
      offset: 0,
    },
  },
  CR5AF: {
    path: "cr5af/all.glb",
    workspace: {
      radius: 1047,
      topRadius: 120,
      yOffset: -50,
      scale: 0.6,
    },
    scale: 1.0,
    skins: [
      "J3SkinKey3",
      "J3SkinKey2",
      "J3SkinKey1",
      "J3SkinKey4",
      "J3SkinKey7",
      "J3SkinKey5",
      "J3SkinKey6",
      "J4SkinKey3",
      "J4SkinKey1",
      "J4SkinKey2",
      "J5SkinKey2",
      "J5SkinKey1",
      "J5SkinKey3",
    ],
    bowLimit: {
      radius: 100,
      offset: 0,
    },
  },
  CR7: {
    path: "cr7/all.glb",
    workspace: {
      radius: 843,
      topRadius: 141,
      yOffset: 0,
      scale: 0.7,
    },
    scale: 1.0,
    skins: [],
    bowLimit: {
      radius: 100,
      offset: 0,
    },
  },
  CR7V: {
    path: "cr7v/all.glb",
    workspace: {
      radius: 843,
      topRadius: 141,
      yOffset: 0,
      scale: 0.7,
    },
    scale: 1.0,
    skins: [],
    bowLimit: {
      radius: 100,
      offset: 0,
    },
  },
  CR10: {
    path: "cr10/all.glb",
    workspace: {
      radius: 1476,
      topRadius: 130,
      yOffset: -50,
      scale: 0.6,
    },
    scale: 0.8,
    skins: [
      "J3SkinKey4",
      "J3SkinKey3",
      "J3SkinKey2",
      "J3SkinKey1",
      "J3SkinKey7",
      "J3SkinKey5",
      "J3SkinKey6",
      "J4SkinKey3",
      "J4SkinKey1",
      "J4SkinKey2",
      "J5SkinKey2",
      "J5SkinKey1",
      "J5SkinKey3",
    ],
    bowLimit: {
      radius: 100,
      offset: -50,
    },
  },
  CR10V: {
    path: "cr10v/all.glb",
    workspace: {
      radius: 1476,
      topRadius: 130,
      yOffset: -50,
      scale: 0.6,
    },
    scale: 0.8,
    skins: [
      "J3SkinKey4",
      "J3SkinKey3",
      "J3SkinKey2",
      "J3SkinKey1",
      "J3SkinKey7",
      "J3SkinKey5",
      "J3SkinKey6",
      "J4SkinKey3",
      "J4SkinKey1",
      "J4SkinKey2",
      "J5SkinKey2",
      "J5SkinKey1",
      "J5SkinKey3",
    ],
    bowLimit: {
      radius: 100,
      offset: 0,
    },
  },
  CR10AF: {
    path: "cr10af/all.glb",
    workspace: {
      radius: 1476,
      topRadius: 130,
      yOffset: -50,
      scale: 0.6,
    },
    scale: 0.8,
    skins: [
      "J3SkinKey4",
      "J3SkinKey3",
      "J3SkinKey2",
      "J3SkinKey1",
      "J3SkinKey7",
      "J3SkinKey5",
      "J3SkinKey6",
      "J4SkinKey3",
      "J4SkinKey1",
      "J4SkinKey2",
      "J5SkinKey2",
      "J5SkinKey1",
      "J5SkinKey3",
    ],
    bowLimit: {
      radius: 100,
      offset: 0,
    },
  },
  CR12: {
    path: "cr12/all.glb",
    workspace: {
      radius: 1250,
      topRadius: 191,
      yOffset: 0,
      scale: 0.65,
    },
    scale: 0.7,
    skins: [],
    bowLimit: {
      radius: 100,
      offset: 0,
    },
  },
  CR12V: {
    path: "cr12v/all.glb",
    workspace: {
      radius: 1250,
      topRadius: 191,
      yOffset: 0,
      scale: 0.65,
    },
    scale: 0.7,
    skins: [],
    bowLimit: {
      radius: 100,
      offset: 0,
    },
  },
  CR16: {
    path: "cr16/all.glb",
    workspace: {
      radius: 1168.5,
      topRadius: 191,
      yOffset: -50,
      scale: 0.6,
    },
    scale: 1,
    skins: [],
    bowLimit: {
      radius: 100,
      offset: 0,
    },
  },
  CR16V: {
    path: "cr16v/all.glb",
    workspace: {
      radius: 1168.5,
      topRadius: 191,
      yOffset: -50,
      scale: 0.6,
    },
    scale: 1,
    skins: [],
    bowLimit: {
      radius: 100,
      offset: 0,
    },
  },
  CR20: {
    path: "cr20/all.glb",
    workspace: {
      radius: 843,
      topRadius: 141,
      yOffset: 0,
      scale: 0.7,
    },
    scale: 0.7,
    skins: [],
    bowLimit: {
      radius: 130,
      offset: 0,
    },
  },
  CR20V: {
    path: "cr20v/all.glb",
    workspace: {
      radius: 843,
      topRadius: 141,
      yOffset: 0,
      scale: 0.7,
    },
    scale: 0.6,
    skins: [],
    bowLimit: {
      radius: 130,
      offset: 0,
    },
  },
  CR20AF: {
    path: "cr20af/all.glb",
    workspace: {
      radius: 843,
      topRadius: 141,
      yOffset: 0,
      scale: 0.7,
    },
    scale: 0.6,
    skins: [],
    bowLimit: {
      radius: 130,
      offset: 0,
    },
  },
  CR30: {
    path: "cr30/all.glb",
    workspace: {
      radius: 843,
      topRadius: 141,
      yOffset: 0,
      scale: 0.7,
    },
    scale: 0.6,
    skins: [],
    bowLimit: {
      radius: 130,
      offset: 0,
    },
  },
  NC05: {
    path: "nc05/all.glb",
    workspace: {
      radius: 850,
      topRadius: 135,
      top: 180,
      yOffset: 0,
      scale: 0.6,
    },
    scale: 1.1,
    skins: [],
    bowLimit: {
      radius: 80,
      offset: 0,
    },
  },
  NC02: {
    path: "nc02/all.glb",
    workspace: {
      radius: 625,
      topRadius: 117.5,
      top: 163.4,
      yOffset: 0,
      scale: 0.6,
    },
    scale: 1.4,
    skins: [],
    bowLimit: {
      radius: 80,
      offset: 0,
    },
  },
  NC02s: {
    path: "nc02s/all.glb",
    workspace: {
      radius: 625,
      topRadius: 117.5,
      top: 163.4,
      yOffset: 0,
      scale: 0.6,
    },
    scale: 1.4,
    skins: [],
    bowLimit: {
      radius: 80,
      offset: 0,
    },
  },
  // NC02L: {
  //   path: "nc02l/all.glb",
  //   workspace: {
  //     radius: 850,
  //     topRadius: 131.9,
  //     top: 163.4,
  //     yOffset: 0,
  //     scale: 0.6,
  //   },
  //   scale: 1.15,
  //   skins: [],
  // },
  MG6: {
    path: "mg6/all.glb",
    workspace: {
      radius: 625,
      topRadius: 117.5,
      top: 163.4,
      yOffset: 0,
      scale: 0.6,
    },
    scale: 1.5,
    skins: [],
    bowLimit: {
      radius: 60,
      offset: 0,
    },
  },
};
