CREATE SCHEMA IF NOT EXISTS rfb;
SET search_path TO rfb, public;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS companies (
  cnpj_base TEXT PRIMARY KEY,
  legal_name TEXT NOT NULL,
  normalized_legal_name TEXT NOT NULL,
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
  normalized_trade_name TEXT,
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
  state TEXT NOT NULL,
  municipality_code TEXT REFERENCES municipalities(code),
  phone1 TEXT,
  phone1_last8 TEXT,
  phone2 TEXT,
  phone2_last8 TEXT,
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

CREATE INDEX IF NOT EXISTS idx_rfb_municipality_name
  ON municipalities(normalized_name);

CREATE INDEX IF NOT EXISTS idx_rfb_est_state_city_status
  ON establishments(state, municipality_code, status_code);

CREATE INDEX IF NOT EXISTS idx_rfb_est_cnpj_base
  ON establishments(cnpj_base);

CREATE INDEX IF NOT EXISTS idx_rfb_est_cnae_status
  ON establishments(main_cnae, status_code);

CREATE INDEX IF NOT EXISTS idx_rfb_est_phone1_last8
  ON establishments(phone1_last8)
  WHERE phone1_last8 IS NOT NULL AND phone1_last8 <> '';

CREATE INDEX IF NOT EXISTS idx_rfb_est_phone2_last8
  ON establishments(phone2_last8)
  WHERE phone2_last8 IS NOT NULL AND phone2_last8 <> '';

CREATE INDEX IF NOT EXISTS idx_rfb_est_trade_name_trgm
  ON establishments USING gin(normalized_trade_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_rfb_company_legal_name_trgm
  ON companies USING gin(normalized_legal_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_rfb_partners_cnpj_base
  ON partners(cnpj_base);

CREATE INDEX IF NOT EXISTS idx_rfb_company_size_capital
  ON companies(company_size_code, capital_social_cents);
