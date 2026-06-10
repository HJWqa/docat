import postMessageCenter from "./postMessageCenter";
export interface IMessageCenter {
  send: (message: any) => void;
  listen: (cb: Function) => void;
  registerSource: (source?: any) => void;
}
class MessageCenterDispense {
  messageCenter: IMessageCenter | undefined;
  constructor() {
    this.messageCenter = this.getCenter();
    this.init();
  }
  private getCenter(): IMessageCenter {
    return postMessageCenter;
  }
  private init() {
    if (!this.messageCenter) {
      console.error("messageCenter is not register!");
      return;
    }
    this.messageCenter.registerSource();
  }
  public messageHandler(cb: Function) {
    if (!this.messageCenter) {
      console.error("messageCenter is not register!");
      return;
    }
    return this.messageCenter.listen(cb);
  }
  public sendMessage(data: any) {
    if (!this.messageCenter) {
      console.error("messageCenter is not register!");
      return;
    }
    return this.messageCenter.send(data);
  }
}

export default new MessageCenterDispense();
