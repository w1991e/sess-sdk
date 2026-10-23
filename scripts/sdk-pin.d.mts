export interface SdkPin {
  name: string;
  version: string;
  filename: string;
  sha256: string;
  integrity: string;
  package: { license: string; dependencies: Record<string, string>; engines: Record<string, string> };
}
export declare function readPin(): SdkPin;
export declare function consumerDrift(pin?: SdkPin): string[];
export declare function evidenceDrift(pin?: SdkPin, record?: { sdk?: { evidence?: unknown } }): string[];
