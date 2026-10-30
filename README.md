# Caderno

Versão **0.12.0**. Modelos de notas, consulta lado a lado, exportação PDF/HTML e seletores de cor do texto e marca-texto. Busca geral e comandos com **Ctrl+K**, referências entre notas, marcações de PDF e tarefas recorrentes com prioridade. Os relatórios históricos descrevem versões anteriores; modelos de voz, dados pessoais, instaladores e evidências locais não fazem parte do repositório.

Aplicativo **desktop** de anotações para Windows, inspirado nos fluxos de
organização do Evernote e com visual limpo e minimalista (próximo ao T3 Code).
Interface em português do Brasil.

- **Stack:** Electron + React + TypeScript + Vite
- **Editor:** TipTap (títulos, negrito, itálico, listas, checklist, links, blocos de código, citação)
- **Persistência:** SQLite (`better-sqlite3`) com migrações versionadas — **não** usa `localStorage` como banco
- **Segurança:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, preload/IPC tipado e validado com Zod, consultas SQL parametrizadas

> Nome provisório: **Caderno**. Dados ficam no diretório `userData` do app
> (`%APPDATA%\caderno\caderno.sqlite` + `%APPDATA%\caderno\attachments`).

---

## Funcionalidades

- **Notas:** criar, editar, salvar automaticamente (debounce de 600 ms), reabrir, excluir.
- **Modelos:** salvar a nota atual com cópias independentes dos anexos e das marcações PDF; buscar, visualizar, renomear, excluir e criar uma nova nota. Inclui reunião, projeto, plano de ação 5W2H e diário. O marcador `{{data}}` insere a data local. Migração SQLite 12 e backup JSON 8, com leitura dos backups anteriores.
- **Lado a lado:** editor principal e outra nota em referência somente leitura; escolher, permutar e fechar, com scroll independente, largura ajustável e painéis empilhados em espaços estreitos.
- **Cores do texto e marca-texto:** paletas, HEX personalizado, cores recentes e remoção independente da cor ou destaque, preservando fontes e outras formatações no trecho.
- **Exportação PDF/HTML:** conteúdo salvo antes de exportar, arquivo HTML offline com imagens/fontes/mídia incorporadas e PDF A4 claro. PDFs anexados são rasterizados com marcações e comentários (até 60 páginas por anexo e 200 no total; excedentes geram aviso). No PDF exportado, o texto dos PDFs incorporados vira imagem, e áudio/vídeo aparecem como cartões estáticos. Os arquivos originais são preservados. Modelos e exportação exigem o app desktop.
- **Cadernos:** criar, renomear, excluir e **mover notas** entre cadernos.
- **Etiquetas:** criar, anexar/desanexar, filtrar por etiqueta.
- **Favoritos** e **fixar no topo**.
- **Busca geral e comandos (Ctrl+K):** títulos, conteúdo e texto indexado de anexos, com trechos dos resultados; criação de notas/tarefas/eventos e navegação por teclado. Disponível também com as barras recolhidas.
- **Pesquisa incremental:** a última palavra pode estar incompleta ("Crie cadern" encontra "Crie cadernos"); palavras anteriores são completas e todos os termos devem aparecer, em qualquer ordem. Caixa e acentos não diferenciam resultados. A paleta dá maior peso ao título, mantendo a ordenação escolhida na lista. Filtros por tipo sem texto também funcionam; resultados de arquivos preservam nome e trecho da fonte.
- **Referências entre notas:** seção “Referências a esta nota” mostra links recebidos por UUID e acompanha renomeações e lixeira.
- **PDFs:** use “Ampliar” na prévia para destacar áreas e adicionar, editar ou excluir comentários por página. Marcações ficam no SQLite e no backup JSON, separadas dos bytes do original.
- **Tarefas:** prioridade baixa/normal/alta, filtro por prioridade e repetição diária/semanal/mensal. A conclusão cria uma única próxima ocorrência futura no fuso da tarefa; atrasos são pulados, o dia mensal original é preservado e meses curtos usam o último dia. Reabrir a ocorrência concluída não gera duplicação. Edite a próxima ocorrência para encerrar a repetição. Lembretes são entregues enquanto o app está aberto.
- **Lixeira:** restaurar, excluir definitivamente (com confirmação) e esvaziar lixeira.
- **Temas** claro/escuro persistentes.
- **Anexos:** adicionar, abrir e remover arquivos por nota (armazenados em diretório dedicado).
- **Importar/exportar Markdown** e **backup/restauração** JSON com validação e
  preservação dos dados em caso de falha (restauração é transacional).

