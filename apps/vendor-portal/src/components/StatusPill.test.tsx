import { ThemeProvider } from '@mui/material'
import { statusPillLabel, theme, type PillStatus } from '@shazlo/ui'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { pillLabel } from '../copy/status'
import { StatusPill } from './StatusPill'

const wrap = (ui: ReactNode) => render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
const pillOf = (text: string) => screen.getByText(text).closest('[data-status]') as HTMLElement

describe("the seller's StatusPill", () => {
  it.each(Object.entries(pillLabel) as [PillStatus, string][])('shows %s as “%s”, with its icon', (status, word) => {
    wrap(<StatusPill status={status} />)
    const pill = pillOf(word)
    expect(pill).toHaveAttribute('data-status', status)
    expect(pill.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
  })

  it.each<PillStatus>(['pending', 'sentBack', 'editInReview'])('never falls back to the admin word for %s', (status) => {
    wrap(<StatusPill status={status} />)
    expect(screen.queryByText(statusPillLabel[status])).toBeNull()
  })

  it('takes a one-off label and keeps the look of its status', () => {
    wrap(<StatusPill status="draft" label="Draft · 2 changes" />)
    expect(pillOf('Draft · 2 changes')).toHaveAttribute('data-status', 'draft')
    expect(screen.queryByText('Draft')).toBeNull()
  })

  it('uses the seller word when the label is empty', () => {
    wrap(<StatusPill status="sentBack" label="" />)
    expect(pillOf('Needs changes')).toHaveAttribute('data-status', 'sentBack')
  })
})
