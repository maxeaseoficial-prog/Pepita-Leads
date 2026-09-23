export type PotentialLevel = "LOW" | "MEDIUM" | "HIGH";
export type CompanySizeFilter = "MICRO" | "SMALL" | "OTHER";

export type SearchPayload = {
  niche: string;
  city: string;
  state: string;
  quantity: number;
  companySizes: CompanySizeFilter[];
  minCapital: number;
  minAgeYears: number;
  minPotential: "ALL" | "MEDIUM_PLUS" | "HIGH";
  activeOnly: boolean;
  hasPhone: boolean;
  hasEmail: boolean;
  matrixOnly: boolean;
  onlyWithoutSite: boolean;
  findInstagram: boolean;
};

export type Potential = {
  score: number;
  level: PotentialLevel;
  reasons: string[];
};

export type SocialMatch = {
  url: string;
  confidence: string;
  source: string;
};

export type CompanyLead = {
  cnpj: string;
  cnpjFormatted: string;
  legalName: string;
  tradeName: string | null;
  category: string | null;
  cnae: string | null;
  statusCode: string | null;
  openingDate: string | null;
  ageYears: number | null;
  companySizeCode: string | null;
  companySize: string;
  capitalSocialCents: number | null;
  matrixBranch: string;
  city: string | null;
  state: string | null;
  address: string | null;
  postalCode: string | null;
  phone: string | null;
  whatsapp?: string | null;
  ownerPhone?: string | null;
  ownerWhatsapp?: string | null;
  email: string | null;
  website?: string | null;
  mapsUrl?: string | null;
  social?: {
    instagram?: SocialMatch | null;
  };
  potential: Potential;
  partners?: Partner[];
};

export type SearchResponse = {
  input: SearchPayload;
  requested: number;
  returned: number;
  partial: boolean;
  dataset: {
    mode: string;
    reference?: string | null;
  };
  results: CompanyLead[];
};

export type Partner = {
  name: string;
  qualification: string | null;
  entryDate?: string | null;
};

export type CompanyDetail = CompanyLead & {
  partners: Partner[];
  simpleOption?: string | null;
  meiOption?: string | null;
  source: {
    provider: string;
    note?: string | null;
  };
};

export type HealthResponse = {
  ok: boolean;
  ready: boolean;
  database: "connected" | "missing" | "error";
  datasetMode: string;
  datasetReference?: string | null;
  providers: {
    googlePlaces: boolean;
    websiteEnrichment: boolean;
    mapsBrowser: boolean;
  };
};

export type CrmComment = {
  id: string;
  cardId: string;
  body: string;
  createdAt: string;
};

export type CrmCard = {
  id: string;
  columnId: string;
  position: number;
  companyCnpj: string | null;
  companyName: string;
  tradeName: string | null;
  category: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  potentialLevel: PotentialLevel | null;
  potentialScore: number | null;
  source: "manual" | "search";
  notes: string;
  createdAt: string;
  updatedAt: string;
  comments: CrmComment[];
};

export type CrmColumn = {
  id: string;
  name: string;
  slug: string;
  position: number;
  cards: CrmCard[];
};

export type CrmBoard = {
  columns: CrmColumn[];
  totalCards: number;
};
