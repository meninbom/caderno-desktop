# Caderno Web Clipper (0.15.0)

Extensão Manifest V3 unpacked. O caminho de instalação é esta pasta, não uma loja e não um pacote gerado pelo build do app.

## Onde carregar

1. No Caderno: `Mais ações → Web Clipper → Configurar Clipper`. A ponte escuta só em `127.0.0.1:43187` enquanto o app está aberto.
2. No Chrome, Edge ou Vivaldi: modo de desenvolvedor → **Carregar sem compactação**.
3. Selecione a pasta `extensions/clipper` deste checkout. Não copie para um perfil sincronizado. O token fica em `chrome.storage.local`.

Atualize o app e a extensão juntos. A pasta da extensão não atualiza a ponte de uma instalação antiga.

## O que a captura faz

- Modos: artigo, seleção, página e favorito. A seleção usa `Range.cloneContents()` e não edita a página.
- O artigo é uma heurística local (`article` / `main` / blocos de texto). Não é o Mozilla Readability.
- Prévia, título editável, filtro de caderno, etiquetas, comentário separado e destino novo ou acréscimo a uma nota.
- Ao acrescentar a uma nota aberta, o app salva a edição pendente e atualiza o editor. Uma falha no salvamento cancela a captura, mantendo o rascunho para tentar novamente.
- Links relativos viram absolutos. Tabelas, listas e código permanecem. Imagens não são baixadas; o texto alternativo entra como texto.
- A URL original fica na nota. `utm_*`, `fbclid`, `gclid` e outros rastreadores conhecidos só saem da chave de deduplicação. O fragmento permanece.
- O mesmo `requestId` não cria outra nota. Outra seleção da mesma página pode. Artigo repetido pede confirmação. Nota na lixeira não bloqueia.
- Um envio sem resposta fica em `pendingClip` no storage local para tentar de novo. Não há fila offline nem service worker.
- O atalho sugerido é Alt+Shift+X. O popup mostra o atalho que o navegador realmente atribuiu.

## Segurança que não mudou

Permissões: `activeTab`, `scripting`, `storage` e o host `http://127.0.0.1:43187/*`. Sem content script permanente e sem acesso a todos os sites. Pareamento com nonce de uso único (2 minutos), token Bearer de 30 dias no safeStorage, Origin pareado, JSON de no máximo 1 MB. A sanitização no app continua obrigatória.

O botão **Desconectar** apaga o token da extensão. **Desconectar e revogar acesso** no app apaga o token do cofre e fecha a ponte.

## Provas que esta pasta não substitui

`node scripts/test-clipper-extract.mjs` abre um Chromium com o extrator injetado numa fixture. Isso não é o gesto `activeTab`.

`npm run test:clipper` sobe o app num perfil temporário e concede host da fixture só numa cópia da extensão. É prova HTTP e de handler do popup, não do gesto nativo.

O gesto nativo continua sendo abrir a extensão pelo ícone ou pelo menu, numa página http/https, com o harness `scripts/test-clipper-native-gesture.mjs` quando houver uma pessoa para acionar o popup.

## Backup

O backup continua compatível com a versão 9. Mantém cada captura da mesma URL, a origem e o identificador de envio, inclusive após restauração. Backups antigos sem esses campos continuam aceitos. Não há anexos nesta captura, então a fila de anexos não recebe arquivo novo; o app é avisado de que uma nota mudou.
