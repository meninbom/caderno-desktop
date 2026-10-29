# Correção do Clipper — 29/10/2026

**Aceite final em 0.10.3:** o usuário acionou a extensão no Chrome temporário, salvou a página e o harness terminou com código 0: `PASS: captura real da extensão confirmada no SQLite`. A nota continha a frase de validação e a URL de origem. A evidência local está em `evidence/functional/clipper-human-gesture.json` (`passed: true`, perfis temporários). A restrição anterior referente ao gesto `activeTab` foi resolvida nesta rodada.

## Defeitos reproduzidos

- Fetch GET de destinos executado no contexto real da extensão retornou HTTP 403, `ORIGIN_NOT_PAIRED`, após pareamento válido. O Chromium omite `Origin` nesse GET. O cliente HTTP dos testes antigos preenchia o cabeçalho e mascarava o defeito.
- A regra CSS `section { display:grid }` sobrepunha o atributo `hidden`, deixando o formulário de pareamento visível após conectar.
- A captura persistia, mas o renderer não recebia um aviso para atualizar a lista. O teste de retorno de foco isolado não resolveu esse fluxo de forma confiável.

## Ajustes

- Destinos agora são solicitados com POST JSON pelo navegador; a ponte aceita esse método mantendo a exigência de origem pareada e Bearer. Nenhuma permissão de host adicional foi incluída na extensão distribuída.
- `[hidden]` é respeitado; salvar fica desabilitado até carregar uma página válida e seus destinos. Ausência de URL autorizada apresenta orientação legível.
- Captura concluída emite evento específico pelo preload para atualizar lista e contadores sem substituir o corpo da nota aberta.
- O harness registra comandos e respostas sem tokens, e falha imediatamente se o navegador de teste fechar.

## Evidência

- Antes do ajuste, o teste no browser falhou com 403 `ORIGIN_NOT_PAIRED`.
- Depois do ajuste: build/typecheck aprovado, 58 testes unitários aprovados e 24 verificações Clipper aprovadas. O fluxo executou handler do botão → `chrome.scripting` → fetch da extensão → ponte → SQLite → lista visível, além de repetição/deduplicação, pareamento, revogação e rejeições de segurança.
- O teste usa uma cópia temporária da extensão com permissão de host somente para a fixture loopback. Isso valida extração e transporte reais, mas não comprova o gesto nativo de concessão `activeTab`.
- Uma rodada funcional geral falhou no restart OCR com worker encerrado sem resultado (código 0), enquanto havia outros testes/build em andamento. Não há atribuição de causa comprovada. A repetição completa sem concorrência passou: 22 jornadas e 362 asserções, incluindo OCR/cancelamento/restart, autosave/caret/undo e restauração. Isso não elimina o registro da falha anterior nem prova ausência de intermitência.
- Nenhum instalador foi regenerado ou instalado nesta rodada. O NSIS 0.10.2 anterior não contém estas correções. Não houve push.
