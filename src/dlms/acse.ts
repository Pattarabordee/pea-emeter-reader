// ACSE association (IEC 62056-46 / DLMS Green Book): LN referencing, no ciphering, LLS.
const LN_CONTEXT = [0x60, 0x85, 0x74, 0x05, 0x08, 0x01, 0x01]; // 2.16.756.5.8.1.1
const LLS_MECH = [0x60, 0x85, 0x74, 0x05, 0x08, 0x02, 0x01]; // 2.16.756.5.8.2.1
// InitiateRequest: no dedicated-key, no response-allowed, no quality, DLMS v6, then conformance and max PDU.
export type InitiateParams = { conformance: number; maxPdu: number };
// Default: conformance (get|set|selective-access|action|block-transfer|multiple-refs|event-notif) 00 7E 1F, max PDU 0xFFFF.
export const DEFAULT_INITIATE: InitiateParams = { conformance: 0x007e1f, maxPdu: 0xffff };
const initiateRequest = ({ conformance: c, maxPdu: m }: InitiateParams) =>
  [0x01, 0x00, 0x00, 0x00, 0x06, 0x5f, 0x1f, 0x04, 0x00, (c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff, (m >> 8) & 0xff, m & 0xff];

function ber(len: number): number[] {
  if (len < 0x80) return [len];
  return len < 0x100 ? [0x81, len] : [0x82, len >> 8, len & 0xff];
}
const tlv = (tag: number, body: ArrayLike<number>): number[] => [tag, ...ber(body.length), ...Array.from(body)];

export function buildAarq(password: Uint8Array, initiate: InitiateParams = DEFAULT_INITIATE): Uint8Array {
  const body = [
    ...tlv(0xa1, tlv(0x06, LN_CONTEXT)),
    0x8a, 0x02, 0x07, 0x80, // sender-acse-requirements: authentication
    ...tlv(0x8b, LLS_MECH),
    ...tlv(0xac, tlv(0x80, password)),
    ...tlv(0xbe, tlv(0x04, initiateRequest(initiate))),
  ];
  return Uint8Array.from(tlv(0x60, body));
}

/** Parse one BER TLV at pos -> [tag, valueStart, valueEnd]. */
function tl(b: Uint8Array, pos: number): [number, number, number] {
  if (pos + 2 > b.length) throw new Error('AARE: truncated');
  let len = b[pos + 1];
  let p = pos + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n < 1 || n > 2 || p + n > b.length) throw new Error('AARE: bad length');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + b[p++];
  }
  if (p + len > b.length) throw new Error('AARE: truncated');
  return [b[pos], p, p + len];
}

const USER_DIAG: Record<number, string> = {
  0: 'null', 1: 'no-reason-given', 2: 'application-context-name-not-supported',
  11: 'authentication-mechanism-name-not-recognised', 12: 'authentication-mechanism-name-required',
  13: 'authentication-failure', 14: 'authentication-required',
};
const PROVIDER_DIAG: Record<number, string> = {
  0: 'null', 1: 'no-reason-given', 2: 'no-common-acse-version',
};
const RESULT: Record<number, string> = { 0: 'accepted', 1: 'rejected-permanent', 2: 'rejected-transient' };
// xDLMS ConfirmedServiceError (Green Book): 0x0E <service> <ServiceError choice> <value>.
const CSE_SERVICE: Record<number, string> = { 1: 'initiate', 2: 'get-status', 3: 'get-name-list', 5: 'read', 6: 'write' };
const SERVICE_ERROR: Record<number, [string, Record<number, string>]> = {
  0: ['application-reference', { 0: 'other', 1: 'time-elapsed', 2: 'application-unreachable', 3: 'application-reference-invalid', 4: 'application-context-unsupported', 5: 'provider-communication-error', 6: 'deciphering-error' }],
  1: ['hardware-resource', { 0: 'other', 1: 'memory-unavailable', 2: 'processor-resource-unavailable', 3: 'mass-storage-unavailable', 4: 'other-resource-unavailable' }],
  2: ['vde-state-error', { 0: 'other', 1: 'no-dlms-context', 2: 'loading-data-set', 3: 'status-nochange', 4: 'status-inoperable' }],
  3: ['service', { 0: 'other', 1: 'pdu-size', 2: 'service-unsupported' }],
  4: ['definition', { 0: 'other', 1: 'object-undefined', 2: 'object-class-inconsistent', 3: 'object-attribute-inconsistent' }],
  5: ['access', { 0: 'other', 1: 'scope-of-access-violated', 2: 'object-access-violated', 3: 'hardware-fault', 4: 'object-unavailable' }],
  6: ['initiate', { 0: 'other', 1: 'dlms-version-too-low', 2: 'incompatible-conformance', 3: 'pdu-size-too-short', 4: 'refused-by-the-VDE-handler' }],
};

function confirmedServiceError(b: Uint8Array, i: number): string {
  const svc = CSE_SERVICE[b[i + 1]] ?? `service-${b[i + 1]}`;
  const se = SERVICE_ERROR[b[i + 2]];
  const val = b[i + 3];
  if (!se || val === undefined) return `confirmed-service-error ${svc}`;
  return `confirmed-service-error ${svc}: ${se[0]}/${se[1][val] ?? val}`;
}

export function parseAare(apdu: Uint8Array): { accepted: boolean; diagnostic: string } {
  let result = -1;
  let diag = '';
  let userInfo = '';
  try {
    const [tag, s, e] = tl(apdu, 0);
    if (tag !== 0x61) return { accepted: false, diagnostic: `not an AARE (tag 0x${tag.toString(16)})` };
    for (let p = s; p < e; ) {
      const [t, vs, ve] = tl(apdu, p);
      if (t === 0xa2 && ve - vs >= 3) result = apdu[vs + 2]; // INTEGER inside [2]
      else if (t === 0xa3 && ve - vs >= 5) {
        const src = apdu[vs];
        const code = apdu[vs + 4];
        diag = src === 0xa1 ? (USER_DIAG[code] ?? `user-diagnostic-${code}`) : (PROVIDER_DIAG[code] ?? `provider-diagnostic-${code}`);
      } else if (t === 0xbe && ve - vs >= 4) {
        // [30] { OCTET STRING { xDLMS APDU } }: 0x08 InitiateResponse, 0x0E ConfirmedServiceError
        const x = apdu[vs + 2];
        if (x === 0x0e) userInfo = confirmedServiceError(apdu, vs + 2);
      }
      p = ve;
    }
  } catch (err) {
    return { accepted: false, diagnostic: (err as Error).message };
  }
  const accepted = result === 0;
  let diagnostic = `${RESULT[result] ?? `unknown-result-${result}`}${diag ? ': ' + diag : ''}`;
  if (userInfo) diagnostic += ` (${userInfo})`;
  return { accepted, diagnostic };
}
