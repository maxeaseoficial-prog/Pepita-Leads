#!/usr/bin/env python3
"""
Baixa os ZIPs oficiais dos Dados Abertos CNPJ da Receita Federal.

Exemplos:
  python scripts/download-rfb.py --output /dados/rfb
  python scripts/download-rfb.py --month 2026-09 --output /dados/rfb

Quando --month não é informado, tenta usar a competência mais recente
publicada no diretório oficial.
"""
from __future__ import annotations

import argparse
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT_URL = "https://dadosabertos.rfb.gov.br/CNPJ/dados_abertos_cnpj/"
USER_AGENT = "PepitaRFBDownloader/1.0"
MONTH_RE = re.compile(r'href=["\'](\d{4}-\d{2})/?["\']', re.I)
ZIP_RE = re.compile(r'href=["\']([^"\']+\.zip)["\']', re.I)


def fetch_text(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=45) as response:
        return response.read().decode("utf-8", errors="replace")


def latest_month() -> str:
    html = fetch_text(ROOT_URL)
    months = sorted(set(MONTH_RE.findall(html)))
    if not months:
        raise SystemExit("Não consegui identificar competências no diretório oficial da RFB.")
    return months[-1]


def list_zip_urls(month: str, include_prefixes: set[str] | None = None) -> list[str]:
    base = urllib.parse.urljoin(ROOT_URL, month.rstrip("/") + "/")
    html = fetch_text(base)
    hrefs = ZIP_RE.findall(html)

    urls = []
    seen = set()
    for href in hrefs:
        name = Path(urllib.parse.urlparse(href).path).name
        if include_prefixes and not any(
            name.lower().startswith(prefix.lower()) for prefix in include_prefixes
        ):
            continue
        url = urllib.parse.urljoin(base, href)
        if url in seen:
            continue
        seen.add(url)
        urls.append(url)

    if not urls:
        raise SystemExit(f"Nenhum ZIP encontrado para a competência {month}.")
    return sorted(urls)


def remote_size(url: str) -> int | None:
    try:
        req = urllib.request.Request(
            url,
            method="HEAD",
            headers={"User-Agent": USER_AGENT},
        )
        with urllib.request.urlopen(req, timeout=30) as response:
            raw = response.headers.get("Content-Length")
            return int(raw) if raw and raw.isdigit() else None
    except Exception:
        return None


def download(url: str, target: Path):
    expected = remote_size(url)
    if target.exists():
        size = target.stat().st_size
        if expected is None and size > 0:
            print(f"OK existente: {target.name} ({size:,} bytes)")
            return
        if expected is not None and size == expected:
            print(f"OK existente: {target.name} ({size:,} bytes)")
            return

    temp = target.with_suffix(target.suffix + ".part")
    if temp.exists():
        temp.unlink()

    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    print(f"Baixando {target.name}...", flush=True)

    with urllib.request.urlopen(req, timeout=120) as response, temp.open("wb") as out:
        total = 0
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)
            total += len(chunk)
            if total and total % (100 * 1024 * 1024) < 1024 * 1024:
                print(f"  {total / (1024**3):.2f} GiB", flush=True)

    actual = temp.stat().st_size
    if expected is not None and actual != expected:
        temp.unlink(missing_ok=True)
        raise RuntimeError(
            f"Download incompleto de {target.name}: {actual} bytes; esperado {expected}."
        )

    temp.replace(target)
    print(f"Concluído: {target.name} ({actual:,} bytes)", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--month", default="")
    parser.add_argument("--output", required=True)
    parser.add_argument(
        "--include",
        default="",
        help="Prefixos separados por vírgula, ex.: Municipios,Cnaes,Empresas",
    )
    args = parser.parse_args()

    month = args.month.strip() or latest_month()
    if not re.fullmatch(r"\d{4}-\d{2}", month):
        raise SystemExit("--month deve estar no formato YYYY-MM.")

    output = Path(args.output).expanduser().resolve() / month
    output.mkdir(parents=True, exist_ok=True)

    include_prefixes = {
        item.strip()
        for item in args.include.split(",")
        if item.strip()
    } or None
    urls = list_zip_urls(month, include_prefixes)
    print(f"Competência: {month}")
    print(f"Arquivos encontrados: {len(urls)}")
    print(f"Destino: {output}")

    failures = []
    for url in urls:
        name = Path(urllib.parse.urlparse(url).path).name
        try:
            download(url, output / name)
        except Exception as exc:
            failures.append((name, str(exc)))
            print(f"ERRO em {name}: {exc}", file=sys.stderr)

    if failures:
        print("\nFalhas:", file=sys.stderr)
        for name, error in failures:
            print(f"- {name}: {error}", file=sys.stderr)
        raise SystemExit(1)

    print("\nDownload concluído.")
    print(f"Use esta pasta no importador: {output}")


if __name__ == "__main__":
    main()
