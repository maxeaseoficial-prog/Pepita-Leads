# Base CNPJ / Receita Federal

## Arquitetura recomendada

A Pepita usa dois bancos com responsabilidades diferentes:

- **Banco operacional**: usuários, autenticação, planos, CRM, jobs, histórico e cache.
- **Banco RFB dedicado**: empresas, estabelecimentos, sócios, municípios, CNAEs e Simples/MEI.

A aplicação lê o banco RFB por `RFB_DATABASE_URL`. Isso evita que a carga pesada da Receita concorra com o banco operacional.

## Como o cruzamento funciona

Em buscas via Google Maps, o CNPJ **não é casado apenas pelo nome**.

1. Filtrar obrigatoriamente pela **UF solicitada**.
2. Filtrar obrigatoriamente pelo **município solicitado**.
3. Dentro da cidade, comparar nome fantasia e razão social.
4. Usar telefone cadastral, CEP e número do endereço como evidências fortes.
5. Se houver mais de um candidato parecido, exigir diferença de confiança suficiente.
6. Sem correspondência confiável, manter `CNPJ não localizado` em vez de arriscar um CNPJ incorreto.
7. Com o estabelecimento confirmado, carregar os sócios pelo `cnpj_base`.

Isso permite retornar o **CNPJ do estabelecimento/filial local**, e não necessariamente o CNPJ da matriz em outra cidade.

## Schema otimizado

O schema do banco dedicado fica em `db/rfb-schema.sql`.

Ele inclui:

- índice por UF + município + situação cadastral;
- índices de telefone;
- `pg_trgm` para busca aproximada por nome fantasia e razão social;
- índice de CNPJ-base para carregar o quadro societário rapidamente.

## Configuração

```env
RFB_DATABASE_URL=postgresql://usuario:senha@host/banco?sslmode=require
RFB_DB_SCHEMA=rfb
```

O banco operacional continua usando `SUPABASE_DATABASE_URL` / `DATABASE_URL`.

## Download dos arquivos oficiais

A Pepita inclui um downloader próprio que identifica a competência mais recente publicada pela Receita:

```bash
python scripts/download-rfb.py --output /dados/rfb
```

Para fixar uma competência:

```bash
python scripts/download-rfb.py --month 2026-09 --output /dados/rfb
```

O script cria uma subpasta da competência e baixa os ZIPs em streaming.

## Importação inicial recomendada

Para iniciar com Paraná:

```bash
python3 -m venv .venv-import
source .venv-import/bin/activate
pip install -r requirements-import.txt

python scripts/import-rfb.py \
  --database-url "$RFB_DATABASE_URL" \
  --input /pasta/rfb \
  --states PR \
  --reference "RFB 2026-09"
```

Para ampliar a cobertura:

```bash
python scripts/import-rfb.py \
  --database-url "$RFB_DATABASE_URL" \
  --input /pasta/rfb \
  --states PR,SC,SP \
  --reference "RFB 2026-09"
```

Sem `--states`, o importador carrega o Brasil inteiro.

### Observação importante

Os arquivos oficiais da Receita são nacionais, não separados por UF. Mesmo numa carga somente de PR, o importador precisa ler os ZIPs nacionais de estabelecimentos para identificar os CNPJs daquele estado. O benefício é que o **banco final guarda apenas as UFs escolhidas**, reduzindo bastante o armazenamento inicial.

## Dados carregados

Para as UFs escolhidas:

- estabelecimentos;
- empresas correspondentes;
- sócios dessas empresas;
- Simples/MEI dessas empresas.

As tabelas pequenas de referência são carregadas integralmente:

- municípios;
- CNAEs;
- qualificações.

## Atualizações mensais

Não apague a base em produção durante uma atualização.

Fluxo recomendado:

1. criar um novo banco/schema de staging;
2. carregar o novo mês da Receita;
3. validar contagens e consultas conhecidas;
4. executar `ANALYZE`;
5. trocar `RFB_DATABASE_URL` para a base nova;
6. manter a base anterior temporariamente para rollback;
7. remover a base antiga depois da validação.

## Telefones

A Receita pode fornecer telefone 1, telefone 2 e e-mail cadastrados no estabelecimento.

Na Pepita esses dados ficam separados de:

- telefone público encontrado no Google Maps;
- WhatsApp encontrado no site;
- telefone de responsável, usado apenas quando houver uma fonte que associe explicitamente o número à pessoa.

O telefone cadastral pode ser do proprietário em muitos pequenos negócios, mas tecnicamente é o **telefone cadastrado do estabelecimento**.

## Fallback

Enquanto uma UF ainda não estiver carregada no banco RFB dedicado, a Pepita continua usando o resolvedor público/cache atual. A migração pode ser gradual sem interromper as buscas.
