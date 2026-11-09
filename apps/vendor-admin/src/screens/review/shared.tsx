// Pieces shared by the product (A-05) and brand page (A-07) review screens.
import { styled } from '@mui/material/styles'
import { useNavigate } from 'react-router'
import { kit, Table } from '@shazlo/ui/components'
import { useQueue, type QueueItem } from '../../api'
import { itemPath } from '../shared/format'

/** Position in the whole queue (oldest first) and the neighbours either side. */
export function useQueueNeighbours(kind: QueueItem['kind'], id: string) {
  const navigate = useNavigate()
  const queue = useQueue()
  const items = queue.data?.items ?? []
  const index = items.findIndex(i => i.kind === kind && i.id === id)
  const prev = index > 0 ? items[index - 1] : undefined
  const next = index >= 0 ? items[index + 1] : undefined
  return {
    position: index >= 0 ? index + 1 : null,
    total: items.length,
    onPrev: prev ? () => navigate(itemPath(prev)) : undefined,
    onNext: next ? () => navigate(itemPath(next)) : undefined,
    /** Where to go after deciding this item: the next one, else the one before, else the queue. */
    afterDecision: () => {
      const target = next ?? prev
      navigate(target ? itemPath(target) : '/queue')
    },
  }
}

/** Diff tables sit inside a card, so rows do not highlight on hover. */
export const DiffTable = styled(Table)({
  tableLayout: 'fixed',
  '& tbody tr:hover td': { background: kit.surface },
})

/** Two columns that stack when the frame gets narrow. */
export const Split = styled('div')({
  display: 'flex',
  gap: 20,
  alignItems: 'flex-start',
  flexWrap: 'wrap',
  minWidth: 0,
})
