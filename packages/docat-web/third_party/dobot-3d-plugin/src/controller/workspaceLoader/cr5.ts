import * as THREE from "three";
interface Iprops {
  topRadius: number;
  radius: number;
  top?: number;
}
export default class CrWorkspaceLoader extends THREE.Group {
  constructor(props: Iprops) {
    super();
    const group = new THREE.Group();
    const sphere = new THREE.SphereGeometry(
      props.radius,
      100,
      100,
      0,
      Math.PI * 2,
      Math.asin(props.topRadius / props.radius),
      Math.PI
    );
    const material = new THREE.MeshBasicMaterial({
      toneMapped: false,
      color: 0xcccccc,
      opacity: 0.3,
      transparent: true,
    });
    const sphereMesh = new THREE.Mesh(sphere, material);
    sphereMesh.position.set(0, props.top || 50, 0);
    group.add(sphereMesh);
    return group;
  }
}
