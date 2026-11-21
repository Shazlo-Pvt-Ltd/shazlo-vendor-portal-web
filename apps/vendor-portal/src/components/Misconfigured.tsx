import { Box, Link } from '@mui/material'
import { Banner } from '@shazlo/ui'
import { SUPPORT_EMAIL } from '../config/support'
import { frameCopy as copy } from '../copy/frame'
import { Notice, PlainPage } from './Notice'

interface Props {
  problems: string[]
}

/** Shown instead of a blank page when the build's environment is wrong. */
export function Misconfigured({ problems }: Props) {
  return (
    <PlainPage>
      <Notice
        title={copy.misconfigured.title}
        illustration="sheet"
        actions={<Link href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</Link>}
      >
        <p>{copy.misconfigured.body}</p>
        <Box sx={{ mt: 2, textAlign: 'left' }}>
          <Banner tone="error" title={problems.length === 1 ? problems[0] : `${problems.length} settings are wrong`}>
            {problems.length > 1 ? (
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </Box>
            ) : null}
          </Banner>
        </Box>
      </Notice>
    </PlainPage>
  )
}
