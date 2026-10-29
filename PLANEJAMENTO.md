# Planejamento — app desktop de anotações

## Objetivo
Criar um aplicativo de anotações para Windows inspirado nos fluxos do Evernote, com visual limpo e minimalista próximo ao T3 Code. Nome provisório: Caderno. Interface em português do Brasil. Projeto novo e independente; não reutilizar dados de outros apps.

## Arquitetura
- Electron + React + TypeScript + Vite.
- Processo principal responsável por arquivos e persistência; renderer isolado, nodeIntegration desativado, contextIsolation ativado e preload com API IPC tipada e validada.
- SQLite local com migrações, consultas parametrizadas e busca textual; anexos em diretório próprio no userData.
- Editor TipTap com documento estruturado; títulos, parágrafos, negrito, itálico, listas, checklist, links e blocos de código.
- Camada de repositório separada da interface. Adaptador de desenvolvimento web explicitamente distinto da persistência Electron.

## Direção visual
Três painéis: navegação lateral compacta, lista de notas e editor amplo. Tons neutros, divisórias discretas, tipografia legível, ícones consistentes, cor de destaque contida. Temas claro/escuro persistentes. Estados de foco, vazio, carregamento, erro e salvamento definidos. Fidelidade aos fluxos de organização do Evernote, com identidade própria.

## Etapas e critérios
1. Fundação: scripts de desenvolvimento/build, Electron seguro, banco migrável e conceito visual/documentação de tokens.
2. Fluxo principal: criar, editar, salvar automaticamente, reabrir e excluir/restaurar notas; cadernos com criação/renomeação e movimentação; etiquetas, favoritos e busca em título/corpo. Seleção e filtros coerentes após alterações. Lixeira com confirmação para exclusão definitiva.
3. Editor e produtividade: formatação rica, checklist, atalhos, ordenação, indicação confiável de salvamento e anexos locais. Importação/exportação Markdown e backup/restauração com validação e preservação dos dados em falha.
4. Qualidade: verificar fluxos reais, persistência após reinício, isolamento Electron, busca, lixeira, temas, teclado e layout compacto. Typecheck/build e testes significativos do repositório e dos fluxos críticos. Comparar screenshots com conceito e registrar limites de evidência.
5. Entrega: README com comandos exatos, arquitetura, funcionalidades implementadas e pendentes. Build desktop e empacotamento Windows quando viável, distinguindo preview web, execução Electron e instalador validado.

## Fora da primeira versão
Contas, sincronização em nuvem, colaboração, OCR, IA, captura web e paridade completa com todas as funções do Evernote. Manter roadmap documentado para estes itens.

## Orquestração
OpenCode implementa nesta workspace compartilhada; agente principal coordena e revisa os resultados. Não publicar, criar repositório remoto ou instalar globalmente. Se houver uso de Cloudflare, usar cf CLI, exceto se existir configuração Wrangler no projeto. Não substituir o provider solicitado silenciosamente.

---

# Status real (atualizado — implementação concluída)

## Concluído e verificado

**Fundação (etapa 1)**
- Scripts `dev`, `dev:web`, `build`, `build:web`, `electron`, `test`, `package` funcionais. `dev` usa `cross-env CADERNO_DEV=1` (HMR corrigido).
- Electron seguro: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, preload com lista fixa de canais, `validateInput` (Zod) no processo principal.
- SQLite (`better-sqlite3` 11.10.0, ABI Electron 33.4.11) com migrações versionadas e idempotentes; anexos em diretório próprio.
- Tokens visuais em `src/theme.css` (claro/escuro). Sem conceito raster gerado: o modelo desta execução não aceita entrada de imagem, então o conceito visual é o próprio CSS implementado + capturas em `evidence/` (bloqueio documentado abaixo).

**Fluxo principal (etapa 2) — validado ponta a ponta no navegador via T3 preview**
- CRUD de notas com autosave (600 ms) e persistência (localStorage no preview; SQLite no desktop) confirmada após recarregar a página.
- Cadernos: criar/renomear/excluir + **mover notas** (select “Caderno” no editor).
- Etiquetas: criar/anexar/desanexar com contagem e chips atualizados na nota aberta.
- Favoritos (toggle reflete imediatamente no botão e no contador) e fixar no topo.
- Busca em título/corpo (testada com “mercado” → 1 resultado).
- Lixeira: excluir → Lixeira → restaurar → esvaziar; excluir definitivamente com `window.confirm`.
- Temas claro/escuro persistentes (toggle e atributo `data-theme` verificados).

**Editor e produtividade (etapa 3)**
- TipTap com 14 controles de formatação, checklist, links, blocos de código, citação, undo/redo.
- Indicador de salvamento (“Salvando…/Salvo HH:mm”).
- Anexos: adicionar/listar/abrir/remover.
- Import/export Markdown (conversores movidos para `shared/text.ts`, reutilizados por main e renderer).
- Backup/restauração JSON com validação e aplicação transacional (falha não altera dados).

