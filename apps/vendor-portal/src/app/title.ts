import { useEffect } from 'react'
import { TITLE_SUFFIX } from './portalRoutes'

/** Sets the window title, "Products · Shazlo Seller": screen readers announce it on navigation. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · ${TITLE_SUFFIX}`
  }, [title])
}
