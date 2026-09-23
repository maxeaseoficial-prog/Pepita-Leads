#!/usr/bin/env python3
"""
Baixa os ZIPs oficiais dos Dados Abertos CNPJ da Receita Federal pelo
share WebDAV público atual da RFB em arquivos.receitafederal.gov.br.

Exemplos:
  python scripts/download-rfb.py --output /dados/rfb
  python scripts/download-rfb.py --month 2026-09 --output /dados/rfb
  python scripts/download-rfb.py --output /dados/rfb \
    --include Municipios,Cnaes,Qualificacoes,Empresas,Estabelecimentos,Socios
"""
from __future__ import annotations

import argparse
import base64
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

WEBDAV_BASE = "https://arquivos.receitafederal.gov.br/public.php/webdav"
CNPJ_PATH = "Dados/Cadastros/CNPJ"
DEFAULT_SHARE_TOKEN = "gn672Ad4CF8N6TK"
USER_AGENT = "PepitaRFBDownloader/2.0"
NS = {"d": "DAV:"}
PERIOD_RE = re.compile(r"/(\d{4}-\d{2})/$")


def auth_header() -> str:
    token = os.getenv("RFB_SHARE_TOKEN") or DEFAULT_SHARE_TOKEN
    raw = base64.b64encode(f"{token}:".encode()).decode()
    return "Basic " + raw


def request(url: str, method="GET", headers=None, timeout=120):
    merged = {
        "User-Agent": USER_AGENT,
        "Authorization": auth_header(),
        **(headers or {}),
    }
    return urllib.request.urlopen(
        urllib.request.Request(url, method=method, headers=merged),
        timeout=timeout,
    )


def propfind(path: str) -> list[dict]:
    url = f"{WEBDAV_BASE}/{path.strip('/')}/"
    last_error = None

    for attempt in range(1, 6):
        try:
            with request(
                url,
                method="PROPFIND",
                headers={"Depth": "1"},
                timeout=60,
            ) as response:
                root = ET.fromstring(response.read())

            entries = []
            for resp in root.findall("d:response", NS):
                href = resp.findtext("d:href", default="", namespaces=NS)
                length_el = resp.find(".//d:getcontentlength", NS)
                size = (
                    int(length_el.text)
                    if length_el is not None and length_el.text
                    else None
                )
                entries.append({"href": urllib.parse.unquote(href), "size": size})
            return entries
        except Exception as exc:
            last_error = exc
            print(
                f"PROPFIND tentativa {attempt}/5 falhou: {exc}",
                file=sys.stderr,
                flush=True,
            )
            time.sleep(min(2**attempt, 20))

    raise RuntimeError(f"Falha ao listar {url}: {last_error}")


def latest_month() -> str:
    periods = []
    for entry in propfind(CNPJ_PATH):
        match = PERIOD_RE.search(entry["href"])
        if match:
            periods.append(match.group(1))

    if not periods:
        raise SystemExit("Nenhuma competência YYYY-MM encontrada no share da RFB.")
    return max(periods)


def list_zip_urls(month: str, include_prefixes: set[str] | None = None) -> list[dict]:
    files = []
    seen = set()

    for entry in propfind(f"{CNPJ_PATH}/{month}"):
        name = entry["href"].rstrip("/").rsplit("/", 1)[-1]
        if not name.lower().endswith(".zip"):
            continue
        if include_prefixes and not any(
            name.lower().startswith(prefix.lower()) for prefix in include_prefixes
        ):
            continue
        if name in seen:
            continue
        seen.add(name)
        files.append({"name": name, "size": entry["size"]})

    if not files:
        raise SystemExit(f"Nenhum ZIP encontrado para a competência {month}.")

    return sorted(files, key=lambda item: item["name"])


def download(month: str, name: str, target: Path, expected_size: int | None):
    if target.exists() and expected_size and target.stat().st_size == expected_size:
        print(f"OK existente: {name} ({expected_size:,} bytes)", flush=True)
        return

    for attempt in range(1, 7):
        already = target.stat().st_size if target.exists() else 0
        if expected_size and already >= expected_size:
            target.unlink(missing_ok=True)
            already = 0

        headers = {}
        mode = "wb"
        if already > 0:
            headers["Range"] = f"bytes={already}-"
            mode = "ab"

        quoted_name = urllib.parse.quote(name)
        url = f"{WEBDAV_BASE}/{CNPJ_PATH}/{month}/{quoted_name}"

        print(
            f"Baixando {name} tentativa {attempt}/6"
            + (f" a partir de {already:,} bytes" if already else ""),
            flush=True,
        )

        try:
            with request(url, headers=headers, timeout=180) as response, target.open(mode) as out:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    out.write(chunk)

            actual = target.stat().st_size
            if expected_size is None or actual == expected_size:
                print(f"Concluído: {name} ({actual:,} bytes)", flush=True)
                return

            print(
                f"Tamanho divergente em {name}: {actual:,} != {expected_size:,}",
                file=sys.stderr,
                flush=True,
            )
        except Exception as exc:
            print(
                f"Erro em {name}: {exc}",
                file=sys.stderr,
                flush=True,
            )

        time.sleep(min(2**attempt, 30))

    raise RuntimeError(f"Falha ao baixar {name} após 6 tentativas.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--month", default="")
    parser.add_argument("--output", required=True)
    parser.add_argument(
        "--include",
        default="",
        help="Prefixos separados por vírgula.",
    )
    args = parser.parse_args()

    month = args.month.strip() or latest_month()
    if not re.fullmatch(r"\d{4}-\d{2}", month):
        raise SystemExit("--month deve estar no formato YYYY-MM.")

    include_prefixes = {
        item.strip()
        for item in args.include.split(",")
        if item.strip()
    } or None

    files = list_zip_urls(month, include_prefixes)
    output = Path(args.output).expanduser().resolve() / month
    output.mkdir(parents=True, exist_ok=True)

    total = sum(item["size"] or 0 for item in files)
    print(f"Competência: {month}", flush=True)
    print(f"Arquivos selecionados: {len(files)}", flush=True)
    print(f"Tamanho esperado: {total / 1024**3:.2f} GiB", flush=True)
    print(f"Destino: {output}", flush=True)

    failures = []
    for item in files:
        try:
            download(
                month,
                item["name"],
                output / item["name"],
                item["size"],
            )
        except Exception as exc:
            failures.append((item["name"], str(exc)))
            print(f"ERRO em {item['name']}: {exc}", file=sys.stderr)

    if failures:
        print("\nFalhas:", file=sys.stderr)
        for name, error in failures:
            print(f"- {name}: {error}", file=sys.stderr)
        raise SystemExit(1)

    print("\nDownload concluído.", flush=True)
    print(f"Use esta pasta no importador: {output}", flush=True)


if __name__ == "__main__":
    main()