**Qualidade (etapa 4)**
- `npx tsc -b` → 0 erros.
- `npm test` → **17 testes passando** (2 arquivos).
- `npm run build` → ok (web + electron).
- Electron real capturado: `evidence/electron-light-new.png` e `evidence/electron-dark-new.png` (open-first clicou, tema escuro aplicado).
- Persistência após reinício: teste novo em `tests/repo.test.ts` (“Persistência após reinício”) fecha e reabre o banco; inspeção do banco real (`scripts/read-db.cjs`) confirma dados em SQLite.

**Entrega (etapa 5) — instalador e evidência atual**
- Instalador NSIS gerado: `release/Caderno Setup 0.1.0.exe` (88.556.968 bytes, SHA-256 `9FF8411A…5E8BDE`) + `release/win-unpacked/Caderno.exe`.
- Executável empacotado validado com **perfil temporário isolado** (`--user-data-dir` em `%TEMP%`): abriu, renderizou (captura PNG não vazia) e criou `caderno.sqlite` no diretório isolado; o perfil real `%APPDATA%\caderno` permaneceu **inalterado** (hash do `caderno.sqlite` idêntico antes/depois).
- Capturas novas após o fix do rodapé: `evidence/electron-light-footer-fixed.png` e `evidence/electron-dark-footer-fixed.png`.
- Ressalva de coerência: o instalador acima foi gerado pelo processo já em execução **antes** do fix do rodapé, portanto ele ainda traz o rodapé antigo; o fix está no código-fonte e no `dist/` reconstruído. Gerar um instalador com o fix exige uma nova execução de `npm run package` (não disparada nesta rodada, conforme a orientação de não duplicar empacotamento).

## Correções feitas nesta retomada
1. **Adapter web de desenvolvimento** (`src/api/webClient.ts`) — `npm run dev:web` agora funciona para CRUD/cadernos/etiquetas/favoritos/busca/lixeira/temas. Cliente escolhido por presença de `window.cadernoDesktop`.
2. **Bug de troca de nota durante o debounce** — editar uma nota e trocar rapidamente para outra gravava o conteúdo na nota errada. Corrigido em `NoteEditor` (flush da edição pendente na nota anterior antes da troca).
3. **Estado da nota aberta desatualizado** — favoritar/fixar/etiquetar atualizavam o banco mas não o editor aberto. Corrigido (re-sincroniza `openNote`).
4. **Movimentação entre cadernos** — faltava a UI; adicionado select “Caderno” no editor.
5. **`npm run dev`** — não setava `CADERNO_DEV`, carregando build obsoleto; corrigido com `cross-env`.
6. **Modo captura** agora encerra o app sozinho (`app.exit(0)` após salvar o PNG).
7. Extração dos conversores de markdown/texto para `shared/text.ts` (sem dependências de Node), reutilizados por main e renderer.
8. **Overflow horizontal na sidebar** — as ações Importar/Backup/Restaurar do rodapé excediam a largura (216 px) e geravam barra de rolagem horizontal. Rodapé reorganizado em duas linhas (`.footer-actions` com `flex-wrap: wrap` + `.footer-meta`) e `overflow-x: hidden` na sidebar; rótulos de menu/caderno/etiqueta ganharam `text-overflow: ellipsis`. Confirmado por medição de DOM (`scrollWidth === clientWidth`; nenhum botão além da borda da sidebar).
9. **`npm run lint`** — trocado de `tsc --noEmit` (não seguia os *project references*; não checava nada) por `tsc -b`, que typechecka de verdade `tsconfig.node.json` e `tsconfig.web.json`.
10. **`npm install` reconstrói ABI nativo** — adicionado `"postinstall": "electron-builder install-app-deps"`, alinhando o README ao comportamento real (o módulo `better-sqlite3` é recompilado para o ABI do Electron).

## Limites de evidência (bloqueios reais)
- **Sem `view_image`/entrada de imagem**: o modelo desta execução não lê imagens, então a comparação visual conceito↔screenshot da skill `frontend-app-builder` não pôde ser feita por inspeção de imagem. A validação visual foi substituída por inspeção de DOM/estado via T3 `preview_evaluate`/`preview_snapshot` + capturas PNG do Electron. `image_gen` também não está disponível neste harness; o conceito é o CSS/capturas existentes.
- **Empacotamento NSIS** (`npm run package`): **concluído** nesta rodada. O instalador
  `release/Caderno Setup 0.1.0.exe` (88.556.968 bytes, SHA-256
  `9FF8411A90CDF21A51454703900B9509A437E61CA4362BCEBFCD7521115E8BDE`) foi gerado pelo
  processo `electron-builder` que já estava em execução quando a rodada começou.
  Ressalva concreta: num Windows **sem Modo de Desenvolvedor**, o 7-Zip não consegue
  recriar os symlinks do SDK macOS dentro do `winCodeSign` (aviso
  `Cannot create symbolic link: O cliente não tem o privilégio necessário`), o que faz o
  `electron-builder` repetir a extração; como esses arquivos (`darwin/...`) não são usados
  num build Windows, o empacotamento conclui na tentativa seguinte. Não afeta o instalador.

