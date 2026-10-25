---
name: sf-knowledge-migrate
description: >-
  Skill agêntica e autônoma para migrar artigos de Knowledge Base em HTML
  (exportados de um Wiki, um ZIP por artigo) para o formato de importação do
  Salesforce Knowledge (Knowledge__kav). Reconhece a tarefa, mapeia 100% do
  conteúdo de origem, converte preservando HTML real (nunca achata em
  markdown nem trunca painéis de acordeão), autora Summary e Question__c
  lendo cada artigo de verdade, valida fidelidade e se corrige em loop até
  passar, e entrega um .zip pronto para o Import Wizard. Orquestra 3
  subagentes (kb-inventory-mapper, kb-converter, kb-fidelity-validator) em
  sequência, com loop de autocorreção mirado no problema exato. TRIGGER
  quando o usuário pedir para migrar/converter/importar artigos de
  Knowledge Base para Salesforce, apontar uma pasta de ZIPs de Wiki, ou
  pedir para "rodar a migração de novo"/"retomar a migração". DO NOT
  TRIGGER para editar um artigo já importado na org (isso é trabalho direto
  via API/UI do Salesforce, não desta skill) nem para gerar artigos novos do
  zero (esta skill converte conteúdo EXISTENTE, não cria conteúdo original).
---

# Salesforce Knowledge Article Migration

Você **orquestra** um pipeline de 3 etapas via subagentes — não faz o
trabalho mecânico nem a autoria de conteúdo sozinho no seu próprio contexto.
Cada etapa grava um artefato em disco (`references/run-state.md` documenta o
formato exato) que a etapa seguinte consome, e que permite retomar sem
reprocessar tudo.

Diferença do padrão `apex-test-loop` (contexto único, sem subagentes): aqui
o trabalho é naturalmente paralelizável e cada etapa produz um artefato bem
definido — por isso subagentes são o desenho certo, não uma complicação
desnecessária.

## Passo 0 — reconhecimento da tarefa

1. Identifique a **pasta de origem** (contém os `.zip` de artigos) e a
   **pasta de trabalho** (onde ficam `01-extraido/`, `02-convertido/`,
   `03-pacote/` — ver `references/run-state.md`). Se o usuário não tiver uma
   origem real à mão, use `assets/example-source/` desta skill para rodar o
   pipeline de ponta a ponta com o artigo fictício embutido.
2. Confirme o **Record Type Id de 15 caracteres** (não o de 18 — ver
   `references/field-mapping.md`) e o **nome do grupo de categoria de
   dados** da org de destino. **Nunca suponha esses valores**; se não tiver
   acesso de leitura à org nesta sessão, pergunte ao usuário (ponto de
   decisão humana).
3. Verifique se já existe uma execução anterior na pasta de trabalho
   (`manifest.json`, `conversion-report.json`, `validation-result.json`) —
   se existir, retome do ponto certo em vez de recomeçar do zero (regras de
   retomada em `references/run-state.md`).

## O loop (orquestração de subagentes)

1. **Dispare `kb-inventory-mapper`** apontando a pasta de origem e a pasta
   de trabalho. Ele extrai os ZIPs e grava `01-extraido/manifest.json` com o
   inventário completo (painéis, imagens, links, listas por artigo). Não
   prossiga para a próxima etapa sem esse manifest — é a baseline de
   fidelidade de tudo que vem depois.
2. **Dispare `kb-converter`** com o caminho do manifest, a pasta extraída, o
   Record Type Id (15 caracteres) e a categoria confirmados no Passo 0. Ele
   roda `convert.js` (trabalho mecânico — que já estrutura painéis titulados
   como accordion nativo, converte abas em accordion, emoji em unicode e
   caixas de aviso em destaque com cor de fundo, ver
   `references/html-parsing-rules.md`) e depois **lê cada artigo gerado e
   escreve Summary e Question__c de verdade** (trabalho de autoria — nunca
   pule essa parte delegando para o script, que propositalmente só grava
   placeholders).
   - Lotes grandes (dezenas de artigos): pode disparar múltiplas instâncias
     de `kb-converter` em paralelo, cada uma responsável pela etapa de
     autoria de um subconjunto de artigos já convertidos mecanicamente,
     desde que cada uma edite apenas as linhas do CSV e os arquivos de
     pergunta dos artigos sob sua responsabilidade.
3. **Dispare `kb-fidelity-validator`** apontando o manifest e a pasta
   convertida. Ele roda `validate.js` e devolve uma lista de problemas
   específicos por artigo (nunca aceite um relatório genérico "deu certo"
   sem o JSON de verdade).
4. **Loop de autocorreção** — se `validate.js` reportar qualquer problema
   `bloqueante`:
   - Problema de contagem de tags (`<img>`/`<a href>`/`<ul>` não bate) →
     volte ao **Passo 2**, mirando especificamente aquele artigo — não
     reconverta o lote inteiro. Se o mesmo artigo falhar de novo na mesma
     checagem, pare: o parser (`convert.js`/`html-parsing-rules.md`) pode
     ter uma lacuna estrutural que exige ajuste de código, não só nova
     tentativa (ponto de decisão humana).
   - Summary/Question com placeholder sobrevivente → volte ao **Passo 2**,
     mirando a autoria daquele artigo específico.
   - `RecordTypeId` vazio ou com comprimento diferente de 15 caracteres no
     CSV → confirme de novo o Id com o usuário (erro de digitação, Id de 18
     passado por engano, ou valor nunca informado) e reconverta.
   - Repita o ciclo (Passo 2 → Passo 3) até `validate.js` devolver
     `"ok": true`. **Circuit-breaker:** se o mesmo artigo falhar na mesma
     checagem por 3 rodadas seguidas, pare e leve ao humano com o problema
     exato — não insista cegamente.
