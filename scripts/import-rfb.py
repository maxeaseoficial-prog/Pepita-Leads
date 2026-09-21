#!/usr/bin/env python3
"""
Importador streaming dos Dados Abertos CNPJ para PostgreSQL/Neon.

Uso:
  pip install -r requirements-import.txt
  python scripts/import-rfb.py --database-url "$DATABASE_URL" --input /pasta/dos-zips

O script foi pensado para banco vazio. Ele NÃO apaga dados existentes.
Se detectar dados nas tabelas principais, interrompe.
"""
from __future__ import annotations

import argparse
import csv
import io
import os
import re
import unicodedata
import zipfile
from decimal import Decimal, InvalidOperation
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "db" / "schema.sql"

def clean(v: str) -> str:
    return (v or "").strip()

def norm(v: str) -> str:
    v = unicodedata.normalize("NFD", v or "")
    v = "".join(c for c in v if unicodedata.category(c) != "Mn")
    return " ".join(v.upper().strip().split())

def date_iso(v: str):
    v = clean(v)
    if len(v) != 8 or v == "00000000":
        return None
    return f"{v[:4]}-{v[4:6]}-{v[6:8]}"

def money_cents(v: str):
    v = clean(v)
    if not v:
        return None
    try:
        return int(Decimal(v.replace(".","").replace(",", ".")) * 100)
    except InvalidOperation:
        return None

def phone(ddd: str, number: str):
    d = re.sub(r"\D","", clean(ddd))
    n = re.sub(r"\D","", clean(number))
    return d+n if n else None

def rows(path: Path):
    with zipfile.ZipFile(path) as zf:
        for member in zf.namelist():
            if member.endswith("/"):
                continue
            with zf.open(member) as raw:
                with io.TextIOWrapper(raw, encoding="latin-1", newline="") as text:
                    yield from csv.reader(text, delimiter=";", quotechar='"')

