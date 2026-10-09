Type: research
Status: resolved
Blocked by: 01

## Question

What content projection should power self-contained HTML and PDF export? Establish a supported matrix for regular topics, nested blocks, marks, links, images, tables, math, tasks, Reader sources, whiteboards, and image occlusion. Decide how unsupported or interactive content is represented so the output is readable and loss is explicit.

## Answer

HTML and PDF will consume one validated static export projection, built from each Topic's canonical data rather than editor DOM, React state, or application routes. Regular and Book Topics use validated Topic JSON; ImageOcclusion Topics use their image snapshot plus normalized shapes; Whiteboard Topics use a static scene image when available and then export embedded editor content as ordinary rich text.

The projection matrix is:

- Regular/Book Topics and nested blocks preserve hierarchy, headings, paragraphs, blockquotes, code, horizontal rules, lists, tasks, tables, links, marks, and hard breaks.
- Math is rendered through the existing KaTeX/MathML path with source LaTeX retained as fallback.
- Images prefer Memorilo-managed data URLs; external or missing resources remain visible as an explicitly diagnosed placeholder or warning.
- Reader sources become static asides containing quote/image and location; Reader navigation and source-book files are not embedded.
- Image occlusion becomes a static image with SVG overlays and a mode/source caption; reveal interactions are frozen.
- Whiteboards become a static SVG/PNG scene when renderable, with embedded editor text following it; scene tools, selection, zoom, and editability are not exported.
- Cloze, card delimiters, highlights, timers, reminders, and other learning interactions are frozen to readable content and non-executable styling/labels.

Every unsupported, unavailable, or degraded item produces a structured diagnostic containing its topic/block/node path, kind, reason, and fallback. HTML inserts a visible warning at the affected location; PDF preserves the warning text. Projection validation failures reject the whole export before any output is saved, while resource/render failures degrade visibly instead of producing blank content. Exported files contain no application scripts or IPC behavior.

Research basis: [Note HTML/PDF export content fidelity](../../../docs/research/note-export-content-fidelity.md).
