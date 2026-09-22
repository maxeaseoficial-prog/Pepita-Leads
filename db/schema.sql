CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS companies (
  cnpj_base TEXT PRIMARY KEY,
  legal_name TEXT NOT NULL,
  legal_nature_code TEXT,
  responsible_qualification_code TEXT,
  capital_social_cents BIGINT,
  company_size_code TEXT,
  federal_entity TEXT
);

CREATE TABLE IF NOT EXISTS municipalities (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cnaes (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  normalized_label TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS qualifications (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS establishments (
  cnpj TEXT PRIMARY KEY,
  cnpj_base TEXT NOT NULL REFERENCES companies(cnpj_base),
  order_no TEXT,
  dv TEXT,
  matrix_branch_code TEXT,
  trade_name TEXT,
  status_code TEXT,
  status_date DATE,
  status_reason_code TEXT,
  opening_date DATE,
  main_cnae TEXT,
  secondary_cnaes TEXT,
  street_type TEXT,
  street TEXT,
  number TEXT,
  complement TEXT,
  neighborhood TEXT,
  postal_code TEXT,
  state TEXT,
  municipality_code TEXT REFERENCES municipalities(code),
  phone1 TEXT,
  phone2 TEXT,
  fax TEXT,
  email TEXT,
  special_status TEXT,
  special_status_date DATE
);

CREATE TABLE IF NOT EXISTS partners (
  id BIGSERIAL PRIMARY KEY,
  cnpj_base TEXT NOT NULL REFERENCES companies(cnpj_base),
  partner_type_code TEXT,
  name TEXT NOT NULL,
  document_masked TEXT,
  qualification_code TEXT,
  entry_date DATE,
  country_code TEXT,
  legal_rep_document TEXT,
  legal_rep_name TEXT,
  legal_rep_qualification_code TEXT,
  age_range_code TEXT
);

CREATE TABLE IF NOT EXISTS simple_tax (
  cnpj_base TEXT PRIMARY KEY REFERENCES companies(cnpj_base),
  simple_option TEXT,
  simple_start_date DATE,
  simple_end_date DATE,
  mei_option TEXT,
  mei_start_date DATE,
  mei_end_date DATE
);

CREATE INDEX IF NOT EXISTS idx_municipalities_normalized
  ON municipalities(normalized_name);

CREATE INDEX IF NOT EXISTS idx_cnaes_normalized
  ON cnaes(normalized_label);

CREATE INDEX IF NOT EXISTS idx_est_state_municipality
  ON establishments(state, municipality_code);

CREATE INDEX IF NOT EXISTS idx_est_municipality
  ON establishments(municipality_code);

CREATE INDEX IF NOT EXISTS idx_est_cnae_status
  ON establishments(main_cnae, status_code);

CREATE INDEX IF NOT EXISTS idx_est_opening
  ON establishments(opening_date);

CREATE INDEX IF NOT EXISTS idx_est_cnpj_base
  ON establishments(cnpj_base);

CREATE INDEX IF NOT EXISTS idx_companies_size_capital
  ON companies(company_size_code, capital_social_cents);

CREATE INDEX IF NOT EXISTS idx_partners_cnpj_base
  ON partners(cnpj_base);

-- A Pepita acessa estes dados apenas pelo backend usando DATABASE_URL.
-- Bloqueie o acesso anônimo pelas APIs públicas do Supabase.
ALTER TABLE metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE municipalities ENABLE ROW LEVEL SECURITY;
ALTER TABLE cnaes ENABLE ROW LEVEL SECURITY;
ALTER TABLE qualifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE establishments ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE simple_tax ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  metadata,
  companies,
  municipalities,
  cnaes,
  qualifications,
  establishments,
  partners,
  simple_tax
FROM anon, authenticated;

REVOKE ALL ON SEQUENCE partners_id_seq FROM anon, authenticated;
