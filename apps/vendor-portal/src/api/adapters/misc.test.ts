import { describe, expect, it } from 'vitest'
import type { SizeChartOut, UserOut } from '../wire'
import { assetIdForUrl, forgetAssets, rememberAsset } from './assets'
import { sizeChartBody, sizeChartFromApi } from './sizeCharts'
import { teamUserFromApi } from './team'

describe('sizeChartFromApi', () => {
  const out: SizeChartOut = {
    group: 'dresses',
    measurements: { M: { bust: 91, waist: 77, hip: null, length: 113 } },
    photo_asset_id: 'asset-chart',
    photo_url: 'https://res.cloudinary.com/x/chart.jpg',
    version: 2,
    updated_at: '2026-11-10T10:00:00Z',
  }

  it('reads the chart for its group', () => {
    expect(sizeChartFromApi(out)).toEqual({
      group: 'dresses',
      measurements: { M: { bust: 91, waist: 77, hip: null, length: 113 } },
      photo_url: 'https://res.cloudinary.com/x/chart.jpg',
      updated_at: '2026-11-10T10:00:00Z',
    })
  })

  it('drops values that are not numbers and groups it does not know', () => {
    const odd = sizeChartFromApi({ ...out, group: 'hats' as never, measurements: { M: { bust: 'wide' }, L: 'big' } as never })
    expect(odd).toMatchObject({ group: 'dresses', measurements: { M: { bust: null } } })
  })

  it('writes the photo by asset id', () => {
    expect(sizeChartBody({ measurements: {}, photo_url: 'https://res.cloudinary.com/x/chart.jpg' }, out, () => null)).toEqual({ measurements: {}, photo_asset_id: 'asset-chart' })
    expect(sizeChartBody({ measurements: {}, photo_url: 'https://res.cloudinary.com/x/new.jpg' }, out, () => 'asset-new').photo_asset_id).toBe('asset-new')
    expect(sizeChartBody({ measurements: {}, photo_url: null }, out, () => 'x').photo_asset_id).toBeNull()
  })
})

describe('teamUserFromApi', () => {
  const user: UserOut = { id: 'u-2', email: 'asha@kalkistudio.in', role: 'staff', status: 'invited', last_login_at: null, created_at: '2026-11-01T10:00:00Z' }

  it('reads a team member', () => {
    expect(teamUserFromApi(user)).toEqual({ id: 'u-2', email: 'asha@kalkistudio.in', role: 'staff', status: 'invited', lastLoginAt: null, createdAt: '2026-11-01T10:00:00Z' })
  })

  it('gives an unknown role the least rights and an unknown status the safest word', () => {
    expect(teamUserFromApi({ ...user, role: 'admin', status: 'locked' })).toMatchObject({ role: 'staff', status: 'disabled' })
  })
})

describe('the asset registry', () => {
  it('remembers which asset an uploaded image URL is, for the PUT bodies that want ids', () => {
    forgetAssets()
    expect(assetIdForUrl('https://res.cloudinary.com/x/a.jpg')).toBeNull()
    rememberAsset('https://res.cloudinary.com/x/a.jpg', 'asset-a')
    expect(assetIdForUrl('https://res.cloudinary.com/x/a.jpg')).toBe('asset-a')
    forgetAssets()
    expect(assetIdForUrl('https://res.cloudinary.com/x/a.jpg')).toBeNull()
  })
})