---

## Comandos

```bash
# Instalar dependências (o `postinstall` roda `electron-builder install-app-deps` e
# compila o módulo nativo better-sqlite3 para o ABI do Electron)
npm install

# Desenvolvimento Electron com HMR (vite em :5173 + Electron)
npm run dev

# Apenas o preview web (adapter em memória/localStorage, sem Electron)
npm run dev:web

# Typecheck dos projetos node + web (tsc -b, segue os project references de tsconfig.json)
npm run lint

# Testes (Vitest, roda sob o runtime Node do Electron para o ABI do better-sqlite3)
npm test

# Pesquisa incremental e foco na paleta (Electron real, perfil isolado)
npm run test:search
npm run test:palette

# Testes funcionais (Electron real + renderer + preload + IPC + SQLite isolado)
npm run test:functional

# Verificação completa: lint, testes de dados, funcionais e build
npm run verify

# Build de produção (typecheck + vite build + bundle do Electron)
npm run build

# Executar o Electron a partir do build (dist/ + dist-electron/)
npm run electron

# Empacotar instalador Windows (NSIS) para release-<versão>/
npm run package
```

> `npm run build` produz `dist/` (renderer) e `dist-electron/` (main + preload).
> `npm run electron` carrega esses artefatos; `npm run dev` carrega o servidor vite.
>
> `npm run package` gera o instalador em `release-<versão>/Caderno Setup <versão>.exe`
> (junto de `release-<versão>/win-unpacked/` com o executável desempacotado `Caderno.exe`).

### Seed de demonstração (opcional)

```bash
node scripts/seed.mjs
```

Grava dados de exemplo no banco real do app (`%APPDATA%\caderno`).

### Captura de evidência (QA, opcional)

```bash
# Janela Electron em modo captura; encerra sozinha após salvar o PNG
$env:CADERNO_CAPTURE = "evidence\captura.png"; $env:CADERNO_OPEN_FIRST = "1"; electron .
$env:CADERNO_CAPTURE = "evidence\captura-dark.png"; $env:CADERNO_THEME = "dark"; $env:CADERNO_OPEN_FIRST = "1"; electron .
```

---

## Arquitetura

```
electron/
  main.ts            processo principal: janela, IPC, diálogos, montagem dos repositórios
  preload.ts         expõe window.cadernoDesktop.invoke com lista fixa de canais
  repo/
    db.ts            conexão SQLite + migrações + helpers de texto
    sqlite.ts        NotesRepo / NotebooksRepo / TagsRepo / CountsRepo / Meta
    attachments.ts   AttachmentsRepo + BackupRepo (dump/restore transacional)
    markdown.ts      reexporta os conversores puros de shared/text
shared/
  ipc.ts             contratos e schemas Zod por canal
  api.ts             validateInput (validação central no processo principal)
  bridge.ts          tipos globais da ponte
  text.ts            funções puras de markdown/texto (main + renderer)
src/
  api/
    client.ts        DesktopClient (IPC) + seleção Desktop vs Web
    webClient.ts     WebClient (localStorage, apenas dev:web)
    types.ts         interface CadernoClient comum
  state/store.tsx    reducer + seleção + autosave (dispatch)
  components/        Sidebar, NoteList, NoteEditor
  theme.css          tokens de design (claro/escuro)
tests/               repo.test.ts, markdown.test.ts
```

### Fluxo de dados

- O renderer nunca acessa `fs`, `sqlite` ou o sistema diretamente.
- Toda operação passa por `window.cadernoDesktop.invoke(channel, input)`, validada no
  processo principal por `validateInput` (Zod) e despachada para um handler tipado.
- Consultas SQL usam **parâmetros vinculados** (`?`) — nunca interpolação de strings.

### Persistência desktop vs preview web

