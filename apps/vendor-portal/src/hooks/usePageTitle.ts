import { useEffect } from 'react'

/** Every screen sets its page title (screen readers announce it on navigation). */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · Shazlo Vendor Portal`
  }, [title])
}
