export interface StarterLock {
  name: string;
  packages: Map<string, Record<string, unknown>>;
}
export declare const WANTED: string;
export declare const SDK: string;
export declare function parseLock(text: string, label: string): StarterLock;
export declare function runtimeChains(lock: StarterLock, wanted: string): string[];
export declare function starterChains(text: string, label: string): string[];
