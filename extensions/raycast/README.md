# Caderno para Raycast no Windows

Extensão local em modo Development para buscar notas do Caderno, abri-las no app e criar notas e tarefas. O identificador e o autor do manifesto são `caderno-local`; não dependem de uma conta ou handle público.

## Desenvolvimento

Na pasta `extensions/raycast`:

```powershell
npm install
npm run typecheck
npm run test:client
npm run build
npm run bundle
npm run dev
```

`npm run dev` chama `ray develop`, que registra a extensão no Raycast como Development e mantém um watcher para recarregar alterações. Ao encerrar o watcher com `Ctrl+C`, a extensão continua registrada localmente. Para atualizar o bundle distribuível local, rode `npm run bundle`; o arquivo gerado é `caderno-local.rayext`. A extensão não foi publicada na Store.

`npm run test:client` exercita o transporte Node do cliente contra um servidor HTTP isolado: valida pareamento sem Bearer, requisições autenticadas, ausência de cabeçalhos de navegador, mapeamento de `401` sem revelar a credencial e cancelamento. É um teste do cliente HTTP, não uma prova visual dos comandos ou uma chamada à ponte do Caderno instalado.

## Conectar ao Caderno

1. Abra o Caderno e ative a conexão em **Configurações → Raycast → Ativar conexão local**.
2. Gere o código temporário na mesma tela.
3. No Raycast, abra **Conexão com o Caderno**, informe os dez dígitos e selecione **Parear Raycast**.
4. Use **Buscar Notas**, **Criar Nota** ou **Criar Tarefa**.

A ponte escuta apenas em `127.0.0.1:43188`. A extensão usa `node:http` e envia somente os cabeçalhos necessários; a ponte rejeita `Origin`, `Referer` e `Sec-Fetch-*`. O código é de uso único, expira em três minutos e permite até cinco tentativas. O token de 256 bits é salvo no `LocalStorage` seguro do Raycast e vale até 30 dias ou até ser revogado no Caderno.

**Remover Credencial Local** apaga somente a cópia deste Raycast. Para invalidar o token no Caderno, use **Configurações → Raycast → Revogar acesso** no app. Se uma chamada indicar credencial expirada ou revogada, gere outro código e pareie novamente.

## Comandos e limites

- **Buscar Notas**: lista notas com prévia e caderno. Enter abre e seleciona a nota no app e recolhe a janela do Raycast após a confirmação da abertura; se falhar, mantém a mensagem de erro visível. Outra ação copia o ID.
- **Criar Nota**: aceita título, conteúdo em texto simples e caderno opcional.
- **Criar Tarefa**: busca e escolhe uma nota, depois aceita descrição, prioridade baixa/normal/alta e prazo opcional com data e hora locais. A confirmação indica em qual filtro encontrar a tarefa: sem prazo, use **Tarefas → Todas**; com prazo de hoje, **Hoje**. A ponte não oferece consulta, edição ou remoção de tarefas.
- **Conexão com o Caderno**: mostra o estado do pareamento, recebe o código mascarado e remove a credencial local.

A busca aceita até 200 caracteres e lista até 50 resultados por consulta; título de nota ou tarefa aceita até 300 caracteres; conteúdo de nota aceita até 10.000. A extensão usa os repositórios do Caderno pela ponte autenticada e nunca acessa o SQLite diretamente. Não usa sincronização em nuvem.

## Script Commands mantidos

Os seis arquivos `.ps1` continuam disponíveis como compatibilidade para quem já os importou como Script Commands. Eles não são o fluxo principal da integração SDK. Para detalhes de seus comandos, use `pwsh -NoProfile -File <comando.ps1>` e consulte `support/CadernoBridge.psm1`.
