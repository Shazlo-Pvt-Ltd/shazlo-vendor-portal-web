import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import type { components } from '../../../api/schema'
import { vendorDetailCopy } from '../../../copy/vendors'
import { rateField, rateText, toBps, waitingProposal } from '../../../lib/commission'

const e = vendorDetailCopy.approval.errors
export const AGREEMENT_REF = 'signed_offline'

// Commission is typed as a percentage (the API takes basis points), so "12.5" stays exact.
// There is no default rate: the field starts from the brand's proposal, or empty.
export const approvalSchema = z.object({
  commission: rateField,
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
  return { commission_bps: toBps(values.commission), agreement_ref: AGREEMENT_REF, owner_email: values.owner_email.trim() }
}

export function useApprovalForm(vendor: components['schemas']['VendorDetail']) {
  return useForm<ApprovalValues>({
    resolver: zodResolver(approvalSchema),
    defaultValues: { commission: rateText(waitingProposal(vendor.commission)), owner_email: vendor.email, agreement: false },
    mode: 'onChange',
  })
}
