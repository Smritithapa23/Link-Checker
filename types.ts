
export enum SafetyVerdict {
  SAFE = 'SAFE',
  DANGER = 'DANGER',
  SUSPICIOUS = 'SUSPICIOUS',
  UNKNOWN = 'UNKNOWN'
}

export interface VerificationResult {
  url: string;
  verdict: SafetyVerdict;
  reason: string;
  timestamp: number;
}

export interface ExtensionMessage {
  type: 'VERIFY_LINK' | 'VERIFICATION_START' | 'VERIFICATION_RESULT';
  payload?: any;
}
