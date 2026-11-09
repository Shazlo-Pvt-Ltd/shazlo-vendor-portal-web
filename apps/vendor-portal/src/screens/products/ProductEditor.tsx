import { Button, useMediaQuery } from '@mui/material'
import type { Theme } from '@mui/material/styles'
import { Banner, EmptyState, PageHeader } from '@shazlo/ui'
import { useState } from 'react'
import { Link as RouterLink, useParams } from 'react-router'
import { ApiError } from '../../api/client'
import { useProduct } from '../../api/queries'
import { useCrumb } from '../../app/crumbs'
import { paths } from '../../app/paths'
import { productEditorCopy as copy } from '../../copy/productEditor'
import { Editor } from './editor/Editor'
import { EditorSkeleton } from './editor/EditorSkeleton'

// V-07 Product editor, for /products/new and /products/:id.
export default function ProductEditor() {
  const { id } = useParams()
  const twoColumn = useMediaQuery((t: Theme) => t.breakpoints.up('lg'))

  // A new product moves from /products/new to /products/:id once its first save creates it. That
  // editor keeps its key ("adopted"), so the seller keeps typing in the same form; opening
  // /products/new again starts a fresh one.
  const [prevId, setPrevId] = useState(id)
  const [session, setSession] = useState<{ n: number; adopted: string | null }>({ n: 0, adopted: null })
  if (id !== prevId) {
    setPrevId(id)
    if (id === undefined) setSession((s) => ({ n: s.n + 1, adopted: null }))
  }

  const query = useProduct(id)
  const product = query.data
  // On /products/new the route already names the crumb "New product".
  useCrumb(id && product ? product.title || copy.untitled : null)
  const refetch = () => void query.refetch()

  if (id === undefined || id === session.adopted) {
    return <Editor key={`new-${session.n}`} product={(id && product) || null} onCreated={(created) => setSession((s) => ({ ...s, adopted: created }))} onStale={refetch} />
  }
  if (query.isPending) return <EditorSkeleton twoColumn={twoColumn} />
  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 404) {
      return (
        <EmptyState
          illustration="box"
          title={copy.notFound.title}
          body={copy.notFound.body}
          action={
            <Button variant="contained" component={RouterLink} to={paths.products}>
              {copy.notFound.back}
            </Button>
          }
        />
      )
    }
    return (
      <>
        <PageHeader title={copy.productTitle} />
        <Banner tone="error" title={copy.loadFailed} action={<Button onClick={refetch}>{copy.banners.retry}</Button>}>
          {query.error.message}
        </Banner>
      </>
    )
  }
  return <Editor key={id} product={product!} onStale={refetch} />
}
