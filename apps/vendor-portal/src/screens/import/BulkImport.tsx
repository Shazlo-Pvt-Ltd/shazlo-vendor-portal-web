// V-08 · Bulk import · validation report.
// Four steps: download template → upload file → fix errors → create drafts. The last upload is kept
// by the API, so a seller can leave and come back to the report (V-08 note 1).
import { useRef, useState, type DragEvent } from 'react'
import {
  Banner, Button, Card, Content, EmptyState, Icon, kit, Mono, PageHeader, Skeleton, StatCard, Table, Text, textStyle, useToast,
} from '@shazlo/ui/components'
import type { CatalogImportReport } from '../../api/mock'
import { useCreateDraftsFromImport, useImportCatalog, useLastImport } from '../../api/hooks'
import { TopBar } from '../../app/topbar'
import { count } from '../../lib/format'
import { csvCell, downloadFile, savedAgo, useIsMobile } from '../products/shared'

/* ---------- files ---------- */

const TEMPLATE_COLUMNS = [
  'Product ID', 'Product name', 'Category', 'Subcategory', 'Description', 'Price', 'MRP', 'Stock qty', 'Size', 'Color', 'Material', 'Gender',
  'Image 1', 'Image 2', 'Image 3', 'Returnable',
]
const TEMPLATE_EXAMPLE = [
  'KS-AJR-014', 'Ajrakh Block-Print Kurta', 'Kurtas', 'Straight kurtas', 'Hand block-printed Ajrakh cotton. Hand wash cold.', '2499', '2999', '4', 'XS',
  'Indigo', 'Cotton (mul)', 'Women', 'https://example.com/ajrakh-front.jpg', 'https://example.com/ajrakh-back.jpg', 'https://example.com/ajrakh-fabric.jpg', 'Yes',
]

function downloadTemplate() {
  downloadFile('shazlo_catalog_template.csv', [TEMPLATE_COLUMNS, TEMPLATE_EXAMPLE].map(r => r.map(csvCell).join(',')).join('\r\n'))
}

function downloadErrors(report: CatalogImportReport) {
  const rows = [['Row', 'Product name', 'Column', 'error'], ...report.errors.map(e => [String(e.row), e.product, e.column, e.message])]
  const base = report.fileName.replace(/\.[^.]+$/, '')
  downloadFile(`${base}_errors.csv`, rows.map(r => r.map(csvCell).join(',')).join('\r\n'))
}

const ACCEPT = '.xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv'

/* ---------- stepper ---------- */

type StepState = 'done' | 'current' | 'todo'
const STEPS = ['Download template', 'Upload file', 'Fix errors', 'Create drafts']

