GRANT SELECT ON TABLE
  public.metadata, public.companies, public.municipalities, public.cnaes,
  public.qualifications, public.establishments, public.partners, public.simple_tax
TO pepita_app;

CREATE POLICY "Pepita backend reads metadata" ON public.metadata FOR SELECT TO pepita_app USING (true);
CREATE POLICY "Pepita backend reads companies" ON public.companies FOR SELECT TO pepita_app USING (true);
CREATE POLICY "Pepita backend reads municipalities" ON public.municipalities FOR SELECT TO pepita_app USING (true);
CREATE POLICY "Pepita backend reads cnaes" ON public.cnaes FOR SELECT TO pepita_app USING (true);
CREATE POLICY "Pepita backend reads qualifications" ON public.qualifications FOR SELECT TO pepita_app USING (true);
CREATE POLICY "Pepita backend reads establishments" ON public.establishments FOR SELECT TO pepita_app USING (true);
CREATE POLICY "Pepita backend reads partners" ON public.partners FOR SELECT TO pepita_app USING (true);
CREATE POLICY "Pepita backend reads simple tax" ON public.simple_tax FOR SELECT TO pepita_app USING (true);
