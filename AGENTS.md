<!-- ZHEUS:MEMORIA:INICIO -->
# Memória do projeto (mantida pelo Zheus)

Este arquivo é escrito automaticamente. Ele existe para que o trabalho
continue igual quando o motor de IA muda (Claude Code ↔ GPT Codex).
**Leia antes de agir e não recomece o que já está feito.**

## Imagens — use de verdade, não deixe espaço vazio

Este projeto tem um gerador de imagens. Ao construir telas, **gere as
imagens** em vez de usar `<div>` cinza, ícone genérico ou link quebrado:

```
node .zheus/imagem.cjs "descrição do que aparece na foto" assets/hero.png 1200x600
```

- O caminho do destino é relativo à raiz do projeto.
- O arquivo pode sair como `.jpg` mesmo se você pedir `.png` — o comando
  responde com o nome final em `"arquivo"`. **Use esse nome no HTML.**
- A imagem sai na medida exata que você pedir, e a resposta traz
  `"largura"` e `"altura"` para conferência. Não precisa abrir o arquivo.
- Descreva a cena em português, com contexto: "vitrine de loja de tênis,
  luz natural, fundo claro" rende melhor que "tênis".
- Gere uma imagem por seção que precise (hero, produtos, depoimentos).

**Cada imagem gerada é cobrada.** Depois de gerar, use o arquivo — não
substitua por foto de banco nem regere "para padronizar". Se alguma não
servir, regere só aquela, dizendo o que mudar. E se a medida atrapalhar o
layout, ajuste o CSS (`object-fit: cover`) em vez de trocar a imagem.

<!-- ZHEUS:MEMORIA:FIM -->

## Estado do CredPlus (SaaS financeiro)

Frontend completo implementado como SPA estática (sem build), consumindo a API real em `/site/credplus/api/*` (base relativa, ver `assets/js/api.js`). Todos os 16 módulos do prompt original estão implementados: autenticação, dashboard, clientes, empréstimos/parcelamento, pagamentos, financeiro, cobranças, central de atrasos, lembretes, metas, simulador, notas, relatórios, busca global e configurações.

O backend real (Node/Express + PostgreSQL) do CredPlus **não é acessível a partir deste diretório de projeto** — só o frontend publicado está aqui. Por isso quase todos os endpoints além de `/api/auth/*` ainda precisam ser criados no backend externo. A lista completa de endpoints, tabelas/migrations e regras de negócio pendentes está em `.zheus/PENDENCIAS-BACKEND.md` — leia esse arquivo antes de dizer que uma funcionalidade "não funciona": ela está pronta no frontend e só falta o endpoint correspondente no servidor.

Enquanto os endpoints reais não existem, cada tela oferece um botão "Carregar dados de demonstração" que preenche a interface com dados fictícios gerados 100% no cliente (`assets/js/demo.js`), sinalizados por uma faixa amarela fixa no topo. Isso não é persistência real e não deve ser confundido com dado de conta — é só para visualizar as telas.

Não recriar o que já existe: todo o JS vive em `assets/js/app.js` (um único arquivo, organizado em seções por IIFE que se registram em `window.CP`) — a camada de dados é a classe `Loja` (`loja`), o cliente HTTP é o objeto `api`/`requisicao()`, e os componentes de shell/modal/toast (`abrirModal`, `toast`, `renderTopbar`, `renderSidebar` etc.) também estão lá. Reaproveite essas peças ao adicionar funcionalidades em vez de recriá-las ou dividir em novos arquivos.

Notificações (sino do topbar, desktop e mobile): dropdown com título/descrição/data-hora/estado lida-não-lida, badge de não lidas, persistido via `loja.listarNotificacoes/criarNotificacao/marcarNotificacaoLida` (endpoints `GET/POST /api/notificacoes` e `PUT /api/notificacoes/:id`, ainda pendentes no backend real — ver `.zheus/PENDENCIAS-BACKEND.md`). Um ciclo client-side (`iniciarCicloNotificacoes`, a cada 60s enquanto o app está aberto) compara lembretes pendentes com `data`+`hora` já vencidas contra as notificações existentes (`origemTipo:'lembrete'`) e cria a que faltar — não há Web Push/PWA/som ainda, é só polling em memória enquanto a aba está aberta.
