import * as THREE from "three";
class RenderHandler {
  public renderer: THREE.WebGLRenderer | undefined;
  public helperRenderer: THREE.WebGLRenderer | undefined;
  public init(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      // logarithmicDepthBuffer: true,
    });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setScissorTest(true);

    container.appendChild(this.renderer.domElement);
  }
  public initHelperRenderer(container: HTMLElement) {
    this.helperRenderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: false,
    });
    this.helperRenderer.setSize(200, 200);
    this.helperRenderer.domElement.style.position = "absolute";
    this.helperRenderer.domElement.style.width = `${Math.min(
      container.clientWidth,
      container.clientHeight
    )}px`;
    this.helperRenderer.domElement.style.height = `${Math.min(
      container.clientWidth,
      container.clientHeight
    )}px`;
    container.appendChild(this.helperRenderer.domElement);
  }
  public resizeRender = (
    container: HTMLElement,
    type: "renderer" | "helperRenderer"
  ) => {
    if (!this[type]) return;
    this[type]!.setSize(container.clientWidth, container.clientHeight);
    this[type]!.setScissor(0, 0, container.clientWidth, container.clientHeight);
    this[type]!.setViewport(
      0,
      0,
      container.clientWidth,
      container.clientHeight
    );
    if (type === "helperRenderer") {
      this.helperRenderer!.domElement.style.width = `${Math.min(
        container.clientWidth,
        container.clientHeight
      )}px`;
      this.helperRenderer!.domElement.style.height = `${Math.min(
        container.clientWidth,
        container.clientHeight
      )}px`;
    }
  };
  public renderModel(container: HTMLElement) {
    container.appendChild(this.renderer!.domElement);
  }
  public setRenderLimit(isLimit: boolean) {
    if (isLimit) {
      this.renderer &&
        this.renderer.setPixelRatio(window.devicePixelRatio * 0.1);
      this.helperRenderer &&
        this.helperRenderer.setPixelRatio(window.devicePixelRatio * 0.1);
    } else {
      this.renderer && this.renderer.setPixelRatio(window.devicePixelRatio);
      this.helperRenderer &&
        this.helperRenderer.setPixelRatio(window.devicePixelRatio * 0.8);
    }
  }
}
export default new RenderHandler();
