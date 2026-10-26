# Autoria de conteúdo: Summary e Question — é trabalho do agente, não de script

## Por que não existe um dicionário/heurística automática

Numa execução anterior real desta migração, `Summary` e a pergunta de FAQ de
cada artigo foram **redigidos manualmente**: o agente leu o HTML completo de
cada artigo convertido e escreveu um resumo em prosa e uma pergunta natural
específicos para aquele conteúdo. Isso funcionou bem porque exige
compreensão real do conteúdo — um resumo gerado por truncamento automático
do texto, ou por um template genérico, sai fraco ou enganoso (ex.: cortar no
meio de uma frase, ou repetir o título em vez de resumir).

**Por isso `scripts/convert.js` nunca tenta gerar Summary/Question
automaticamente.** Ele grava placeholders detectáveis
(`__TODO_SUMMARY_NAO_PREENCHIDO_PELO_AGENTE__` e
`__TODO_QUESTION_NAO_PREENCHIDO_PELO_AGENTE__`) e `validate.js` **falha** se
algum desses placeholders sobreviver até o pacote final. A etapa de autoria
é sempre feita por um agente (o subagente `kb-converter`, ou o próprio
agente da sessão) lendo o `article_NN.html` gerado — nunca por heurística de
string.

## Regra do campo Summary — template estruturado (aprovado 2026-10-26)

**Por que não é mais texto corrido**: a primeira versão desta regra pedia um
parágrafo único em prosa. Na prática, um operador de atendimento lendo isso
sob pressão (cliente na linha) tem dificuldade de escanear rapidamente onde
está o fato principal, a ação a tomar e o encaminhamento — tudo misturado em
frases longas separadas por vírgula. `Summary` é tecnicamente um **Text Area
simples** (não Rich Text — sem negrito/cor), mas **suporta múltiplas linhas
reais** (`\n`) quando exibido em páginas padrão do Salesforce (Lightning
Record Page). O CSV já lida bem com isso: um valor entre aspas com `\n`
embutido é CSV válido (RFC 4180) e o Import Wizard importa corretamente —
não foi necessário mudar `convert.js`/`csvEscape` para isso, só a convenção
de redação.

### Estrutura

```
{FATO PRINCIPAL — o quê + quando/vigência + produto/canal, até ~180 caracteres}
AÇÃO: {o que o atendente/robô faz, resumido em sequência}
ENCAMINHAR: {fila/habilidade/transferência — só se houver}
EXCEÇÃO: {o que NÃO muda / ressalva — só se houver}
```

### Regras de cada parte

1. **Linha 1 é obrigatória e sozinha** — sem rótulo, é uma frase completa com
   o fato mais importante do artigo (data/vigência, produto, canal, regra
   central). Até ~180 caracteres. **Esta linha precisa fazer sentido sozinha**,
   porque é o único trecho garantido de aparecer em qualquer preview truncado
   (busca global, Knowledge Sidebar, componentes de listagem) — contextos
   onde a quebra de linha das linhas seguintes não é preservada.
2. **Linhas com rótulo são opcionais — só entram se houver informação real.**
   Nunca force um rótulo vazio ("ENCAMINHAR: não aplicável") só para seguir o
   template; um artigo simples pode ter só a linha 1.
3. **Rótulos em maiúscula, seguidos de dois-pontos, um por linha.** Os 3
   catalogados acima (`AÇÃO`, `ENCAMINHAR`, `EXCEÇÃO`) cobrem o caso mais
   comum (fluxo operacional com transferência), mas **a lista não é
   fechada** — use o rótulo que o conteúdo pedir, com o mesmo princípio de
   objetividade. Rótulos adicionais já observados como úteis:
   - `VALOR:` — percentual, valor monetário, desconto
   - `PRAZO:` — vigência/validade quando não cabe na linha 1
   - `ELEGIBILIDADE:` — quem se qualifica / critério de inclusão
4. **Limite total continua 1000 caracteres** (confirmar o limite real do
   campo na org de destino), mas na prática um Summary bem escrito nesse
   formato fica bem abaixo disso (3-4 linhas curtas).
5. Nunca duplicar o título, nunca virar lista de keywords.

### Exemplo completo (antes → depois)

**Antes (texto corrido, difícil de escanear)**:
> A partir de 12/05/2026, novo fluxo de retenção de produtos massificados no
> canal Digital, iniciando pelo produto SPPR: o robô argumenta os
> benefícios, oferece downgrade e, se o cliente insistir, transfere para a
> empresa parceira Tech4Humans para uma última tentativa ou conclusão do
> cancelamento. Transbordos durante o horário comercial devem ser
> direcionados às habilidades W_OD_RETENC_MASSIF_CARTAO_MOT (WhatsApp) ou
> C_OD_RETENC_MASSIF_CARTAO_MOT (Chat do App); o atendimento por Voz segue
> sem alterações.

**Depois (template estruturado)**:
```
Novo fluxo de retenção de massificados no Digital (produto SPPR), vigente desde 12/05/2026.
AÇÃO: robô argumenta benefícios, oferece downgrade e, se o cliente insistir, transfere para a Tech4Humans (última tentativa ou cancelamento).
ENCAMINHAR: transbordo comercial via habilidades W_OD_RETENC_MASSIF_CARTAO_MOT (WhatsApp) ou C_OD_RETENC_MASSIF_CARTAO_MOT (Chat do App).
EXCEÇÃO: atendimento por Voz segue sem alterações.
```
Mesma informação, ~380 caracteres, mas escaneável em segundos sob pressão.

