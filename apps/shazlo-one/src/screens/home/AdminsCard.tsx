import { Box, Button, Skeleton, Stack } from '@mui/material'
import { Banner, SectionCard, StatFigure } from '@shazlo/ui'
import { Link as RouterLink } from 'react-router'
import { useAdmins } from '../../api/queries'
import { paths } from '../../app/paths'
import { homeCopy } from '../../copy/home'
import { formatCount } from '../../lib/format'

const copy = homeCopy.admins
const touch = { minHeight: { xs: 44, md: 36 } }

// Super admins only: who can sign in, and who still has a temporary password.
export function AdminsCard() {
  const admins = useAdmins({})
  const items = admins.data?.items
  const active = items?.filter((a) => a.is_active) ?? []
  const invited = active.filter((a) => a.must_change_password).length

  let body
  if (admins.isPending) body = <Skeleton role="status" aria-label={copy.loading} variant="rounded" height={112} />
  else if (admins.isError)
    body = (
      <Banner tone="error" title={copy.error} action={<Button variant="outlined" sx={{ ...touch, bgcolor: 'background.paper' }} onClick={() => void admins.refetch()}>{homeCopy.retry}</Button>}>
        {admins.error.message}
      </Banner>
    )
  else body = <StatFigure label={copy.active} value={formatCount(active.length)} baseline={copy.invited(invited)} />

  return (
    <SectionCard title={copy.title}>
      <Stack spacing={2}>
        {body}
        <Box>
          <Button variant="outlined" component={RouterLink} to={paths.admins} sx={touch}>
            {copy.manage}
          </Button>
        </Box>
      </Stack>
    </SectionCard>
  )
}
