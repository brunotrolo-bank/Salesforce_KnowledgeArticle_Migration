# Mapeamento de campos — Knowledge__kav

**Regra de ouro: nunca suponha o nome de um campo ou Record Type Id. Confirme
sempre via schema real da org antes de gerar ou alterar o CSV.**

Use um destes caminhos (o que estiver disponível no seu ambiente):
- MCP de leitura Salesforce: `getObjectSchema` para `Knowledge__kav`.
- SOQL direto: `SELECT Id, Name, DeveloperName FROM RecordType WHERE SObjectType = 'Knowledge__kav'`.
- Setup > Object Manager > Knowledge > Fields & Relationships (ver a lista
  completa de campos com API Name exato, incluindo capitalização) e
  Setup > Object Manager > Knowledge > Record Types (para o Id).

## Colunas obrigatórias do CSV de importação

| Coluna CSV | Campo real (típico) | Tipo | Regra |
|---|---|---|---|
| `Title` | `Title` | Text(255) | Título do artigo |
| `Summary` | `Summary` | Text Area (até 1000) | Texto **inline** no CSV. Ver `content-authoring-rules.md` |
| `URLName` | `UrlName` | Text(255) | Slug único — é a chave usada pelo Import Wizard para fazer UPDATE em reimportações (mesmo `URLName` = atualiza, não duplica) |
| `RecordTypeId` | `RecordTypeId` | Reference | **Obrigatório, Id de 15 caracteres.** Ver seções abaixo |
| `datacategorygroup.<NomeDoGrupo>` | Categoria de dados | — | Nome do grupo de categoria de dados específico da sua org (ex.: `datacategorygroup.PortoBank`) |
| `channels` | — | — | Canais de publicação (ex.: `application+sites`) |
| `Question__c` (ou campo equivalente de pergunta) | Rich Text Area | Ver regra de Rich Text abaixo |
| `Answer__c` (ou campo equivalente de resposta) | Rich Text Area | Ver regra de Rich Text abaixo |

Os nomes exatos de `Question__c`/`Answer__c` (ou quaisquer campos customizados
equivalentes) **variam por org** — o que não varia são as regras de formato
abaixo.

## Regra de tipo: Text Area vs. Rich Text Area

- **Text Area simples** (como `Summary`) aceita **valor inline** no CSV —
  escreva o texto direto entre aspas na célula.
- **Rich Text Area** (como `Question__c`/`Answer__c` em orgs com FAQ) **exige
  referência a um arquivo `.html` ou `.htm`** dentro do ZIP, caminho relativo
  ao CSV (ex.: `data/article_01.html`). Colocar texto inline nesses campos
  falha com:
  ```
  Invalid file path for the Rich Text Area field <valor>. Verify that your
  file is .html or .htm and that the path is relative to the CSV file path.
  ```
  Vale mesmo para um texto curto de uma linha (uma pergunta, por exemplo) —
  não há exceção por tamanho de conteúdo.

## Regra de header: API name exata, sempre

Nome de coluna tem que bater com a API name real do campo, inclusive
capitalização (`Question__c`, não `QUESTION__c`; `RecordTypeId`, não
`RecordType`). Um header fora disso falha com:
```
This value [X] in the header for column N cannot be mapped (check both the
header and its matching FLS).
```
Antes de suspeitar de FLS (permissão de campo), confirme via SOQL em
`FieldPermissions` se o perfil usado tem `PermissionsEdit: true` no campo —
na prática, toda vez que esse erro apareceu, a causa real era o nome do
header, não permissão.

## Regra de Id de lookup/reference: 15 caracteres, não 18

`RecordTypeId` precisa do Id de **15 caracteres**. O Id de 18 (o que se
copia normalmente de qualquer registro no Salesforce, com um sufixo de
checksum de 3 caracteres a mais) **falha a importação inteira**:
```
A lookup field value is not a lookup ID <Id de 18 chars>
```
O Id de 15 caracteres aparece direto na URL de Setup > Object Manager >
Knowledge > Record Types > abrir o Record Type específico — pegue os 15
primeiros caracteres do que aparece ali.

`scripts/convert.js` valida o comprimento do `--record-type-id` recebido e
se recusa a rodar se não tiver exatamente 15 caracteres.

## Coluna ausente é diferente de header errado

Diferente dos erros acima (que bloqueiam a importação e aparecem no log), a
**ausência completa** da coluna `RecordTypeId` no CSV **não gera nenhum
sinal de erro** — o Import Wizard importa normalmente e só deixa o campo
vazio nos registros criados. Por isso:
- `scripts/convert.js` **se recusa a rodar** sem `--record-type-id` explícito.
- `scripts/validate.js` verifica que a coluna existe no header **e** que
  nenhuma linha está vazia **e** que o valor tem 15 caracteres, antes de
  liberar o empacotamento final.
- Nunca confie apenas no "log de importação sem erros" como prova de que o
  CSV está completo — rode `validate.js` antes de qualquer envio ao Import
  Wizard.
