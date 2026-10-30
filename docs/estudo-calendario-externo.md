# Estudo inicial: calendário externo no Caderno

## Arquitetura atual

O calendário é local e SQLite. `calendar_events` guarda título, descrição, início/fim em epoch, fuso, dia inteiro e vínculo opcional com nota. Os contratos ficam em `shared/ipc.ts` / `shared/api.ts`; o renderer chama `events:*` via `src/api/client.ts`, o processo principal despacha para `EventsRepo` em `electron/repo/sqlite.ts`. A agenda atual é `src/components/LocalAgenda.tsx`. Não há contas externas, fontes de calendário nem estado de sincronização.

## Opções

- **ICS por URL (somente leitura):** simples para o MVP e compatível com Google/Outlook/iCloud quando oferecem URL privada. Atualização periódica, parser ICS confiável, cache local e suporte a `ETag`/`Last-Modified`. URLs privadas são credenciais e precisam ser protegidas.
- **CalDAV:** protocolo aberto usado por iCloud e vários provedores. Permite leitura e escrita, mas exige descoberta de principal/calendários, autenticação que varia por provedor, parsing de `VEVENT`, `CTag`/`sync-collection` quando disponível e fallback por `ETag`.
- **Google Calendar API:** OAuth 2.0, escopos mínimos, `events.list` incremental com `syncToken` e paginação. Tokens devem ser renováveis; mudanças nos parâmetros podem invalidar o token e exigir ressincronização.
- **Microsoft Graph:** OAuth 2.0 e escopo `Calendars.Read` para leitura; delta queries por calendário para sincronização incremental. Permissões de escrita devem ser adiadas até existir necessidade clara.

## OAuth em aplicativo Electron

Usar navegador do sistema para autorização e Authorization Code com PKCE (sem client secret embutido). Iniciar servidor HTTP temporário ligado apenas a `127.0.0.1`, com caminho/estado aleatórios, validar `state`, trocar o código pelo token usando o verificador PKCE e encerrar o listener imediatamente. Restringir redirect URI e validar issuer/audience conforme provedor. Não abrir fluxo OAuth dentro do BrowserWindow.

## Armazenamento de credenciais

Guardar refresh/access tokens criptografados por `safeStorage` no processo principal; manter apenas metadados não sensíveis em SQLite. Persistir ciphertext em arquivo local com escrita atômica e permissões restritas. Se `safeStorage` não estiver disponível/seguro, não armazenar tokens silenciosamente. Nunca expor tokens ao renderer, logs, backup comum ou telemetria. ICS privado também deve ser tratado como segredo, evitando exibir URL em logs/erros.

## Estratégia e conflitos

Começar com importação unidirecional. Guardar por fonte o cursor incremental do provedor (`syncToken` ou delta link), última sincronização e identificadores remotos; atualizar por páginas e só avançar cursor após commit bem-sucedido. Para ICS, usar `ETag`/`Last-Modified` e comparar UID/SEQUENCE/DTSTAMP. Cancelamentos remotos devem marcar o evento como removido da fonte, sem apagar eventos locais.

Sincronização bidirecional requer identidade remota, `ETag`/versão, tombstones, política de exclusão e resolução de conflito explícita. Não sobrescrever mudanças locais silenciosamente. Proposta: primeiro manter fontes externas somente leitura e eventos locais editáveis isoladamente; posteriormente oferecer “manter ambos”, “usar versão externa” e cópia local.

## Mudanças de modelo propostas

Adicionar `calendar_sources(id, provider, account_label, calendar_id, display_name, sync_mode, enabled, last_sync_at, cursor_ciphertext, created_at, updated_at)` e `external_event_links(source_id, remote_id, remote_etag, remote_updated_at, local_event_id, status, content_hash)` com unicidade por fonte/ID remoto. Acrescentar à tabela local `calendar_events` uma origem opcional, mas preferir tabela de vínculo para preservar eventos e contratos atuais. Tokens ficam fora da base de notas. Migrações aditivas e reversíveis por desativação da fonte.

## Privacidade e modo offline

Sincronizar somente calendários escolhidos e campos necessários. Informar quais dados ficam armazenados e permitir desconectar/excluir cache. Dados sincronizados ficam disponíveis offline; sincronização aguarda conexão e mostra último sucesso/erro sem descartar cache. Evitar baixar anexos e detalhes privados desnecessários. Considerar retenção de eventos passados configurável e criptografia do banco completo como trabalho separado.

## Estimativa por fase

1. **Fundação e contrato de fontes:** 2–3 dias (modelo, migração, UI de fontes, estados/erros).
2. **ICS somente leitura:** 3–5 dias (parser, URL segura, refresh, cache, duplicatas, testes e UX offline).
3. **Google OAuth + incremental:** 5–8 dias (PKCE/loopback, safeStorage, paginação e `syncToken`).
4. **Microsoft Graph:** 4–7 dias (OAuth, delta, paginação, renovação e erros de consentimento).
5. **CalDAV/iCloud:** 5–10 dias (descoberta, autenticação por provedor, sync e compatibilidade). App passwords podem ser requisito para algumas contas iCloud.
6. **Escrita e conflitos:** 8–15 dias adicionais, incluindo reconciliação, exclusões e UX de conflito.

Estimativas são de engenharia e variam conforme testes de integração e requisitos de distribuição/OAuth dos provedores.

## MVP recomendado

Implementar primeiro **assinaturas ICS somente leitura**: usuário adiciona URL para um calendário suportado, escolhe nome/cor, sincronização manual e automática com intervalo conservador, cache offline e ações de pausar/remover. Guardar segredo com safeStorage, não permitir URL arbitrária sem HTTPS (exceto testes locais explicitamente isolados), validar tamanho/timeout/redirecionamentos e parsear ICS sem executar conteúdo. Definir tabela de fontes e vínculos com IDs/ETags desde o começo, mas não escrever de volta. Depois adicionar Google e Graph individualmente com OAuth PKCE e cursores incrementais. CalDAV e escrita ficam para fases posteriores.
