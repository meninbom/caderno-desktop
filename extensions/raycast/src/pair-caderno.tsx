import { useEffect, useRef, useState } from "react";
import {
  Action,
  ActionPanel,
  Form,
  Icon,
  Toast,
  showToast,
} from "@raycast/api";
import {
  hasLocalCredential,
  pairWithCode,
  removeLocalCredential,
  verifyConnection,
} from "./client";

type ConnectionStatus = {
  kind: "checking" | "unpaired" | "connected" | "saved" | "error";
  message: string;
};

export default function PairCaderno() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [status, setStatus] = useState<ConnectionStatus>({
    kind: "checking",
    message: "Verificando a conexão local…",
  });

  useEffect(() => {
    let active = true;
    void hasLocalCredential()
      .then(async (exists) => {
        if (!active) return;
        if (!exists) {
          setStatus({
            kind: "unpaired",
            message: "Nenhuma credencial local foi salva neste Raycast.",
          });
          return;
        }
        try {
          await verifyConnection();
          if (active)
            setStatus({
              kind: "connected",
              message:
                "Conectado ao Caderno. A credencial está no armazenamento local seguro deste Raycast.",
            });
        } catch (error) {
          if (active) {
            setStatus({
              kind: "error",
              message:
                error instanceof Error
                  ? error.message
                  : "A credencial está salva, mas não foi possível confirmar a conexão.",
            });
          }
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setStatus({
            kind: "error",
            message:
              error instanceof Error
                ? error.message
                : "Não foi possível ler o armazenamento seguro deste Raycast.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [refreshKey]);

  async function submit(values: { code?: string }) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setStatus({ kind: "checking", message: "Pareando com o Caderno…" });
    try {
      await pairWithCode(values.code ?? code);
      setCode("");
      try {
        await verifyConnection();
        setStatus({
          kind: "connected",
          message:
            "Conectado ao Caderno. A credencial está no armazenamento local seguro deste Raycast.",
        });
        await showToast({
          style: Toast.Style.Success,
          title: "Raycast pareado com o Caderno",
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Não foi possível confirmar a conexão agora.";
        setStatus({
          kind: "saved",
          message: `O pareamento foi salvo. A conexão ainda não foi confirmada: ${message}`,
        });
        await showToast({
          style: Toast.Style.Success,
          title: "Credencial local salva",
          message: "A conexão será verificada na próxima chamada.",
        });
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Confira o código e tente novamente.";
      setStatus({ kind: "error", message });
      await showToast({
        style: Toast.Style.Failure,
        title: "Não foi possível parear",
        message,
      });
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  async function removeCredential() {
    try {
      await removeLocalCredential();
      setCode("");
      setStatus({
        kind: "unpaired",
        message:
          "A credencial foi removida deste Raycast. Isso não revoga o token no Caderno; use Configurações → Raycast no app para revogar o acesso.",
      });
      await showToast({
        style: Toast.Style.Success,
        title: "Credencial local removida",
        message:
          "Para revogar também no app, use Configurações → Raycast no Caderno.",
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Tente novamente.";
      setStatus({ kind: "error", message });
      await showToast({
        style: Toast.Style.Failure,
        title: "Não foi possível remover a credencial",
        message,
      });
    }
  }

  return (
    <Form
      navigationTitle="Conexão local com o Caderno"
      isLoading={busy || status.kind === "checking"}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Parear Raycast"
            icon={Icon.Link}
            onSubmit={submit}
          />
          <Action
            title="Remover Credencial Local"
            icon={Icon.Trash}
            style={Action.Style.Destructive}
            onAction={removeCredential}
          />
        </ActionPanel>
      }
    >
      <Form.Description title="Estado" text={status.message} />
      <Form.Description
        title="Como parear"
        text="No Caderno, abra Configurações → Raycast → Ativar conexão local e gere um código. Ele expira em 3 minutos e aceita até 5 tentativas."
      />
      <Form.PasswordField
        id="code"
        title="Código de pareamento"
        placeholder="10 dígitos"
        value={code}
        onChange={setCode}
      />
      <Form.Description
        title="Armazenamento"
        text="A credencial fica no armazenamento local seguro da extensão no Raycast. Removê-la aqui apaga somente a cópia local; a revogação efetiva é feita nas configurações do Caderno."
      />
    </Form>
  );
}
