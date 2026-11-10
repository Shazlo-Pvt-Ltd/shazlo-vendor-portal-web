import { Box, Button, Menu, MenuItem, Skeleton, Stack, Tab, Tabs } from '@mui/material'
import { Banner, brand, EmptyState, neutral, PageHeader } from '@shazlo/ui'
import { Download } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router'
import { useVendors } from '../../api/queries'
import type { components } from '../../api/schema'
import { modulePaths } from '../../app/routes'
import { vendorActionsCopy, vendorsCopy as copy, vendorTabs } from '../../copy/vendors'
import { formatCount } from '../../lib/format'
import { phoneFullWidth, scrollingTabs, useCompact } from '../../lib/responsive'
import { useModuleTitle, useRuntime } from '../../runtime/runtime'
import { VendorActionDialog, type DialogKind } from './dialogs'
import { downloadCsv, vendorsCsv } from './list/csv'
import { VendorFilters } from './list/Filters'
import { toFilters, useVendorParams, type VendorParams } from './list/useVendorParams'
import { VendorCards } from './list/VendorCards'
import { VendorTable } from './list/VendorTable'

type S = components['schemas']
type Vendor = S['VendorSummary']
type Counts = S['VendorPage']['counts']

const icon = { size: 18, strokeWidth: 1.5, 'aria-hidden': true } as const

function StatusTabs({ value, counts, onChange }: { value: string; counts: Counts | undefined; onChange: (key: string) => void }) {
  return (
    <Tabs
      value={value}
      onChange={(_, key: string) => onChange(key)}
      {...scrollingTabs}
      aria-label={copy.tabsLabel}
      textColor="inherit"
      sx={{ borderBottom: `1px solid ${neutral.line}`, minHeight: 44, '& .MuiTabs-indicator': { bgcolor: brand.brown } }}
    >
      {vendorTabs.map((tab) => (
        <Tab
          key={tab.key}
          value={tab.key}
          sx={{ minHeight: 44, px: 2, color: 'text.secondary', '&.Mui-selected': { color: neutral.ink } }}
          label={
            <span>
              {tab.label}
              {counts && (
                <>
                  {' '}
                  <Box component="span" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums', ml: 0.25 }}>
                    {formatCount(counts[tab.key])}
                  </Box>
                </>
              )}
            </span>
          }
        />
      ))}
    </Tabs>
  )
}

// Filters that match nothing, or a tab with nobody in it.
function ListEmpty({ params, onClearFilters, onShowAll }: { params: VendorParams; onClearFilters: () => void; onShowAll: () => void }) {
  if (params.q || params.city) {
    return (
      <EmptyState
        illustration="box"
        title={copy.noResults.title}
        body={copy.noResults.body}
        action={
          <Button variant="outlined" onClick={onClearFilters}>
            {copy.noResults.clear}
          </Button>
        }
      />
    )
  }
  const tab = copy.emptyTab[params.status ?? 'all']
  return (
    <EmptyState
      illustration="box"
      title={tab.title}
      body={tab.body}
      action={
        params.status ? (
          <Button variant="outlined" onClick={onShowAll}>
            {copy.emptyTab.showAll}
          </Button>
        ) : undefined
      }
    />
  )
}

// Only the actions that fit the vendor's state are offered; nothing is shown disabled.
function RowMenu({ target, onClose, onOpen, onAction }: { target: { anchor: HTMLElement; vendor: Vendor } | null; onClose: () => void; onOpen: (vendor: Vendor) => void; onAction: (kind: DialogKind, vendor: Vendor) => void }) {
  const vendor = target?.vendor
  return (
    <Menu anchorEl={target?.anchor ?? null} open={target !== null} onClose={onClose} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
      {vendor && [
        <MenuItem key="open" onClick={() => onOpen(vendor)}>
          {copy.menu.open}
        </MenuItem>,
        vendor.status === 'approved' && (
          <MenuItem key="suspend" onClick={() => onAction('suspend', vendor)}>
            {copy.menu.suspend}
          </MenuItem>
        ),
        vendor.status === 'suspended' && (
          <MenuItem key="reactivate" onClick={() => onAction('reactivate', vendor)}>
            {copy.menu.reactivate}
          </MenuItem>
        ),
      ]}
    </Menu>
  )
}

