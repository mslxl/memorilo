import type { ReaderSource } from '@memorilo/editor/reader'
import type { ChangeEvent } from 'react'
import { WindowReader } from '@memorilo/editor/reader'
import { readingFileAccept } from '@memorilo/reading-model'
import * as stylex from '@stylexjs/stylex'
import { BookOpen, FolderOpen } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'

import { useDesktopConfiguration } from '../../shared/configuration'
import { usePageTitlebar } from '../../shared/page-titlebar'
import { readerPageStyles } from './reader-page.stylex'

export function ReaderLayout() {
  const configuration = useDesktopConfiguration()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const titlebar = useMemo(() => file
    ? { navigation: 'hidden' as const }
    : { navigation: 'default' as const, title: 'Reader', titleVisibility: 'always' as const }, [file])
  usePageTitlebar(titlebar)

  const source = useMemo<ReaderSource | null>(() => file
    ? { data: file, name: file.name }
    : null, [file])
  const selectFile = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files?.[0] ?? null)
    event.target.value = ''
  }, [])

  return (
    <main {...stylex.props(readerPageStyles.page, file && readerPageStyles.pageOpen)}>
      <input
        ref={inputRef}
        {...stylex.props(readerPageStyles.fileInput)}
        accept={readingFileAccept}
        aria-label="Open PDF or EPUB, TXT, CBZ, or CBR"
        data-reader-file-input=""
        type="file"
        onChange={selectFile}
      />
      {source
        ? (
            <WindowReader
              annotationEditingEnabled={false}
              arrowKeyPageTurning={configuration.readerArrowKeyPageTurning}
              initialPresentationMode={configuration.readerEpubPresentationMode}
              pageMode={configuration.readerPageMode}
              source={source}
            />
          )
        : (
            <section {...stylex.props(readerPageStyles.empty)}>
              <BookOpen {...stylex.props(readerPageStyles.emptyIcon)} aria-hidden="true" strokeWidth={1.5} />
              <h1 {...stylex.props(readerPageStyles.emptyTitle)}>Open a document</h1>
              <p {...stylex.props(readerPageStyles.emptyDetail)}>
                Choose a PDF, EPUB, TXT, CBZ, or CBR from this Mac.
              </p>
              <button
                {...stylex.props(readerPageStyles.openButton)}
                type="button"
                onClick={() => inputRef.current?.click()}
              >
                <FolderOpen aria-hidden="true" size={15} strokeWidth={1.9} />
                Open File
              </button>
            </section>
          )}
    </main>
  )
}
