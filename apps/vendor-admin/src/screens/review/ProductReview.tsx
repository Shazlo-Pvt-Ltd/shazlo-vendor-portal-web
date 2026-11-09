import { PageHeader } from '@shazlo/ui'
import { useModuleTitle } from '../../runtime/runtime'

// Placeholder: replaced by the real screen.
export default function Screen() {
  useModuleTitle('Product review')
  return <PageHeader title="Product review" />
}
