#!/usr/bin/env python3
"""
Importador streaming dos Dados Abertos CNPJ da Receita Federal para o banco RFB da Pepita.

Uso recomendado inicial:
  python scripts/import-rfb.py \
    --database-url "$RFB_DATABASE_URL" \
    --input /pasta/rfb \
    --states PR \
    --reference "RFB 2026-09"

Sem --states, importa o Brasil inteiro.

O importador usa o schema rfb e foi pensado para banco vazio. Ele NÃO apaga
nem sobrescreve silenciosamente uma base existente.
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
from typing import Iterable, Iterator

import psycopg

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "db" / "rfb-schema.sql"


def clean(v: str) -> str:
    return (v or "").strip()


def norm(v: str) -> str:
    value = unicodedata.normalize("NFD", v or "")
    value = "".join(c for c in value if unicodedata.category(c) != "Mn")
    value = re.sub(r"[^A-Za-z0-9 ]+", " ", value.upper())
    return " ".join(value.strip().split())


def digits(v: str) -> str:
    return re.sub(r"\D", "", clean(v))


def phone(ddd: str, number: str):
    d = digits(ddd)
    n = digits(number)
    return d + n if n else None


def phone_last8(value):
    d = digits(value or "")
    return d[-8:] if len(d) >= 8 else (d or None)


def date_iso(v: str):
    value = clean(v)
    if len(value) != 8 or value == "00000000":
        return None
    return f"{value[:4]}-{value[4:6]}-{value[6:8]}"


def money_cents(v: str):
    value = clean(v)
    if not value:
        return None
    try:
        return int(Decimal(value.replace(".", "").replace(",", ".")) * 100)
    except InvalidOperation:
        return None


def rows(path: Path) -> Iterator[list[str]]:
    with zipfile.ZipFile(path) as zf:
        for member in zf.namelist():
            if member.endswith("/"):
                continue
            with zf.open(member) as raw:
                with io.TextIOWrapper(raw, encoding="latin-1", newline="") as text:
                    yield from csv.reader(text, delimiter=";", quotechar='"')


def parse_states(raw: str) -> set[str]:
    if not raw.strip():
        return set()
    states = {item.strip().upper() for item in raw.split(",") if item.strip()}
    invalid = sorted(state for state in states if not re.fullmatch(r"[A-Z]{2}", state))
    if invalid:
        raise SystemExit(f"UF inválida em --states: {', '.join(invalid)}")
    return states


def files_for(zips: list[Path], prefix: str) -> list[Path]:
    matches = [path for path in zips if path.name.lower().startswith(prefix.lower())]
    return sorted(matches)


def assert_required_files(zips: list[Path]):
    required = ["Municipios", "Cnaes", "Qualificacoes", "Empresas", "Estabelecimentos", "Socios", "Simples"]
    missing = [prefix for prefix in required if not files_for(zips, prefix)]
    if missing:
        raise SystemExit(
            "Arquivos ZIP obrigatórios não encontrados: " + ", ".join(missing)
        )


def apply_schema(conn):
    sql = SCHEMA.read_text(encoding="utf-8")
    with conn.cursor() as cur:
        for statement in sql.split(";"):
            statement = statement.strip()
            if statement:
                cur.execute(statement)
    conn.commit()


def assert_empty(conn):
    with conn.cursor() as cur:
        cur.execute("SET search_path TO rfb, public")
        cur.execute("SELECT COUNT(*) FROM companies")
        count = cur.fetchone()[0]
        if count > 0:
            raise SystemExit(
                "O banco RFB já contém empresas. Faça a nova carga em outro banco/schema "
                "e troque a conexão depois de validar; não sobrescreva produção."
            )


def copy_rows(conn, copy_sql: str, values: Iterable[tuple], label: str):
    count = 0
    with conn.cursor() as cur:
        with cur.copy(copy_sql) as cp:
            for row in values:
                cp.write_row(row)
                count += 1
                if count % 100_000 == 0:
                    print(f"  {label}: {count:,} linhas", flush=True)
    conn.commit()
    print(f"  {label} total: {count:,}", flush=True)
    return count


def collect_selected_bases(establishment_files: list[Path], states: set[str]):
    if not states:
        return None

    bases: set[str] = set()
    matched_establishments = 0

    print(f"Mapeando CNPJs-base dos estados: {', '.join(sorted(states))}", flush=True)
    for path in establishment_files:
        print(f"  lendo {path.name}", flush=True)
        for row in rows(path):
            if len(row) < 30:
                continue
            if clean(row[19]).upper() not in states:
                continue
            base = clean(row[0])
            if base:
                bases.add(base)
                matched_establishments += 1

    print(
        f"  estabelecimentos selecionados: {matched_establishments:,}; "
        f"CNPJs-base únicos: {len(bases):,}",
        flush=True,
    )
    if not bases:
        raise SystemExit("Nenhum estabelecimento encontrado para os estados informados.")
    return bases


def import_lookup_files(conn, zips: list[Path]):
    for path in files_for(zips, "Municipios"):
        print(f"Importando {path.name}", flush=True)
        copy_rows(
            conn,
            "COPY municipalities(code,name,normalized_name) FROM STDIN",
            ((clean(r[0]), clean(r[1]), norm(r[1])) for r in rows(path) if len(r) >= 2),
            "municípios",
        )

    for path in files_for(zips, "Cnaes"):
        print(f"Importando {path.name}", flush=True)
        copy_rows(
            conn,
            "COPY cnaes(code,label,normalized_label) FROM STDIN",
            ((clean(r[0]), clean(r[1]), norm(r[1])) for r in rows(path) if len(r) >= 2),
            "CNAEs",
        )

    for path in files_for(zips, "Qualificacoes"):
        print(f"Importando {path.name}", flush=True)
        copy_rows(
            conn,
            "COPY qualifications(code,label) FROM STDIN",
            ((clean(r[0]), clean(r[1])) for r in rows(path) if len(r) >= 2),
            "qualificações",
        )


def import_companies(conn, files: list[Path], selected_bases: set[str] | None):
    def gen(path: Path):
        for r in rows(path):
            if len(r) < 7:
                continue
            base = clean(r[0])
            if selected_bases is not None and base not in selected_bases:
                continue
            legal_name = clean(r[1])
            yield (
                base,
                legal_name,
                norm(legal_name),
                clean(r[2]),
                clean(r[3]),
                money_cents(r[4]),
                clean(r[5]),
                clean(r[6]),
            )

    total = 0
    for path in files:
        print(f"Importando {path.name}", flush=True)
        total += copy_rows(
            conn,
            """COPY companies(
              cnpj_base,legal_name,normalized_legal_name,legal_nature_code,
              responsible_qualification_code,capital_social_cents,
              company_size_code,federal_entity
            ) FROM STDIN""",
            gen(path),
            "empresas",
        )
    return total


def import_establishments(conn, files: list[Path], states: set[str]):
    def gen(path: Path):
        for r in rows(path):
            if len(r) < 30:
                continue
            state = clean(r[19]).upper()
            if states and state not in states:
                continue

            base, order, dv = clean(r[0]), clean(r[1]), clean(r[2])
            trade_name = clean(r[4])
            phone1 = phone(r[21], r[22])
            phone2 = phone(r[23], r[24])
            fax = phone(r[25], r[26])

            yield (
                (base + order + dv).upper(),
                base,
                order,
                dv,
                clean(r[3]),
                trade_name,
                norm(trade_name),
                clean(r[5]),
                date_iso(r[6]),
                clean(r[7]),
                date_iso(r[10]),
                clean(r[11]),
                clean(r[12]),
                clean(r[13]),
                clean(r[14]),
                clean(r[15]),
                clean(r[16]),
                clean(r[17]),
                clean(r[18]),
                state,
                clean(r[20]),
                phone1,
                phone_last8(phone1),
                phone2,
                phone_last8(phone2),
                fax,
                clean(r[27]).lower(),
                clean(r[28]),
                date_iso(r[29]),
            )

    total = 0
    for path in files:
        print(f"Importando {path.name}", flush=True)
        total += copy_rows(
            conn,
            """COPY establishments(
              cnpj,cnpj_base,order_no,dv,matrix_branch_code,trade_name,
              normalized_trade_name,status_code,status_date,status_reason_code,
              opening_date,main_cnae,secondary_cnaes,street_type,street,number,
              complement,neighborhood,postal_code,state,municipality_code,
              phone1,phone1_last8,phone2,phone2_last8,fax,email,
              special_status,special_status_date
            ) FROM STDIN""",
            gen(path),
            "estabelecimentos",
        )
    return total


def import_partners(conn, files: list[Path], selected_bases: set[str] | None):
    def gen(path: Path):
        for r in rows(path):
            if len(r) < 11:
                continue
            base = clean(r[0])
            if selected_bases is not None and base not in selected_bases:
                continue
            yield (
                base,
                clean(r[1]),
                clean(r[2]),
                clean(r[3]),
                clean(r[4]),
                date_iso(r[5]),
                clean(r[6]),
                clean(r[7]),
                clean(r[8]),
                clean(r[9]),
                clean(r[10]),
            )

    total = 0
    for path in files:
        print(f"Importando {path.name}", flush=True)
        total += copy_rows(
            conn,
            """COPY partners(
              cnpj_base,partner_type_code,name,document_masked,qualification_code,
              entry_date,country_code,legal_rep_document,legal_rep_name,
              legal_rep_qualification_code,age_range_code
            ) FROM STDIN""",
            gen(path),
            "sócios",
        )
    return total


def import_simple(conn, files: list[Path], selected_bases: set[str] | None):
    def gen(path: Path):
        for r in rows(path):
            if len(r) < 7:
                continue
            base = clean(r[0])
            if selected_bases is not None and base not in selected_bases:
                continue
            yield (
                base,
                clean(r[1]),
                date_iso(r[2]),
                date_iso(r[3]),
                clean(r[4]),
                date_iso(r[5]),
                date_iso(r[6]),
            )

    total = 0
    for path in files:
        print(f"Importando {path.name}", flush=True)
        total += copy_rows(
            conn,
            """COPY simple_tax(
              cnpj_base,simple_option,simple_start_date,simple_end_date,
              mei_option,mei_start_date,mei_end_date
            ) FROM STDIN""",
            gen(path),
            "Simples/MEI",
        )
    return total


def write_metadata(conn, reference: str, states: set[str], counts: dict[str, int]):
    with conn.cursor() as cur:
        values = {
            "dataset_mode": "RFB_OPEN_DATA",
            "dataset_reference": reference,
            "dataset_states": ",".join(sorted(states)) if states else "BR",
            "dataset_companies": str(counts["companies"]),
            "dataset_establishments": str(counts["establishments"]),
            "dataset_partners": str(counts["partners"]),
        }
        for key, value in values.items():
            cur.execute(
                """
                INSERT INTO metadata(key,value)
                VALUES(%s,%s)
                ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value
                """,
                (key, value),
            )
    conn.commit()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--database-url",
        default=os.getenv("RFB_DATABASE_URL") or os.getenv("DATABASE_URL"),
    )
    parser.add_argument("--input", required=True)
    parser.add_argument("--states", default=os.getenv("RFB_STATES", ""))
    parser.add_argument("--reference", default="")
    parser.add_argument("--skip-analyze", action="store_true")
    args = parser.parse_args()

    if not args.database_url:
        raise SystemExit("Informe --database-url ou RFB_DATABASE_URL.")

    folder = Path(args.input).expanduser().resolve()
    if not folder.is_dir():
        raise SystemExit(f"Pasta não encontrada: {folder}")

    zips = sorted(folder.glob("*.zip"))
    if not zips:
        raise SystemExit("Nenhum ZIP encontrado.")

    assert_required_files(zips)
    states = parse_states(args.states)

    with psycopg.connect(args.database_url) as conn:
        apply_schema(conn)
        with conn.cursor() as cur:
            cur.execute("SET search_path TO rfb, public")
        assert_empty(conn)

        establishment_files = files_for(zips, "Estabelecimentos")
        selected_bases = collect_selected_bases(establishment_files, states)

        import_lookup_files(conn, zips)

        counts = {
            "companies": import_companies(conn, files_for(zips, "Empresas"), selected_bases),
            "establishments": import_establishments(conn, establishment_files, states),
            "partners": import_partners(conn, files_for(zips, "Socios"), selected_bases),
            "simple": import_simple(conn, files_for(zips, "Simples"), selected_bases),
        }

        if counts["companies"] == 0 or counts["establishments"] == 0:
            raise SystemExit("Carga inválida: empresas/estabelecimentos ficaram vazios.")

        reference = args.reference or folder.name
        write_metadata(conn, reference, states, counts)

        if not args.skip_analyze:
            print("Atualizando estatísticas do PostgreSQL (ANALYZE)...", flush=True)
            with conn.cursor() as cur:
                cur.execute("ANALYZE companies")
                cur.execute("ANALYZE establishments")
                cur.execute("ANALYZE partners")
                cur.execute("ANALYZE municipalities")
            conn.commit()

    print("Carga concluída com sucesso.", flush=True)
    print(
        f"Empresas: {counts['companies']:,} | "
        f"Estabelecimentos: {counts['establishments']:,} | "
        f"Sócios: {counts['partners']:,}",
        flush=True,
    )


if __name__ == "__main__":
    main()
