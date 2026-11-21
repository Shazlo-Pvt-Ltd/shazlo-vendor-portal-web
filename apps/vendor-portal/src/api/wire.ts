/**
 * vendor-api's shapes, as the adapters and the mock API use them: the real ones from
 * `openapi.json` (`schema.d.ts`) and the proposed ones from `openapi/proposed.yaml`
 * (`proposed.d.ts`). Screens never import this file; they use `model.ts`.
 */
import type { components as ProposedComponents } from './proposed'
import type { components as RealComponents } from './schema'

type Real = RealComponents['schemas']
type Proposed = ProposedComponents['schemas']

// ---- session and me ------------------------------------------------------------------------------
export type SessionOut = Proposed['ProposedSessionResponse']
/** A session as the client types it today (the vendor's commission not yet guaranteed). */
export type SessionIn = Real['SessionResponse']
export type MeOut = Proposed['ProposedMe']
/** `/v1/vendor/me` as the client types it today: the commission may or may not be there yet. */
export type MeIn = Real['Me'] & { vendor: { commission?: unknown } }
export type UserProfileOut = Real['UserProfile']
export type VendorSummaryOut = Proposed['ProposedVendorSummary']
export type CommissionOut = Proposed['CommissionOut']
export type CommissionState = Proposed['CommissionState']
export type MessageOut = Real['Message']

// ---- sign-up -------------------------------------------------------------------------------------
export type SignupBody = Proposed['ProposedSignupRequest']
export type SignupStoreDetails = Proposed['SignupStoreDetails']

// ---- store details -------------------------------------------------------------------------------
export type StoreDetailsOut = Proposed['StoreDetailsOut']
export type StoreSectionName = Proposed['StoreSection']
export type StoreBrandBody = Proposed['StoreBrandBody']
export type StoreContact = Proposed['StoreContact']
export type StoreDelivery = Proposed['StoreDelivery']
export type StoreReturns = Proposed['StoreReturns']
export type StorePayment = Proposed['StorePayment']
export type StorePayoutBody = Proposed['StorePayoutBody']
export type StorePayoutOut = Proposed['StorePayoutOut']
export type StoreBusiness = Proposed['StoreBusiness']
export type IfscOut = Proposed['IfscOut']

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
/** A submission as it may arrive: with `product_id` once vendor-api sends it (proposed). */
export type SubmissionIn = SubmissionOut & { product_id?: string | null }
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

// ---- size charts ---------------------------------------------------------------------------------
export type SizeChartOut = Proposed['SizeChartOut']
export type SizeChartBody = Proposed['SizeChartBody']
export type ApiSizeChartGroup = Proposed['SizeChartGroup']
