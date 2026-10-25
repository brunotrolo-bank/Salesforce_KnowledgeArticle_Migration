# Regras de parsing de HTML

## Por que profundidade de tags, não regex gulosa

A primeira abordagem usada para extrair o conteúdo de cada artigo (histórico
real desta skill, não hipotético) usava uma regex de linha única:

```js
/<div[^>]*panel-body[^>]*>(.*?)<\/div>/
```

Isso parece razoável até o painel conter **qualquer `<div>` aninhado**
(listas dentro de avisos, blocos de alerta, sub-seções) — o `.*?`
não-guloso para no **primeiro** `</div>` que encontra, que normalmente é o
fechamento de um elemento interno, não do painel inteiro. Resultado
observado em produção: um artigo com 5 seções de acordeão (Conceito, Regras,
Procedimento, Informe ao cliente, Changelog) foi convertido capturando
**só a primeira seção** — perda de ~94% do conteúdo real, incluindo todas as
listas, links e a imagem do artigo.

`scripts/convert.js` resolve isso contando profundidade de abertura/
fechamento de `<div>` a partir do ponto de abertura do painel, só considerando
o painel "fechado" quando a contagem volta a zero. Isso captura o HTML
completo do painel, não importa quantos `<div>` aninhados existam dentro.

**Essa lógica está duplicada** em `extract-zips.js` (para contar painéis do
manifest de origem) e `convert.js` (para extrair o conteúdo de verdade) —
de propósito: se as duas implementações divergirem, `validate.js` vai
detectar a divergência na contagem de painéis/tags entre manifest e
artigo convertido. Se você alterar a lógica de parsing em um lugar,
altere no outro também.

## Tags preservadas vs. removidas

**Preservado sempre** (é conteúdo real do artigo): `<p>`, `<div>`, `<ul>`,
`<ol>`, `<li>`, `<a href>`, `<img>`, `<strong>`, `<b>`, `<em>`, `<i>`,
`<table>`, `<h1>`–`<h6>`, atributos de estilo inline (`style="..."`).

**Removido sempre** (risco de segurança ou irrelevante fora do site de
origem): `<script>...</script>`, `<style>...</style>`, comentários HTML
(`<!-- ... -->`), atributos de evento (`onclick="..."`, `onload="..."` etc.).

Scripts de filtro de permissão do Wiki de origem (ex.: um script que
esconde/mostra blocos conforme permissão do usuário logado no Wiki) são
removidos automaticamente por fazerem parte de `<script>` — isso é
intencional: esse comportamento não existe nem faz sentido fora do Wiki
original.

## Título de cada painel (não confundir com o título do documento)

Cada painel de acordeão do original tem (ou não) um título próprio clicável
— isso é o que decide se ele vira um `<details class="mce-accordion">` (ver
seção de recursos ricos abaixo) ou conteúdo sequencial sem colapso. O
critério para achar esse título precisa ser robusto: numa migração real de
16 artigos, usar só `id="component-title_link"` como critério identificou
título em apenas **5 dos 16** — os outros 11 usavam o mesmo wrapper
`<h4 class="panel-title"><a ...>Título</a></h4>`, só que o `<a>` interno
tinha atributos diferentes (ex.: `data-toggle="collapse"`, sem `id`
nenhum). Resultado: 11 artigos tiveram accordions reais tratados como
"conteúdo sem título", perdendo o comportamento colapsável inteiro —
incluindo casos como um artigo com 3 accordions de topo (um deles contendo
8 sub-accordions de abas convertidas) e outro com 8 comunicados históricos,
cada um com título de data ("31/03 - Complemento").

`findPanelTitles` em `scripts/convert.js` usa `<h4 class="panel-title">`
como critério — **não** um id específico do `<a>` interno — para ser
robusto contra as duas variações observadas. Se um lote novo tiver uma
terceira variação (heading sem a classe `panel-title`, por exemplo), o
painel vai cair no caminho de "sem título" silenciosamente; revisar
`conversion-report.json` (campo `titledPanels` vs. `panels`) é a forma de
detectar isso.

## Derivação de título

O `<title>` do HTML exportado por ferramentas de Wiki costuma ser um
placeholder genérico fixo (não descreve o artigo individual). O primeiro
painel de acordeão também não serve como título sozinho — gera nomes
genéricos repetidos entre artigos diferentes ("Conceito", "Visão Geral",
"Introdução").