def assert_empty(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM companies")
        if cur.fetchone()[0] > 0:
            raise SystemExit(
                "O banco já contém empresas. Este importador não apaga nem substitui uma base existente."
            )

def apply_schema(conn):
    sql = SCHEMA.read_text(encoding="utf-8")
    with conn.cursor() as cur:
        for statement in sql.split(";"):
            statement = statement.strip()
            if statement:
                cur.execute(statement)
    conn.commit()

def copy_rows(conn, copy_sql: str, values):
    count=0
    with conn.cursor() as cur:
        with cur.copy(copy_sql) as cp:
            for row in values:
                cp.write_row(row)
                count += 1
                if count % 100000 == 0:
                    print(f"  {count:,} linhas", flush=True)
    conn.commit()
    print(f"  total: {count:,}")
    return count

def import_municipios(conn,path):
    return copy_rows(conn,
      "COPY municipalities(code,name,normalized_name) FROM STDIN",
      ((clean(r[0]),clean(r[1]),norm(r[1])) for r in rows(path) if len(r)>=2)
    )

def import_cnaes(conn,path):
    return copy_rows(conn,
      "COPY cnaes(code,label,normalized_label) FROM STDIN",
      ((clean(r[0]),clean(r[1]),norm(r[1])) for r in rows(path) if len(r)>=2)
    )

def import_qualificacoes(conn,path):
    return copy_rows(conn,
      "COPY qualifications(code,label) FROM STDIN",
      ((clean(r[0]),clean(r[1])) for r in rows(path) if len(r)>=2)
    )

def import_empresas(conn,path):
    return copy_rows(conn,
      """COPY companies(
        cnpj_base,legal_name,legal_nature_code,responsible_qualification_code,
        capital_social_cents,company_size_code,federal_entity
      ) FROM STDIN""",
      (
        (
          clean(r[0]),clean(r[1]),clean(r[2]),clean(r[3]),
          money_cents(r[4]),clean(r[5]),clean(r[6])
        )
        for r in rows(path) if len(r)>=7
      )
    )

def import_estabelecimentos(conn,path):
    def gen():
        for r in rows(path):
            if len(r)<30: continue
            base,order,dv=clean(r[0]),clean(r[1]),clean(r[2])
            yield (
              (base+order+dv).upper(),base,order,dv,clean(r[3]),clean(r[4]),clean(r[5]),
              date_iso(r[6]),clean(r[7]),date_iso(r[10]),clean(r[11]),clean(r[12]),
              clean(r[13]),clean(r[14]),clean(r[15]),clean(r[16]),clean(r[17]),
              clean(r[18]),clean(r[19]).upper(),clean(r[20]),
              phone(r[21],r[22]),phone(r[23],r[24]),phone(r[25],r[26]),
              clean(r[27]).lower(),clean(r[28]),date_iso(r[29])
            )
    return copy_rows(conn,
      """COPY establishments(
        cnpj,cnpj_base,order_no,dv,matrix_branch_code,trade_name,status_code,status_date,
        status_reason_code,opening_date,main_cnae,secondary_cnaes,street_type,street,number,
        complement,neighborhood,postal_code,state,municipality_code,phone1,phone2,fax,email,
        special_status,special_status_date
      ) FROM STDIN""",
      gen()
    )

def import_socios(conn,path):
    return copy_rows(conn,
      """COPY partners(
        cnpj_base,partner_type_code,name,document_masked,qualification_code,entry_date,
        country_code,legal_rep_document,legal_rep_name,legal_rep_qualification_code,age_range_code
      ) FROM STDIN""",
      (
        (
          clean(r[0]),clean(r[1]),clean(r[2]),clean(r[3]),clean(r[4]),date_iso(r[5]),
          clean(r[6]),clean(r[7]),clean(r[8]),clean(r[9]),clean(r[10])
        )
        for r in rows(path) if len(r)>=11
      )
    )

def import_simples(conn,path):
    return copy_rows(conn,
      """COPY simple_tax(
        cnpj_base,simple_option,simple_start_date,simple_end_date,
        mei_option,mei_start_date,mei_end_date
      ) FROM STDIN""",
      (
        (
          clean(r[0]),clean(r[1]),date_iso(r[2]),date_iso(r[3]),
          clean(r[4]),date_iso(r[5]),date_iso(r[6])
        )
        for r in rows(path) if len(r)>=7
      )
    )

IMPORTERS = [
  ("Municipios", import_municipios),
  ("Cnaes", import_cnaes),
  ("Qualificacoes", import_qualificacoes),
  ("Empresas", import_empresas),
  ("Estabelecimentos", import_estabelecimentos),
  ("Socios", import_socios),
  ("Simples", import_simples),
]

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    ap.add_argument("--input", required=True)
    ap.add_argument("--reference", default="")
    args=ap.parse_args()

    if not args.database_url:
        raise SystemExit("Informe --database-url ou DATABASE_URL.")

    folder=Path(args.input).expanduser().resolve()
    if not folder.is_dir():
        raise SystemExit(f"Pasta não encontrada: {folder}")

    zips=sorted(folder.glob("*.zip"))
    if not zips:
        raise SystemExit("Nenhum ZIP encontrado.")

    with psycopg.connect(args.database_url) as conn:
        apply_schema(conn)
        assert_empty(conn)

        processed=0
        for prefix, importer in IMPORTERS:
            matches=[p for p in zips if p.name.lower().startswith(prefix.lower())]
            for path in matches:
                print(f"Importando {path.name}")
                importer(conn,path)
                processed += 1

        with conn.cursor() as cur:
            cur.execute("""
              INSERT INTO metadata(key,value)
              VALUES('dataset_mode','RFB_OPEN_DATA')
              ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value
            """)
            cur.execute("""
              INSERT INTO metadata(key,value)
              VALUES('dataset_reference',%s)
              ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value
            """,(args.reference or folder.name,))
        conn.commit()

    print(f"Concluído. ZIPs processados: {processed}")

if __name__=="__main__":
    main()
