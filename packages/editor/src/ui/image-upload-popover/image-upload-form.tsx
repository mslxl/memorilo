'use client'

import type { Uploader } from 'prosekit/extensions/file'
import type { ImageExtension } from 'prosekit/extensions/image'
import { Button, TextField } from '@memorilo/ui'
import * as stylex from '@stylexjs/stylex'
import { useEditor } from 'prosekit/react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { imageUploadFormStyles } from './image-upload-form.stylex'

export default function ImageUploadForm(props: {
  uploader: Uploader<string>
  onComplete: () => void
}) {
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const ariaId = useId()
  const editor = useEditor<ImageExtension>()
  const { t } = useTranslation('editor')

  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = (event) => {
    const nextFile = event.target.files?.[0]

    if (nextFile) {
      setFile(nextFile)
      setUrl('')
      return
    }

    setFile(null)
  }

  const handleUrlChange: React.ChangeEventHandler<HTMLInputElement> = (event) => {
    const nextUrl = event.target.value
    setUrl(nextUrl)
    if (nextUrl) {
      setFile(null)
    }
  }

  const handleSubmit = () => {
    if (url) {
      editor.commands.insertImage({ src: url })
    }
    else if (file) {
      editor.commands.uploadImage({ file, uploader: props.uploader })
    }
    else {
      throw new Error('An image URL or file is required')
    }

    props.onComplete()
    editor.focus()
  }

  return (
    <div {...stylex.props(imageUploadFormStyles.form)} data-image-form="">
      {file
        ? null
        : (
            <>
              <label {...stylex.props(imageUploadFormStyles.label)} htmlFor={`id-link-${ariaId}`}>{t('ui.embedLink')}</label>
              <TextField
                data-image-field="url"
                id={`id-link-${ariaId}`}
                placeholder={t('ui.pasteImageLinkPlaceholder')}
                type="url"
                value={url}
                onChange={handleUrlChange}
              />
            </>
          )}

      {url
        ? null
        : (
            <>
              <label {...stylex.props(imageUploadFormStyles.label)} htmlFor={`id-upload-${ariaId}`}>{t('ui.upload')}</label>
              <TextField
                data-image-field="file"
                id={`id-upload-${ariaId}`}
                xstyle={imageUploadFormStyles.fileInput}
                accept="image/*"
                type="file"
                onChange={handleFileChange}
              />
            </>
          )}

      {url
        ? (
            <Button data-image-action="insert" variant="primary" type="button" onClick={handleSubmit}>
              {t('ui.insertImageButton')}
            </Button>
          )
        : null}
      {file
        ? (
            <Button data-image-action="upload" variant="primary" type="button" onClick={handleSubmit}>
              {t('ui.uploadImage')}
            </Button>
          )
        : null}
    </div>
  )
}
