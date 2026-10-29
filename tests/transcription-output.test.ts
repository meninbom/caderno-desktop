import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readWhisperOutput } from '../electron/transcription-output';

describe('Whisper CLI output boundaries', () => {
  it('reports a successful CLI exit that left no JSON file', () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'caderno-whisper-no-json-'));
    try {
      expect(() => readWhisperOutput(path.join(folder, 'missing.json'), 'CLI finished without output', 'pt')).toThrow(/não criou o JSON esperado/);
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });

  it('reports malformed JSON and empty transcription output', () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'caderno-whisper-invalid-json-'));
    const output = path.join(folder, 'transcript.json');
    try {
      fs.writeFileSync(output, '{broken');
      expect(() => readWhisperOutput(output, '', 'pt')).toThrow(/JSON inválido/);
      fs.writeFileSync(output, JSON.stringify({ segments: [] }));
      expect(() => readWhisperOutput(output, '', 'pt')).toThrow(/não reconheceu fala/);
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });

  it('normalizes real CLI segment forms and preserves language', () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'caderno-whisper-valid-json-'));
    const output = path.join(folder, 'transcript.json');
    try {
      fs.writeFileSync(output, JSON.stringify({ result: { language: 'pt' }, transcription: [{ offsets: { from: 0, to: 450 }, text: ' Bom dia. ' }] }));
      expect(readWhisperOutput(output, '', 'auto')).toEqual({ text: 'Bom dia.', language: 'pt', segments: [{ startMs: 0, endMs: 450, text: 'Bom dia.' }] });
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});
