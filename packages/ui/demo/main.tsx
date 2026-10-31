import { CssBaseline, ThemeProvider } from '@mui/material'
import { createRoot } from 'react-dom/client'
import { theme } from '../src'
import '../src/fonts.css'
import { App } from './App'

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>,
  )
}
