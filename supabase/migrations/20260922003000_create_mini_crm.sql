CREATE TABLE public.crm_columns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60), slug TEXT NOT NULL CHECK (char_length(slug) BETWEEN 1 AND 80),
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (workspace_id, slug)
);
CREATE TABLE public.crm_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id TEXT NOT NULL DEFAULT 'default',
  column_id UUID NOT NULL REFERENCES public.crm_columns(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0), company_cnpj TEXT,
  company_name TEXT NOT NULL CHECK (char_length(company_name) BETWEEN 1 AND 180), trade_name TEXT, category TEXT,
  city TEXT, state TEXT, phone TEXT, email TEXT, website TEXT,
  potential_level TEXT CHECK (potential_level IS NULL OR potential_level IN ('LOW','MEDIUM','HIGH')),
  potential_score INTEGER CHECK (potential_score IS NULL OR potential_score BETWEEN 0 AND 100),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','search')), notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.crm_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id TEXT NOT NULL DEFAULT 'default',
  card_id UUID NOT NULL REFERENCES public.crm_cards(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX crm_cards_workspace_cnpj_unique ON public.crm_cards(workspace_id, company_cnpj)
  WHERE company_cnpj IS NOT NULL AND company_cnpj <> '';
CREATE INDEX crm_columns_workspace_position_idx ON public.crm_columns(workspace_id, position);
CREATE INDEX crm_cards_column_position_idx ON public.crm_cards(column_id, position);
CREATE INDEX crm_cards_workspace_updated_idx ON public.crm_cards(workspace_id, updated_at DESC);
CREATE INDEX crm_comments_card_created_idx ON public.crm_comments(card_id, created_at DESC);
CREATE FUNCTION public.crm_set_updated_at() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER crm_columns_set_updated_at BEFORE UPDATE ON public.crm_columns FOR EACH ROW EXECUTE FUNCTION public.crm_set_updated_at();
CREATE TRIGGER crm_cards_set_updated_at BEFORE UPDATE ON public.crm_cards FOR EACH ROW EXECUTE FUNCTION public.crm_set_updated_at();
INSERT INTO public.crm_columns (workspace_id,name,slug,position) VALUES
  ('default','Prospectar','prospectar',0), ('default','Abordar','abordar',1), ('default','Em contato','em-contato',2),
  ('default','Reunião marcada','reuniao-marcada',3), ('default','Em negociação','em-negociacao',4),
  ('default','Fechou','fechou',5), ('default','Perdeu','perdeu',6);
ALTER TABLE public.crm_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_comments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_columns, public.crm_cards, public.crm_comments FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.crm_columns, public.crm_cards, public.crm_comments TO pepita_app;
CREATE POLICY "Pepita backend manages CRM columns" ON public.crm_columns FOR ALL TO pepita_app USING (true) WITH CHECK (true);
CREATE POLICY "Pepita backend manages CRM cards" ON public.crm_cards FOR ALL TO pepita_app USING (true) WITH CHECK (true);
CREATE POLICY "Pepita backend manages CRM comments" ON public.crm_comments FOR ALL TO pepita_app USING (true) WITH CHECK (true);
