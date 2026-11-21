/**
 * vendor-api's shapes, as the adapters and the mock API use them: the real ones from
 * `openapi.json` (`schema.d.ts`) and the proposed ones from `openapi/proposed.yaml`
 * (`proposed.d.ts`). Screens never import this file; they use `model.ts`.
 */
import type { components as ProposedComponents } from './proposed'
import type { components as RealComponents } from './schema'

type Real = RealComponents['schemas']
type Proposed = ProposedComponents['schemas']

// ---- session, me and commission ------------------------------------------------------------------
export type SessionOut = Real['SessionResponse']
export type SessionIn = SessionOut
export type MeOut = Real['Me']
export type MeIn = MeOut
export type UserProfileOut = Real['UserProfile']
export type VendorSummaryOut = Real['VendorSummary']
/** `GET /v1/vendor/commission` (its own route; not on the session). `state` is not_set, proposed, sent_back or agreed. */
export type CommissionOut = Real['CommissionOut']
export type CommissionProposalIn = Real['ProposalIn']
export type MessageOut = Real['Message']

// ---- sign-up -------------------------------------------------------------------------------------
export type SignupBody = Proposed['ProposedSignupRequest']
export type SignupStoreDetails = Proposed['SignupStoreDetails']

// ---- store details (real since PR 281) ----------------------------------------------------------
/** Flat, as Build 2 drew it; the topics are loosely typed objects, read defensively. */
export type StoreDetailsOut = Real['StoreDetailsOut']
export type StoreBrandIn = Real['BrandIn']
export type StoreContactIn = Real['ContactIn']
export type StoreDeliveryIn = Real['DeliveryIn']
export type StoreReturnsIn = Real['ReturnsIn']
export type StorePaymentIn = Real['PaymentIn']
export type StorePayoutIn = Real['PayoutIn']
export type StoreBusinessIn = Real['BusinessIn']
/** `GET /v1/public/ifsc/{code}`; `branch` is null until vendor-api bundles RBI's list. */
export type IfscOut = Real['IfscBankOut']

// ---- products ------------------------------------------------------------------------------------
export type ProductOut = Proposed['ProposedProductOut']
export type RevisionOut = Proposed['ProposedRevisionOut']
export type VariantOut = Proposed['ProposedVariantOut']
export type ImageOut = Proposed['ProposedImageOut']
export type ProductContentBody = Proposed['ProposedProductContentBody']
export type CreateProductBody = Proposed['ProposedCreateProductBody']
export type VariantBody = Proposed['ProposedVariantBody']
export type ImageBody = Proposed['ProposedImageBody']
export type ApiPhotoAngle = Proposed['PhotoAngle']
export type ApiSubmitRequirement = Proposed['SubmitRequirement']
export type ApiGender = Real['Gender']
export type ProductSummaryOut = Real['ProductSummaryOut']
type SummaryExtras = Pick<Proposed['ProposedProductSummaryOut'], 'price_paise' | 'mrp_paise' | 'stock' | 'thumbnail_url' | 'main_colour' | 'gender' | 'working_state'>
/** A list row as it may arrive: today's fields, and the proposed ones when vendor-api has them. */
export type ProductSummaryIn = ProductSummaryOut & Partial<SummaryExtras>
export type ProposedProductSummaryOut = Proposed['ProposedProductSummaryOut']
export type ApiProductSort = Proposed['ProductSort']
export type ProductPageOut = Real['ProductPageOut']

// ---- reviews, team, import, uploads --------------------------------------------------------------
export type SubmissionOut = Real['SubmissionOut']
/** A submission as it may arrive: with `product_id` and `was_live` once vendor-api sends them (proposed). */
export type SubmissionIn = SubmissionOut & Partial<Pick<Proposed['ProposedSubmissionOut'], 'product_id' | 'was_live'>>
export type SubmissionPageOut = Real['SubmissionPageOut']
export type UserOut = Real['UserOut']
export type ImportReportOut = Real['ImportReportOut']
export type ApiImportMode = Real['ImportMode']
export type AssetOut = Real['AssetOut']
export type AssetKind = Real['AssetKind']
export type SignResponse = Real['SignResponse']

// ---- brand profile -------------------------------------------------------------------------------
export type DraftOut = Proposed['ProposedDraftOut']
export type BrandProfileOut = Proposed['ProposedBrandProfileOut']
export type BrandProfileBody = Proposed['ProposedBrandProfileBody']

// ---- size charts (real since PR 281) ------------------------------------------------------------
export type SizeChartOut = Real['SizeChartOut']
export type SizeChartBody = Real['SizeChartIn']
/** vendor-api takes the group as a free path segment and answers 404 for anything else. */
export type ApiSizeChartGroup = 'bottoms' | 'tops' | 'dresses' | 'jackets'
