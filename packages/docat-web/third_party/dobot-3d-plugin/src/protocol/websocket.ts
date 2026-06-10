import { IMessageCenter } from "./messageCenterDispense";
import baseMessageCenter from ".";
import { isJSON } from "src/utils/relocalStorage";
class WebsocketCenter implements IMessageCenter {
  socket: any;
  wsUrl = "ws://localhost:9988";
  lockReconnect = false;
  locklistener = false;
  isConnected = false;
  public registerSource(wsUrl?: string) {
    if (wsUrl) {
      this.wsUrl = wsUrl;
    }
    this.socket = new WebSocket(this.wsUrl);
    this.onOpen();
  }
  private onError() {
    this.socket.onerror = () => {
      console.log("websocket error");
      this.isConnected = false;
      this.socket = null;
      this.reconnect();
    };
  }
  private onClose() {
    console.log("close", this.wsUrl);
    this.socket.onclose = () => {
      this.locklistener = false;
      this.isConnected = false;
      this.socket = null;
      this.reconnect();
    };
  }
  private onOpen() {
    console.log("start", this.wsUrl);
    this.onError();
    this.socket.onopen = () => {
      console.log("open");
      this.isConnected = true;
      this.onClose();
      baseMessageCenter.freshListener();
    };
  }
  public listen(cb: Function) {
    if (this.locklistener) return;
    console.log("listen");
    this.locklistener = true;
    this.socket.onmessage = (event: any) => {
      cb(JSON.parse(event.data));
    };
  }
  public send(message: any) {
    if (!this.socket || !this.isConnected) return;
    if(!isJSON(message)){
      message = JSON.stringify(message)
    }
    this.socket.send(message);
  }
  private reconnect() {
    if (this.lockReconnect) return;
    this.lockReconnect = true;
    setTimeout(() => {
      this.registerSource(this.wsUrl);
      this.lockReconnect = false;
    }, 2000);
  }
}
export default new WebsocketCenter();
