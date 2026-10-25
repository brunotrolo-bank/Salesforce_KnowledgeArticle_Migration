# Salesforce Knowledge Article Migration

Skill agêntica e autônoma para migrar artigos de Knowledge Base em HTML
(exportados de um Wiki) para o formato de importação do Salesforce Knowledge.

## Uso rápido

No Claude Code, dentro deste diretório:

```
/sf-knowledge-migrate
```

Informe (ou deixe o agente perguntar):
- a pasta com os `.zip` de origem (ou use o artigo de exemplo embutido para
  testar sem dados reais — ver abaixo);
- o Record Type Id da org de destino;
- o nome do grupo de categoria de dados da org de destino.

A skill então, sozinha:
1. Extrai e mapeia 100% do conteúdo de origem (`kb-inventory-mapper`).
2. Converte preservando HTML real e autora Summary/Question lendo cada
   artigo de verdade (`kb-converter`).
3. Valida fidelidade objetivamente e se corrige em loop até passar
   (`kb-fidelity-validator`).
4. Entrega um `.zip` pronto para Setup > Knowledge > Import Articles.

## Testar sem dados reais

Esta skill vem com um artigo de exemplo 100% fictício em
`.claude/skills/sf-knowledge-migrate/assets/example-source/` — uma política
de "Garantia Estendida" de uma loja fictícia, com a mesma estrutura técnica
real (múltiplos painéis de acordeão, imagem, links, listas, script de
filtro de permissão a ser removido). Peça ao agente para rodar a migração
usando esse artigo como origem para validar o pipeline inteiro.

## Documentação completa

Todas as regras, decisões de design e incidentes reais já enfrentados estão
em:
- [`AGENTS.md`](AGENTS.md) — regras do repositório.
- [`.claude/skills/sf-knowledge-migrate/SKILL.md`](.claude/skills/sf-knowledge-migrate/SKILL.md) — fluxo completo da skill.
- [`.claude/skills/sf-knowledge-migrate/references/`](.claude/skills/sf-knowledge-migrate/references/) — mapeamento de campos, regras de parsing, autoria de conteúdo, erros conhecidos do Import Wizard.
