import * as stylex from '@stylexjs/stylex'

export const appShellStyles = stylex.create({
  shell: {
    position: 'relative',
    display: 'flex',
    width: '100%',
    height: '100%',
    minHeight: 0,
    overflow: 'hidden',
    flexDirection: 'column',
    backgroundColor: 'var(--ui-canvas, rgb(250, 250, 249))',
  },
  body: {
    position: 'relative',
    display: 'flex',
    width: '100%',
    height: '100%',
    minWidth: 0,
    minHeight: 0,
    overflow: 'hidden',
  },
  workspace: {
    position: 'relative',
    flex: 1,
    minHeight: 0,
    minWidth: 0,
  },
  routeViewport: {
    position: 'relative',
    display: 'flex',
    minWidth: 0,
    minHeight: 0,
    flex: 1,
    overflow: 'hidden',
  },
})
