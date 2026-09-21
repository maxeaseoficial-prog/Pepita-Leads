# Arquitetura Pepita SaaS

## Frontend

Next.js App Router com uma única experiência de aplicativo:

- Chat
- Resultados
- Exportação
- Histórico
- Configurações

O chat não usa IA cloud. O parser determinístico converte pedidos comuns em filtros estruturados.

## Backend

Route Handlers:

- `GET /api/health`
- `POST /api/search`
- `GET /api/companies/:cnpj`
- `GET /api/niches?q=...`

## Banco

PostgreSQL:

- companies
- establishments
- partners
- cnaes
- municipalities
- qualifications
- simple_tax
- metadata

CNPJ é `TEXT`, inclusive para compatibilidade com formato alfanumérico.

## Fonte factual

RFB / Dados Abertos CNPJ.

O app não transforma ausência em fato:
- e-mail ausente = não informado;
- site ausente no provider = não encontrado;
- Instagram só é preenchido quando o website oficial contém link público.

## Enriquecimento

Opcional:

```text
Pepita Search
  ↓
RFB candidatos
  ↓
Google Places
  ↓
websiteUri
  ↓
website oficial
  ↓
link Instagram
```

## Score

Determinístico.

Usa:
- telefone;
- e-mail;
- idade;
- capital social;
- porte;
- matriz;
- situação ativa.

Não representa:
- faturamento;
- crédito;
- solvência;
- recomendação financeira.
