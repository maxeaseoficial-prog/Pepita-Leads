# Stripe na Pepita

A estrutura de billing já está preparada, mas nenhuma cobrança é ativada sem as variáveis da Stripe.

## Variáveis

Configure na Vercel:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_BASIC`
- `STRIPE_PRICE_UNLIMITED`

Use Price IDs recorrentes mensais criados no painel da Stripe.

## Banco

Execute a migration:

`supabase/migrations/20260923013000_create_billing_subscriptions.sql`

## Endpoints preparados

- `POST /api/billing/checkout` — cria Checkout Session para Basic ou Unlimited.
- `GET /api/billing/status` — retorna plano/status do usuário autenticado.
- `POST /api/billing/portal` — abre o Stripe Customer Portal quando já existir customer.
- `POST /api/billing/webhook` — recebe eventos da Stripe e sincroniza a assinatura no banco.

## Webhook

Cadastre na Stripe:

`https://SEU-DOMINIO/api/billing/webhook`

Eventos esperados:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

## Estado atual

Os botões de plano continuam sem cobrança ativa na interface. A camada de servidor está pronta para ser ligada aos botões depois que as chaves, Price IDs, migration e webhook estiverem configurados.
