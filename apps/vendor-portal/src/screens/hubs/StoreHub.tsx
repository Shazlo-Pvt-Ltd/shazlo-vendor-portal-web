import { PageHeader } from '@shazlo/ui'
import { Percent, SlidersHorizontal, Store } from 'lucide-react'
import type { Schemas } from '../../api/client'
import { useMe } from '../../api/queries'
import { paths } from '../../app/paths'
import { hubsCopy } from '../../copy/hubs'
import { HubList } from './HubList'

const copy = hubsCopy.store

// The commission in one line (spec §6); there is no default rate.
function commissionLine(c: Schemas['Commission'] | undefined): string | undefined {
  if (!c) return undefined
  if (c.state === 'agreed' && c.agreed_bps != null) return copy.commission.agreed(c.agreed_bps)
  if (c.state === 'proposed' && c.proposed_bps != null) return copy.commission.proposed(c.proposed_bps)
  if (c.state === 'sent_back') return copy.commission.sent_back
  return copy.commission.not_set
}

// The phone Store tab (spec §3): Brand page, Store details, Commission. Works at every width.
export default function StoreHub() {
  const me = useMe().data
  const setup = me?.setup
  return (
    <>
      <PageHeader title={copy.title} subtitle={copy.subtitle} />
      <HubList
        label={copy.listLabel}
        rows={[
          { key: 'brand', title: copy.brand.title, body: copy.brand.body, status: setup && !setup.brand_page ? hubsCopy.todo : undefined, icon: Store, to: paths.brand },
          { key: 'details', title: copy.details.title, body: copy.details.body, status: setup && !setup.store_details ? hubsCopy.todo : undefined, icon: SlidersHorizontal, to: paths.storeDetails },
          { key: 'commission', title: copy.commission.title, body: commissionLine(me?.vendor.commission), icon: Percent, to: paths.commission },
        ]}
      />
    </>
  )
}