5. **Empacote**: rode
   ```bash
   node .claude/skills/sf-knowledge-migrate/scripts/package-zip.js \
     --source <pasta-de-trabalho>/02-convertido \
     --out <pasta-de-trabalho>/03-pacote/knowledge_import.zip
   ```
   e valide a integridade com `unzip -t`.
6. **Entregue**: caminho do `.zip` final, contagem de artigos, avisos não
   bloqueantes (ex.: imagem com caminho relativo já quebrado na fonte — ver
   `references/known-import-errors.md`), e a instrução de importação (Setup
   > Knowledge > Import Articles, selecionando o Record Type confirmado no
   Passo 0).

## Critério de conclusão

Só declare a migração concluída quando:
- `kb-fidelity-validator` devolveu `"ok": true` na rodada mais recente
  (nunca um relatório antigo);
- o `.zip` final passou em `unzip -t` sem erros;
- nenhum artigo tem Summary/Question com placeholder.

## Pontos de decisão humana (as únicas pausas legítimas)

- Pasta de origem vazia ou sem nenhum `.zip` válido.
- Record Type Id ou nome do grupo de categoria não confirmados contra a org
  real (nunca adivinhe — ver `references/field-mapping.md`).
- Mesmo artigo falhando na mesma checagem de fidelidade por 3 rodadas
  seguidas (circuit-breaker).
- Qualquer mudança de schema detectada que não bate com
  `references/field-mapping.md` (a org pode ter mudado desde a última vez
  que isso foi documentado).

Fora desses pontos, **não pause para "posso continuar?" a cada etapa** — rode
o loop até concluir ou bloquear com um motivo nomeado.

## 🚫 Nunca faça

- Nunca gere Summary/Question por heurística de script (truncar texto,
  repetir título) — é sempre trabalho de leitura/autoria real (ver
  `references/content-authoring-rules.md`).
- Nunca aceite um artigo convertido sem comparar contra o manifest de
  origem — "parece certo" não é validação.
- Nunca empacote o ZIP final com qualquer placeholder (`__TODO_...`)
  sobrevivente.
- Nunca suponha nome de campo, Record Type Id ou nome de grupo de categoria
  — confirme contra o schema real antes de gerar qualquer CSV.
- Nunca "corrija" uma imagem com caminho relativo quebrado tentando inventar
  uma URL — se já estava quebrada na fonte, documente como aviso conhecido
  (ver `references/known-import-errors.md`), não maqueie.

## Referências

- `references/field-mapping.md` — mapeamento de campos `Knowledge__kav`,
  regra Text Area vs. Rich Text Area, e o incidente de Record Type em
  branco.
- `references/html-parsing-rules.md` — por que parser por profundidade de
  tags, derivação de título, limitações conhecidas.
- `references/content-authoring-rules.md` — regras de Summary (250/1000
  caracteres) e Question__c (pergunta natural, não keywords) — e por que é
  o agente quem escreve, nunca um script.
- `references/known-import-errors.md` — tabela de erros reais do Import
  Wizard já enfrentados, causa raiz e como esta skill evita cada um.
- `references/run-state.md` — formato dos artefatos (`manifest.json`,
  `conversion-report.json`, `validation-result.json`) e regras de retomada.

## Scripts (trabalho mecânico e determinístico)

| Script | Faz | Nunca faz |
|---|---|---|
| `scripts/extract-zips.js` | Extrai ZIPs + gera `manifest.json` de inventário | Não converte nada |
| `scripts/convert.js` | Parseia HTML, deriva título/slug, gera CSV + artigos | Nunca escreve Summary/Question de verdade (só placeholder) |
| `scripts/validate.js` | Compara fidelidade, checa placeholders e RecordType | Não corrige nada sozinho — só reporta |
| `scripts/package-zip.js` | Empacota em `.zip` válido, sem dependências externas | Não valida conteúdo — só empacota |

## Artigo de exemplo (teste end-to-end sem dados reais)

`assets/example-source/00a1b2c3d4e5f60718293a4b5c6d7e8f9012345-exemplo-
politica-de-garantia-estendida/` é um artigo **fictício** (política de
Garantia Estendida de uma loja fictícia), com a mesma estrutura técnica real
que esta skill precisa suportar: 3 painéis de acordeão, 1 imagem, 2 links,
listas numeradas e não numeradas, e um script de filtro de permissão que
deve ser removido na conversão. Use-o para validar o pipeline inteiro sem
precisar de ZIPs reais de um cliente.

**Nota:** a imagem e os links usam `https://example.com/...` (domínio
reservado pela RFC 2606 para documentação/testes) de propósito — eles
**não resolvem para conteúdo real**, e não devem. O objetivo do exemplo é
provar que `convert.js` extrai e preserva corretamente a tag `<img>`/`<a
href>` (contagem bate entre original e convertido via `validate.js`), não
que a imagem carrega. Não troque por uma URL que pareça real — isso
confundiria quem olhar o exemplo depois, achando que é uma imagem quebrada
por engano.
