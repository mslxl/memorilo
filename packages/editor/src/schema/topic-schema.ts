import type { Effect } from 'effect'
import { Exit, Schema } from 'effect'
import {
  LoroTopicDocumentSchema,
  strictTopicParseOptions,
  TopicAttributesSchema,
} from './topic-document-schema'

export type {
  LoroTopicDocument,
  LoroTopicMarkType,
  LoroTopicNode,
  LoroTopicNodeType,
} from './topic-document-schema'
export {
  LoroTopicDocumentSchema,
  LoroTopicNodeSchema,
} from './topic-document-schema'

const NonNegativeIntegerSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const PositiveIntegerSchema = Schema.Int.check(Schema.isGreaterThan(0))
const UnitIntervalSchema = Schema.Number.check(Schema.isBetween({ maximum: 1, minimum: 0 }))
const PositiveUnitIntervalSchema = UnitIntervalSchema.check(Schema.isGreaterThan(0))
const ReadingFormatSchema = Schema.Literals(['cbr', 'cbz', 'epub', 'pdf', 'txt'])
const BookFileSha256Schema = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u))
const ReadingAnnotationColorSchema = Schema.Literals(['blue', 'green', 'pink', 'purple', 'yellow'])
const ReadingAnnotationStyleSchema = Schema.Literals(['highlight', 'underline'])
const ReadingNormalizedRectSchema = Schema.Struct({
  height: UnitIntervalSchema,
  width: UnitIntervalSchema,
  x: UnitIntervalSchema,
  y: UnitIntervalSchema,
})
const ReadingTextQuoteSchema = Schema.Struct({
  after: Schema.optionalKey(Schema.String),
  before: Schema.optionalKey(Schema.String),
  exact: Schema.String,
})
const ReadingEpubLocatorSchema = Schema.Struct({
  href: Schema.NonEmptyString,
  locations: Schema.optionalKey(TopicAttributesSchema),
  text: Schema.optionalKey(TopicAttributesSchema),
  title: Schema.optionalKey(Schema.String),
  type: Schema.NonEmptyString,
})
const ReadingPdfTextAnchorSchema = Schema.Struct({
  format: Schema.Literal('pdf'),
  pageNumber: PositiveIntegerSchema,
  quote: ReadingTextQuoteSchema,
  rects: Schema.Array(ReadingNormalizedRectSchema),
  source: Schema.Literals(['embedded', 'ocr']),
  type: Schema.Literal('text'),
})
const ReadingPdfRegionAnchorSchema = Schema.Struct({
  format: Schema.Literal('pdf'),
  pageNumber: PositiveIntegerSchema,
  rect: ReadingNormalizedRectSchema,
  type: Schema.Literal('region'),
})
const ReadingEpubTextAnchorSchema = Schema.Struct({
  format: Schema.Literal('epub'),
  locator: ReadingEpubLocatorSchema,
  quote: ReadingTextQuoteSchema,
  type: Schema.Literal('text'),
})
const ReadingEpubRegionAnchorSchema = Schema.Struct({
  format: Schema.Literal('epub'),
  locator: ReadingEpubLocatorSchema,
  targets: Schema.Array(Schema.Struct({
    rect: ReadingNormalizedRectSchema,
    selector: Schema.NonEmptyString,
  })),
  type: Schema.Literal('region'),
})
const ReadingTxtTextAnchorSchema = Schema.Struct({
  end: NonNegativeIntegerSchema,
  format: Schema.Literal('txt'),
  quote: ReadingTextQuoteSchema,
  start: NonNegativeIntegerSchema,
  type: Schema.Literal('text'),
})
const ReadingTxtRegionAnchorSchema = Schema.Struct({
  end: NonNegativeIntegerSchema,
  format: Schema.Literal('txt'),
  start: NonNegativeIntegerSchema,
  type: Schema.Literal('region'),
})
const ReadingComicRegionAnchorSchema = Schema.Struct({
  format: Schema.Literals(['cbr', 'cbz']),
  pageNumber: PositiveIntegerSchema,
  rect: ReadingNormalizedRectSchema,
  type: Schema.Literal('region'),
})
const ReadingTextAnchorSchema = Schema.Union([
  ReadingEpubTextAnchorSchema,
  ReadingPdfTextAnchorSchema,
  ReadingTxtTextAnchorSchema,
])
const ReadingRegionAnchorSchema = Schema.Union([
  ReadingComicRegionAnchorSchema,
  ReadingEpubRegionAnchorSchema,
  ReadingPdfRegionAnchorSchema,
  ReadingTxtRegionAnchorSchema,
])
const ReadingAnnotationBaseFields = {
  annotationTopicId: Schema.optionalKey(Schema.NonEmptyString),
  color: ReadingAnnotationColorSchema,
  createdAt: NonNegativeIntegerSchema,
  id: Schema.NonEmptyString,
  updatedAt: NonNegativeIntegerSchema,
} as const
const ReadingAnnotationSchema = Schema.Union([
  Schema.Struct({
    ...ReadingAnnotationBaseFields,
    anchors: Schema.NonEmptyArray(ReadingTextAnchorSchema),
    style: ReadingAnnotationStyleSchema,
  }),
  Schema.Struct({
    ...ReadingAnnotationBaseFields,
    anchors: Schema.NonEmptyArray(ReadingRegionAnchorSchema),
    style: Schema.Literal('highlight'),
  }),
]).check(Schema.makeFilter((annotation) => {
  const first = annotation.anchors[0]
  return annotation.anchors.some(anchor => anchor.format !== first.format || anchor.type !== first.type)
    ? { message: 'expected annotation fragments to use one format and type', path: ['anchors'] }
    : undefined
}, { expected: 'a ReadingAnnotation with consistent fragments' }))
const ReadingPositionSchema = Schema.Union([
  Schema.Struct({
    format: Schema.Literals(['cbr', 'cbz']),
    pageNumber: PositiveIntegerSchema,
    pageProgress: UnitIntervalSchema,
  }),
  Schema.Struct({ format: Schema.Literal('epub'), locator: ReadingEpubLocatorSchema }),
  Schema.Struct({
    format: Schema.Literal('pdf'),
    pageNumber: PositiveIntegerSchema,
    pageProgress: UnitIntervalSchema,
  }),
  Schema.Struct({ format: Schema.Literal('txt'), offset: NonNegativeIntegerSchema }),
])
const BookFileLocatorSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('local'),
    readingId: Schema.NonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal('shelf'),
    publicationId: Schema.NonEmptyString,
    readingId: Schema.NonEmptyString,
    sourceId: Schema.NonEmptyString,
  }),
])
const BookFileBindingSchema = Schema.Struct({
  book: Schema.Struct({
    authors: Schema.Array(Schema.NonEmptyString),
    title: Schema.NonEmptyString,
  }),
  file: Schema.Struct({
    byteLength: PositiveIntegerSchema,
    format: ReadingFormatSchema,
    originalName: Schema.NonEmptyString,
    sha256: BookFileSha256Schema,
  }),
  retrievalHints: Schema.Array(BookFileLocatorSchema),
})

