# AGENTS.md

Fonte única de regras deste repositório. Qualquer agente (Claude Code ou
outro) que trabalhar aqui segue o que está escrito abaixo — não há regras
duplicadas em outro lugar, para não divergir.

## O que este repositório é

Uma **skill agêntica autônoma** que migra artigos de Knowledge Base em HTML
(exportados de um Wiki, um `.zip` por artigo) para o formato de importação
do Salesforce Knowledge (`Knowledge__kav`). Não é um projeto de aplicação —
é uma skill que um agente executa sozinho contra uma pasta de artigos de
origem, produzindo um `.zip` pronto para o Import Wizard do Salesforce.

## Onde está tudo

- **A skill em si:** `.claude/skills/sf-knowledge-migrate/SKILL.md` — ponto
  de entrada. Lá está o fluxo completo (reconhecimento → inventário →
  conversão → validação → loop de autocorreção → empacotamento).
- **Subagentes:** `.claude/agents/kb-inventory-mapper.md`,
  `kb-converter.md`, `kb-fidelity-validator.md` — cada um com
  responsabilidade única, orquestrados pelo `SKILL.md`.
- **Scripts determinísticos:** `.claude/skills/sf-knowledge-migrate/
  scripts/` — trabalho mecânico (extração, parsing de HTML, empacotamento,
  validação de contagens). Nunca fazem autoria de conteúdo.
- **Regras de negócio:** `.claude/skills/sf-knowledge-migrate/references/`
  — cada decisão de design documentada com o porquê, incluindo incidentes
  reais já enfrentados (não hipóteses).
- **Artigo de exemplo:** `.claude/skills/sf-knowledge-migrate/assets/
  example-source/` — conteúdo 100% fictício, usado para validar o pipeline
  ponta a ponta sem depender de dados reais de um cliente.

## Regras que não mudam

1. **Scripts fazem só trabalho mecânico. Autoria de conteúdo (Summary,
   Question__c) é sempre trabalho de um agente lendo o artigo de verdade** —
   nunca uma heurística de truncamento ou um dicionário fixo. Ver
   `content-authoring-rules.md`.
2. **Nunca suponha nome de campo, Record Type Id ou nome de grupo de
   categoria** — confirme contra o schema real da org antes de gerar
   qualquer CSV. Ver `field-mapping.md`.
3. **Fidelidade de conteúdo é objetiva, não subjetiva**: a contagem de
   `<img>`/`<a href>`/`<ul>` do artigo original precisa bater exatamente com
   o convertido. "Parece certo" não é validação — rodar `validate.js` é.
4. **O log do Import Wizard não é prova de que o CSV está correto** — ele
   não detecta campos obrigatórios do seu processo de negócio que ficaram
   vazios (ex.: Record Type, que falha silenciosamente). Ver
   `known-import-errors.md`.
5. **Um incidente real documentado vale mais do que uma boa prática
   genérica.** Toda regra em `references/` existe porque algo já quebrou na
   prática, não porque "parece uma boa ideia".

## Convenções

- Arquivos de skill/agente (`SKILL.md`, `.claude/agents/*.md`,
  `references/*.md`) em português — é o idioma operacional desta migração.
- Scripts em Node.js, sem dependências externas (zero `npm install`) — o
  Import Wizard roda em ambientes sem rede confiável.
- Nunca editar o conteúdo de `assets/example-source/` para conter dados
  reais de um cliente — ele existe justamente para testar sem dados reais.
