# Pepita SaaS v1.0.0

Pepita agora é um **web aplicativo full-screen**, não uma extensão do Chrome.

Stack:

- Next.js 16.3.3
- React 19.2
- TypeScript
- Vercel
- Neon Postgres via Vercel Marketplace
- Dados Abertos CNPJ / Receita Federal
- Google Places opcional para website / “sem site” / Instagram via website oficial
- sem OpenAI, Claude ou qualquer LLM cloud

## O que o app faz

- chat determinístico para pedidos em linguagem natural;
- pergunta quantidade quando o usuário não informar;
- busca por nicho/CNAE e cidade/UF;
- filtros de porte, capital social e tempo de empresa;
- telefone, e-mail, matriz e potencial;
- lista de resultados em tela própria;
- dossiê de empresa com CNPJ e sócios;
- histórico local;
- exportação CSV e XLSX;
- configurações;
- interface responsiva desktop/mobile;
- status real do backend/banco.

## Importante

O projeto **não possui modo DEMO**.

Sem `SUPABASE_DATABASE_URL`/`DATABASE_URL` e sem a base RFB importada, o app mostra que a infraestrutura ainda não está pronta. Ele não inventa resultados.

## Rodar localmente

```bash
npm install
cp .env.example .env.local
npm run dev
```

Você precisa de um `SUPABASE_DATABASE_URL` ou `DATABASE_URL` PostgreSQL real.

## Deploy na Vercel

Leia `docs/VERCEL.md`.

Resumo:

1. crie o repositório `Pepita` no GitHub;
2. importe o repositório na Vercel;
3. crie o projeto no Supabase e use a conexão pelo Transaction Pooler;
4. confirme `SUPABASE_DATABASE_URL` (ou `DATABASE_URL`);
5. aplique `db/schema.sql`;
6. importe a RFB com `scripts/import-rfb.py`;
7. redeploy.

## Google Places

Opcional.

Configure apenas no servidor/Vercel:

```env
GOOGLE_PLACES_API_KEY=...
```

Nunca coloque essa chave no browser.

Sem Google Places:
- CNPJ;
- razão social;
- porte;
- capital;
- idade;
- CNAE;
- telefone;
- e-mail;
- sócios;

continuam funcionando.

Com Google Places:
- website;
- filtro “somente sem site encontrado”;
- Maps URI enriquecido;
- Instagram quando o website oficial expõe link público.

## GitHub

O arquivo `scripts/publish-github.sh` cria e faz push do repositório usando GitHub CLI em uma máquina autenticada:

```bash
./scripts/publish-github.sh Pepita maxeaseoficial-prog
```

Este pacote não contém credencial GitHub.
