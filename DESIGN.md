---
name: Pepita SaaS
description: Prospecção e acompanhamento comercial em grafite, preto e ouro.
colors:
  bg: "#08090b"
  surface: "#121417"
  border: "#2e3238"
  border-soft: "#22262b"
  text: "#f5f3ee"
  muted: "#9fa4ad"
  gold: "#f6c515"
  selected-bg: "#211d08"
  field-bg: "#191c20"
  field-border: "#383d43"
  error-bg: "#2b1416"
  error-border: "#703838"
  error-text: "#ffb3b3"
typography:
  body:
    fontFamily: 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  title:
    fontSize: "13px"
    fontWeight: 700
  label:
    fontSize: "11px"
rounded:
  field: "9px"
  control: "10px"
  card: "12px"
  panel: "14px"
  overlay: "18px"
  pill: "999px"
spacing:
  compact: "8px"
  control: "10px"
  group: "12px"
  panel: "16px"
  overlay: "18px"
components:
  button-primary:
    backgroundColor: "{colors.gold}"
    textColor: "#111"
    rounded: "{rounded.control}"
    padding: "11px 14px"
  button-ghost:
    backgroundColor: "#15181c"
    textColor: "#e4e7ea"
    rounded: "{rounded.control}"
    padding: "9px 12px"
  field:
    backgroundColor: "{colors.field-bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.field}"
    padding: "10px"
  crm-card:
    backgroundColor: "#171a1e"
    rounded: "{rounded.card}"
    padding: "10px"
---

# Design System: Pepita SaaS

## Overview

**Creative North Star: "Sala de controle comercial Pepita"**

Pepita mantém a identidade existente em grafite, preto e ouro. O chat é o núcleo da prospecção, os resultados têm superfície própria e o dossiê concentra os detalhes da empresa. O CRM prolonga esse trabalho com colunas legíveis e controles familiares, dentro da mesma navegação.

A interface é compacta, de texto primeiro, com superfícies delimitadas e ícones SVG autorais. A personagem pixel art continua como identidade no cabeçalho e apoio a estados e transições; no CRM aparece no erro de carregamento e no convite de importação dos resultados, sem ocupar os cartões operacionais.

**Key Characteristics:**
- Grafite e preto como base; ouro nas ações e seleções.
- Navegação persistente e áreas de trabalho com rolagem própria.
- Hierarquia compacta, bordas discretas e profundidade concentrada em sobreposições.
- Texto direto em português e mascote em apoio ao estado.

As referências históricas são `Pepita Front.pdf` e o DP do produto; 21st.dev e getdesign.md foram benchmarks estruturais. O registro atual deriva de `app/globals.css`, `components/pepita-app.tsx`, `components/crm-board.tsx` e `components/icons.tsx`.

## Colors

O ouro luminoso orienta ações sobre uma base quase preta; diferenças pequenas de tom e bordas separam as superfícies.

### Primary
- **Ouro Pepita:** ação principal, navegação selecionada, foco dos campos e pontos da atividade.
- **Ouro sombreado:** fundo escuro de seleção e origem de busca.

### Neutral
- **Preto de fundo:** estrutura geral.
- **Grafite de superfície:** painéis e conteúdo.
- **Cinza de borda:** contornos; a variante suave separa a estrutura.
- **Branco quente:** conteúdo principal.
- **Cinza de apoio:** descrições e contexto secundário.

Erros usam fundo vinho, borda avermelhada e texto rosa claro. Estados salvos e potencial alto usam verde; são sinais funcionais, não um segundo tema decorativo.

**The Ouro de Ação Rule.** O ouro distingue ação, seleção e foco; as superfícies de trabalho continuam escuras.

## Typography

A pilha declarada começa com Inter e continua com fontes sans-serif de interface do sistema. Não há uma família separada de display; este documento não promove o fallback de sistema a uma direção de display.

A escala é funcional, sem razão modular declarada. Boas-vindas usam (36px, linha 1.1), reduzidos a (30px) no mobile. Títulos das páginas existentes usam (30px), reduzidos a (24px). O CRM usa (26px), reduzidos a (22px); o drawer usa (18px, linha 1.25). São valores contextuais, não novos tokens globais.

Títulos de coluna e empresa convergem em (13px); nomes de empresa usam linha (1.3). Rótulos e controles secundários usam (11px). Atividades usam (12px, linha 1.48). Datas e contagens usam algarismos tabulares quando declarado. Nome secundário e localização truncam em uma linha.

## Layout

O app ocupa a viewport. No desktop a navegação lateral mede (92px) e o cabeçalho (76px). Áreas comuns de conteúdo chegam a (1200px); configuração e histórico, a (1000px). O ritmo é compacto, com (8–12px) entre itens e (16–18px) dentro de painéis maiores.

