# Caderno Web Clipper (0.9.0)

Extensão Manifest V3 para Chromium. O caminho normal é Chrome, Edge e Vivaldi com suporte padrão a extensões Chromium; esses navegadores não foram todos exercitados nesta rodada.

## Instalação manual

1. Abra `Mais ações → Web Clipper → Configurar Clipper` no Caderno. Isso inicia a ponte somente em `127.0.0.1` enquanto o app estiver aberto.
2. Em Chrome/Edge/Vivaldi, abra a página de extensões, habilite o modo de desenvolvedor e escolha **Carregar sem compactação** (ou equivalente).
3. Selecione esta pasta `extensions/clipper` do checkout. Não copie para um perfil sincronizado. A extensão guarda o token em `chrome.storage.local`, nunca em storage sincronizado.
4. No app, escolha **Gerar código de pareamento**. Digite o código numérico e cole o código de conexão mostrado na extensão. O pareamento expira em dois minutos e só vale uma vez.
5. Abra uma página http/https, selecione a extensão (ou use `Alt+Shift+X`), escolha caderno e modo e clique **Salvar página**. Artigo, seleção e página são capturados apenas por ação explícita. Imagens não são baixadas.

O botão **Desconectar** remove o token da extensão. No app, **Desconectar e revogar acesso** revoga o token guardado no cofre do SO e fecha a ponte; o token inválido pode permanecer no `storage.local` até a extensão ser desconectada ou pareada novamente. O token expira após 30 dias. A ponte não inicia com o app fechado. Porta ocupada apresenta erro na tela do app.

O endpoint aceita somente JSON limitado a 1 MB, host loopback e o Origin da extensão pareada; a autorização usa token aleatório além de nonce/code de pareamento de uso único. A nota registra título, URL, data da página e data de captura. Scripts, formulários, frames, eventos, URLs ativas e imagens remotas não são importados.

## Limites conhecidos desta versão

### Correção do fluxo de captura (29/10/2026)

O fetch GET de destinos executado pelo Chromium retornava 403 `ORIGIN_NOT_PAIRED`: o navegador omitia `Origin`, ao contrário do cliente HTTP usado nos testes anteriores. A extensão agora solicita destinos por POST JSON, mantendo a checagem estrita de origem e token na ponte. Atualize tanto o app quanto a extensão; atualizar só a pasta da extensão não atualiza a ponte de uma instalação antiga.

O CSS respeita `[hidden]`, ocultando corretamente o pareamento após conectar. Captura fica desabilitada sem página HTTP/HTTPS autorizada, com mensagem orientando a abertura pelo ícone. Ao retornar ao Caderno, a lista é atualizada para mostrar notas capturadas.

O teste de integração executa o handler do botão, `chrome.scripting`, fetch no navegador e persistência SQLite, com uma permissão de host concedida somente à fixture na cópia temporária da extensão. Essa permissão não foi adicionada ao manifest distribuído e não comprova o gesto nativo `activeTab`.

O atalho sugerido não garante que o navegador o atribuiu. No Chromium temporário de QA, `chrome.commands.getAll()` retornou `_execute_action` com `shortcut` vazio: pressionar Alt+Shift+X não abre o painel nesse perfil. Use o menu **Extensões → Caderno Web Clipper** para conceder `activeTab` por ação real, ou configure o atalho em `chrome://extensions/shortcuts`. O harness registra os comandos atribuídos e as respostas da ponte sem gravar tokens.

O extrator local escolhe `article`, `main` ou `[role=main]` de maior texto e remove elementos ativos. Não incorpora a biblioteca Mozilla Readability. Captura imagem e links são limitados ao texto/HTML sanitizado; anexos remotos não são copiados. O processo exige que o app esteja aberto.
