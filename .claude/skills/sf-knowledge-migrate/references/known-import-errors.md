# Erros reais do Import Wizard já enfrentados (e como esta skill evita cada um)

Esta tabela é o histórico de incidentes reais de uma migração completa.
Todos os pontos abaixo já viraram trava automática nos scripts ou checagem
no `validate.js` — não são só "boas práticas", são bugs que já aconteceram.

| Sintoma no log do Import Wizard | Causa raiz | Como esta skill evita |
|---|---|---|
| `This value [QUESTION__c] in the header for column N cannot be mapped (check both the header and its matching FLS)` | Header do CSV com capitalização diferente da API Name real do campo (ex.: `QUESTION__c` tudo maiúsculo vs. `Question__c` real) — a correspondência de coluna no Import Wizard é **case-sensitive** | `field-mapping.md` exige confirmar o nome exato do campo via schema antes de qualquer geração de CSV; nunca supor capitalização |
| (suspeita inicial, descartada) Field-Level Security | — | Antes de investigar FLS, confirme via SOQL: `SELECT Field, PermissionsEdit FROM FieldPermissions WHERE SobjectType = 'Knowledge__kav' AND Field IN (...)`. No incidente real, o perfil já tinha `PermissionsEdit: true` — a causa verdadeira era o case mismatch acima, não FLS. Não gaste tempo em FLS antes de confirmar o header |
| `Invalid file path for the Rich Text Area field <valor>. Verify that your file is .html or .htm and that the path is relative to the CSV file path.` | Texto colocado inline num campo **Rich Text Area** (ex.: `Question__c`) — esses campos exigem referência a arquivo `.html`, mesmo para conteúdo curto de uma linha | `convert.js` sempre escreve `Question__c`/`Answer__c` como referência a arquivo (`data/article_NN_question.html`, `data/article_NN.html`), nunca inline |
| `The <caminho> graphics is missing from the Rich Text Area field. Please review your article data.` (warning, não bloqueia) | Referência de imagem com **caminho relativo** no HTML de origem (ex.: `images/pasta/arquivo.png`) em vez de URL absoluta — o caminho relativo nunca existiu fora do site de origem | **Não é bug da conversão.** Antes de investigar, confirme com `grep` no `index.html` original se a referência já estava quebrada na fonte. Se sim, é um problema de dado de origem, não de pipeline — documente e siga em frente. `validate.js` não tenta "corrigir" isso automaticamente |
| `This value [RecordType] in the header for column N cannot be mapped` | Header `RecordType` não é a API name real do campo — o campo é `RecordTypeId` | `field-mapping.md`/`convert.js` usam sempre `RecordTypeId` como header, nunca `RecordType` |
| `A lookup field value is not a lookup ID <Id>` | Id de Record Type de **18 caracteres** usado onde o Import Wizard exige o de **15** (o Id de 18 é o que normalmente se copia de qualquer registro no Salesforce) | `convert.js` valida o comprimento do `--record-type-id` recebido e se recusa a rodar se não tiver exatamente 15 caracteres; `validate.js` reconfere o mesmo no CSV final |
| (silencioso — sem nenhuma linha de erro ou warning no log) Record Type em branco nos artigos criados | Coluna `RecordTypeId` ausente do CSV — o Import Wizard **não detecta nem avisa** sobre essa ausência, só cria o registro sem o campo preenchido | `convert.js` se recusa a rodar sem `--record-type-id`; `validate.js` verifica a coluna `RecordTypeId` e que nenhuma linha está vazia antes de liberar o empacotamento |
| `validate.js` reporta "Contagem de `<img>` não bate" em artigo que tem emoji no texto original (🤖, ⚠️, etc.) | Emoji do Wiki de origem vem como `<img src="...notoemoji...">`, e `convert.js` converte isso de propósito para caractere unicode real (`convertEmojiImages`) — **não é perda de conteúdo**, é melhoria documentada. Contar essas tags como "imagem" no inventário de origem fazia a contagem convertida nunca bater | `extract-zips.js` já exclui `<img>` com `notoemoji` no `src` da contagem `images` do manifest — o inventário conta só imagens reais, comparável 1:1 com o convertido |
| `validate.js` corrompe o parsing do CSV (linhas desalinhadas) quando o `Summary` usa o template estruturado multi-linha | `validate.js` fazia `split('\n')` no arquivo inteiro **antes** de respeitar aspas — um `\n` real dentro de um campo `Summary` entre aspas (válido por RFC 4180, ver `content-authoring-rules.md`) quebrava o arquivo no meio de um registro | `validate.js` reescrito para parsear o CSV inteiro caractere a caractere, respeitando aspas através de quebras de linha reais, antes de separar em linhas/campos |

## Regra geral tirada destes incidentes

**O log do Import Wizard não é uma fonte de verdade completa.** Ele pega
erros de mapeamento de coluna e de formato de campo, mas **não pega campos
obrigatórios do seu processo de negócio que simplesmente ficaram vazios**
(como Record Type). Por isso `validate.js` roda **antes** do empacotamento
final e verifica mais do que o Import Wizard verificaria — ele é a segunda
camada de defesa, não uma duplicata do que o Wizard já faz.
