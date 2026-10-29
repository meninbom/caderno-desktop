import fs from 'node:fs';

export interface WhisperOutput {
  text: string;
  segments: { startMs: number; endMs: number; text: string }[];
  language: string;
}

export function readWhisperOutput(jsonPath: string, stdout: string, language: 'pt' | 'auto'): WhisperOutput {
  if (!fs.existsSync(jsonPath)) throw new Error(`whisper-cli não criou o JSON esperado (saída: ${stdout.slice(-300)}).`);
  let parsed: any;
  try {
    parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (error) {
    throw new Error(`whisper-cli criou JSON inválido: ${error instanceof Error ? error.message : String(error)}`);
  }
  const segments = (parsed.transcription ?? parsed.segments ?? []).map((segment: any) => ({
    startMs: Math.max(0, Math.round(Number(segment.offsets?.from ?? (Number(segment.t0 ?? 0) * 10)))),
    endMs: Math.max(0, Math.round(Number(segment.offsets?.to ?? (Number(segment.t1 ?? 0) * 10)))),
    text: String(segment.text ?? '').trim(),
  })).filter((segment: any) => segment.text);
  const text = segments.map((segment: any) => segment.text).join(' ').trim();
  if (!text) throw new Error('O modelo não reconheceu fala neste áudio.');
  return { text, segments, language: String(parsed.result?.language ?? language) };
}
