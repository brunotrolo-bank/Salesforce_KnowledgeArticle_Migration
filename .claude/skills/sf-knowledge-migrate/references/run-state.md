# Estado da execução entre subagentes

Cada etapa grava um artefato em disco que a próxima etapa (ou uma repetição
da mesma etapa, no loop de autocorreção) consome. Isso permite retomar sem
reprocessar tudo, e dá ao orquestrador uma visão objetiva do progresso sem
depender de memória de conversa.

## Layout de diretórios de uma execução — OBRIGATÓRIO, 5 pastas fixas

Esta é a **única** estrutura de pastas que esta skill usa — não é uma
convenção padrão que pode ser trocada por outra interna (`01-extraido/02-
convertido/03-pacote` já existiu, foi abandonada e não deve voltar). Decisão
de 2026-10-26, depois de um projeto real já ter essa estrutura (`01-
originais`/`02-processados`/`03-exportacao`/`04-scripts`/`05-docs`) e o
orquestrador ter inventado pastas aninhadas por lote (`02-processados/<nome-
do-lote>/01-extraido/...`) por cima dela — confuso, gerou um `mv` manual
later que quase perdeu o `import.csv` já autorado (só foi recuperável porque
o `.zip` final já tinha sido empacotado antes da bagunça).

```
<pasta-de-trabalho>/            # ex.: knowledge_import/ na raiz do projeto
├── 01-originais/
│   ├── <qualquer-pasta-com-os-.zip-de-origem>/   # nome livre, definido pelo usuário
│   ├── extracted/             # saída de extract-zips.js — um subdiretório por artigo
│   └── BKP/                   # lotes anteriores arquivados aqui antes de sobrescrever (ver "Execução repetida" abaixo)
├── 02-processados/            # saída de convert.js — SEM subpasta por lote
│   ├── import.csv
│   ├── content.properties
│   └── data/
│       ├── article_NN.html
│       └── article_NN_question.html
├── 03-exportacao/
│   └── <nome-descritivo>.zip  # saída de package-zip.js
├── 04-scripts/
│   └── extract-zips.js, convert.js, validate.js, package-zip.js
│       (cópia dos scripts desta skill — mantém o projeto autocontido)
└── 05-docs/
    ├── manifest.json          # saída de extract-zips.js (inventário de origem)
    ├── conversion-report.json # saída de convert.js
    └── validation-result.json # saída de validate.js (a mais recente)
```

**Nunca** crie uma subpasta por lote/execução dentro de `02-processados` ou
`03-exportacao` (ex.: `02-processados/piloto-2026/`) — essas duas pastas são
sempre o **estado ativo mais recente**, flat. Se já existir um lote anterior
lá na hora de iniciar uma nova conversão, siga a regra de "Execução
repetida" abaixo antes de sobrescrever.

### Execução repetida (novo lote de artigos na mesma pasta de trabalho)

Como `02-processados`/`03-exportacao` são flat (sem subpasta por lote), rodar
a skill de novo para um conjunto diferente de artigos sobrescreve o lote
anterior. Antes de sobrescrever:
1. Se `02-processados/import.csv` já existe e pertence a um lote diferente
   do atual (nomes de artigo não batem com os ZIPs de origem desta
   execução), mova o conteúdo inteiro de `02-processados/` (e o `.zip`
   correspondente em `03-exportacao/`) para
   `01-originais/BKP/lote-anterior-<descrição-ou-timestamp>/` antes de
   prosseguir — nunca sobrescreva sem arquivar.
2. Se houver dúvida sobre se o lote anterior já foi importado para a org
   (logo, pode ser arquivado com segurança) ou ainda está em uso, pergunte
   ao usuário — não presuma.

## `manifest.json` (gerado por `extract-zips.js`)

```json
{
  "totalZips": 16,
  "articles": [
    { "dir": "<nome-da-pasta>", "zipFile": "<nome>.zip", "panels": 5, "images": 1, "links": 2, "lists": 11 }
  ]
}
```

## `conversion-report.json` (gerado por `convert.js`)

```json
[
  { "num": 1, "dirName": "...", "docTitle": "...", "urlName": "...", "panels": 5, "titledPanels": 5, "fallbackUsed": false, "bytes": 6218, "images": 1, "links": 2, "lists": 11 }
]
```

`titledPanels < panels` indica painéis sem título detectado — vale revisar
manualmente se é legítimo (seção sem cabeçalho clicável no original) ou se o
parser de título (`html-parsing-rules.md`, seção "Título de cada painel")
não reconheceu uma terceira variação de markup.

A ordem dos artigos em `conversion-report.json` é a mesma de `manifest.json`
(ambos ordenam os diretórios alfabeticamente) — isso é o que permite
`validate.js` comparar item `i` de um com item `i` do outro sem precisar de
um identificador compartilhado mais complexo.

## `validation-result.json` (gerado por `validate.js`)

```json
{
  "ok": false,
  "totalArtigos": 16,
  "problemas": [
    { "scope": "artigo-9", "problem": "Contagem de <img> não bate: original=1, convertido=0", "severity": "bloqueante" }
  ]
}
```

- `severity: "bloqueante"` → impede o empacotamento final, entra no loop de
  autocorreção.
- `severity: "aviso"` → não bloqueia, mas deve ser revisado manualmente antes
  de considerar a migração concluída (ex.: artigo de origem com um único
  painel — pode ser legítimo ou pode ser truncamento).

## Ciclo de retomada

Se a pasta de trabalho já existir de uma execução anterior:
- `05-docs/manifest.json` existe e é válido, e descreve o **mesmo lote**
  (mesmos ZIPs em `01-originais/`) → **não** re-extrair, a menos que o
  usuário tenha adicionado/alterado arquivos na pasta de origem (comparar
  timestamps ou perguntar ao usuário em caso de dúvida). Se descrever um
  lote **diferente**, siga a regra de "Execução repetida" acima antes de
  continuar.
- `05-docs/validation-result.json` existe com `"ok": false` → retomar direto
  no loop de autocorreção, mirando os `problemas` listados — não recomeçar
  do zero.
- `03-exportacao/<nome>.zip` existe e `05-docs/validation-result.json` mais
  recente tem `"ok": true` → a execução já está concluída; confirmar com o
  usuário antes de rodar de novo (evita reprocessamento desnecessário).
