/**
 * DeviceFactory — 根据 controllerTypeExt 创建对应驱动实例
 * @see OpenDobot46/src.vm/dobotvm/device/index.ts DevieFactory
 */
import { DeviceDriver } from './DeviceDriver.js'
import { StubDriver } from './StubDriver.js'
import { MG6Driver } from './drivers/MG6Driver.js'
import { MagicianDriver } from './drivers/MagicianDriver.js'

/** 从 controllerTypeExt 判断设备系列 */
function detectDeviceSeries(controllerTypeExt: string): string {
  const upper = controllerTypeExt.toUpperCase()
  if (upper.includes('MG6') || upper.includes('MAGICIAN E6') || upper.includes('E6')) return 'MG6'
  if (upper.includes('NOVA') || upper.includes('NC0')) return 'Nova'
  if (upper.includes('CR')) return 'CR'
  if (upper.includes('MAGICIAN') || upper.includes('M1') || upper.includes('MG400')) return 'Magician'
  return 'Unknown'
}

/** 从设备名判断 */
function detectByName(name: string): string {
  const upper = name.toUpperCase()
  if (upper.includes('MG6') || upper.includes('E6')) return 'MG6'
  if (upper.includes('NOVA') || upper.includes('NC')) return 'Nova'
  if (upper.includes('CR')) return 'CR'
  if (upper.includes('MAGICIAN') || upper.includes('MG400') || upper.includes('M1')) return 'Magician'
  return 'Unknown'
}

export interface DeviceFactoryResult {
  driver: DeviceDriver
  series: string
}

export interface DriverSerialConfig {
  serialPort?: string
  baudRate?: number
}

export function createDriver(
  id: string,
  ip: string,
  name: string = 'Unknown',
  controllerTypeExt: string = '',
  serial: DriverSerialConfig = {},
): DeviceFactoryResult {
  let series = 'Unknown'

  if (controllerTypeExt) {
    series = detectDeviceSeries(controllerTypeExt)
  }
  if (series === 'Unknown') {
    series = detectByName(name)
  }

  switch (series) {
    case 'MG6':
      return { driver: new MG6Driver(id, ip, name), series: 'MG6' }

    case 'Nova':
      // TODO: NovaDriver
      return { driver: new StubDriver(id, ip, name), series: 'Nova' }

    case 'CR':
      // TODO: CRDriver
      return { driver: new StubDriver(id, ip, name), series: 'CR' }

    case 'Magician':
      return {
        driver: new MagicianDriver(id, ip, name, serial.serialPort ?? '', serial.baudRate ?? 115200),
        series: 'Magician',
      }

    default:
      return { driver: new StubDriver(id, ip, name), series: 'Unknown' }
  }
}
