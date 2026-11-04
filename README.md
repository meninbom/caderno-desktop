# Caderno

App de anotações para Windows, feito em Electron. Comecei inspirado no jeito do Evernote organizar as coisas e fui somando o que eu sentia falta no dia a dia: tarefas, calendário, um clipper para o navegador e transcrição de áudio que roda no próprio computador.

Tudo fica salvo localmente, num banco SQLite. Não tem conta nem servidor.

## O que dá para fazer

- Escrever notas num editor rico (TipTap) com salvamento automático, cadernos, pastas, etiquetas, favoritos e lixeira.
- Buscar em tudo com **Ctrl+K**: títulos, texto das notas e conteúdo indexado dos anexos.
- Anexar arquivos à nota, com prévia. Em PDFs dá para marcar áreas e comentar por página.
- Ligar notas entre si e ver quem aponta para a nota aberta.
- Criar modelos de nota (reunião, projeto, 5W2H, diário) e abrir outra nota lado a lado para consulta.
- Controlar tarefas com prioridade e repetição, e eventos num calendário.
- Transcrever áudios anexados com o whisper.cpp, sem mandar nada para a internet. O runtime e o modelo são configurados à parte ([detalhes](TRANSCRICAO_LOCAL.md)).
- Salvar páginas da web pela [extensão Clipper](extensions/clipper/README.md) e criar notas pelo [Raycast](extensions/raycast/README.md).
- Mudar a aparência: temas, cores, fontes e fundos próprios ([guia](docs/APARENCIA.md)).
- Exportar nota em PDF, HTML e Markdown, e fazer backup/restauração completos em JSON.

## Stack

Electron, React, TypeScript e Vite. SQLite com `better-sqlite3` e migrações versionadas. IPC tipado e validado com Zod, com `contextIsolation` e `sandbox` ligados. Testes com Vitest e fluxos funcionais rodando no Electron de verdade.

## Rodando localmente

Precisa de Node.js e Windows (o empacotamento é para Windows; o modo web serve só para mexer na interface).

```bash
npm install        # também compila o better-sqlite3 para o Electron
npm run dev        # Vite + Electron com recarga
npm run dev:web    # só a interface no navegador, com dados em memória
npm test
npm run package    # gera o instalador em release-<versão>/
```

Os dados ficam em `%APPDATA%\caderno`.

## Mais documentação

O manual completo, com arquitetura, testes e o histórico das versões, está em [docs/MANUAL.md](docs/MANUAL.md).
