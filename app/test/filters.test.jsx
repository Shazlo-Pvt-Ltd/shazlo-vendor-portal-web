import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import BrandFilter from '../src/components/BrandFilter'
import ProductFilter from '../src/components/ProductsFilter'
import PriceFilter from '../src/components/PriceFilter'

describe.each([
  ['brands', BrandFilter, 'brandList', ['Kalki', 'Indigo']],
  ['products', ProductFilter, 'productList', ['Shirts', 'Dresses']],
])('%s filter', (_name, Filter, listProp, values) => {
  it('searches without case sensitivity and applies only the selected values', async () => {
    const onApply = vi.fn()
    const onClose = vi.fn()
    render(<Filter open {...{ [listProp]: values }} onApply={onApply} onClose={onClose} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: values[0].toUpperCase() } })
    expect(screen.getByRole('checkbox', { name: values[0] })).toBeTruthy()
    expect(screen.queryByRole('checkbox', { name: values[1] })).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: values[0] }))
    fireEvent.click(screen.getByRole('button', { name: /apply/i }))
    expect(onApply).toHaveBeenCalledExactlyOnceWith([values[0]])
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('allows deselection and clears the active selection and search', async () => {
    const onApply = vi.fn()
    const onClear = vi.fn()
    render(<Filter open {...{ [listProp]: values }} onApply={onApply} onClose={vi.fn()} onClear={onClear} />)
    const checkbox = screen.getByRole('checkbox', { name: values[0] })
    fireEvent.click(checkbox)
    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(false)
    fireEvent.click(checkbox)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: values[0] } })
    fireEvent.click(screen.getByRole('button', { name: /clear/i }))
    expect(onClear).toHaveBeenCalledOnce()
    expect(screen.getByRole('textbox').value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: /apply/i }))
    expect(onApply).toHaveBeenCalledWith([])
  })

  it('keeps the selected values while reopening the dialog', async () => {
    const onApply = vi.fn()
    const props = { [listProp]: values, onApply, onClose: vi.fn() }
    const view = render(<Filter open {...props} />)
    fireEvent.click(screen.getByRole('checkbox', { name: values[0] }))
    view.rerender(<Filter open={false} {...props} />)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    view.rerender(<Filter open {...props} />)
    expect(screen.getByRole('checkbox', { name: values[0] }).checked).toBe(true)
  })
})

describe('price filter', () => {
  it.each([
    ['', '', { minPrice: null, maxPrice: null }],
    ['0', '', { minPrice: 0, maxPrice: null }],
    ['', '5000', { minPrice: null, maxPrice: 5000 }],
    ['500', '1500', { minPrice: 500, maxPrice: 1500 }],
  ])('applies From=%s To=%s as numbers or open bounds', (min, max, expected) => {
    const onApply = vi.fn()
    const onClose = vi.fn()
    render(<PriceFilter open onApply={onApply} onClose={onClose} />)
    fireEvent.change(screen.getByLabelText('From'), { target: { value: min } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: max } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onApply).toHaveBeenCalledExactlyOnceWith(expected)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('removes non-digit input and clears both bounds', () => {
    const onClear = vi.fn()
    render(<PriceFilter open onClear={onClear} />)
    fireEvent.change(screen.getByLabelText('From'), { target: { value: 'Rs 1,200' } })
    expect(screen.getByLabelText('From').value).toBe('1200')
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByLabelText('From').value).toBe('')
    expect(screen.getByLabelText('To').value).toBe('')
    expect(onClear).toHaveBeenCalledOnce()
  })
})
