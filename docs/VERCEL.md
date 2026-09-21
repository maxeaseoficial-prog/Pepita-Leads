# Deploy na Vercel

## Arquitetura

```text
Browser
  ↓
Next.js na Vercel
  ↓
Route Handlers /api/*
  ↓
Neon Postgres
  ↓
Base CNPJ / Receita
```

Google Places é opcional e chamado somente do servidor.

## 1. GitHub

Crie um repositório `Pepita` ou use:

```bash
./scripts/publish-github.sh Pepita maxeaseoficial-prog
```

O script requer:
- GitHub CLI (`gh`);
- `gh auth login` concluído.

## 2. Vercel

Na Vercel:

1. Add New > Project
2. Import Git Repository
3. selecione `Pepita`
4. Framework Preset: Next.js
5. Deploy

O primeiro deploy pode mostrar “CONFIGURAR” até o banco estar pronto.

## 3. Banco Neon

No projeto da Vercel:

1. Storage / Marketplace
2. adicione **Neon**
3. crie um Postgres novo ou conecte uma conta existente
4. confirme que `DATABASE_URL` foi injetado no projeto
5. redeploy

## 4. Schema

Abra o SQL editor do banco e execute:

`db/schema.sql`

ou use um cliente PostgreSQL.

## 5. Dados reais da Receita

Baixe os ZIPs oficiais de Dados Abertos CNPJ para uma máquina de importação.

Não execute a importação nacional como request HTTP da Vercel.

Na máquina:

```bash
python3 -m venv .venv-import
source .venv-import/bin/activate
pip install -r requirements-import.txt

export DATABASE_URL='postgresql://...'
python scripts/import-rfb.py \
  --input /caminho/para/zips-rfb \
  --reference 'RFB AAAA-MM'
```

O importador:
- trabalha em streaming;
- não apaga uma base existente;
- recusa importar se `companies` já possuir dados;
- marca o dataset como `RFB_OPEN_DATA` ao concluir.

## 6. Google Places opcional

Em Vercel > Settings > Environment Variables:

```text
GOOGLE_PLACES_API_KEY
```

Depois redeploy.

Sem essa variável, os filtros de site/Instagram ficam desabilitados na UI.

## 7. Verificação

Abra:

```text
https://seu-dominio.vercel.app/api/health
```

Pronto para uso real:

```json
{
  "ok": true,
  "ready": true,
  "database": "connected",
  "datasetMode": "RFB_OPEN_DATA"
}
```

## 8. Domínio

Depois do deploy estável, adicione domínio próprio na Vercel.

Exemplos:

- app.pepita.com.br
- pepita.com.br

Não é necessário um domínio separado para API porque os Route Handlers usam o mesmo origin.
