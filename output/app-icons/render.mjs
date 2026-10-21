import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceDirectory = dirname(fileURLToPath(import.meta.url))
const organizer = process.argv.includes('--organizer')
const scheduled = process.argv.includes('--schedule')
const balanced = process.argv.includes('--balanced')
const refinement = process.argv.includes('--refine')
const workspace = process.argv.includes('--workspace')
const flat = organizer || scheduled || balanced || refinement || workspace || process.argv.includes('--flat')
const directory = organizer ? join(sourceDirectory, 'organizer') : scheduled ? join(sourceDirectory, 'scheduled') : balanced ? join(sourceDirectory, 'balanced') : refinement ? join(sourceDirectory, 'grow-and-do') : workspace ? join(sourceDirectory, 'workspace') : flat ? join(sourceDirectory, 'flat') : sourceDirectory
const require = createRequire(join(sourceDirectory, '../../apps/desktop/package.json'))
const sharp = require('sharp')
const edition = organizer ? 'PERSONAL ORGANIZER / ONE CLEAR OBJECT' : scheduled ? 'NOTES + TIME / INTEGRATED FORMS' : balanced ? 'NEW DIRECTIONS / BALANCED FORMS' : refinement ? 'GROW &amp; DO / REFINEMENTS' : flat ? 'FLAT ICON STUDIES' : 'APP ICON STUDIES'
const productSummary = 'READ / CAPTURE / PLAN / DO / LEARN'
const artworkDescription = flat
  ? 'Flat SVG artwork. Solid colors only. No gradients or shadows.'
  : 'Original SVG artwork. Opaque materials.'

const concepts = organizer ? [
  { name: '01-indexed-journal', title: 'Indexed Journal', detail: 'Ideas, plans, and actions in one place.', label: '01 / INDEXED JOURNAL' },
  { name: '02-bound-planner', title: 'Bound Planner', detail: 'A familiar place to record and arrange.', label: '02 / BOUND PLANNER' },
  { name: '03-open-organizer', title: 'Open Organizer', detail: 'A personal organizer, opened to today.', label: '03 / OPEN ORGANIZER' },
] : scheduled ? [
  { name: '01-open-agenda', title: 'Open Agenda', detail: 'Open pages with a calendar rhythm.', label: '01 / BOOK + DATE CELLS' },
  { name: '02-calendar-pages', title: 'Calendar Pages', detail: 'Reading and writing within your day.', label: '02 / CALENDAR + BOOK' },
  { name: '03-daily-folio', title: 'Daily Folio', detail: 'Notes and actions in an open planner.', label: '03 / NOTES + PLANS + TASKS' },
  { name: '04-time-notes', title: 'Time Notes', detail: 'Personal knowledge, with time in view.', label: '04 / TIME + OPEN PAGES' },
] : balanced ? [
  { name: '01-open-pages', title: 'Open Pages', detail: 'A place for thought and everyday life.', label: '01 / MIRRORED PAGES' },
  { name: '02-paired-folios', title: 'Paired Folios', detail: 'Information and action, connected.', label: '02 / PAIRED FORMS' },
  { name: '03-gather', title: 'Gather', detail: 'Different activities. One workspace.', label: '03 / SHARED CENTER' },
  { name: '04-open-m', title: 'Open M', detail: 'A simple mark for Memorilo.', label: '04 / BRAND INITIAL' },
] : refinement ? [
  { name: '00-reference', title: 'Previous B', detail: 'Reference from the previous round.', label: 'REFERENCE / PREVIOUS B' },
  { name: '01-single-leaf', title: 'Single Leaf', detail: 'Less foliage. A quieter page.', label: 'B1 / REDUCED' },
  { name: '02-page-flow', title: 'Page Flow', detail: 'Progress becomes the page edge.', label: 'B2 / INTEGRATED' },
  { name: '03-leaf-vein', title: 'Leaf Vein', detail: 'Growth and action share one shape.', label: 'B3 / COMBINED' },
] : workspace ? [
  { name: '03-knowledge-sprout', title: 'Knowledge Sprout', detail: 'Retained from the previous round.', label: 'A / RETAINED' },
  { name: '02-grow-and-do', title: 'Grow &amp; Do', detail: 'Ideas and actions on the same page.', label: 'B / KNOWLEDGE + ACTION' },
  { name: '03-daybook', title: 'Daybook', detail: 'Your notes, plans, and daily progress.', label: 'C / NOTES + SCHEDULES' },
  { name: '04-growing-check', title: 'Growing Check', detail: 'Make room for meaningful progress.', label: 'D / GROWTH + PROGRESS' },
] : [
  { name: '01-folded-m', title: flat ? 'Page M' : 'Folded M', detail: 'Read. Capture. Remember.', accent: '#286747' },
  { name: '02-recall-cards', title: 'Recall Cards', detail: 'Knowledge worth returning to.', accent: '#BD563C' },
  { name: '03-knowledge-sprout', title: 'Knowledge Sprout', detail: 'Small sessions. Lasting growth.', accent: '#63836C' },
  { name: '04-memory-loop', title: 'Memory Loop', detail: 'A continuous learning practice.', accent: '#D99161' },
]
const boardWidth = 80 + 380 * concepts.length
const rightEdge = boardWidth - 52

