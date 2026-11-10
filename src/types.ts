export type EvidenceType = 'fact' | 'estimate' | 'hypothesis';
export type Confidence = 'high' | 'medium' | 'low';

export interface Pricing { plan: string; price: string; billingPeriod: string; sourceUrl: string; quote: string; checkedAt: string; }
export interface Evidence { claim: string; sourceUrl: string; quote: string; type: EvidenceType; confidence: Confidence; }
export interface Product { name: string; website: string; description: string; consumerAudience: string; payer: string; problemSolved: string; businessModel: string; pricing: Pricing[]; evidence: Evidence[]; unknowns: string[]; }
export interface ScanResponse { query: string; generatedAt: string; products: Product[]; summary: { marketPattern: string; pricingPattern: string; audiencePattern: string; caveats: string[] }; }
