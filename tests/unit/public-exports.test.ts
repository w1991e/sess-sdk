import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import * as root from '../../src/index.js';
import * as receipts from '../../src/receipts/index.js';
import * as webhooks from '../../src/webhooks/index.js';
import * as qrHelper from '../../src/qr/index.js';
import { Sess } from '../../src/index.js';
import { API_KEY } from '../fixtures/api.js';

// Exports of the previous candidate. The only allowed change is the addition listed below.
const BEFORE = {
  '.': [
    'AcceptedResponse',
    'Action',
    'ApiResult',
    'CreateSessionRequest',
    'CreateSessionResponse',
    'Deliveries',
    'DisplayInteraction',
    'DisplaySession',
    'DisplaySurfaceRevision',
    'FieldSchema',
    'InteractiveInteraction',
    'InteractiveSession',
    'InteractiveSurfaceRevision',
    'MutationOptions',
    'PublishSessionRequest',
    'RawCreateSessionRequest',
    'RawPublishSessionRequest',
    'RedeliverResponse',
    'RequestEvent',
    'RequestOptions',
    'ResponseMeta',
    'Sess',
    'SessError',
    'SessErrorDetails',
    'SessErrorKind',
    'SessOptions',
    'Session',
    'SessionEvent',
    'SessionEvents',
    'SurfaceComponent',
    'SurfaceRevision',
    'VersionedResult',
    'WaitOptions',
    'WaitResult',
    'WebhookDelivery',
    'WebhookRegisterRequest',
    'WebhookRegisterResponse',
    'WebhookResponse',
    'WebhookRotateResponse',
    'WebhookVerification',
    'WebhookVerifyResponse',
    'WriteOutcome',
    'components',
    'isInteractiveSession',
    'isInteractiveSurface',
    'operations',
    'paths',
  ],
  './receipts': [
    'BUNDLE_LIMITS',
    'BundleContextField',
    'BundleJwk',
    'BundleRejection',
    'DecisionBundle',
    'DecisionBundleVerification',
    'DeepReadonly',
    'ExpectedBundleContext',
    'ReceiptClaims',
    'ReceiptKeyResolver',
    'ReceiptKeySet',
    'ReceiptPublicKey',
    'ReceiptResource',
    'VerificationRequestOptions',
    'VerifiedReceiptSummary',
    'VerifiedResponse',
    'VerifyDecisionBundleOptions',
    'VerifyDecisionReceiptInput',
    'VerifyDecisionReceiptOptions',
    'VerifyResponseInput',
    'verifyDecisionBundle',
    'verifyDecisionReceipt',
  ],
  './webhooks': [
    'VerifiedWebhook',
    'VerifyWebhookOptions',
    'WebhookChallenge',
    'WebhookEvent',
    'WebhookHeaders',
    'verifyWebhook',
  ],
  './qr': [],
};
const ADDED = {
  '.': ['AskAnswer', 'AskAnswerOptions', 'AskField', 'AskHandle', 'AskInput', 'AskOptions'],
  './receipts': [],
  './webhooks': [],
  // S-07: the new optional QR entry point.
  './qr': [
    'PrintQrOptions',
    'QR_HEADING',
    'QR_TITLE',
    'QrFormat',
    'QrOptions',
    'QrPngOptions',
    'QrSvgOptions',
    'QrTerminalOptions',
    'printQr',
    'qr',
  ],
};
const ENTRIES = {
  '.': 'index.ts',
  './receipts': 'receipts/index.ts',
  './webhooks': 'webhooks/index.ts',
  './qr': 'qr/index.ts',
} as const;

function declaredExports(): Record<keyof typeof ENTRIES, string[]> {
  const files = Object.fromEntries(
    Object.entries(ENTRIES).map(([entry, file]) => [
      entry,
      fileURLToPath(new URL(`../../src/${file}`, import.meta.url)),
    ]),
  );
  const program = ts.createProgram(Object.values(files), {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    strict: true,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  return Object.fromEntries(
    Object.entries(files).map(([entry, file]) => {
      const symbol = checker.getSymbolAtLocation(program.getSourceFile(file)!)!;
      return [
        entry,
        checker
          .getExportsOfModule(symbol)
          .map((s) => s.name)
          .sort(),
      ];
    }),
  ) as Record<keyof typeof ENTRIES, string[]>;
}

describe('public exports', () => {
  it('are unchanged except for the added question types', () => {
    const actual = declaredExports();
    for (const entry of Object.keys(ENTRIES) as (keyof typeof ENTRIES)[])
      expect(actual[entry]).toEqual([...BEFORE[entry], ...ADDED[entry]].sort());
  });

  it('add no runtime value exports', () => {
    expect(Object.keys(root).sort()).toEqual([
      'Sess',
      'SessError',
      'isInteractiveSession',
      'isInteractiveSurface',
    ]);
    expect(Object.keys(receipts).sort()).toEqual([
      'BUNDLE_LIMITS',
      'verifyDecisionBundle',
      'verifyDecisionReceipt',
    ]);
    expect(Object.keys(webhooks).sort()).toEqual(['verifyWebhook']);
  });

  it('add the QR entry point with only its helpers', () => {
    expect(Object.keys(qrHelper).sort()).toEqual(['QR_HEADING', 'QR_TITLE', 'printQr', 'qr']);
  });

  it('keep every existing client resource and add only the ask method', () => {
    const sess = new Sess({ apiKey: API_KEY, fetch: () => Promise.reject(new Error('no network')) });
    expect(Object.keys(sess)).toEqual(['sessions', 'webhooks', 'receipts']);
    expect(Object.getOwnPropertyNames(Sess.prototype).sort()).toEqual(['ask', 'constructor']);
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(sess.sessions)).sort()).toEqual([
      'complete',
      'constructor',
      'create',
      'listDeliveries',
      'listEvents',
      'publish',
      'redeliverEvent',
      'retrieve',
      'retrieveSurface',
      'waitForResponse',
    ]);
    expect(Object.keys(sess.receipts)).toEqual(['verifyResponse']);
  });
});
