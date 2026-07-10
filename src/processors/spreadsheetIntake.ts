import { PreProcessor, CDN } from 'lua-cli';
import type { ChatMessage, PreProcessorResult } from 'lua-cli';
import { sniffExport, manifestText } from '../lib/exportSniff';

/**
 * Chat-intake preprocessor for spreadsheet attachments (XBS/SOL exports).
 *
 * REPLACES the raw spreadsheet part with a text manifest — never forwards it.
 * The model provider (Anthropic via the AI SDK) rejects spreadsheet media
 * types (e.g. application/vnd.openxmlformats-officedocument.spreadsheetml.sheet)
 * with AI_UnsupportedFunctionalityError, which aborts the whole turn and
 * returns an empty reply (verified in file-types/file-support.md). The ingest
 * tools read the file from the CDN by fileId, so the raw bytes are never
 * needed inline.
 */

const SPREADSHEET_MEDIA_TYPES = new Set([
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const SPREADSHEET_URL = /\.(csv|xls|xlsx)(\?.*)?$/i;

const normalizeMediaType = (mediaType: string): string =>
  (mediaType ?? '').split(';', 1)[0].trim().toLowerCase();

export function isSpreadsheet(data: string, mediaType: string): boolean {
  if (SPREADSHEET_MEDIA_TYPES.has(normalizeMediaType(mediaType))) return true;
  return /^https?:\/\//i.test(data) && SPREADSHEET_URL.test(data);
}

/** Attachment `data` is either a URL or (possibly data:-prefixed) base64. */
async function fetchAttachmentBytes(data: string): Promise<Buffer> {
  if (/^https?:\/\//i.test(data)) {
    const res = await fetch(data);
    if (!res.ok) throw new Error(`Failed to fetch attachment: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  const b64 = data.startsWith('data:') ? data.slice(data.indexOf(',') + 1) : data;
  return Buffer.from(b64, 'base64');
}

function extensionFor(mediaType: string): string {
  const mt = normalizeMediaType(mediaType);
  if (mt === 'text/csv') return 'csv';
  if (mt === 'application/vnd.ms-excel') return 'xls';
  return 'xlsx';
}

export async function intakeExecute(messages: ChatMessage[]): Promise<PreProcessorResult> {
  const out: ChatMessage[] = [];
  let changed = false;
  for (const msg of messages) {
    if (msg.type === 'file' && isSpreadsheet(msg.data, msg.mediaType)) {
      try {
        const bytes = await fetchAttachmentBytes(msg.data);
        const sniff = sniffExport(bytes); // sniff first: don't CDN-store unparseable files
        const file = new File([new Uint8Array(bytes)], `upload.${extensionFor(msg.mediaType)}`, {
          type: msg.mediaType,
        });
        const fileId = await CDN.upload(file);
        out.push({ type: 'text', text: manifestText(fileId, sniff) });
      } catch (err) {
        console.error('spreadsheet-intake: failed to fetch or parse attachment', err);
        out.push({
          type: 'text',
          text:
            '[Spreadsheet intake failed: the attachment could not be fetched or parsed. ' +
            'Tell the trader the file could not be read and ask them to re-export and re-upload it.]',
        });
      }
      changed = true;
      continue;
    }
    out.push(msg);
  }
  return changed ? { action: 'proceed', modifiedMessage: out } : { action: 'proceed' };
}

export const spreadsheetIntake = new PreProcessor({
  name: 'spreadsheet-intake',
  description:
    'Stores spreadsheet attachments (csv/xls/xlsx) on the CDN, detects which desk export they are ' +
    '(XBS stock / SOL DailyNetPosition / SOL ReportLogistic) and injects a fileId manifest so the ' +
    'ingest tools can parse them losslessly.',
  priority: 10,
  execute: async (_user, messages, _channel) => intakeExecute(messages),
});
