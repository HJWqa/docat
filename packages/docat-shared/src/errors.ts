/**
 * 设备通信错误码（从 DobotStudio Pro 4.6 提取）
 * @see OpenDobot46/src.dobotlink/error/errorCode.ts
 */
export enum DeviceErrorCode {
  /** 连接失败 */
  CONNECT_FAILED = 1000,
  /** 设备已被占用（未知类型） */
  CONNECT_DEVICE_BEEN_OCCUPIED = 1001,
  /** 设备已被 PC 客户端占用 */
  CONNECT_DEVICE_BEEN_OCCUPIED_PC = 1002,
  /** 设备已被 App 占用 */
  CONNECT_DEVICE_BEEN_OCCUPIED_APP = 1003,
  /** 设备已被有线示教器占用 */
  CONNECT_DEVICE_BEEN_OCCUPIED_TEACH_WIRED = 1004,
  /** 设备已被无线示教器占用 */
  CONNECT_DEVICE_BEEN_OCCUPIED_TEACH_WIREDLESS = 1005,
  /** V3 版本不支持 */
  CONNECT_VERSION_INVALID_V3 = 1006,
  /** V4.4.0 版本不支持 */
  CONNECT_VERSION_INVALID_V440 = 1007,
  /** V4.4.0 版本不支持（变体1） */
  CONNECT_VERSION_INVALID_V440_1 = 1008,
  /** V4.4.0 版本不支持（变体2） */
  CONNECT_VERSION_INVALID_V440_2 = 1009,

  /** 通用请求错误 */
  REQUEST_COMMON_ERROR = 4000,
  /** 请求超时 */
  REQUEST_TIMEOUT = 4001,
  /** 请求方法错误 */
  REQUEST_METHOD_ERROR = 4002,
  /** 请求参数错误 */
  REQUEST_PARAMS_ERROR = 4003,
  /** 请求执行错误 */
  REQUEST_EXECUTE_ERROR = 4004,

  /** 脚本启动错误 */
  SCRIPT_START_ERROR = 5000,
  /** 脚本运行错误 */
  SCRIPT_RUN_ERROR = 5001,

  /** SFTP 通信错误 */
  SFTP_ERROR = 6000,

  /** 项目保存错误 */
  PROJECT_SAVE_ERROR = 7000,
  /** 项目未找到 */
  PROJECT_NOT_FOUND_ERROR = 7001,
  /** 项目大小错误 */
  PROJECT_SIZE_ERROR = 7002,
  /** 项目点位错误 */
  PROJECT_POINT_ERROR = 7003,
  /** 项目解压错误 */
  PROJECT_UNZIP_ERROR = 7004,

  /** 脚本预编译错误 */
  SCRIPT_PRECOMPILE_ERROR = 8000,

  /** 授权码不存在 */
  CODE_NOT_EXSIT = 400001,
  /** 授权码过期 */
  CODE_EXPIRED = 400002,
  /** 授权码已废弃 */
  CODE_ABANDONED = 400003,
  /** 控制器版本不兼容 */
  CONTROLVERSION_INVALID = 400004,
  /** 机械臂类型不兼容 */
  ROBOTARM_INVALID = 400005,
  /** 线缆类型不兼容 */
  CABTYPE_INVALID = 400006,
  /** 区域 ID 不兼容 */
  REGIONID_INVALID = 400007,
  /** 类型相同 */
  TYPE_SAME = 400008,
  /** 请求过于频繁 */
  TOO_MANY_REQUESTS = 400009,
}

/** docat-server 内部错误码 */
export enum ServerErrorCode {
  /** 未授权 */
  UNAUTHORIZED = 40100,
  /** 禁止访问 */
  FORBIDDEN = 40300,
  /** 设备未找到 */
  DEVICE_NOT_FOUND = 40401,
  /** 脚本未找到 */
  SCRIPT_NOT_FOUND = 40402,
  /** 用户未找到 */
  USER_NOT_FOUND = 40403,
  /** 设备已被占用 */
  DEVICE_OCCUPIED = 40902,
  /** 参数验证失败 */
  VALIDATION_ERROR = 42200,
  /** 设备离线 */
  DEVICE_OFFLINE = 50301,
  /** 内部服务器错误 */
  INTERNAL_ERROR = 50000,
}

/** 获取错误码对应的人类可读描述 */
export function getDeviceErrorLabel(code: DeviceErrorCode): string {
  const labels: Partial<Record<DeviceErrorCode, string>> = {
    [DeviceErrorCode.CONNECT_FAILED]: '设备连接失败',
    [DeviceErrorCode.CONNECT_DEVICE_BEEN_OCCUPIED]: '设备已被占用',
    [DeviceErrorCode.CONNECT_DEVICE_BEEN_OCCUPIED_PC]: '设备已被 PC 客户端占用',
    [DeviceErrorCode.CONNECT_DEVICE_BEEN_OCCUPIED_APP]: '设备已被 App 占用',
    [DeviceErrorCode.CONNECT_DEVICE_BEEN_OCCUPIED_TEACH_WIRED]: '设备已被有线示教器占用',
    [DeviceErrorCode.CONNECT_DEVICE_BEEN_OCCUPIED_TEACH_WIREDLESS]: '设备已被无线示教器占用',
    [DeviceErrorCode.CONNECT_VERSION_INVALID_V3]: '固件版本过低（V3）',
    [DeviceErrorCode.CONNECT_VERSION_INVALID_V440]: '固件版本不兼容（V4.4.0）',
    [DeviceErrorCode.REQUEST_TIMEOUT]: '请求超时',
    [DeviceErrorCode.REQUEST_METHOD_ERROR]: '请求方法错误',
    [DeviceErrorCode.REQUEST_PARAMS_ERROR]: '请求参数错误',
    [DeviceErrorCode.REQUEST_EXECUTE_ERROR]: '请求执行错误',
    [DeviceErrorCode.SCRIPT_START_ERROR]: '脚本启动失败',
    [DeviceErrorCode.SCRIPT_RUN_ERROR]: '脚本运行错误',
    [DeviceErrorCode.SFTP_ERROR]: '文件传输错误',
    [DeviceErrorCode.PROJECT_SAVE_ERROR]: '项目保存失败',
    [DeviceErrorCode.PROJECT_NOT_FOUND_ERROR]: '项目未找到',
    [DeviceErrorCode.PROJECT_SIZE_ERROR]: '项目大小超限',
    [DeviceErrorCode.PROJECT_POINT_ERROR]: '项目点位错误',
    [DeviceErrorCode.PROJECT_UNZIP_ERROR]: '项目解压失败',
    [DeviceErrorCode.SCRIPT_PRECOMPILE_ERROR]: '脚本预编译错误',
    [DeviceErrorCode.TOO_MANY_REQUESTS]: '请求过于频繁',
  }
  return labels[code] ?? `未知错误 (${code})`
}

/** 检测是否为设备占用类错误 */
export function isOccupiedError(code: number): boolean {
  return code >= 1001 && code <= 1005
}
