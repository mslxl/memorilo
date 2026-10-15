import process from 'node:process'
import iconIcoPath from '../../resources/icon.ico?asset'
import iconPngPath from '../../resources/icon.png?asset'
import trayTemplatePath from '../../resources/trayTemplate.png?asset'
import trayTemplateRetinaPath from '../../resources/trayTemplate@2x.png?asset'

export const applicationIconPath = process.platform === 'win32' ? iconIcoPath : iconPngPath
export { trayTemplatePath, trayTemplateRetinaPath }
