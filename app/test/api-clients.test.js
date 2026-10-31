import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getRecommendations } from '../src/api/recommendations'
import { sendSwipe } from '../src/api/swipes'
import { recalculatePreferenceVector } from '../src/api/user_vector'
import { getShadowUser, saveShadowUser } from '../src/utils/shadowUser'

const user = { user_id: 'user-1', preference_vector: [0.25, 0.75] }

beforeEach(() => saveShadowUser(user))

const calls = [
  ['recommendations', () => getRecommendations(), '/items/getinitial', 'Failed to fetch recommendations'],
  ['swipe', () => sendSwipe({ item: { item_id: 'item-1', embedding: [1, 0] }, likeStatus: false }), '/user/swipes', 'Failed to save swipe'],
  ['preference vector', () => recalculatePreferenceVector(), '/user/calculatevector', 'Failed to recalculate vector'],
]

describe.each(calls)('%s API', (_name, call, path, failureMessage) => {
  it('rejects a missing identity without contacting the API', async () => {
    localStorage.clear()
    await expect(call()).rejects.toThrow('Shadow user missing')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects corrupt local identity without contacting the API', async () => {
    localStorage.setItem('shadow_user', '{broken')
    await expect(call()).rejects.toBeInstanceOf(SyntaxError)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('preserves identity on an unsuccessful HTTP response', async () => {
    fetch.mockResolvedValue({ ok: false })
    await expect(call()).rejects.toThrow(failureMessage)
    expect(fetch.mock.calls[0][0]).toBe(`https://api.shazlo.store/v1${path}`)
    expect(getShadowUser()).toEqual(user)
  })

  it('propagates connection errors without changing saved preferences', async () => {
    fetch.mockRejectedValue(new Error('offline'))
    await expect(call()).rejects.toThrow('offline')
    expect(getShadowUser()).toEqual(user)
  })
})

describe('recommendation request contract', () => {
  it('sends the default filters and shadow identity', async () => {
    const items = [{ item_id: 'item-1' }]
    fetch.mockResolvedValue({ ok: true, json: async () => items })
    await expect(getRecommendations()).resolves.toEqual(items)
    const request = fetch.mock.calls[0][1]
    expect(request.method).toBe('POST')
    expect(request.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(request.body)).toEqual({
      userid: 'user-1', preference_vector: [0.25, 0.75], gender: 'women',
      brands: [], products: [], min_price: null, max_price: null, exclude_ids: [],
    })
  })

  it('forwards exclusions, explicit filters and a zero price without dropping them', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => [] })
    await getRecommendations({ excludeIds: ['seen'], gender: 'men', brands: ['Kalki'], products: ['Shirts'], minPrice: 0, maxPrice: 500 })
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      gender: 'men', brands: ['Kalki'], products: ['Shirts'],
      min_price: 0, max_price: 500, exclude_ids: ['seen'],
    })
  })
})

describe('swipe request contract', () => {
  it.each([true, false])('sends like_status=%s, the item embedding and current preference', async (likeStatus) => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ saved: true }) })
    await expect(sendSwipe({ item: { item_id: 'item-1', embedding: [1, 0] }, likeStatus })).resolves.toEqual({ saved: true })
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      user_id: 'user-1', item_id: 'item-1', like_status: likeStatus,
      item_embedding: [1, 0], preference_vector: [0.25, 0.75],
    })
  })
})

describe('preference vector persistence', () => {
  it('saves the returned vector and retains unrelated identity fields', async () => {
    saveShadowUser({ ...user, extra: 'keep' })
    fetch.mockResolvedValue({ ok: true, json: async () => ({ new_vector: [0, 1] }) })
    await expect(recalculatePreferenceVector()).resolves.toEqual([0, 1])
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ user_id: 'user-1', preference_vector: [0.25, 0.75] })
    expect(getShadowUser()).toEqual({ user_id: 'user-1', preference_vector: [0, 1], extra: 'keep' })
  })

  it('does not replace preferences when response JSON is malformed', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError('bad JSON') } })
    await expect(recalculatePreferenceVector()).rejects.toThrow('bad JSON')
    expect(getShadowUser()).toEqual(user)
  })
})
