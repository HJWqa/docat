import mathTool from "../MathTool/index";
import * as THREE from "three";
class FloorHandler {
  private grid: THREE.GridHelper | undefined;
  private gridDeep: THREE.GridHelper | undefined;
  private axisHelp: THREE.Object3D | undefined;
  private axes: THREE.Object3D | undefined;
  public init(scene: any) {
    // this.grid = new THREE.GridHelper(13000, 50, , 0xe2e2e2);
    // this.grid.position.y = -600;
    // this.grid.rotation.y = mathTool.transformDeg(45);
    // scene.add(this.grid);
    // this.gridDeep = new THREE.GridHelper(13000, 50, 0x333333, 0x333333);
    // this.gridDeep.position.y = -100;
    // this.gridDeep.rotation.y = mathTool.transformDeg(45);
    // scene.add(this.gridDeep);
    // this.gridDeep.visible = false;

    const options = {
      size: 1000,
      distance: 80000,
      colorGrid: "#ffffff",
      colorLine: "#d2d2d2",
      opacity: 0.5,
    };

    const geometry = new THREE.BoxGeometry(
      options.distance,
      1,
      options.distance
      // 1,
      // 1
    );
    geometry.rotateY(Math.PI / 4);
    geometry.translate(0, -600, 0);
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        color1: { value: new THREE.Color(options.colorGrid) },
        color2: { value: new THREE.Color(options.colorLine) },
        scale: { value: options.distance / options.size },
      },
      vertexShader: `
        varying vec2 vUv;

        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position.z = gl_Position.w;
        }
    `,
      fragmentShader: `
        uniform vec3 color1;
        uniform vec3 color2;
        uniform float scale;
        varying vec2 vUv;
        void main() {
          vec2 uv = vUv * scale;
          vec2 uv1 = (vUv - 0.5) * scale; 
          float distanceToCamera = uv1.x * uv1.x + uv1.y * uv1.y;
          float fadeFactor = 1.0 - smoothstep(0.0, 1000.0, distanceToCamera); // 根据距离计算淡化因子
          vec2 grid = abs(fract(uv - 0.5) - 0.5) / fwidth(uv) * 1.5;
          float line = min(grid.x, grid.y);
          vec3 color = mix(color1, color2, fadeFactor * (1.0 - min(line, 1.0))); // 根据淡化因子调整颜色
          gl_FragColor = vec4(color, 0.5);
        }
    `,

      extensions: {
        derivatives: true,
      },
      transparent: true,
    });

    // this._uniforms = material.uniforms;
    const object = new THREE.Mesh(
      geometry,
      material
      // new THREE.MeshBasicMaterial({
      //   opacity: 0.1,
      //   transparent: true,
      //   color: "black",
      //   side: THREE.DoubleSide,
      // })
    );
    // this.addModelToGroup(helperName, object);
    scene.add(object);
    // object.position.y = -600;
    // object.renderOrder = -1;
  }
  public toggleBgc(color: string) {
    if (this.grid) {
      this.grid.visible = color === "black" ? false : true;
    }
    if (this.gridDeep) {
      this.gridDeep.visible = color === "black" ? true : false;
    }
  }
}

export default new FloorHandler();
