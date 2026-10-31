import { describe, expect, it, vi } from 'vitest'
import reducer, { addProduct, addProducts, setFriends, setGithubLogin, setLogin, setLogout, setMode, setPost, setPosts, setProducts } from '../src/state'

describe('persisted application state', () => {
  it('toggles the display mode without changing the previous state', () => {
    const before = reducer(undefined, { type: 'init' })
    const dark = reducer(before, setMode())
    expect(dark.mode).toBe('dark')
    expect(reducer(dark, setMode()).mode).toBe('light')
    expect(before.mode).toBe('light')
  })

  it('clears session credentials and preferences on logout', () => {
    const loggedIn = reducer(undefined, setGithubLogin({
      user: { id: 'seller-1' }, token: 'session', githubtoken: 'github', preferences: ['shirts'],
    }))
    expect(loggedIn.user).toEqual({ id: 'seller-1' })
    const loggedOut = reducer(loggedIn, setLogout())
    expect(loggedOut).toMatchObject({ user: null, token: null, githubtoken: null, preferences: null })
    expect(loggedIn.token).toBe('session')
  })

  it('updates friends only for a logged-in user', () => {
    const anonymous = reducer(undefined, { type: 'init' })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(reducer(anonymous, setFriends({ friends: ['a'] }))).toBe(anonymous)
    expect(log).toHaveBeenCalledOnce()
    const loggedIn = reducer(anonymous, setLogin({ user: { id: 'seller-1' } }))
    expect(reducer(loggedIn, setFriends({ friends: ['a'] })).user.friends).toEqual(['a'])
  })

  it('replaces only the matching post and does not append an unknown post', () => {
    const before = reducer(undefined, setPosts({ posts: [{ _id: 'a', text: 'old' }, { _id: 'b', text: 'keep' }] }))
    const after = reducer(before, setPost({ post: { _id: 'a', text: 'new' } }))
    expect(after.posts).toEqual([{ _id: 'a', text: 'new' }, { _id: 'b', text: 'keep' }])
    expect(before.posts[0].text).toBe('old')
    expect(reducer(after, setPost({ post: { _id: 'unknown' } })).posts).toEqual(after.posts)
  })

  it('replaces the catalog then appends single and bulk additions in order', () => {
    const original = reducer(undefined, setProducts({ products: [{ id: 'a' }] }))
    const single = reducer(original, addProduct({ product: { id: 'b' } }))
    const bulk = reducer(single, addProducts({ products: [{ id: 'c' }, { id: 'd' }] }))
    expect(bulk.products).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }])
    expect(original.products).toEqual([{ id: 'a' }])
    expect(reducer(bulk, setProducts({ products: [] })).products).toEqual([])
  })
})