const OcclusionShapeBaseFields = {
  groupId: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
} as const
const OcclusionBoundsShapeSchema = Schema.Struct({
  ...OcclusionShapeBaseFields,
  height: PositiveUnitIntervalSchema,
  kind: Schema.Literals(['ellipse', 'rectangle']),
  width: PositiveUnitIntervalSchema,
  x: UnitIntervalSchema,
  y: UnitIntervalSchema,
}).check(Schema.makeFilter((shape) => {
  if (shape.x + shape.width > 1)
    return { message: 'expected the OcclusionShape width to stay inside the image', path: ['width'] }
  if (shape.y + shape.height > 1)
    return { message: 'expected the OcclusionShape height to stay inside the image', path: ['height'] }
  return undefined
}, { expected: 'an OcclusionShape contained by the image bounds' }))
const OcclusionBrushShapeSchema = Schema.Struct({
  ...OcclusionShapeBaseFields,
  kind: Schema.Literal('brush'),
  points: Schema.Array(UnitIntervalSchema),
  strokeWidth: PositiveUnitIntervalSchema,
}).check(Schema.makeFilter(shape => shape.points.length >= 4 && shape.points.length % 2 === 0
  ? undefined
  : { message: 'expected at least two complete OcclusionShape brush points', path: ['points'] }, {
  expected: 'an OcclusionShape brush path with complete point pairs',
}))
const OcclusionShapeSchema = Schema.Union([
  OcclusionBoundsShapeSchema,
  OcclusionBrushShapeSchema,
])
const ImageOcclusionSourceReferenceSchema = Schema.Union([
  Schema.Struct({
    imageId: Schema.NonEmptyString,
    kind: Schema.Literal('topic-image'),
    topicId: Schema.NonEmptyString,
  }),
  Schema.Struct({
    annotationId: Schema.NonEmptyString,
    kind: Schema.Literal('reader-region'),
    topicId: Schema.NonEmptyString,
  }),
])
const ImageOcclusionStateSchema = Schema.Struct({
  image: Schema.Struct({
    height: PositiveIntegerSchema,
    src: Schema.NonEmptyString,
    width: PositiveIntegerSchema,
  }),
  mode: Schema.Literals(['hide-all', 'hide-one']),
  shapes: Schema.Array(OcclusionShapeSchema),
  source: ImageOcclusionSourceReferenceSchema,
}).check(Schema.makeFilter((state) => {
  const shapeIds = new Set<string>()
  for (const [index, shape] of state.shapes.entries()) {
    if (shapeIds.has(shape.id))
      return { message: `duplicate OcclusionShape id ${JSON.stringify(shape.id)}`, path: ['shapes', index, 'id'] }
    shapeIds.add(shape.id)
  }
  return undefined
}, { expected: 'an ImageOcclusionTopic state with unique OcclusionShape IDs' }))