const panels = await Promise.all(concepts.map(async (concept, index) => {
  const input = await readFile(join(directory, `${concept.name}.svg`))
  if (flat && /gradient|filter|opacity|url\(/i.test(input.toString()))
    throw new Error(`Non-flat styling found: ${concept.name}`)
  await Promise.all([1024, 256, 64, 32].map(size =>
    sharp(input).resize(size, size).png().toFile(join(directory, `${concept.name}${size === 1024 ? '' : `-${size}`}.png`)),
  ))
  const image = `data:image/png;base64,${(await readFile(join(directory, `${concept.name}.png`))).toString('base64')}`
  const x = 48 + index * 380
  return `<g>
    <rect x="${x}" y="183" width="360" height="548" rx="22" fill="#FFFDFA" stroke="#DDD9D0"/>
    <text x="${x + 24}" y="218" font-family="sans-serif" font-size="12" letter-spacing="1" fill="#777970">${concept.label ?? `0${index + 1}`}</text>
    <image href="${image}" x="${x + 36}" y="231" width="288" height="288"/>
    <text x="${x + 24}" y="548" font-family="Georgia,serif" font-size="26" fill="#252F29">${concept.title}</text>
    <text x="${x + 24}" y="575" font-family="sans-serif" font-size="13" fill="#69726B">${concept.detail}</text>
    <rect x="${x + 24}" y="602" width="149" height="94" rx="12" fill="#EDEAE3"/>
    <rect x="${x + 187}" y="602" width="149" height="94" rx="12" fill="#262B28"/>
    <image href="${image}" x="${x + 38}" y="633" width="32" height="32"/>
    <image href="${image}" x="${x + 90}" y="617" width="64" height="64"/>
    <image href="${image}" x="${x + 201}" y="633" width="32" height="32"/>
    <image href="${image}" x="${x + 253}" y="617" width="64" height="64"/>
  </g>`
}))

const comparison = `<svg xmlns="http://www.w3.org/2000/svg" width="${boardWidth}" height="816" viewBox="0 0 ${boardWidth} 816">
  <rect width="${boardWidth}" height="816" fill="#F2EFE7"/>
  <text x="50" y="81" font-family="Georgia,serif" font-size="47" fill="#26372C">Memorilo</text>
  <text x="51" y="115" font-family="sans-serif" font-size="16" fill="#667066">${edition} / ${productSummary}</text>
  <text x="${rightEdge}" y="81" text-anchor="end" font-family="sans-serif" font-size="13" letter-spacing="2" fill="#667066">${organizer ? 'ONE DIRECTION / THREE SILHOUETTES' : scheduled ? 'TIME IS VISIBLE / PAGES STAY CENTRAL' : balanced ? 'ONE MARK / TWO SOLID COLORS' : refinement ? 'A CALMER SHARED SYMBOL' : workspace ? 'KNOWLEDGE + EVERYDAY ACTION' : 'FOUR DIRECTIONS'}</text>
  <path d="M50 145H${rightEdge}" stroke="#D3D5C9"/>
  ${panels.join('\n')}
  <text x="51" y="779" font-family="sans-serif" font-size="13" fill="#667066">${artworkDescription} Transparent outer canvas. Small previews at 32 and 64 pixels.</text>
</svg>`

await sharp(Buffer.from(comparison)).png().toFile(join(directory, 'comparison.png'))

const cards = concepts.map((concept, index) => `
  <article>
    <span class="number">${concept.label ?? `0${index + 1}`}</span>
    <div class="hero"><img src="${concept.name}.png" alt="${concept.title}" width="1024" height="1024"></div>
    <h2>${concept.title}</h2>
    <p>${concept.detail}</p>
    <div class="samples">
      <div class="sample light"><img src="${concept.name}-32.png" alt="" width="32" height="32"><img src="${concept.name}-64.png" alt="" width="64" height="64"></div>
      <div class="sample dark"><img src="${concept.name}-32.png" alt="" width="32" height="32"><img src="${concept.name}-64.png" alt="" width="64" height="64"></div>
    </div>
    <div class="links"><a href="${concept.name}.svg">SVG source</a><a href="${concept.name}.png">1024px PNG</a></div>
  </article>`).join('\n')

await writeFile(join(directory, 'preview.html'), `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Memorilo - ${flat ? 'Flat icon studies' : 'Icon studies'}</title>
<style>
  :root { color-scheme: light; --ink: #26372c; --muted: #667066; --line: #d3d5c9; }
  * { box-sizing: border-box; }
  body { margin: 0; color: var(--ink); background: ${flat ? '#f2efe7' : 'radial-gradient(ellipse at 8% 0%, #faf7ed, transparent 70%), #f2efe7'}; font-family: "Avenir Next", "Segoe UI", sans-serif; }
  main { max-width: 1660px; padding: 56px 40px; margin: auto; }
  header { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; padding-bottom: 28px; border-bottom: 1px solid var(--line); }
  h1 { margin: 0 0 14px; font: 56px/.95 Georgia, serif; letter-spacing: -2px; }
  header p { margin: 0; color: var(--muted); font-size: 12px; letter-spacing: 1.5px; line-height: 1.6; }
  header a { color: var(--ink); font-size: 13px; text-underline-offset: 4px; }
  .grid { display: grid; grid-template-columns: repeat(${concepts.length}, minmax(0, 1fr)); gap: 20px; padding: 34px 0; }
  article { padding: 24px; background: #fffdfa; border: 1px solid #ddd9d0; border-radius: 20px; }
  .number { font-size: 12px; letter-spacing: 2px; color: var(--muted); }
  .hero { margin: 8px 0 14px; }
  .hero img { display: block; width: 100%; height: auto; }
  h2 { margin: 0 0 10px; font: 27px/1.1 Georgia, serif; letter-spacing: -.5px; }
  article p { color: var(--muted); font-size: 13px; line-height: 1.6; min-height: 42px; margin: 0 0 16px; }
  .samples { display: flex; gap: 10px; }
  .sample { min-width: 0; flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px; height: 94px; border-radius: 12px; }
  .sample img { flex-shrink: 0; }
  .light { background: #edeae3; }
  .dark { background: #262b28; }
  .links { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 20px; }
  .links a { color: var(--ink); font-size: 12px; text-underline-offset: 4px; }
  a:focus-visible { outline: 2px solid #286747; outline-offset: 5px; border-radius: 2px; }
  footer { font-size: 13px; line-height: 1.8; color: var(--muted); }
  @media (max-width: 1200px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 600px) { main { padding: 32px 20px; } header { align-items: flex-start; flex-direction: column; } h1 { font-size: 46px; } .grid { grid-template-columns: 1fr; } article { padding: 24px; } }
</style>
<main>
  <header><div><h1>Memorilo</h1><p>${edition} / ${productSummary}</p></div><a href="comparison.png">Open comparison image</a></header>
  <section class="grid" aria-label="${concepts.length} application icon alternatives">${cards}</section>
  <footer>${artworkDescription} Small previews show each icon at 32px and 64px on light and dark surfaces.<br>SVG sources and PNG exports are included. These are design candidates; the application configuration has not been changed.</footer>
</main>
</html>
`)

for (const concept of concepts) {
  const filename = join(directory, `${concept.name}.png`)
  const metadata = await sharp(filename).metadata()
  const { data, info } = await sharp(filename).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const cornerAlpha = data[3]
  const centerAlpha = data[(512 * info.width + 512) * info.channels + 3]
  if (metadata.width !== 1024 || metadata.height !== 1024 || !metadata.hasAlpha || cornerAlpha !== 0 || centerAlpha !== 255)
    throw new Error(`Invalid icon dimensions or transparency: ${concept.name}`)
  console.log(`${concept.name}: 1024/256/64/32px PNG, transparent exterior, opaque center`)
  if (balanced || scheduled || organizer) {
    let total = 0
    let sumX = 0
    let sumY = 0
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const offset = (y * info.width + x) * info.channels
        if (data[offset] === 247 && data[offset + 1] === 240 && data[offset + 2] === 215 && data[offset + 3] === 255) {
          total++
          sumX += x
          sumY += y
        }
      }
    }
    console.log(`  Foreground centroid: ${(sumX / total).toFixed(1)}, ${(sumY / total).toFixed(1)}; canvas center: 511.5, 511.5`)
  }
}
console.log('comparison.png and preview.html written')
