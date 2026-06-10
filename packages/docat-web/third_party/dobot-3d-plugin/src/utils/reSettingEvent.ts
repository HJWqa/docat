export const SettingEventHandler = function (key: string, newValue: any) {
  const setItemEvent = new Event("setItemEvent") as any;
  setItemEvent.newValue = newValue;
  setItemEvent.key = key;
  window.dispatchEvent(setItemEvent);
};
