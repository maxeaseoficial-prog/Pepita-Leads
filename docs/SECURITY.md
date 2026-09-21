# Segurança

## Segredos

Nunca enviar ao browser:

- `DATABASE_URL`
- `GOOGLE_PLACES_API_KEY`
- senhas
- Service Role
- tokens administrativos

Todas essas variáveis ficam em Environment Variables da Vercel.

## Browser

O browser chama apenas rotas same-origin:

```text
/api/health
/api/search
/api/companies/:cnpj
/api/niches
```

## Banco

Queries dinâmicas usam parâmetros `$1`, `$2`, etc. via driver Neon.

## Dados

A ausência de campo nunca vira inferência.

Exemplos:
- sem e-mail na base → `Não informado`;
- Google Places sem website → `Não encontrado`;
- Instagram só aparece quando um link é encontrado no website oficial.

## Conta/licença

O MVP não possui autenticação.

Antes de venda:
- login;
- sessão server-side;
- rate limit por conta/plano;
- billing;
- política de privacidade;
- LGPD;
- auditoria de acesso;
- proteção de endpoints administrativos.