- **Electron:** SQLite em disco (`userData`). Sobrevive a reinício; migrações idempotentes.
- **`npm run dev:web`:** adapter `WebClient` com `localStorage` **apenas** para o preview
  de navegador. Nunca é usado no aplicativo desktop. O cliente é escolhido em tempo de
  execução conforme a presença da ponte (`window.cadernoDesktop`).

---

## Testes

`npm test` (Vitest sob o Node do Electron) cobre:

- CRUD de notas, busca, favoritar/fixar/mover e ordenação.
- Lixeira: excluir, restaurar, apagar definitivo e esvaziar.
- Cadernos (inclusive duplicados) e etiquetas (anexar/desanexar/contar).
- Anexos em diretório dedicado.
- Backup/restauração (roundtrip) e backup inválido sem efeito.
- Migração idempotente e **persistência após reabrir o banco** (simula reinício).
- Markdown → HTML → Markdown e helpers de texto/preview.
- Validação dos payloads IPC (`validateInput`).

`npm run test:functional` inicia o Electron de desenvolvimento com `CADERNO_USER_DATA`
em um perfil temporário novo, executa a UI real via Playwright e salva capturas em
`evidence/functional/`. Diálogos de arquivo e `shell.openPath` são simulados na fronteira
do sistema operacional; renderer, preload, IPC, validação, repositórios, SQLite e arquivos
de anexos continuam reais. A matriz, os resultados e os limites estão em
[`TESTES_FUNCIONAIS.md`](TESTES_FUNCIONAIS.md). Não usa nem altera o perfil instalado.

---

## Limitações / pendências (roadmap)

Fora da primeira versão (documentado em `PLANEJAMENTO.md`): contas, sincronização em
nuvem, colaboração, OCR, IA, captura web e paridade completa com o Evernote.

- O empacotamento NSIS (`npm run package`) baixa o toolchain do `electron-builder` na
  primeira execução (Electron ~115 MB, NSIS e winCodeSign). Em um Windows **sem Modo de
  Desenvolvedor**, a extração do `winCodeSign` pode emitir aviso ao tentar recriar
  symlinks do SDK macOS (que não são usados num build Windows) e exigir nova tentativa;
  isso não afeta o instalador gerado.
- O instalador **não assina código** (não há certificado configurado); o Windows pode
  exibir o aviso do SmartScreen ao executá-lo.
- O preview web não tem diálogos nativos de arquivo (usa download/picker do navegador).

---

## Evidência

Screenshots capturados do Electron real (modo claro/escuro, primeira nota aberta) ficam
em `evidence/`. Após a correção do rodapé da sidebar, as capturas atuais são
`electron-light-footer-fixed.png` e `electron-dark-footer-fixed.png` (as anteriores,
`electron-light-new.png`/`electron-dark-new.png`, mostram o rodapé com overflow).

Redesign **0.2.0** (tokens do T3 Code, ver `AUDITORIA.md`): capturas `v020-*.png` em
`evidence/` cobrem claro/escuro, estado populado/vazio, 1440×900, 1000×700 e janela
mínima 900×560, além de `v020-packaged-final.png` (executável empacotado).


## Entrega final verificada pelo coordenador (0.1.0)
- Novo npm run package concluído com código de saída 0 após a correção do rodapé.
- Instalador: release/Caderno Setup 0.1.0.exe; 88.557.166 bytes; SHA-256: 6E21587E49571967FF16BD32B02E284B5E3BFD50CE47F6730077504DE95B08A9.
- O fluxo de instalação NSIS não foi executado; validado executável desempacotado. Instalador sem assinatura.

## Entrega 0.2.0 (redesign + auditoria)
- 3 falhas reais corrigidas (autosave do título, input "Criar caderno", persistência
  de tema) e redesign visual próximo ao T3 Code. Detalhes em `AUDITORIA.md`.
- Testes: 21 passando (17 + 4 regressão). `tsc -b` sem erros. Build ok.
- Instalador: `release/Caderno Setup 0.2.0.exe`; 88.558.075 bytes; SHA-256:
  4CC4CA9FEBD37F65188DAC75691E3548708891003A1B8EECA9C49D2950AEA733.
- Executável desempacotado validado com perfil isolado (`CADERNO_USER_DATA`); o perfil
  real `%APPDATA%\caderno` permaneceu inalterado (hash idêntico antes/depois).