// A-08: every brand on Shazlo and every application, with status tabs, search and filters.
export default function VendorList() {
  useModuleTitle(copy.title)
  const navigate = useNavigate()
  const compact = useCompact()
  const { toast } = useRuntime()
  const [params, update] = useVendorParams()
  const query = useVendors(toFilters(params))
  const { data } = query
  const [menu, setMenu] = useState<{ anchor: HTMLElement; vendor: Vendor } | null>(null)
  // Kept after closing (open: false) so the dialog keeps its words while it fades out.
  const [dialog, setDialog] = useState<{ vendor: Vendor; kind: DialogKind; open: boolean } | null>(null)
  const closeDialog = () => setDialog((d) => d && { ...d, open: false })

  const onSearch = useCallback((q: string) => update({ q }, { replace: true }), [update])
  const onMenu = useCallback((anchor: HTMLElement, vendor: Vendor) => setMenu({ anchor, vendor }), [])
  const openVendor = (vendor: Vendor) => navigate(modulePaths.vendor(vendor.id))
  const clearFilters = () => update({ q: undefined, city: undefined })

  function exportCsv() {
    if (!data || data.items.length === 0) {
      toast('info', copy.nothingToExport)
      return
    }
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
    downloadCsv(copy.csv.filename(day), vendorsCsv(data.items))
    toast('success', copy.exported(data.items.length))
  }

  const onDone = (kind: DialogKind, vendor: { brand_name: string }) => {
    closeDialog()
    toast('success', kind === 'suspend' ? vendorActionsCopy.suspend.done(vendor.brand_name) : vendorActionsCopy.reactivate.done(vendor.brand_name))
  }
  const onFailed = (_kind: DialogKind, error: Error) => {
    closeDialog()
    toast('error', error.message || vendorActionsCopy.failed)
  }

  // A failed refetch keeps the last list on screen under the banner (partial state).
  const errorBanner = query.isError ? (
    <Banner
      tone="error"
      title={copy.error.title}
      action={
        <Button variant="outlined" size="small" onClick={() => void query.refetch()} disabled={query.isFetching}>
          {copy.error.retry}
        </Button>
      }
    >
      {query.error.message}
    </Banner>
  ) : null

  let body
  if (query.isError && !data) {
    body = null
  } else if (data && data.items.length === 0) {
    body = <ListEmpty params={params} onClearFilters={clearFilters} onShowAll={() => update({ status: undefined })} />
  } else {
    body = compact ? <VendorCards items={data?.items} fetching={query.isFetching} onMenu={onMenu} /> : <VendorTable items={data?.items} fetching={query.isFetching} onOpen={openVendor} onMenu={onMenu} />
  }

  const waiting = data ? data.counts.applied + data.counts.under_review : 0
  return (
    <>
      <PageHeader
        title={copy.title}
        subtitle={data ? copy.subtitle(data.counts.all, waiting) : query.isPending ? <Skeleton variant="text" width={240} component="span" sx={{ display: 'inline-block' }} /> : undefined}
        actions={
          <Button variant="outlined" onClick={exportCsv} disabled={!data} startIcon={<Download {...icon} />} sx={phoneFullWidth}>
            {copy.exportCsv}
          </Button>
        }
      />
      <Stack spacing={2}>
        {errorBanner}
        <StatusTabs value={params.status ?? 'all'} counts={data?.counts} onChange={(key) => update({ status: key === 'all' ? undefined : key })} />
        <VendorFilters params={params} update={update} cities={data?.cities ?? []} onSearch={onSearch} />
        {body}
      </Stack>

      <RowMenu
        target={menu}
        onClose={() => setMenu(null)}
        onOpen={(vendor) => {
          setMenu(null)
          openVendor(vendor)
        }}
        onAction={(kind, vendor) => {
          setMenu(null)
          setDialog({ vendor, kind, open: true })
        }}
      />
      {dialog && <VendorActionDialog key={dialog.vendor.id + dialog.kind} vendor={dialog.vendor} kind={dialog.kind} open={dialog.open} onClose={closeDialog} onDone={onDone} onFailed={onFailed} />}
    </>
  )
}
