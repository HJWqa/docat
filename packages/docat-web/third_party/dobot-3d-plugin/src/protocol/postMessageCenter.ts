import { IMessageCenter } from "./messageCenterDispense";
class PostMessageCenter implements IMessageCenter {
  source: any;
  origin: string;
  constructor() {
    this.source = null;
    this.origin = "*";
  }
  public send(message: any) {
    if (!this.source) {
        window.parent.postMessage(message, this.origin);
      return;
    }
    this.source.postMessage(message, this.origin);
  }
  public listen(cb: Function) {
    window.addEventListener("message", (event) => {
      const message = event.data;
      if (!message || typeof message !== "object" || !message.method) return;
      if (!this.source && event.source) {
        this.registerSource(event.source);
      }
      cb(message);
    });
  }
  public registerSource(source: object) {
    this.source = source;
  }
}
export default new PostMessageCenter();