No CRM, título, contagem, estado de salvamento e criação precedem o quadro. Colunas de (286px) têm intervalo de (12px), cabeçalho de (48px) e listas com rolagem própria. A rolagem horizontal pertence ao trilho. Isso esclarece o princípio anterior de “sem overflow horizontal”: não há overflow global; a navegação horizontal local do Kanban é intencional.

Até (980px), resultados passam a uma coluna. Até (720px), a navegação vira barra inferior de (68px), o cabeçalho mede (68px), ações do CRM se reorganizam e colunas usam (82vw), com encaixe de rolagem por proximidade. O drawer lateral de até (500px) vira folha inferior com altura `min(92dvh,760px)`. Até (420px), cabeçalho, campos e rótulos recebem ajustes de densidade.

**The Rolagem Contida Rule.** O quadro pode rolar horizontalmente dentro de sua área; a estrutura do produto permanece dentro da viewport.

## Elevation & Depth

Bordas e diferenças tonais organizam o trabalho. Gradientes discretos já existem no fundo, nos resultados e em atalhos; não são proibidos. Cartões do CRM ficam sem sombra em repouso. Modais, composer e drawer usam sombras suaves. O cartão arrastado ganha borda de ouro e sombra, enquanto a posição original fica esmaecida.

Modais reutilizam `--shadow`; sombras completas e movimento ficam no sidecar.

**The Plano de Trabalho Rule.** Bordas e tom estruturam os cartões do CRM; a elevação forte acompanha uma sobreposição ou arraste.

## Shapes

Campos e controles têm curvas pequenas; cartões e painéis usam curvas intermediárias. Modais e folhas usam curvas maiores. Chips e contagens têm formato de cápsula. Bordas normalmente medem (1px); tracejados identificam espaços de criação. Ícones SVG usam traço (1.8), pontas e junções arredondadas.

## Components

### Buttons
A ação principal usa ouro e texto escuro, peso (850) e preenchimento compacto. A secundária usa grafite e borda clara, aquecida no hover. O primário desabilitado reduz opacidade a (.42). Botões do drawer têm foco visível de ouro; não existe hover global específico declarado para o primário.

### Inputs / Fields
Campos do CRM têm fundo grafite e rótulo externo. Foco muda a borda para ouro e acrescenta halo suave; o teclado também recebe contorno. Erros ficam junto ao formulário e preservam o conteúdo digitado.

### Navigation
Ícone sobre rótulo, hover escuro e seleção de ouro sobre fundo sombreado. Uma linha interna indica seleção na lateral do desktop e na base do mobile. O CRM mantém a navegação existente.

A lateral pode ser recolhida no desktop, preservando os ícones e ocultando apenas os rótulos. “Planos” aparece como destino futuro desativado, com estado visual explícito. No mobile, a navegação permanece como barra inferior.

### Authentication
O cabeçalho apresenta ações compactas de entrar e criar conta. Cadastro e entrada usam uma sobreposição focada, com a Pepita como assinatura visual, campos rotulados e mensagens junto ao formulário. Usuários autenticados veem um controle de conta no cabeçalho e gerenciam nome, plano e segurança nas Configurações. Senhas existentes nunca são exibidas; a troca solicita uma nova senha e confirmação.

### Chips
Origem manual usa cápsula neutra; origem da busca recebe ouro sombreado. Chips de potencial distinguem alto, médio e baixo por cor e texto. Chips informativos não são botões.

### Cards / Containers
Cartões separam origem e arraste, nome e localização, depois disponibilidade de telefone e contagem de comentários. Abrir e arrastar são controles distintos. Colunas mostram nome e contagem; a coluna vazia oferece “Adicionar a primeira empresa”, sem dados fictícios.

### Working drawer
Detalhes, observações e comentários compartilham o painel. A atividade usa marcadores de ouro, linha vertical e datas em português. Remoção exige confirmação explícita. O drawer fecha por Escape, contém a navegação por Tab e devolve foco ao controle anterior. Entrada dura (.22s); movimento reduzido desativa essa animação, o pulso de salvamento e o carregamento do CRM.

### Mascot and state
Pepita pixel art acompanha identidade, busca, transição para o CRM e estados vazios ou de erro existentes. O CRM carregando usa esqueletos; falha de acesso apresenta personagem, explicação e nova tentativa.

## Do's and Don'ts

### Do:
- **Do** preservar grafite, preto e ouro e a personagem pixel art existente.
- **Do** usar texto direto em português, ícones SVG e ações de criação nos vazios.
- **Do** manter a rolagem horizontal do Kanban dentro do quadro.
- **Do** conservar foco visível e redução de movimento nas interações do CRM.

### Don't:
- **Don't** substituir a identidade por uma aparência genérica de “AI SaaS”.
- **Don't** usar emojis aleatórios como ícones da interface.
- **Don't** preencher o CRM vazio com empresas ou atividades inventadas.
- **Don't** transformar o mascote em decoração repetida dentro dos cartões.
