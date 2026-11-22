import { Box, Skeleton, Stack, Typography } from '@mui/material'
import { brand, neutral, radius, SectionCard } from '@shazlo/ui'
import { adminsCopy } from '../../copy/admins'
import { roleIcon, roleName, type Admin, type Role } from './shared'

const copy = adminsCopy.roles
// The role's icon tile matches the people avatars in the table above.
const ICON_TILE = 36

// What each role can do, and how many active people hold it.
export function RolesSection({ roles, admins }: { roles: Role[] | undefined; admins: Admin[] | undefined }) {
  return (
    <SectionCard title={copy.title} padded={false}>
      {!roles ? (
        <Box role="status" aria-label={copy.loading} sx={{ px: { xs: 2, sm: 3 }, pb: 2 }}>
          <Skeleton variant="text" width="40%" />
          <Skeleton variant="text" width="70%" />
        </Box>
      ) : (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, pb: 1 }}>
          {roles.map((role) => {
            const count = admins?.filter((a) => a.is_active && a.roles.includes(role.name)).length
            const Icon = roleIcon(role.name)
            return (
              <Stack component="li" key={role.name} direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0.5, sm: 3 }} sx={{ px: { xs: 2, sm: 3 }, py: 1.75, borderTop: `1px solid ${neutral.line}`, justifyContent: 'space-between' }}>
                <Stack direction="row" spacing={1.5} sx={{ minWidth: 0 }}>
                  <Box sx={{ display: 'grid', placeItems: 'center', width: ICON_TILE, height: ICON_TILE, flexShrink: 0, borderRadius: `${radius.control}px`, bgcolor: brand.cream, color: brand.brown }}>
                    <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                  </Box>
                  <Box sx={{ minWidth: 0, pt: 0.25 }}>
                    <Typography variant="h3" component="h3">
                      {roleName(role.name)}
                    </Typography>
                    <Typography variant="body2" color="textSecondary" sx={{ mt: 0.25, maxWidth: '68ch' }}>
                      {role.description}
                    </Typography>
                  </Box>
                </Stack>
                <Typography variant="body2" color="textSecondary" sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', pl: { xs: `${ICON_TILE + 12}px`, sm: 0 }, pt: { sm: 0.25 } }}>
                  {count === undefined ? <Skeleton variant="text" width={96} /> : copy.members(count)}
                </Typography>
              </Stack>
            )
          })}
        </Box>
      )}
    </SectionCard>
  )
}
