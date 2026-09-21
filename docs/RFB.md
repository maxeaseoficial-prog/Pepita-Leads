# Base CNPJ / Receita Federal

## Objetivo

A Pepita não consulta uma API comercial de CNPJ a cada busca.
Ela mantém uma cópia importada dos Dados Abertos CNPJ em PostgreSQL.

## Importação

1. Baixe os ZIPs oficiais.
2. Crie/ligue o Neon.
3. Configure `DATABASE_URL`.
4. Execute:

```bash
python3 -m venv .venv-import
source .venv-import/bin/activate
pip install -r requirements-import.txt
python scripts/import-rfb.py --input /pasta/rfb --reference "RFB 2026-09"
```

## Segurança de dados

O importador recusa prosseguir se a tabela `companies` já contém dados.

Isso evita apagar ou sobrescrever silenciosamente uma base existente.

Atualizações futuras devem usar staging/swap, não `DROP` em produção.
