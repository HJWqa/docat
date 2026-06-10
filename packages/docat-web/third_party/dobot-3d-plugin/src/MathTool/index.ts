import * as THREE from "three";
import { Geometry, Group, Vector3 } from "three";

const color: { [index: number]: number } = {
  0: 0xff0000,
  1: 0xffb200,
  2: 0x3eb72a,
};
const opacityInfos: { [index: number]: number } = {
  0: 0.1,
  1: 0.3,
  2: 0.2,
};

const wallWH: { [index: string]: number[] } = {
  CR: [2500, 2500],
  CR5V: [2500, 2500],
  CR5AF: [2500, 2500],
  CR3: [2200, 2200],
  CR3V: [2200, 2200],
  CR10: [3000, 3000],
  CR10V: [3000, 3000],
  CR10AF: [3000, 3000],
  CR16: [2800, 2800],
  CR16V: [2800, 2800],
  CR3L: [3500, 3500],
  CR7: [2300, 2300],
  CR7V: [2300, 2300],
  CR12: [3000, 3000],
  CR12V: [3000, 3000],
  NC02: [2400, 2400],
  NC02s: [2400, 2400],
  NC02L: [2600, 2600],
  NC05: [2800, 2800],
  MG6: [1400, 1400],
  CR20: [3800, 3800],
  CR20V: [3800, 3800],
  CR20AF: [3800, 3800],
  CR30: [3800, 3800],
};
class MathTool {
  public transformDeg(deg: number) {
    return (Number(deg) * Math.PI) / 180;
  }
  public transformRadian(radian: number) {
    return radian / (Math.PI / 180);
  }
  public moveModelToCenter(
    group: THREE.Group,
    xOffset = 0,
    yOffset = 0,
    zOffset = 0
  ) {
    const box3 = new THREE.Box3();
    box3.expandByObject(group);
    const center = new THREE.Vector3();
    box3.getCenter(center);
    group.position.x = group.position.x - center.x;
    group.position.y = group.position.y - center.y;
    group.position.z = group.position.z - center.z;
    return {
      x: group.position.x - center.x,
      y: group.position.y - center.y,
      z: group.position.z - center.z,
    };
  }
  public caculateBOXBinding(obj: any) {
    const box = new THREE.Box3();
    box.expandByObject(obj);
    return box;
  }
  public caculateRotationVerctor(
    posiotion: { x: number; y: number; z: number },
    scence: THREE.Scene
  ) {
    const dir = new THREE.Vector3(0, 0, 0);
    dir.normalize();
    const { x, y, z } = posiotion;
    const origin = new THREE.Vector3(x, y, z);
    const length = 300;
    const hex = 0x000000;
    const arrowHelper = new THREE.ArrowHelper(dir, origin, length, hex);
    scence.add(arrowHelper);
    return arrowHelper;
  }
  public rotateAroundWorldAxis(object: any, axis: any, radians: number) {
    // var quaternion = new THREE.Quaternion();
    // // 旋转轴new THREE.Vector3(0,1,0)
    // // 旋转角度Math.PI/2
    // quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 30), Math.PI / 2)
    var rotationMatrix = new THREE.Matrix4();
    rotationMatrix.makeRotationAxis(axis.normalize(), radians);
    rotationMatrix.multiply(object.matrix); // pre-multiply
    object.matrix = rotationMatrix;
    object.rotation.setFromRotationMatrix(object.matrix);
  }
  public moveByMatrix4(x: number, y: number, z: number) {
    var matrix = new THREE.Matrix4();
    matrix.makeTranslation(x, y, z);
  }
  public creatPlane(
    p1: THREE.Vector3,
    p2: THREE.Vector3,
    p3: THREE.Vector3,
    type: 0 | 1 | 2,
    deviceType: string,
    // 是否绘制箭头
    isDrawArray: boolean,
    // 是否反向
    isSideinverted: boolean
  ) {
    // 绘制平面
    const plane = new THREE.Plane();
    plane.setFromCoplanarPoints(p1, p2, p3);
    var coplanarPoint = plane.coplanarPoint(new THREE.Vector3(0, 0, 0));
    var focalPoint = new THREE.Vector3().copy(coplanarPoint).add(plane.normal);
    const planeMaterial = new THREE.MeshStandardMaterial({
      toneMapped: false,
      color: color[type || 0] || 0xff0000,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: opacityInfos[type] + 0.05 || 0.1,
    });
    const geometry = new THREE.BoxGeometry(
      wallWH[deviceType][0],
      wallWH[deviceType][1],
      5
    );
    const dispPlane = new THREE.Mesh(geometry, planeMaterial);
    geometry.lookAt(focalPoint);
    geometry.translate(coplanarPoint.x, coplanarPoint.y, coplanarPoint.z);

    // 绘制箭头
    if (isDrawArray) {
      const arrowHelper = new THREE.ArrowHelper(
        isSideinverted ? plane.normal.negate() : plane.normal,
        new THREE.Vector3(coplanarPoint.x, coplanarPoint.y, coplanarPoint.z),
        200,
        0xff0000,
        50,
        55
      );
      var sphereMaterial = new THREE.MeshBasicMaterial({
        toneMapped: false,
        color: 0xff0000,
      });
      var sphere = new THREE.Mesh(
        new THREE.SphereGeometry(15, 35, 35),
        sphereMaterial
      ) as any;
      sphere.geometry.verticesNeedUpdate = true;
      sphere.geometry.normalsNeedUpdate = true;
      arrowHelper.add(sphere);
      dispPlane.add(arrowHelper);
    }

    (dispPlane.geometry as Geometry).verticesNeedUpdate = true;
    (dispPlane.geometry as Geometry).normalsNeedUpdate = true;

    dispPlane!.renderOrder = 2;
    return dispPlane;
  }