const LoroTopicEntryBaseFields = {
  blockTreeKey: Schema.NonEmptyString,
  editorMode: Schema.Literals([0, 1]),
  entryId: Schema.NonEmptyString,
  kind: Schema.Literal('topic'),
  title: Schema.String,
} as const

const LoroWhiteboardTopicEntryBaseFields = {
  entryId: Schema.NonEmptyString,
  kind: Schema.Literal('topic'),
  title: Schema.String,
  topicType: Schema.Literal('whiteboard'),
} as const

const TopicReaderSourceSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('text'),
    location: Schema.NonEmptyString,
    text: Schema.NonEmptyString,
  }),
  Schema.Struct({
    imageSrc: Schema.NonEmptyString,
    kind: Schema.Literal('region'),
    location: Schema.NonEmptyString,
  }),
])

const TopicReaderReferenceSchema = Schema.Union([
  Schema.Struct({
    annotationId: Schema.NonEmptyString,
    bookTopicId: Schema.NonEmptyString,
    source: TopicReaderSourceSchema,
  }),
  Schema.Struct({ source: TopicReaderSourceSchema }),
])

const CardTopicSourceSchema = Schema.Struct({
  kind: Schema.Literals(['basic', 'cloze', 'highlight', 'list', 'set']),
  sourceId: Schema.NonEmptyString,
  sourceTopicId: Schema.NonEmptyString,
  syncStatus: Schema.Literals(['detached', 'synced']),
})

export const LoroRegularTopicEntrySchema = Schema.Struct({
  ...LoroTopicEntryBaseFields,
  cardSource: Schema.optionalKey(CardTopicSourceSchema),
  readerReference: Schema.optionalKey(TopicReaderReferenceSchema),
  topicType: Schema.Literal('regular'),
})

export const LoroBookTopicEntrySchema = Schema.Struct({
  ...LoroTopicEntryBaseFields,
  annotationsKey: Schema.NonEmptyString,
  book: BookFileBindingSchema,
  readingStateKey: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  topicType: Schema.Literal('book'),
})

export const LoroImageOcclusionTopicEntrySchema = Schema.Struct({
  entryId: Schema.NonEmptyString,
  kind: Schema.Literal('topic'),
  title: Schema.String,
  topicType: Schema.Literal('image-occlusion'),
})

export const LoroWhiteboardTopicEntrySchema = Schema.Struct({
  ...LoroWhiteboardTopicEntryBaseFields,
})

export const LoroTopicEntrySchema = Schema.Union([
  LoroBookTopicEntrySchema,
  LoroImageOcclusionTopicEntrySchema,
  LoroRegularTopicEntrySchema,
  LoroWhiteboardTopicEntrySchema,
])

const LoroRegularTopicSchema = Schema.Struct({
  document: LoroTopicDocumentSchema,
  entry: LoroRegularTopicEntrySchema,
})

const LoroBookTopicSchema = Schema.Struct({
  annotations: Schema.Record(Schema.String, ReadingAnnotationSchema),
  document: LoroTopicDocumentSchema,
  entry: LoroBookTopicEntrySchema,
  readingState: Schema.Struct({
    position: Schema.NullOr(ReadingPositionSchema),
  }),
})

const LoroImageOcclusionTopicSchema = Schema.Struct({
  entry: LoroImageOcclusionTopicEntrySchema,
  state: ImageOcclusionStateSchema,
})

const LoroWhiteboardTopicSchema = Schema.Struct({
  embeddedEditors: Schema.Record(Schema.String, Schema.Struct({
    document: LoroTopicDocumentSchema,
    editorId: Schema.NonEmptyString,
    editorMode: Schema.Literals([0, 1]),
  })),
  entry: LoroWhiteboardTopicEntrySchema,
  scene: Schema.Record(Schema.String, Schema.Unknown),
}).check(Schema.makeFilter((topic) => {
  for (const [editorId, editor] of Object.entries(topic.embeddedEditors)) {
    if (editor.editorId !== editorId) {
      return {
        message: `expected Embedded Editor id ${JSON.stringify(editorId)}`,
        path: ['embeddedEditors', editorId, 'editorId'],
      }
    }
  }
  return undefined
}, {
  expected: 'a WhiteboardTopic with Embedded Editors keyed by their editor IDs',
}))

