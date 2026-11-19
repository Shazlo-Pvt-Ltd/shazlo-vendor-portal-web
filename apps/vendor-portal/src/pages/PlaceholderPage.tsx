import { PageHeader } from '../ui/PageHeader'

interface Props {
  title: string
}

/** A screen that a later issue fills in. It already has the page header every screen must have. */
export function PlaceholderPage({ title }: Props) {
  return <PageHeader title={title} />
}
