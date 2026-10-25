# CLAUDE.md

**As regras deste repositório estão em [`AGENTS.md`](AGENTS.md). Leia-o antes
de qualquer mudança.** Fonte única, vendor-neutra — este arquivo não as
duplica, para não divergir.

## Específico do Claude Code

- **Skill invocável:** `.claude/skills/sf-knowledge-migrate/SKILL.md` está
  um nível abaixo de `skills/`, então vira o comando
  `/sf-knowledge-migrate`. Frontmatter usa `name` e `description`.
- **3 subagentes dedicados** em `.claude/agents/`: `kb-inventory-mapper`,
  `kb-converter`, `kb-fidelity-validator`. O `SKILL.md` os orquestra em
  sequência com um loop de autocorreção — não os invoque fora desse fluxo
  sem entender a ordem de dependência entre eles (inventário → conversão →
  validação).
- **Scripts:** `.claude/skills/sf-knowledge-migrate/scripts/*.js` existem
  para o agente não improvisar parsing de HTML ou empacotamento de ZIP na
  mão. Mudou o contrato de saída de algum script (formato do JSON, nomes de
  campo do CSV), atualize `references/run-state.md` e os subagentes que
  consomem esse artefato na mesma mudança.
- **Artigo de exemplo** em `assets/example-source/` é o jeito de validar a
  skill sem precisar de um ZIP real de cliente — rode o pipeline completo
  contra ele antes de confiar em qualquer mudança nos scripts.
