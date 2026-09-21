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
  email: string | null;
  website?: string | null;
  mapsUrl?: string | null;
  social?: {
    instagram?: SocialMatch | null;
  };
  potential: Potential;
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
  };
};
