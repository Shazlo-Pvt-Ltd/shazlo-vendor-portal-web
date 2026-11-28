import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { readModuleConfig } from '../config'
import { ReferenceModule } from './ReferenceModule'
import './styles.css'

const result = readModuleConfig(import.meta.env, { development: import.meta.env.DEV })
const container = document.getElementById('root')
if (container === null) throw new Error('The page has no #root element.')

createRoot(container).render(
  <StrictMode>
    {result.ok ? (
      <ReferenceModule config={result.config} />
    ) : (
      <main>
        <h1>The reference module is misconfigured</h1>
        <ul>
          {result.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      </main>
    )}
  </StrictMode>,
)
