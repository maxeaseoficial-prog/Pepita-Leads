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

GRANT SELECT ON TABLE
  metadata,
  companies,
  municipalities,
  cnaes,
  qualifications,
  establishments,
  partners,
  simple_tax
TO pepita_app;

CREATE POLICY "Pepita backend reads metadata" ON metadata FOR SELECT TO pepita_app USING (true);
CREATE POLICY "Pepita backend reads companies" ON companies FOR SELECT TO pepita_app USING (true);
CREATE POLICY "Pepita backend reads municipalities" ON municipalities FOR SELECT TO pepita_app USING (true);
CREATE POLICY "Pepita backend reads cnaes" ON cnaes FOR SELECT TO pepita_app USING (true);
CREATE POLICY "Pepita backend reads qualifications" ON qualifications FOR SELECT TO pepita_app USING (true);
CREATE POLICY "Pepita backend reads establishments" ON establishments FOR SELECT TO pepita_app USING (true);
CREATE POLICY "Pepita backend reads partners" ON partners FOR SELECT TO pepita_app USING (true);
CREATE POLICY "Pepita backend reads simple tax" ON simple_tax FOR SELECT TO pepita_app USING (true);

-- Mini CRM. O workspace padrão será substituído por organizações quando
-- autenticação e contas de equipe forem adicionadas ao produto.
CREATE TABLE IF NOT EXISTS crm_columns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  slug TEXT NOT NULL CHECK (char_length(slug) BETWEEN 1 AND 80),
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug)
);

CREATE TABLE IF NOT EXISTS crm_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL DEFAULT 'default',
  column_id UUID NOT NULL REFERENCES crm_columns(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  company_cnpj TEXT,
  company_name TEXT NOT NULL CHECK (char_length(company_name) BETWEEN 1 AND 180),
  trade_name TEXT,
  category TEXT,
  city TEXT,
  state TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  potential_level TEXT CHECK (potential_level IS NULL OR potential_level IN ('LOW','MEDIUM','HIGH')),
  potential_score INTEGER CHECK (potential_score IS NULL OR potential_score BETWEEN 0 AND 100),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','search')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL DEFAULT 'default',
  card_id UUID NOT NULL REFERENCES crm_cards(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS crm_cards_workspace_cnpj_unique
  ON crm_cards(workspace_id, company_cnpj)
  WHERE company_cnpj IS NOT NULL AND company_cnpj <> '';
CREATE INDEX IF NOT EXISTS crm_columns_workspace_position_idx ON crm_columns(workspace_id, position);
CREATE INDEX IF NOT EXISTS crm_cards_column_position_idx ON crm_cards(column_id, position);
CREATE INDEX IF NOT EXISTS crm_cards_workspace_updated_idx ON crm_cards(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS crm_comments_card_created_idx ON crm_comments(card_id, created_at DESC);

CREATE OR REPLACE FUNCTION crm_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crm_columns_set_updated_at ON crm_columns;
CREATE TRIGGER crm_columns_set_updated_at BEFORE UPDATE ON crm_columns
FOR EACH ROW EXECUTE FUNCTION crm_set_updated_at();
DROP TRIGGER IF EXISTS crm_cards_set_updated_at ON crm_cards;
CREATE TRIGGER crm_cards_set_updated_at BEFORE UPDATE ON crm_cards
FOR EACH ROW EXECUTE FUNCTION crm_set_updated_at();

INSERT INTO crm_columns (workspace_id, name, slug, position) VALUES
  ('default','Prospectar','prospectar',0),
  ('default','Abordar','abordar',1),
  ('default','Em contato','em-contato',2),
  ('default','Reunião marcada','reuniao-marcada',3),
  ('default','Em negociação','em-negociacao',4),
  ('default','Fechou','fechou',5),
  ('default','Perdeu','perdeu',6)
ON CONFLICT (workspace_id, slug) DO NOTHING;

ALTER TABLE crm_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_comments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE crm_columns, crm_cards, crm_comments FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE crm_columns, crm_cards, crm_comments TO pepita_app;

CREATE POLICY "Pepita backend manages CRM columns" ON crm_columns
  FOR ALL TO pepita_app USING (true) WITH CHECK (true);
CREATE POLICY "Pepita backend manages CRM cards" ON crm_cards
  FOR ALL TO pepita_app USING (true) WITH CHECK (true);
CREATE POLICY "Pepita backend manages CRM comments" ON crm_comments
  FOR ALL TO pepita_app USING (true) WITH CHECK (true);
