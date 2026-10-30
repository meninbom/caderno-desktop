import { request as httpRequest } from "node:http";

const API_ROOT = "http://127.0.0.1:43188/v1";

export type TransportOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  token?: string;
  signal?: AbortSignal;
  baseUrl?: string;
};

type ApiError = {
  error?: string;
};

export class ApiResponseError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "ApiResponseError";
  }
}

function friendlyError(code: string | undefined): string {
  switch (code) {
    case "UNAUTHORIZED":
    case "TOKEN_EXPIRED":
      return "O pareamento expirou ou foi revogado. Gere um novo código em Configurações → Raycast no Caderno e pareie novamente.";
    case "PAIRING_EXPIRED_OR_INVALID":
      return "Código incorreto, expirado ou já usado. Gere outro código em Configurações → Raycast no Caderno.";
    case "BROWSER_REQUEST_NOT_ALLOWED":
      return "O Caderno recusou uma chamada com cabeçalhos de navegador.";
    case "LOOPBACK_ONLY":
      return "A ponte local recusou uma conexão que não veio deste computador.";
    case "NOTE_NOT_FOUND":
      return "A nota não existe mais ou está na lixeira. Atualize a lista e tente outra vez.";
    case "INVALID_SEARCH":
      return "A busca aceita até 200 caracteres.";
    case "INVALID_NOTE":
      return "Confira o título, o conteúdo e o caderno escolhido.";
    case "INVALID_TASK":
      return "Confira a descrição, a nota e a prioridade da tarefa.";
    default:
      return "Não foi possível concluir a solicitação. Abra o Caderno e confira Configurações → Raycast.";
  }
}

export async function sendApiRequest<T>(
  path: string,
  options: TransportOptions = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  let body: string | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json; charset=utf-8";
    body = JSON.stringify(options.body);
  }

  const timeout = AbortSignal.timeout(5_000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;
  const baseUrl = new URL(options.baseUrl ?? API_ROOT);
  const basePath = baseUrl.pathname.replace(/\/+$/, "");
  const relativePath = path.replace(/^\/+/, "");
  const url = new URL(`${basePath}/${relativePath}`, `${baseUrl.origin}/`);
  if (
    baseUrl.protocol !== "http:" ||
    baseUrl.hostname !== "127.0.0.1" ||
    url.origin !== baseUrl.origin
  ) {
    throw new Error(
      "A conexão com o Caderno precisa usar o endereço local autorizado.",
    );
  }

  let statusCode: number;
  let responseText: string;
  try {
    const result = await new Promise<{ statusCode: number; body: string }>(
      (resolve, reject) => {
        const request = httpRequest(
          {
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port,
            method,
            path: `${url.pathname}${url.search}`,
            headers,
            signal,
          },
          (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk: Buffer | string) =>
              chunks.push(Buffer.from(chunk)),
            );
            response.once("error", reject);
            response.once("end", () => {
              resolve({
                statusCode: response.statusCode ?? 0,
                body: Buffer.concat(chunks).toString("utf8"),
              });
            });
          },
        );
        request.setTimeout(5_000, () =>
          request.destroy(new Error("REQUEST_TIMEOUT")),
        );
        request.once("error", reject);
        request.end(body);
      },
    );
    statusCode = result.statusCode;
    responseText = result.body;
  } catch {
    if (options.signal?.aborted) throw new Error("Busca cancelada.");
    throw new Error(
      "O Caderno não respondeu. Abra o app e confirme Configurações → Raycast → Ativar conexão local.",
    );
  } finally {
    headers.Authorization = "";
  }

  let payload: unknown;
  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new Error(
      "O Caderno retornou uma resposta inválida. Atualize o app e tente novamente.",
    );
  }

  if (statusCode < 200 || statusCode >= 300) {
    const code =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as ApiError).error ?? "")
        : undefined;
    throw new ApiResponseError(statusCode, code, friendlyError(code));
  }

  return payload as T;
}