function Stepper({ current, mobile }: { current: number; mobile: boolean }) {
  const state = (i: number): StepState => (i < current ? 'done' : i === current ? 'current' : 'todo')
  if (mobile) {
    return <Text v="label" as="p" aria-live="polite">Step {Math.min(current, 3) + 1} of 4 · <span style={{ ...textStyle.small, color: kit.muted }}>{STEPS[Math.min(current, 3)]}</span></Text>
  }
  return (
    <ol aria-label="Import steps" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
      {STEPS.map((label, i) => {
        const s = state(i)
        return (
          <li key={label} aria-current={s === 'current' ? 'step' : undefined} style={{ display: 'contents' }}>
            {i > 0 && <span aria-hidden style={{ flex: 1, height: 1, minWidth: 24, background: i <= current ? kit.ink : kit.field }} />}
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <span
                aria-hidden
                style={{
                  width: 24, height: 24, borderRadius: 999, boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: s === 'done' ? kit.ink : kit.surface,
                  border: s === 'done' ? 0 : s === 'current' ? `1.5px solid ${kit.ink}` : `1px solid ${kit.field}`,
                  ...textStyle.caption, color: s === 'todo' ? kit.subtle : kit.ink,
                }}
              >
                {s === 'done' ? <Icon name="check" size={14} color={kit.offWhite} /> : i + 1}
              </span>
              <span style={{ ...(s === 'current' ? textStyle.label : textStyle.small), color: s === 'todo' ? kit.subtle : kit.ink, whiteSpace: 'nowrap' }}>
                {label}<span className="shz-visually-hidden">{s === 'done' ? ' (done)' : s === 'current' ? ' (current step)' : ''}</span>
              </span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/* ---------- side column ---------- */

const guide: Array<[string, string?]> = [
  ['Product ID', 'Required'],
  ['Product name', 'Required'],
  ['Category / Subcategory', 'Required'],
  ['Description'],
  ['Price, MRP', 'Required'],
  ['Stock qty, Size', 'Required'],
  ['Color, Material, Gender'],
  ['Image 1–3 (links)', '1 required'],
  ['Returnable', 'Default: store policy'],
]

function SideColumn() {
  return (
    <aside aria-label="Template help" style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
      <Card gap={10}>
        <Text v="title" as="h2">Template columns</Text>
        <Text v="caption" tone="subtle" as="p">Same columns as the old seller sheet, so existing files still work.</Text>
        <dl style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {guide.map(([name, rule]) => (
            <div key={name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <dt style={{ ...textStyle.small, color: kit.ink }}>{name}</dt>
              <dd style={{ ...textStyle.caption, color: kit.subtle, margin: 0, textAlign: 'right' }}>{rule ?? <span className="shz-visually-hidden">Optional</span>}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <div style={{ background: kit.chip, borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Text v="label" as="h2">Sizes</Text>
        <Text v="small" tone="muted" as="p">One row per size. Rows with the same Product ID become one product with several sizes.</Text>
      </div>
    </aside>
  )
}

/* ---------- main column pieces ---------- */

function FileCard({ report, onReplace, busy }: { report: CatalogImportReport; onReplace: () => void; busy: boolean }) {
  return (
    <Card pad="13px 15px" gap={12} style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Icon name="sheet" size={24} color={kit.ink} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
        <Text v="label" truncate>{report.fileName}</Text>
        <Text v="caption" tone="subtle">{count(report.totalRows)} rows · uploaded {savedAgo(report.uploadedAt)}</Text>
      </span>
      <Button size="sm" variant="ghost" icon="upload" onClick={onReplace} disabled={busy}>{busy ? 'Checking…' : 'Replace file'}</Button>
    </Card>
  )
}

function ErrorReport({ report }: { report: CatalogImportReport }) {
  const n = report.errors.length
  return (
    <Card gap={14} aria-labelledby="bi-errors-title">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <Text v="title" as="h2" id="bi-errors-title">{n} row{n === 1 ? '' : 's'} need{n === 1 ? 's' : ''} fixing</Text>
          <Text v="small" tone="muted" as="p">Fix {n === 1 ? 'it' : 'these'} in your sheet and upload it again. The other {count(report.validRows)} rows are not affected.</Text>
        </span>
        <Button size="sm" variant="secondary" icon="download" onClick={() => downloadErrors(report)}>Download error report</Button>
      </div>
      <div style={{ border: `1px solid ${kit.line}`, borderRadius: 8, overflow: 'auto' }}>
        <Table aria-label="Rows that need fixing" style={{ tableLayout: 'fixed', minWidth: 600 }}>
          <colgroup><col style={{ width: 72 }} /><col style={{ width: 206 }} /><col style={{ width: 126 }} /><col /></colgroup>
          <thead><tr><th scope="col">Row</th><th scope="col">Product</th><th scope="col">Column</th><th scope="col">What to fix</th></tr></thead>
          <tbody>
            {report.errors.map(e => (
              <tr key={`${e.row}-${e.column}`}>
                <td style={{ verticalAlign: 'top' }}><Mono tone="ink">{e.row}</Mono></td>
                <td style={{ verticalAlign: 'top' }}><Text v="label">{e.product || '—'}</Text>{!e.product && <span className="shz-visually-hidden">No product name</span>}</td>
                <td style={{ verticalAlign: 'top' }}><Text v="small" tone="muted">{e.column}</Text></td>
                <td style={{ verticalAlign: 'top' }}>
                  <span style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                    <Icon name="alert" size={14} color={kit.ink} style={{ marginTop: 1 }} />
                    <Text v="small">{e.message}</Text>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </Card>
  )
}

function Dropzone({ onFile, busy, error }: { onFile: () => void; busy: boolean; error: string | null }) {
  return (
    <Card gap={16}>
      <div
        style={{
          border: `1.5px dashed ${error ? kit.error : kit.field}`, borderRadius: 8, padding: '40px 24px', display: 'flex', flexDirection: 'column',
          alignItems: 'center', gap: 10, textAlign: 'center', background: kit.surface,
        }}
      >
        <span style={{ width: 44, height: 44, borderRadius: 10, background: kit.chip, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: kit.brown }}>
          <Icon name="sheet" size={22} />
        </span>
        {busy ? (
          <>
            <Text v="title" as="h2" aria-live="polite">Checking every row…</Text>
            <Skeleton width={220} />
          </>
        ) : (
          <>
            <Text v="title" as="h2">Drop your filled-in template here</Text>
            <Text v="small" tone="muted" as="p">.xlsx or .csv, up to 10 MB. We check every row before anything is created.</Text>
            <Button variant="primary" icon="upload" onClick={onFile} style={{ marginTop: 6 }}>Choose file</Button>
          </>
        )}
      </div>
    </Card>
  )
}

/* ---------- screen ---------- */

export function BulkImport() {
  const mobile = useIsMobile()
  const { show } = useToast()
  const last = useLastImport()
  const upload = useImportCatalog()
  const create = useCreateDraftsFromImport()
  const input = useRef<HTMLInputElement>(null)
  const [downloaded, setDownloaded] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [created, setCreated] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)

  const report: CatalogImportReport | null = last.data ?? null
  const send = async (file: File | undefined) => {
    if (!file) return
    setUploadError(null)
    setCreated(null)
    try {
      await upload.mutateAsync(file)
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'That file didn’t upload. Check your connection and try again.')
    }
  }
  const pick = () => input.current?.click()
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDragging(false); void send(e.dataTransfer.files[0]) }
  const createDrafts = async () => {
    try {
      const n = await create.mutateAsync()
      setCreated(n)
      show(`${n} drafts created. They’re in the Drafts tab.`)
    } catch (e) {
      show(e instanceof Error ? e.message : 'Drafts weren’t created. Try again.', 'error')
    }
  }

  const step = created !== null ? 4 : report ? (report.errors.length ? 2 : 3) : downloaded ? 1 : 0
  const ready = report?.validRows ?? 0

  const main = (() => {
    if (last.isPending) {
      return <Card gap={12} aria-busy="true"><Skeleton width={200} height={18} /><Skeleton height={120} /></Card>
    }
    if (created !== null) {
      return (
        <Card pad={0}>
          <EmptyState
            icon="check"
            title={`${created} drafts created`}
            action={
              <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                <Button variant="secondary" icon="upload" onClick={pick}>Import another file</Button>
                <Button variant="primary" iconEnd="arrowRight" to="/products?tab=drafts">Open drafts</Button>
              </span>
            }
          >
            They’re in the Drafts tab. Check each one, add any missing photos, then submit them for review. Nothing goes live until it is approved.
          </EmptyState>
        </Card>
      )
    }
    if (!report) return <Dropzone onFile={pick} busy={upload.isPending} error={uploadError} />
    const imageNote = report.imageLinksFailed > 0
    return (
      <>
        <FileCard report={report} onReplace={pick} busy={upload.isPending} />
        <div style={{ display: 'grid', gridTemplateColumns: mobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))', gap: 16, alignItems: 'start' }}>
          <StatCard label="Rows in file" value={count(report.totalRows)} />
          <StatCard label="Ready to import" value={count(report.validRows)} hint="Will be created as drafts" />
          <StatCard label="Need fixing" value={count(report.errors.length)} hint={report.errors.length ? 'Listed below' : 'Nothing to fix'} />
          <StatCard label="Image links failed" value={count(report.imageLinksFailed)} hint={imageNote ? 'Product still created' : 'All photos fetched'} />
        </div>
        {report.errors.length > 0 ? (
          <ErrorReport report={report} />
        ) : (
          <Banner icon="check" title={`All ${count(report.totalRows)} rows are ready`}>Nothing to fix. Create the drafts below, then check them in Products.</Banner>
        )}
        <Card pad="13px 15px" gap={12} style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
          <Icon name="info" size={16} color={kit.ink} />
          <Text v="small" tone="muted" as="p" style={{ flex: '1 1 260px', minWidth: 0 }}>
            {count(ready)} products will be created as drafts. You can check them and submit for review from Products.
          </Text>
          {report.errors.length > 0 && <Button variant="secondary" icon="upload" onClick={pick} disabled={upload.isPending}>Upload fixed file</Button>}
          <Button
            variant="primary"
            onClick={() => void createDrafts()}
            disabled={create.isPending || ready === 0}
            title={ready === 0 ? 'No rows are ready yet. Fix the rows above and upload the file again.' : undefined}
          >
            {create.isPending ? 'Creating drafts…' : `Create ${count(ready)} draft${ready === 1 ? '' : 's'}`}
          </Button>
        </Card>
      </>
    )
  })()

  return (
    <Content
      style={{ gap: 20, outline: dragging ? `2px dashed ${kit.brown}` : undefined, outlineOffset: -12 }}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={e => { if (e.currentTarget === e.target) setDragging(false) }}
      onDrop={onDrop}
    >
      <TopBar crumbs={[{ label: 'Products', to: '/products' }, { label: 'Bulk import' }]} />
      <PageHeader
        title="Bulk import"
        subtitle="Add many products at once from a spreadsheet. Imported products are created as drafts; nothing goes live until it is reviewed."
        actions={<Button variant="secondary" icon="download" onClick={() => { downloadTemplate(); setDownloaded(true) }}>Download template</Button>}
      />
      {mobile && <Banner icon="monitor" title="Easier on a laptop">Spreadsheets are hard to fix on a phone. You can still upload here and read the report.</Banner>}
      <Stepper current={step} mobile={mobile} />
      {uploadError && <Banner role="alert" icon="alert" accent={kit.error} title="We couldn’t read that file">{uploadError}</Banner>}
      <div className="shz-import-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 24, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>{main}</div>
        <SideColumn />
      </div>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        hidden
        aria-label="Upload catalogue file"
        data-testid="import-file"
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; void send(f) }}
      />
      <style>{'@media (max-width: 1180px) { .shz-import-grid { grid-template-columns: minmax(0, 1fr) !important; } }'}</style>
    </Content>
  )
}
