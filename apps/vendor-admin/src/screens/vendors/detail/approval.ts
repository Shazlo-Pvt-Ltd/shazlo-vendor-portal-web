import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import type { components } from '../../../api/schema'
import { vendorDetailCopy } from '../../../copy/vendors'

const e = vendorDetailCopy.approval.errors
export const DEFAULT_COMMISSION = '15'
export const AGREEMENT_REF = 'signed_offline'

// Commission is typed as text (the API takes basis points), so "12.5" stays exact.
export const approvalSchema = z.object({
  commission: z
    .string()
    .trim()
    .min(1, e.commissionRequired)
    .regex(/^\d+(\.\d{1,2})?$/, e.commissionNumber)
    .refine((v) => Number(v) <= 40, e.commissionRange),
  owner_email: z.string().trim().min(1, e.emailRequired).email(e.emailFormat),
  agreement: z.boolean().refine((v) => v, e.agreement),
})

export type ApprovalValues = z.infer<typeof approvalSchema>

// API field names on a 422, mapped to the form's own fields.
export const apiFieldToForm: Record<string, keyof ApprovalValues> = {
  commission_bps: 'commission',
  agreement_ref: 'agreement',
  owner_email: 'owner_email',
}

export function toApproveBody(values: ApprovalValues) {
  return { commission_bps: Math.round(Number(values.commission) * 100), agreement_ref: AGREEMENT_REF, owner_email: values.owner_email.trim() }
}

export function useApprovalForm(vendor: components['schemas']['VendorDetail']) {
  return useForm<ApprovalValues>({
    resolver: zodResolver(approvalSchema),
    defaultValues: { commission: DEFAULT_COMMISSION, owner_email: vendor.email, agreement: false },
    mode: 'onChange',
  })
}
