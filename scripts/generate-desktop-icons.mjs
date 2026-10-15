import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const desktopDirectory = join(repositoryRoot, 'apps/desktop')
const resources = join(desktopDirectory, 'resources')
const require = createRequire(join(desktopDirectory, 'package.json'))
const sharp = require('sharp')

const source = await readFile(join(resources, 'icon.svg'))
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
const images = new Map(await Promise.all(sizes.map(async size => [
  size,
  await sharp(source).resize(size, size).png().toBuffer(),
])))

await mkdir(join(resources, 'icons'), { recursive: true })
await Promise.all(sizes.map(size => writeFile(join(resources, 'icons', `${size}x${size}.png`), images.get(size))))
await writeFile(join(resources, 'icon.png'), images.get(1024))

// ICO directory entries reference complete PNG frames, including the 256px frame.
const windowsSizes = sizes.filter(size => size <= 256)
const header = Buffer.alloc(6 + windowsSizes.length * 16)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(windowsSizes.length, 4)
let offset = header.length
const frames = windowsSizes.map((size, index) => {
  const image = images.get(size)
  const entry = 6 + index * 16
  header[entry] = size === 256 ? 0 : size
  header[entry + 1] = size === 256 ? 0 : size
  header.writeUInt16LE(1, entry + 4)
  header.writeUInt16LE(32, entry + 6)
  header.writeUInt32LE(image.length, entry + 8)
  header.writeUInt32LE(offset, entry + 12)
  offset += image.length
  return image
})
await writeFile(join(resources, 'icon.ico'), Buffer.concat([header, ...frames]))

const mark = source.toString()
  .replace(/^<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .replace(/<rect x="64"[^>]*\/>/, '')
  .replaceAll('#F7F0D7', '#fff')
  .replaceAll('#46644F', '#000')
const template = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="245 245 534 534">
  <defs><mask id="mark" x="0" y="0" width="1024" height="1024" maskUnits="userSpaceOnUse">${mark}</mask></defs>
  <rect width="1024" height="1024" fill="#000" mask="url(#mark)"/>
</svg>`
await Promise.all([1, 2].map(scale =>
  sharp(Buffer.from(template)).resize(16 * scale, 16 * scale).png().toFile(join(resources, `trayTemplate${scale === 2 ? '@2x' : ''}.png`)),
))

if (process.platform === 'darwin') {
  const temporary = await mkdtemp(join(tmpdir(), 'memorilo-icons-'))
  try {
    const iconset = join(temporary, 'icon.iconset')
    await mkdir(iconset)
    await Promise.all([16, 32, 128, 256, 512].flatMap(size => [
      writeFile(join(iconset, `icon_${size}x${size}.png`), images.get(size)),
      writeFile(join(iconset, `icon_${size}x${size}@2x.png`), images.get(size * 2)),
    ]))
    await promisify(execFile)('iconutil', ['--convert', 'icns', '--output', join(resources, 'icon.icns'), iconset])
  }
  finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

console.log('Generated desktop, Windows, Linux, and tray icons from apps/desktop/resources/icon.svg')
if (process.platform !== 'darwin')
  console.log('The checked-in macOS icon.icns is retained; regenerate it on macOS when changing icon.svg.')
