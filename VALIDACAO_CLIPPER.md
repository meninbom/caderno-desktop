# Validação manual do gesto real do Clipper

**Concluída em 29/10/2026:** após o hotfix 0.10.3, o harness `scripts/test-clipper-handoff.mjs` terminou com exit 0 e confirmou captura real no SQLite. O usuário abriu a ação pelo menu Extensões, pois o Chromium de teste não atribuiu o atalho sugerido. O artefato local `evidence/functional/clipper-human-gesture.json` registra `passed: true`. As instruções e tentativas abaixo são históricas.

## Tentativa externa 29/10/2026

O Sky localizou a janela isolada `Fixture gesture: Google Chrome for Testing` criada pelo harness, com Chromium QA e perfil temporário. `activate_window` falhou duas vezes com o erro literal `failed to activate captured window`; a interação nativa não ocorreu. Uma tentativa anterior também foi bloqueada porque o Sky não reconheceu com segurança a URL da janela Chromium no Windows: `Computer Use has been stopped for this turn because it could not determine the current browser URL on Windows with enough confidence to enforce policy.` Resultado: BLOCKED externo, sem alegação de captura real aprovada.

O E2E automatizado HTTP testa a ponte e suas fronteiras, mas não concede `activeTab`. A tentativa com CUA não concluiu porque o Sky não reconheceu com segurança a URL da janela Chromium no Windows. Não trate `scripts/test-clipper-native-gesture.mjs` nem `npm run test:clipper` como prova do gesto real.

## Executar no perfil QA isolado

1. Rode `node scripts/test-clipper-native-gesture.mjs`. O harness cria perfis temporários separados para o Caderno e Chromium, carrega apenas `extensions/clipper`, serve uma página fixture local e imprime URL, código, nonce e caminho do sinal de conclusão. Não use seu perfil habitual do navegador.
2. Na janela Chromium QA aberta na URL fixture impressa, acione `Alt+Shift+X` pelo teclado ou botão real da extensão. Se necessário, pareie com o código e nonce apresentados na janela do Caderno QA.
3. Escolha a captura de artigo e salve. Não use DevTools, chamadas `chrome.scripting` manuais, cliente HTTP nem permissões `all_urls` para esta validação.
4. Confira na janela Caderno QA que a nota `Fixture gesture` contém “Captura pelo gesto real”, o artigo fixture e a URL de origem. Só então crie o arquivo indicado em `signal` para o harness concluir as verificações de persistência e encerrar os perfis.

## Critério

PASS somente quando a ação do usuário na UI nativa da extensão usa o `activeTab` concedido pelo Chrome e grava artigo + URL na nota do Caderno QA. Popup aberto como página, requisição HTTP separada ou teste da bridge não satisfazem o critério. Feche o harness sem sinal para registrar timeout como pendência; ele remove os dois perfis temporários no `finally`.
