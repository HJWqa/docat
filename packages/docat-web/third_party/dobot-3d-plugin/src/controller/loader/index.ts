import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader";

export const modelLoader = () => {
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath("./static/draco/");
  // dracoLoader.setDecoderConfig({ type: "js" });
  dracoLoader.preload();
  const loader = new GLTFLoader();
  loader.setDRACOLoader(dracoLoader);
  return loader;
};

export const loader = modelLoader();
export const handleModel = (path: string) => {
  return new Promise((res) => {
    loader.load(`./static/${path}`, (gltf) => {
      res(gltf.scene);
    });
  });
};

export default modelLoader;
