import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Link,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useId, type ReactNode } from 'react'
import { annotation, brand, contrastRatio, link, neutral, radius, reviewStatus, space, status, typeScale } from '../src'

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return (
    <Box component="section" aria-labelledby={id} sx={{ py: 5 }}>
      <Typography id={id} variant="overline" color="text.secondary">
        {title}
      </Typography>
      <Box sx={{ mt: 2 }}>{children}</Box>
    </Box>
  )
}

function Swatch({ name, hex }: { name: string; hex: string }) {
  const onBlack = contrastRatio(hex, '#000000')
  const onWhite = contrastRatio(hex, '#FFFFFF')
  const text = onBlack >= onWhite ? 'black' : 'white'
  return (
    <Card>
      <Box sx={{ height: 72, bgcolor: hex, borderBottom: 1, borderColor: 'divider' }} />
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Typography variant="subtitle2">{name}</Typography>
        <Typography variant="mono" color="text.secondary">
          {hex}
        </Typography>
        <Typography variant="caption" color="text.secondary" component="p">
          {text} text · {Math.max(onBlack, onWhite).toFixed(1)}:1
        </Typography>
      </CardContent>
    </Card>
  )
}

function Swatches({ colors }: { colors: Record<string, string> }) {
  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
      {Object.entries(colors).map(([name, hex]) => (
        <Swatch key={name} name={name} hex={hex} />
      ))}
    </Box>
  )
}

const variants = [
  ['display1', 'displayXl'],
  ['display2', 'displayL'],
  ['h1', 'h1'],
  ['h2', 'h2'],
  ['h3', 'h3'],
  ['body1', 'body'],
  ['body2', 'small'],
  ['caption', 'caption'],
  ['overline', 'overline'],
  ['stat', 'stat'],
  ['informal', 'informal'],
  ['mono', 'mono'],
] as const

export function App() {
  return (
    <Box sx={{ maxWidth: 1120, mx: 'auto', px: { xs: 2, md: 5 }, py: 6 }}>
      <Typography variant="overline" color="text.secondary">
        @shazlo/ui · tokens and theme
      </Typography>
      <Typography variant="display1">Swipe to style</Typography>
      <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 640, mt: 1 }}>
        Shazlo’s warm palette and expressive type, aligned with the Penpot Design language board inspected on 29 October 2026.
      </Typography>
      <Link href="https://design.penpot.app/?screen=workspace&team-id=685eebd9-2ce2-80a4-8008-d702ad7258d4&file-id=685eebd9-2ce2-80a4-8008-d702c75c4edc&page-id=685eebd9-2ce2-80a4-8008-d702c75c4edd" sx={{ display: 'inline-block', mt: 2 }}>
        View the design source
      </Link>

      <Section title="Brand">
        <Swatches colors={brand} />
      </Section>
      <Divider />
      <Section title="Neutrals">
        <Swatches colors={neutral} />
      </Section>
      <Divider />
      <Section title="Status">
        <Swatches colors={status} />
      </Section>
      <Section title="Links and annotations">
        <Swatches colors={{ linkText: link.text, ...annotation }} />
        <Typography variant="body2" sx={{ mt: 2 }}>
          Raspberry is reserved for design annotations. Blue links use the darker accessible text shade.
        </Typography>
      </Section>
      <Divider />

      <Section title="Type scale">
        <Stack divider={<Divider flexItem />} spacing={2}>
          {variants.map(([variant, token]) => {
            const t = typeScale[token]
            return (
              <Box key={variant} sx={{ display: 'grid', gridTemplateColumns: { md: '220px 1fr' }, gap: 2, alignItems: 'baseline' }}>
                <Typography variant="mono" color="text.secondary">
                  {variant} · {t.size}/{t.lineHeight} · {t.weight}
                </Typography>
                <Typography variant={variant}>
                  {variant === 'stat' ? '18 live' : variant === 'informal' ? 'A little joy in every find.' : 'Hand block-printed, naturally dyed.'}
                </Typography>
              </Box>
            )
          })}
        </Stack>
      </Section>
      <Divider />

      <Section title="Spacing (4 px grid) and radius">
        <Stack spacing={1}>
          {space.slice(1).map((s) => (
            <Stack key={s} direction="row" spacing={2} sx={{ alignItems: 'center' }}>
              <Typography variant="mono" color="text.secondary" sx={{ width: 48 }}>
                {s}
              </Typography>
              <Box sx={{ width: s, height: 12, bgcolor: 'primary.main' }} />
            </Stack>
          ))}
        </Stack>
        <Stack direction="row" spacing={2} sx={{ mt: 3, flexWrap: 'wrap' }}>
          {Object.entries(radius).map(([name, r]) => (
            <Box key={name} sx={{ textAlign: 'center' }}>
              <Box sx={{ width: 96, height: 56, borderRadius: `${Math.min(r, 28)}px`, border: 1, borderColor: 'grey.300', bgcolor: 'background.paper' }} />
              <Typography variant="mono" color="text.secondary">
                {name} {r}
              </Typography>
            </Box>
          ))}
        </Stack>
      </Section>
      <Divider />

      <Section title="Components">
        <Stack spacing={3}>
          <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', rowGap: 1.5 }}>
            <Button variant="contained">Submit for review</Button>
            <Button variant="contained" color="secondary">
              Add product
            </Button>
            <Button variant="outlined">Bulk import</Button>
            <Button>Discard draft</Button>
          </Stack>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            {([
              ['live', '✓', 'Live'],
              ['pending', '◷', 'Pending review'],
              ['sentBack', '↩', 'Sent back'],
              ['suspended', '⊘', 'Suspended'],
            ] as const).map(([state, icon, label]) => (
              <Chip key={state} label={label} icon={<span aria-hidden="true">{icon}</span>} sx={{
                color: reviewStatus[state].foreground,
                bgcolor: reviewStatus[state].background,
                '& .MuiChip-icon': { color: 'inherit', ml: 1 },
              }} />
            ))}
          </Stack>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { md: '1fr 1fr' } }}>
            <TextField label="Brand name" defaultValue="Kalki Studio" helperText="Contact us to change your brand name." />
            <TextField label="Email" defaultValue="kiran@kalkistudio.in" error helperText="An application with this email is already under review." />
          </Box>
          <Alert severity="warning" variant="outlined">
            2 products were sent back by the review team. Fix the notes on each product and resubmit.
          </Alert>
          <Card>
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                Live on Shazlo
              </Typography>
              <Typography variant="stat">18</Typography>
              <Typography variant="caption" color="text.secondary" component="p">
                Visible in the app feed
              </Typography>
            </CardContent>
          </Card>
        </Stack>
      </Section>
      <Section title="Shazlo-One shell">
        <Box sx={{ bgcolor: brand.navy, color: brand.offWhite, p: 3, borderRadius: 2 }}>
          <Typography variant="h1" component="h2" color="inherit">Shazlo-One</Typography>
          <Typography color="inherit" sx={{ mt: 1, mb: 2 }}>Review the next collection.</Typography>
          <Button variant="contained">Review products</Button>
        </Box>
      </Section>
    </Box>
  )
}