A fonte mais confiável observada na prática é **o nome do arquivo/pasta de
origem** (ZIP ou diretório extraído) — normalmente já é descritivo, só
precisa ser "deslugificado": remover prefixo de hash (se houver), trocar
hífens por espaços, capitalizar.

### Limitação: acentuação

Slugs de nome de arquivo tipicamente não têm acentuação (`politica` em vez
de `política`). `ACCENT_FIX` em `convert.js` é um **dicionário aberto e
vazio por padrão** — cabe a você popular com os termos recorrentes do seu
domínio à medida que aparecerem. Um termo ausente do dicionário não quebra a
conversão, só produz um título sem acento nessa palavra específica — revise
os títulos gerados (`conversion-report.json`) e ajuste o dicionário conforme
necessário, especialmente antes de reimportar um lote.

## Fallback: nenhum panel-body encontrado

Se um `index.html` não tiver nenhum `panel-body` (estrutura de origem
diferente do padrão de acordeão), `convert.js` cai no fallback de usar o
`<body>` inteiro como conteúdo único — e marca o artigo com
`fallbackUsed: true` no `conversion-report.json`. Isso **não é erro
automático**, mas merece revisão manual: pode ser um artigo legitimamente
simples (uma página sem acordeão) ou uma estrutura de origem que o parser
ainda não reconhece.

## Recursos ricos do Salesforce usados no HTML gerado

O HTML que `convert.js` escreve em `article_NN.html` usa recursos nativos
do Rich Text Area do Lightning Article Editor (TinyMCE) — não é texto
achatado. O markup abaixo foi confirmado inspecionando um artigo editado
manualmente na própria org de destino, não por suposição.

**Accordion.** Todo painel com título (ver seção acima) vira:
```html
<details open="open" class="mce-accordion" style="margin-bottom: 16px;">
  <summary style="margin-bottom: 8px;">Título do painel</summary>
  <div style="margin-top: 8px;">Conteúdo do painel...</div>
</details>
```
O `style` inline **não é decoração opcional** — sem ele, o título fica
colado no corpo e um accordion fica colado no próximo, tornando a leitura
confusa quando aberto. Painéis sem título continuam como texto corrido,
separado por `<hr/>` quando há mais de um em sequência.

**Emoji.** Se o Wiki de origem renderiza emoji como `<img>` do Google Noto
Emoji (`src` contendo `notoemoji`), `convertEmojiImages` troca a tag inteira
pelo caractere unicode real, que já vem disponível no atributo `alt`
(`alt="🤖"`). Evita depender de rede para renderizar um emoji e melhora
acessibilidade (leitor de tela lê o emoji de verdade).

**Caixa de aviso.** `<div class="alert alert-warning">` (Bootstrap, só
funciona com o CSS do Wiki de origem carregado) é convertida para um `<div>`
com `background-color` inline, reproduzindo a distinção visual sem depender
de CSS externo:
```html
<div style="background-color: #fff8e1; border-left: 4px solid #f0ad4e; padding: 10px 14px; margin: 10px 0;">
  <p style="margin: 0 0 6px 0;"><strong>Atenção!</strong></p>
  Resto do aviso...
</div>
```

**Abas.** O Salesforce RTA não tem componente de abas. `nav-pills`/
`tab-pane` do Bootstrap viram accordion nativo (mesmo objetivo funcional:
mostrar conteúdo extenso dividido em seções, uma de cada vez) — o texto do
link de navegação da aba vira o texto do `<summary>` do accordion
correspondente. Um artigo pode ter mais de um grupo de abas (ex.: "produtos
atuais" e "produtos antigos"); `convertTabsToAccordions` processa todos.

### O que não é feito automaticamente

- **Links entre artigos do próprio lote não viram SmartLink** (o formato
  real é `<a href="/articles/Knowledge/<UrlName>">`, confirmado na prática)
  — isso exigiria mapear com segurança qual link do HTML original
  corresponde a qual outro artigo do lote, e normalmente os links internos
  do original apontam para o Wiki de origem, não para os outros artigos
  migrados. Sem essa correspondência 1:1 confiável, reescrever
  automaticamente arrisca apontar para o artigo errado — os links originais
  são preservados como estavam.
- **Referências de imagem com caminho relativo já quebrado na fonte não são
  corrigidas** — se o `index.html` original já referenciava uma imagem por
  um caminho que nunca existiu fora do Wiki de origem, a conversão preserva
  essa referência tal qual. O Import Wizard sinaliza isso como aviso
  (`graphics is missing`), não como erro bloqueante.
