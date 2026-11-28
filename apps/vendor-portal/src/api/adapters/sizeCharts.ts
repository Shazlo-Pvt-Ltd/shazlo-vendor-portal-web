/** Size charts (proposed): one per group of product types; the photo of a brand's own chart is an asset. */
import { SIZE_CHART_GROUPS } from '../../lib/catalog'
import type { SizeChart, SizeChartGroup, SizeChartInput, SizeChartMeasurements } from '../model'
import type { SizeChartBody, SizeChartOut } from '../wire'
import { isoOrNull, oneOf, textOrNull } from './common'

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

function measurementsOf(value: unknown): SizeChartMeasurements {
  const out: SizeChartMeasurements = {}
  if (!isObject(value)) return out
  for (const [size, row] of Object.entries(value)) {
    if (!isObject(row)) continue
    out[size] = Object.fromEntries(Object.entries(row).map(([key, cm]) => [key, typeof cm === 'number' && Number.isFinite(cm) ? cm : null]))
  }
  return out
}

export function sizeChartFromApi(out: SizeChartOut, asked?: SizeChartGroup): SizeChart {
  return {
    group: oneOf(SIZE_CHART_GROUPS, out.group) ?? asked ?? 'dresses',
    measurements: measurementsOf(out.measurements),
    photo_url: textOrNull(out.photo_url),
    updated_at: isoOrNull(out.updated_at),
  }
}

export function sizeChartBody(input: SizeChartInput, current: SizeChartOut | null, resolve: (url: string) => string | null): SizeChartBody {
  let photo: string | null = null
  if (input.photo_url !== null) {
    photo = input.photo_url === current?.photo_url ? (current.photo_asset_id ?? null) : (resolve(input.photo_url) ?? current?.photo_asset_id ?? null)
  }
  return { measurements: input.measurements, photo_asset_id: photo }
}