## Pendências / fora da primeira versão
- Assinatura de código do instalador (hoje sem certificado; Windows exibe SmartScreen).
- Contas, sincronização, colaboração, OCR, IA, captura web, paridade total Evernote (roadmap mantido acima).

## Comandos exatos
Ver `README.md`.


## Entrega final verificada pelo coordenador
- Novo npm run package concluído com código de saída 0 após a correção do rodapé.
- Instalador atual: release/Caderno Setup 0.1.0.exe; 88.557.166 bytes; SHA-256: 6E21587E49571967FF16BD32B02E284B5E3BFD50CE47F6730077504DE95B08A9.
- O pacote atual substitui o instalador anterior mencionado nos registros acima e inclui a correção do rodapé. CSS no app.asar comparado byte a byte com dist/assets: idêntico.
- Executável empacotado aberto com perfil temporário novo; captura evidence/packaged-final.png e SQLite de 69.632 bytes no perfil isolado.
- Capturas claro/escuro inspecionadas visualmente pelo coordenador em 1500x975: três painéis, tipografia, paleta, ícones e rodapé conferidos. Não houve conceito visual aprovado para comparação formal de fidelidade.
- O fluxo de instalação NSIS não foi executado; validado executável desempacotado. Instalador sem assinatura.

---

## Retomada 0.2.0 — redesign próximo ao T3 Code + auditoria funcional

Objetivo do coordenador: aparência muito mais próxima do T3 Code, sóbria/compacta/neutra,
lista à esquerda, seleção discreta, toolbar contida, editor como foco, menos roxo, sem
cards decorativos, temas claro/escuro, rodapé sem overflow. Preservar 3 painéis e funções.

### Referência real (somente leitura)
Tokens extraídos de `%LOCALAPPDATA%\Programs\t3code\resources\server.asar`
(`apps/server/dist/client/assets/main-aCsIvNdA.css`). Aplicados em `src/theme.css`:
paleta zinc/neutral, acento azul `#1b4ed8`/`#346bf1` (antes roxo `#4f46e5`), fonte do
sistema (antes "Inter"), escala 12/14px. Diferenças registradas em `AUDITORIA.md`.
Modelo desta execução não lê imagens (`view_image`/`image_gen` ausentes) — fidelidade
validada por DOM/estado + tokens reais + capturas PNG para o coordenador.

### Falhas reais corrigidas
1. Autosave corrompia o título (`onUpdate` passava `getHTML()` como `title`).
2. Input "Criar caderno" sem `onChange` (impossível digitar nome).
3. Tema não persistia (efeito gravava o padrão claro antes do init ler o salvo).

### Redesign estrutural
- Sidebar: marca neutra, "Nova nota" secundário, menu "⋯" (Importar/Backup/Restaurar).
- Lista: linhas planas à esquerda, metadados inline, seleção por barra lateral sutil.
- Editor: caderno/etiquetas/anexos movidos do corpo para a barra de status inferior
  (select + popovers), toolbar contida.

### Qualidade
- 21 testes (17 + 4 regressão em `tests/regression.test.ts`); `tsc -b` sem erros; build ok.
- Instalador `release/Caderno Setup 0.2.0.exe` (88.558.075 bytes; SHA-256
  `4CC4CA9FEBD37F65188DAC75691E3548708891003A1B8EECA9C49D2950AEA733`).
- QA isolado via `CADERNO_USER_DATA`; perfil real `%APPDATA%\caderno` inalterado.
- Capturas `evidence/v020-*.png` (1440×900, 1000×700, 900×560, claro/escuro,
  populado/vazio) + `v020-packaged-final.png`.


## 10. Revisão final do coordenador
A revisão de imagens reprovou a primeira entrega 0.2.0: a lista permanecia centralizada, os previews vazavam e havia rolagem horizontal. Corrigido em src/theme.css: linhas esticadas e restritas à largura da coluna, min-width:0 e quebra de palavras, mantendo clamp de duas linhas. Novas capturas conferidas diretamente: claro 1440x900, escuro 1000x700 e janela mínima. Alinhamento, recorte, tipografia, paleta, ícones e statusbar revisados. As alegações de alinhamento da primeira rodada só passaram a ser verdadeiras após este reparo.
O roteiro de captura agora define o tema no banco do perfil QA antes da captura, evitando arquivos rotulados claro com tema escuro.
Reexecutado npm test: 21/21; npm run package concluiu com código 0 (inclui tsc -b e build). CSS extraído do app.asar é idêntico ao dist atual.
Instalador final substitui hash anterior: 88.558.032 bytes; SHA-256 133FFD44AE539E4804AB9F2E96C805BEF07E6380CE9015E5EA49EBBA5A34D227.
Preview final falhou duas vezes com 'Preview automation snapshot timed out after 15000ms'; conferência final de layout feita em capturas Electron. Não foi repetida a auditoria interativa completa após o reparo CSS. Limites dos diálogos nativos descritos na seção 4 continuam aplicáveis.