/** A complete Topic projected from its Loro entry map and referenced block tree. */
export const LoroTopicSchema = Schema.Union([
  LoroBookTopicSchema,
  LoroImageOcclusionTopicSchema,
  LoroRegularTopicSchema,
  LoroWhiteboardTopicSchema,
]).check(Schema.makeFilter((topic) => {
  const id = topic.entry.entryId
  if (topic.entry.topicType === 'image-occlusion') {
    if (!('state' in topic)) {
      return {
        message: 'expected an ImageOcclusionTopic state',
        path: ['state'],
      }
    }
    return topic.state.source.topicId === id
      ? {
          message: 'expected an ImageOcclusionTopic to reference a different source Topic',
          path: ['state', 'source', 'topicId'],
        }
      : undefined
  }
  if (topic.entry.topicType === 'regular') {
    return topic.entry.blockTreeKey === `topic:${id}:blocks`
      ? undefined
      : {
          message: `expected the Topic block tree key ${JSON.stringify(`topic:${id}:blocks`)}`,
          path: ['entry', 'blockTreeKey'],
        }
  }
  if (topic.entry.topicType === 'whiteboard') {
    return undefined
  }
  const expectedBlockTreeKey = `topic:${id}:blocks`
  if (topic.entry.blockTreeKey !== expectedBlockTreeKey) {
    return {
      message: `expected the Topic block tree key ${JSON.stringify(expectedBlockTreeKey)}`,
      path: ['entry', 'blockTreeKey'],
    }
  }
  if (!('annotations' in topic) || !('readingState' in topic)) {
    return {
      message: 'expected BookTopic annotations and reading state',
      path: [],
    }
  }
  const expectedReadingStateKey = `topic:${id}:reading-state`
  if (topic.entry.readingStateKey !== expectedReadingStateKey) {
    return {
      message: `expected the BookTopic reading state key ${JSON.stringify(expectedReadingStateKey)}`,
      path: ['entry', 'readingStateKey'],
    }
  }
  const expectedAnnotationsKey = `topic:${id}:annotations`
  if (topic.entry.annotationsKey !== expectedAnnotationsKey) {
    return {
      message: `expected the BookTopic annotations key ${JSON.stringify(expectedAnnotationsKey)}`,
      path: ['entry', 'annotationsKey'],
    }
  }
  const format = topic.entry.book.file.format
  if (topic.readingState.position !== null && topic.readingState.position.format !== format) {
    return {
      message: `expected a ${format} BookTopic reading position`,
      path: ['readingState', 'position', 'format'],
    }
  }
  for (const [annotationId, annotation] of Object.entries(topic.annotations)) {
    if (annotation.id !== annotationId) {
      return {
        message: `expected annotation id ${JSON.stringify(annotationId)}`,
        path: ['annotations', annotationId, 'id'],
      }
    }
    if (annotation.anchors.some(anchor => anchor.format !== format)) {
      return {
        message: `expected ${format} BookTopic annotation anchors`,
        path: ['annotations', annotationId, 'anchors'],
      }
    }
  }
  return undefined
}, {
  expected: 'a Topic whose entry and BookTopic state reference their own Loro containers',
}))

export type LoroTopic = typeof LoroTopicSchema.Type
export type LoroBookTopic = typeof LoroBookTopicSchema.Type
export type LoroImageOcclusionTopic = typeof LoroImageOcclusionTopicSchema.Type
export type LoroRegularTopic = typeof LoroRegularTopicSchema.Type
export type LoroWhiteboardTopic = typeof LoroWhiteboardTopicSchema.Type
export type LoroTopicValidation = Effect.Effect<LoroTopic, Schema.SchemaError>

/** Validates unknown Topic JSON and retains all schema issues in Effect's error channel. */
export function validateLoroTopic(input: unknown): LoroTopicValidation {
  return Schema.decodeUnknownEffect(LoroTopicSchema)(input, strictTopicParseOptions)
}

/** Returns whether an unknown value has the complete Loro Topic structure. */
export function isLoroTopic(input: unknown): input is LoroTopic {
  return Exit.isSuccess(Schema.decodeUnknownExit(LoroTopicSchema)(input, strictTopicParseOptions))
}
