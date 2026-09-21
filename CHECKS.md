# Checks executados

## PASS
- JSON de package/tsconfig/vercel válido
- `scripts/import-rfb.py` compila em Python
- TypeScript dos módulos puros:
  - types
  - format
  - chat-parser
  - export
  - scoring
- TypeScript do projeto completo foi analisado com stubs temporários para React/Next/Neon: sem erros internos
- scan de segredos privados: zero ocorrências

## Não executado neste ambiente
- `npm install`
- `next build`
- deploy real Vercel
- conexão Neon real
- importação nacional RFB real

Motivo: o runtime atual não possui acesso de rede npm confiável para instalar as dependências.

Portanto o código está preparado, mas o primeiro `npm install && npm run build` deve ser executado em uma máquina/Vercel com acesso às dependências.
