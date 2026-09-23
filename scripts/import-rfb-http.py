#!/usr/bin/env python3
"""
Importa Dados Abertos CNPJ/RFB para o Supabase Pepita-RFB via Edge Function
protegida por GitHub Actions OIDC.

Uso (dentro do GitHub Actions):
  python scripts/import-rfb-http.py \
    --input /pasta/rfb/2026-09 \
    --states PR \
    --endpoint https://<project>.supabase.co/functions/v1/rfb-ingest \
    --reference "RFB 2026-09" \
    --skip-simple

O processo é idempotente: empresas/estabelecimentos fazem upsert e sócios têm
índice natural único, então um retry do workflow não duplica os dados.
"""
from __future__ import annotations

import argparse
import base64
import csv
import io
import json
import os
import re
import time
import unicodedata
import urllib.parse
import urllib.request
import zipfile
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Iterable, Iterator


def clean(value: str) -> str:
    return (value or "").strip()


def norm(value: str) -> str:
    value = unicodedata.normalize("NFD", value or "")
    value = "".join(c for c in value if unicodedata.category(c) != "Mn")
    value = re.sub(r"[^A-Za-z0-9 ]+", " ", value.upper())
    return " ".join(value.strip().split())


def digits(value: str | None) -> str:
    return re.sub(r"\D", "", clean(value or ""))


def phone(ddd: str, number: str):
    d = digits(ddd)
    n = digits(number)
    return d + n if n else None


def phone_last8(value: str | None):
    d = digits(value)
    return d[-8:] if len(d) >= 8 else (d or None)


def date_iso(value: str):
    value = clean(value)
    if len(value) != 8 or value == "00000000":
        return None
    return f"{value[:4]}-{value[4:6]}-{value[6:8]}"


def money_cents(value: str):
    value = clean(value)
    if not value:
        return None
    try:
        return int(Decimal(value.replace(".", "").replace(",", ".")) * 100)
    except InvalidOperation:
        return None


def rows(path: Path) -> Iterator[list[str]]:
    with zipfile.ZipFile(path) as archive:
        for member in archive.namelist():
            if member.endswith("/"):
                continue
            with archive.open(member) as raw:
                with io.TextIOWrapper(raw, encoding="latin-1", newline="") as text:
                    yield from csv.reader(text, delimiter=";", quotechar='"')


def files_for(zips: list[Path], prefix: str) -> list[Path]:
    return sorted(path for path in zips if path.name.lower().startswith(prefix.lower()))


def parse_states(raw: str) -> set[str]:
    states = {item.strip().upper() for item in raw.split(",") if item.strip()}
    invalid = sorted(state for state in states if not re.fullmatch(r"[A-Z]{2}", state))
    if invalid:
        raise SystemExit("UF inválida: " + ", ".join(invalid))
    if not states:
        raise SystemExit("Informe ao menos uma UF em --states.")
    return states