  // 删除group，释放内存
  public deleteGroup(group: any) {
    if (!group || !group.children.length) return;
    group.children.forEach((element: any) => {
      group.remove(element);
    });
  }
  public creatSphereMaterial = (radius: number) => {
    var sphereMaterial = new THREE.MeshStandardMaterial({
      toneMapped: false,
      color: 0x0047bb,
      transparent: true,
      opacity: 0.4,
      depthWrite: true, // 关闭深度写入
      depthTest: false, // 关闭深度测试
    });

    var sphere = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 35, 35),
      sphereMaterial
    ) as any;

    sphere.geometry.verticesNeedUpdate = true;
    sphere.geometry.normalsNeedUpdate = true;
    return sphere;
  };

  public checkCollideMesh(movingCube: any, collideMeshList: any) {
    let crash = false;
    var originPoint = movingCube.position.clone();
    var collisionResults: string | any[] = [];
    for (
      var vertexIndex = 0;
      vertexIndex < movingCube.geometry.vertices.length;
      vertexIndex++
    ) {
      // 顶点原始坐标
      var localVertex = movingCube.geometry.vertices[vertexIndex].clone();
      // 顶点经过变换后的坐标
      var globalVertex = localVertex.applyMatrix4(movingCube.matrix);
      // 获得由中心指向顶点的向量
      var directionVector = globalVertex.sub(movingCube.position);

      // 将方向向量初始化
      var ray = new THREE.Raycaster(
        originPoint,
        directionVector.clone().normalize()
      );
      // 检测射线与多个物体的相交情况
      collisionResults = ray.intersectObjects(collideMeshList);
      // 如果返回结果不为空，且交点与射线起点的距离小于物体中心至顶点的距离，则发生了碰撞
      if (
        collisionResults.length > 0 &&
        collisionResults[0].distance < directionVector.length()
      ) {
        crash = true; // crash 是一个标记变量
      }
    }
    return {
      crash,
      collisionResults,
    };
  }

  //墙方向箭头
  public creatArrow = (P1: THREE.Vector3, Pv: THREE.Vector3, color: any) => {
    const arrowHelper = new THREE.ArrowHelper(
      Pv.clone().multiplyScalar(300).normalize(),
      P1.clone(),
      P1.clone().distanceTo(P1.clone().add(Pv.clone().multiplyScalar(300))),
      color,
      50,
      55
    );
    var sphereMaterial = new THREE.MeshBasicMaterial({
      toneMapped: false,
      color,
    });
    var sphere = new THREE.Mesh(
      new THREE.SphereGeometry(15, 35, 35),
      sphereMaterial
    ) as any;
    sphere.geometry.verticesNeedUpdate = true;
    sphere.geometry.normalsNeedUpdate = true;
    arrowHelper.add(sphere);
    return arrowHelper;
  };
  public creatZoneLine(data: number[][], type: number) {
    // 定义八个点的位置
    const vertices: any[] = [];
    data.forEach((p) => {
      vertices.push(new THREE.Vector3(p[0], p[1], p[2]));
    });
    const indices = [
      0, 1, 1, 4, 4, 3, 3, 0, 2, 6, 6, 7, 7, 5, 5, 2, 0, 2, 1, 6, 4, 7, 3, 5,
    ];
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(vertices.length * 3);
    for (let i = 0; i < vertices.length; i++) {
      const vertex = vertices[i];
      vertex.toArray(positions, i * 3);
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(indices);

    const lineOpacity: any = {
      0: 0.3,
      1: 0.9,
      2: 0.8,
    };
    // 创建线段对象
    const material = new THREE.LineBasicMaterial({
      color: color[type || 0] || 0xff0000,
      opacity: lineOpacity[type] || 1,
      side: THREE.DoubleSide,
      // depthWrite: false, // 关闭深度写入
      // depthTest: false, // 关闭深度测试
    });
    const lines = new THREE.LineSegments(geometry, material);

    return lines;
  }
  public creatZonePlane(data: number[][], type: number) {
    // 定义八个点的位置
    const vertices: number[] = [];
    data.forEach((p) => {
      vertices.push(...p);
    });
    var geometry = new THREE.BufferGeometry();
    // 设置顶点属性
    var positions = new THREE.Float32BufferAttribute(vertices, 3);
    geometry.setAttribute("position", positions);
    // 定义面的顶点索引(算法所给的六面体的顺序)
    var indices = [
      0, 1, 2, 1, 2, 6, 1, 4, 6, 4, 6, 7, 3, 4, 5, 4, 5, 7, 0, 2, 3, 2, 3, 5, 2,
      5, 7, 2, 6, 7, 3, 4, 0, 4, 1, 0,
    ];
    // 设置索引属性
    var index = new THREE.BufferAttribute(new Uint16Array(indices), 1);
    geometry.setIndex(index);
    // 创建材质
    var material = new THREE.MeshBasicMaterial({
      toneMapped: false,
      color: color[type || 0] || 0xff0000,
      transparent: true,
      opacity: opacityInfos[type] || 0.1,
      side: THREE.DoubleSide,
      depthWrite: false, // 关闭深度写入
      // depthTest: false, // 关闭深度测试
    });
    // 创建网格对象
    var mesh = new THREE.Mesh(geometry, material);
    return mesh;
  }
  public creatWorkZone(data: number[][], type: number) {
    const zoneGroups = new THREE.Group();
    zoneGroups.add(this.creatZonePlane(data, type));
    zoneGroups.add(this.creatZoneLine(data, type));
    return zoneGroups;
  }

  public creatAxisArrow = (
    type: string,
    positions: number[],
    isGlobal?: boolean
  ) => {
    const colorInfos = {
      X: 0xff0000,
      Y: 0x00ff00,
      Z: 0x0000ff,
    };
    const arrowGeometry = new THREE.ConeGeometry(
      isGlobal ? 5 : 20,
      isGlobal ? 20 : 60,
      32
    );
    const arrowMaterial = new THREE.MeshBasicMaterial({
      toneMapped: false,
      color: colorInfos[type as "X"],
    });
    const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial);
    if (isGlobal) {
      type === "X"
        ? (arrow.rotation.z = -Math.PI / 2)
        : type === "Y"
        ? (arrow.rotation.x = -Math.PI / 2)
        : (arrow.rotation.x = 0);
    } else {
      type === "X"
        ? (arrow.rotation.z = -Math.PI / 2)
        : type === "Y"
        ? (arrow.rotation.x = 0)
        : (arrow.rotation.x = Math.PI / 2);
    }
    arrow.position.set(positions[0], positions[1], positions[2]);
    return arrow;
  };

  //坐标轴描述
  public creatAxisLabel = (text: string, color: string, position: number[]) => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    ctx.fillStyle = color;
    ctx.font = "Normal 40px Arial";
    ctx.lineWidth = 1;
    ctx.fillText(text, 100, 100);
    const texture = new THREE.Texture(canvas);
    texture.needsUpdate = true;
    texture.minFilter = THREE.LinearFilter;

    const material = new THREE.SpriteMaterial({
      toneMapped: false,
      map: texture,
      transparent: true,
    });
    const textObj = new THREE.Sprite(material);
    textObj.scale.set(0.75 * 100, 0.75 * 100, 0.75 * 100);
    textObj.position.set(position[0], position[1], position[2]);
    return textObj;
  };

  //坐标轴
  public creatAxis = (options: { isGlobal: boolean; lens: number }) => {
    const axisGroups = new THREE.Group();
    // 创建辅助坐标系
    const axesHelper = new THREE.AxesHelper(options.lens);
    axisGroups.add(axesHelper);
    const geometry = new THREE.SphereGeometry(5, 35, 35);
    const material = new THREE.MeshBasicMaterial({
      toneMapped: false,
      color: 0xff0000,
    });
    const sphere = new THREE.Mesh(geometry, material);
    axisGroups.add(sphere);
    if (options.isGlobal) {
      axesHelper.rotation.x = this.transformDeg(-90);
      const arrowX = this.creatAxisArrow("X", [options.lens, 0, 0], true);
      const arrowY = this.creatAxisArrow("Y", [0, 0, -options.lens], true);
      const arrowZ = this.creatAxisArrow("Z", [0, options.lens, 0], true);
      const labelX = this.creatAxisLabel("X", "#ff0000", [70, -0, 30]);
      const labelY = this.creatAxisLabel("Y", "#00FF00", [0, 25, -90]);
      const labelZ = this.creatAxisLabel("Z", "#0000ff", [0, 80, 0]);
      axisGroups.add(labelX, labelY, labelZ);
      axisGroups.add(arrowX, arrowY, arrowZ);
    } else {
      const arrowX = this.creatAxisArrow("X", [options.lens, 0, 0]);
      const arrowY = this.creatAxisArrow("Y", [0, options.lens, 0]);
      const arrowZ = this.creatAxisArrow("Z", [0, 0, options.lens]);
      axisGroups.add(arrowX, arrowY, arrowZ);
    }
    return axisGroups;
  };
}
export default new MathTool();
