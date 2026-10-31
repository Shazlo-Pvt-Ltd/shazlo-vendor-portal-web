import { describe, expect, it, vi } from 'vitest'
import FeedQueue from '../src/FeedQueue'

describe('recommendation feed queue', () => {
  it('starts empty and safely accepts a swipe before loading', () => {
    const queue = new FeedQueue()
    queue.swipe('absent')
    expect(queue.getVisible()).toEqual([])
    expect(queue.consumeAnimationFlag()).toBe(false)
  })

  it('shows a five-card window in order without changing the supplied batch', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const items = ['a', 'b', 'c', 'd', 'e', 'f']
    const queue = new FeedQueue()
    queue.addBatch(items)
    expect(queue.getVisible()).toEqual(['a', 'b', 'c', 'd', 'e'])
    queue.swipe('a')
    expect(queue.getVisible()).toEqual(['b', 'c', 'd', 'e', 'f'])
    expect(items).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  it('animates each batch once and advances across queued batches', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const queue = new FeedQueue()
    queue.addBatch(['a', 'b'])
    expect(queue.consumeAnimationFlag()).toBe(true)
    expect(queue.consumeAnimationFlag()).toBe(false)
    queue.addBatch(['c'])
    expect(queue.consumeAnimationFlag()).toBe(false)
    queue.swipe('a')
    expect(queue.getVisible()).toEqual(['b'])
    queue.swipe('b')
    expect(queue.getVisible()).toEqual(['c'])
    expect(queue.consumeAnimationFlag()).toBe(true)
    queue.swipe('c')
    expect(queue.getVisible()).toEqual([])
    expect(queue.consumeAnimationFlag()).toBe(false)
  })

  it('resumes when a network batch arrives after all visible cards were consumed', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const queue = new FeedQueue()
    queue.addBatch(['first'])
    queue.swipe('first')
    queue.addBatch(['late'])
    expect(queue.getVisible()).toEqual(['late'])
    expect(queue.consumeAnimationFlag()).toBe(true)
  })

  it('ignores empty results before, between and after useful batches', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const queue = new FeedQueue()
    queue.addBatch([])
    expect(queue.consumeAnimationFlag()).toBe(false)
    queue.addBatch(['a'])
    queue.addBatch([])
    queue.addBatch(['b'])
    queue.swipe('a')
    expect(queue.getVisible()).toEqual(['b'])
    queue.swipe('b')
    queue.addBatch([])
    expect(queue.getVisible()).toEqual([])
  })
})