### Consumidor próprio: `knowledgeEnhanced` (LWC)

O componente de busca Knowledge na Utility Bar (projeto `CoreEvol - T4H`,
`force-app/main/default/lwc/knowledgeEnhanced/`) usa `Summary` como snippet
nos **cards de resultado** (lista) — o CSS lá (`white-space: pre-line` em
`.card-snippet`) preserva as quebras de linha deste template para o preview
curto.

Na **tela de detalhe** (quando o operador abre o artigo), o componente usa
`Summary_Enhanced__c` em vez do `Summary` plano, com fallback para o
`Summary` se o campo estiver vazio — decisão de 2026-10-26: o `Summary`
continua texto plano de propósito (é o que a busca nativa do Salesforce
indexa/mostra em preview truncado), e o `Summary_Enhanced__c` (Rich Text
Area) existe só para a leitura humana ficar genuinamente mais legível
(negrito real, lista real), sem comprometer a busca.

## `Summary_Enhanced__c` — gerado automaticamente, nunca autorado à parte

**Não escreva o conteúdo de `Summary_Enhanced__c` manualmente.** Ele é
derivado mecanicamente do `Summary` que você acabou de autorar, pelo script
`scripts/format-summary-enhanced.js`:
```bash
node .claude/skills/sf-knowledge-migrate/scripts/format-summary-enhanced.js \
  --text "<o mesmo texto que você escreveu no Summary>" \
  > <pasta-de-trabalho>/02-processados/data/article_NN_summary_enhanced.html
```
A linha 1 (fato principal) vira um parágrafo em negrito; cada linha
`LABEL: texto` vira um item de lista com o rótulo em negrito. Isso é
puramente mecânico porque o conteúdo **já foi** autorado uma vez, ao escrever
o `Summary` — gerar o HTML de novo manualmente seria trabalho duplicado e
arriscaria os dois textos divergirem com o tempo.

Se o `Summary` desviar do template estruturado (texto corrido sem o padrão
`LABEL: texto`), o script ainda funciona — trata a linha 1 como destaque e
qualquer linha adicional sem rótulo como parágrafo normal (ver código-fonte
do script para o comportamento exato).

**Lembrete de compatibilidade**: `Summary_Enhanced__c` é um campo específico
da org `CoreEvol - T4H` para o `knowledgeEnhanced` — ver a nota em
`field-mapping.md` sobre removê-lo do CSV ao migrar para uma org sem esse
campo.

## Regra do campo Question (padrão FAQ)

- **Uma pergunta em linguagem natural**, do jeito que um agente de
  atendimento ou cliente realmente perguntaria (ex.: "Como funciona o
  desconto de anuidade para clientes do Piloto de Retenção?").
- **Nunca** uma lista de palavras-chave separadas por vírgula, mesmo que a
  intenção seja melhorar a busca (foi cogitado e descartado nesta migração —
  ver racional abaixo).
- Se o campo for Rich Text Area, lembre que ele precisa ser gravado como
  arquivo (`data/article_NN_question.html`), não texto inline — ver
  `field-mapping.md`.

### Por que pergunta natural, não keyword stuffing

O par Question/Answer é o modelo padrão de um artigo tipo **FAQ** em
Salesforce Knowledge, e **costuma ser renderizado diretamente** em
componentes de FAQ (Lightning Knowledge, comunidades, Service Console, ou
qualquer componente customizado de "Perguntas Frequentes"). Uma lista de
keywords ali apareceria como texto quebrado para quem está lendo o artigo,
não só afetaria o motor de busca. Para keywords de busca, o canal correto já
é o `Summary` (informação densa nos primeiros 250 caracteres) e o `Title` —
a busca da Knowledge indexa todos os campos de texto, então um título e
resumo bem escritos já carregam peso de busca sem precisar forçar uma lista
de termos num campo que será exibido como se fosse uma pergunta real.

**Nota de transparência:** esta recomendação é baseada em conhecimento de
treinamento sobre a documentação pública do Salesforce Knowledge — não foi
possível confirmar contra a documentação oficial ao vivo no momento em que
essa decisão foi tomada (ferramentas de busca na web indisponíveis no
ambiente). Se a decisão for crítica para o seu caso, vale confirmar contra a
documentação atualizada do Salesforce antes de aplicar em escala.

## Checklist de autoria por artigo (para o subagente kb-converter)

Para cada `article_NN.html` gerado por `convert.js`:
1. Ler o conteúdo completo (não só o título).
2. Escrever o `Summary` no `import.csv` (substituindo o placeholder),
   seguindo o template estruturado (linha 1 obrigatória + linhas com rótulo
   opcionais) descrito acima — lembrar de escrever `\n` real entre as linhas
   no valor do CSV, não `\\n` escapado.
3. Escrever a pergunta natural em `data/article_NN_question.html`
   (substituindo o placeholder), seguindo a regra de FAQ acima.
4. Gerar `data/article_NN_summary_enhanced.html` a partir do mesmo `Summary`
   do passo 2, rodando `scripts/format-summary-enhanced.js` (nunca autorar
   esse conteúdo à mão — ver seção "gerado automaticamente" acima).
5. Nunca copiar/parafrasear o título como Summary — resuma o **conteúdo**.
