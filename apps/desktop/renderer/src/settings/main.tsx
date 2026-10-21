import * as stylex from '@stylexjs/stylex'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import {
  bootstrapRenderer,
} from '../app/bootstrap-renderer'
import {
  DesktopConfigurationEnvironment,
} from '../app/configuration/configuration-environment'
import { errorMessage } from '../shared/error-message'
import { Settings } from './settings'
import { settingsShellStyles as settingsStyles } from './settings-shell.stylex'
import '../styles/renderer-global.stylex'
import '../styles/renderer-stylex.css'

const rootElement = document.querySelector('#root')

if (!rootElement)
  throw new Error('Missing settings renderer root element')

const root = createRoot(rootElement)

void bootstrapRenderer(
  (store) => {
    root.render(
      <StrictMode>
        <DesktopConfigurationEnvironment store={store}>
          <Settings store={store} />
        </DesktopConfigurationEnvironment>
      </StrictMode>,
    )
    return () => root.unmount()
  },
  error => root.render(
    <main {...stylex.props(settingsStyles.status)} role="alert">
      {errorMessage(error)}
    </main>,
  ),
)
