# Estado da execução entre subagentes

Cada etapa grava um artefato em disco que a próxima etapa (ou uma repetição
da mesma etapa, no loop de autocorreção) consome. Isso permite retomar sem
reprocessar tudo, e dá ao orquestrador uma visão objetiva do progresso sem
depender de memória de conversa.

## Layout de diretórios de uma execução

```
<pasta-de-trabalho>/
├── 01-extraido/              # saída de extract-zips.js
│   └── manifest.json         # inventário de origem (1 entrada por artigo)
├── 02-convertido/            # saída de convert.js
│   ├── import.csv
│   ├── content.properties
│   ├── conversion-report.json
│   └── data/
│       ├── article_NN.html
│       └── article_NN_question.html
├── validation-result.json    # saída de validate.js (a mais recente)
└── 03-pacote/
    └── knowledge_import.zip  # saída de package-zip.js
```

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
- `01-extraido/manifest.json` existe e é válido → **não** re-extrair os ZIPs,
  a menos que o usuário tenha adicionado/alterado arquivos na pasta de
  origem (comparar timestamps ou perguntar ao usuário em caso de dúvida).
- `validation-result.json` existe com `"ok": false` → retomar direto no loop
  de autocorreção, mirando os `problemas` listados — não recomeçar do zero.
- `03-pacote/knowledge_import.zip` existe e `validation-result.json` mais
  recente tem `"ok": true` → a execução já está concluída; confirmar com o
  usuário antes de rodar de novo (evita reprocessamento desnecessário).