class GitHubOidcClient:
    def __init__(self, endpoint: str, audience: str = "pepita-rfb-import"):
        self.endpoint = endpoint
        self.audience = audience
        self._token: str | None = None
        self._token_exp = 0.0

    def _decode_exp(self, token: str) -> float:
        try:
            part = token.split(".")[1]
            part += "=" * (-len(part) % 4)
            payload = json.loads(base64.urlsafe_b64decode(part.encode()))
            return float(payload.get("exp") or 0)
        except Exception:
            return 0

    def _refresh(self):
        request_url = os.getenv("ACTIONS_ID_TOKEN_REQUEST_URL")
        request_token = os.getenv("ACTIONS_ID_TOKEN_REQUEST_TOKEN")
        if not request_url or not request_token:
            raise RuntimeError("GitHub OIDC não está disponível neste ambiente.")

        separator = "&" if "?" in request_url else "?"
        url = request_url + separator + "audience=" + urllib.parse.quote(self.audience)
        req = urllib.request.Request(
            url,
            headers={
                "Authorization": "Bearer " + request_token,
                "Accept": "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=30) as response:
            body = json.loads(response.read().decode())
        token = body.get("value")
        if not token:
            raise RuntimeError("GitHub não retornou um token OIDC.")
        self._token = token
        self._token_exp = self._decode_exp(token)

    def token(self):
        if not self._token or self._token_exp - time.time() < 90:
            self._refresh()
        return self._token

    def post(self, payload: dict, retry=True):
        data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        req = urllib.request.Request(
            self.endpoint,
            data=data,
            method="POST",
            headers={
                "Authorization": "Bearer " + self.token(),
                "Content-Type": "application/json",
                "User-Agent": "Pepita-RFB-GitHubImporter/1.0",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as response:
                raw = response.read().decode("utf-8", errors="replace")
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            if error.code == 401 and retry:
                self._token = None
                self._token_exp = 0
                return self.post(payload, retry=False)
            raise RuntimeError(f"HTTP {error.code}: {body[:1000]}") from error


def send_batches(
    client: GitHubOidcClient,
    table: str,
    values: Iterable[dict],
    batch_size: int,
    progress_label: str,
):
    batch: list[dict] = []
    total = 0
    started = time.time()

    for value in values:
        batch.append(value)
        if len(batch) < batch_size:
            continue
        client.post({"op": "ingest", "table": table, "rows": batch})
        total += len(batch)
        batch.clear()
        if total % max(batch_size * 10, 5000) == 0:
            elapsed = max(time.time() - started, 1)
            print(
                f"  {progress_label}: {total:,} ({total / elapsed:,.0f} linhas/s)",
                flush=True,
            )

    if batch:
        client.post({"op": "ingest", "table": table, "rows": batch})
        total += len(batch)

    elapsed = max(time.time() - started, 1)
    print(
        f"  {progress_label} total: {total:,} em {elapsed / 60:.1f} min",
        flush=True,
    )
    return total


def import_lookups(client, zips, batch_size):
    totals = {}

    for path in files_for(zips, "Municipios"):
        print("Importando", path.name, flush=True)
        totals["municipalities"] = send_batches(
            client,
            "municipalities",
            (
                {"code": clean(r[0]), "name": clean(r[1]), "normalized_name": norm(r[1])}
                for r in rows(path)
                if len(r) >= 2
            ),
            batch_size,
            "municípios",
        )

    for path in files_for(zips, "Cnaes"):
        print("Importando", path.name, flush=True)
        totals["cnaes"] = send_batches(
            client,
            "cnaes",
            (
                {"code": clean(r[0]), "label": clean(r[1]), "normalized_label": norm(r[1])}
                for r in rows(path)
                if len(r) >= 2
            ),
            batch_size,
            "CNAEs",
        )

    for path in files_for(zips, "Qualificacoes"):
        print("Importando", path.name, flush=True)
        totals["qualifications"] = send_batches(
            client,
            "qualifications",
            (
                {"code": clean(r[0]), "label": clean(r[1])}
                for r in rows(path)
                if len(r) >= 2
            ),
            batch_size,
            "qualificações",
        )

    return totals


def import_establishments(client, files, states, batch_size):
    selected_bases: set[str] = set()

    def gen():
        for path in files:
            print("Lendo/importando", path.name, flush=True)
            for r in rows(path):
                if len(r) < 30:
                    continue
                state = clean(r[19]).upper()
                if state not in states:
                    continue

                base, order, dv = clean(r[0]), clean(r[1]), clean(r[2])
                if not base:
                    continue
                selected_bases.add(base)

                trade_name = clean(r[4])
                phone1 = phone(r[21], r[22])
                phone2 = phone(r[23], r[24])
                fax = phone(r[25], r[26])

                yield {
                    "cnpj": (base + order + dv).upper(),
                    "cnpj_base": base,
                    "order_no": order,
                    "dv": dv,
                    "matrix_branch_code": clean(r[3]),
                    "trade_name": trade_name or None,
                    "normalized_trade_name": norm(trade_name),
                    "status_code": clean(r[5]),
                    "status_date": date_iso(r[6]),
                    "status_reason_code": clean(r[7]),
                    "opening_date": date_iso(r[10]),
                    "main_cnae": clean(r[11]),
                    "secondary_cnaes": clean(r[12]),
                    "street_type": clean(r[13]),
                    "street": clean(r[14]),
                    "number": clean(r[15]),
                    "complement": clean(r[16]),
                    "neighborhood": clean(r[17]),
                    "postal_code": clean(r[18]),
                    "state": state,
                    "municipality_code": clean(r[20]),
                    "phone1": phone1,
                    "phone1_last8": phone_last8(phone1),
                    "phone2": phone2,
                    "phone2_last8": phone_last8(phone2),
                    "fax": fax,
                    "email": clean(r[27]).lower() or None,
                    "special_status": clean(r[28]),
                    "special_status_date": date_iso(r[29]),
                }

    total = send_batches(
        client,
        "establishments",
        gen(),
        batch_size,
        "estabelecimentos",
    )
    print(f"CNPJs-base selecionados: {len(selected_bases):,}", flush=True)
    return total, selected_bases


def import_companies(client, files, selected_bases, batch_size):
    def gen():
        for path in files:
            print("Lendo/importando", path.name, flush=True)
            for r in rows(path):
                if len(r) < 7:
                    continue
                base = clean(r[0])
                if base not in selected_bases:
                    continue
                legal = clean(r[1])
                yield {
                    "cnpj_base": base,
                    "legal_name": legal,
                    "normalized_legal_name": norm(legal),
                    "legal_nature_code": clean(r[2]),
                    "responsible_qualification_code": clean(r[3]),
                    "capital_social_cents": money_cents(r[4]),
                    "company_size_code": clean(r[5]),
                    "federal_entity": clean(r[6]),
                }

    return send_batches(client, "companies", gen(), batch_size, "empresas")


def import_partners(client, files, selected_bases, batch_size):
    def gen():
        for path in files:
            print("Lendo/importando", path.name, flush=True)
            for r in rows(path):
                if len(r) < 11:
                    continue
                base = clean(r[0])
                if base not in selected_bases:
                    continue
                yield {
                    "cnpj_base": base,
                    "partner_type_code": clean(r[1]),
                    "name": clean(r[2]),
                    "document_masked": clean(r[3]),
                    "qualification_code": clean(r[4]),
                    "entry_date": date_iso(r[5]),
                    "country_code": clean(r[6]),
                    "legal_rep_document": clean(r[7]),
                    "legal_rep_name": clean(r[8]),
                    "legal_rep_qualification_code": clean(r[9]),
                    "age_range_code": clean(r[10]),
                }

    return send_batches(client, "partners", gen(), batch_size, "sócios")


def import_simple(client, files, selected_bases, batch_size):
    def gen():
        for path in files:
            print("Lendo/importando", path.name, flush=True)
            for r in rows(path):
                if len(r) < 7:
                    continue
                base = clean(r[0])
                if base not in selected_bases:
                    continue
                yield {
                    "cnpj_base": base,
                    "simple_option": clean(r[1]),
                    "simple_start_date": date_iso(r[2]),
                    "simple_end_date": date_iso(r[3]),
                    "mei_option": clean(r[4]),
                    "mei_start_date": date_iso(r[5]),
                    "mei_end_date": date_iso(r[6]),
                }

    return send_batches(client, "simple_tax", gen(), batch_size, "Simples/MEI")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--states", required=True)
    parser.add_argument("--endpoint", required=True)
    parser.add_argument("--reference", required=True)
    parser.add_argument("--batch-size", type=int, default=600)
    parser.add_argument("--skip-simple", action="store_true")
    args = parser.parse_args()

    folder = Path(args.input).expanduser().resolve()
    if not folder.is_dir():
        raise SystemExit(f"Pasta não encontrada: {folder}")

    zips = sorted(folder.glob("*.zip"))
    if not zips:
        raise SystemExit("Nenhum ZIP encontrado.")

    states = parse_states(args.states)
    required = ["Municipios", "Cnaes", "Qualificacoes", "Empresas", "Estabelecimentos", "Socios"]
    missing = [prefix for prefix in required if not files_for(zips, prefix)]
    if missing:
        raise SystemExit("ZIPs ausentes: " + ", ".join(missing))

    client = GitHubOidcClient(args.endpoint)
    before = client.post({"op": "status"})
    print("Status inicial:", json.dumps(before, ensure_ascii=False), flush=True)

    lookup_counts = import_lookups(client, zips, args.batch_size)

    establishments, selected_bases = import_establishments(
        client,
        files_for(zips, "Estabelecimentos"),
        states,
        args.batch_size,
    )
    companies = import_companies(
        client,
        files_for(zips, "Empresas"),
        selected_bases,
        args.batch_size,
    )
    partners = import_partners(
        client,
        files_for(zips, "Socios"),
        selected_bases,
        args.batch_size,
    )

    simple = 0
    if not args.skip_simple:
        simple = import_simple(
            client,
            files_for(zips, "Simples"),
            selected_bases,
            args.batch_size,
        )

    metadata = [
        {"key": "dataset_mode", "value": "RFB_OPEN_DATA"},
        {"key": "dataset_reference", "value": args.reference},
        {"key": "dataset_states", "value": ",".join(sorted(states))},
        {"key": "dataset_companies", "value": str(companies)},
        {"key": "dataset_establishments", "value": str(establishments)},
        {"key": "dataset_partners", "value": str(partners)},
        {"key": "dataset_simple", "value": str(simple)},
    ]
    client.post({"op": "ingest", "table": "metadata", "rows": metadata})
    client.post({"op": "analyze"})

    after = client.post({"op": "status"})
    print("Status final:", json.dumps(after, ensure_ascii=False), flush=True)
    print(
        json.dumps(
            {
                "states": sorted(states),
                "companies": companies,
                "establishments": establishments,
                "partners": partners,
                "simple": simple,
                **lookup_counts,
            },
            ensure_ascii=False,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
