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

## Regra do campo Summary

- Texto corrido (prosa), **não** lista de keywords, **não** duplicação do
  título.
- **Limite:** até 1000 caracteres (confirmar o limite real do campo na sua
  org — pode variar).
- **A informação mais importante do artigo deve estar nos primeiros 250
  caracteres.** Isso não é estético: é o trecho que aparece truncado em
  componentes de busca/listagem que mostram só um preview do Summary. Um
  resumo que começa com "Este artigo trata sobre..." desperdiça os 250
  caracteres mais visíveis dizendo nada.
- Boa prática: comece a frase já com o fato principal (data, valor, regra
  central, nome da política/campanha), do mesmo jeito que um lead de notícia
  não enterra a informação principal no segundo parágrafo.

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
   seguindo a regra dos 250/1000 caracteres acima.
3. Escrever a pergunta natural em `data/article_NN_question.html`
   (substituindo o placeholder), seguindo a regra de FAQ acima.
4. Nunca copiar/parafrasear o título como Summary — resuma o **conteúdo**.
