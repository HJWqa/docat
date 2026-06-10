export const orignalSetItem = localStorage.setItem;
// localStorage.setItem = function (key, newValue) {
//   const setItemEvent = new Event('setItemEvent') as any
//   setItemEvent.newValue = newValue
//   setItemEvent.key = key
//   window.dispatchEvent(setItemEvent)
//   orignalSetItem.apply(this, arguments as any)
// }
export const customSetItem = function (key: string, newValue: string) {
  const setItemEvent = new Event("setItemEvent") as any;
  setItemEvent.newValue = newValue;
  setItemEvent.key = key;
  window.dispatchEvent(setItemEvent);
  // orignalSetItem.apply(this, arguments as any)
  localStorage.setItem(key, newValue);
};

/**
 * 可配置防抖函数
 * @param  {function} func        回调函数
 * @param  {number}   wait        表示时间窗口的间隔
 * @param  {boolean}  immediate   设置为ture时，是否立即调用函数
 * @return {function}             返回客户调用函数
 */
export function debounce(func: Function, wait = 100, immediate = true) {
  let timer: any, context: any, args: any;
  // 延迟执行函数
  const later = () =>
    setTimeout(() => {
      timer = null;
      if (!immediate) {
        func.apply(context, args);
        context = args = null;
      }
    }, wait);

  return function (...params: any) {
    if (!timer) {
      timer = later();
      if (immediate) {
        // @ts-ignore
        func.apply(this, params);
      } else {
        // @ts-ignore
        context = this;
        args = params;
      }
    } else {
      clearTimeout(timer);
      timer = later();
    }
  };
}

export const isJSON = (str: any) => {
  if (typeof str === "string") {
    try {
      var obj = JSON.parse(str);
      if (typeof obj === "object" && obj) {
        return true;
      } else {
        return false;
      }
    } catch (e) {
      return false;
    }
  }
  return false;
};
