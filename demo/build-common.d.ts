import type { BuildOptions, BuildResult } from 'esbuild';

export declare const ROOT_DIR: string;
export declare const DEMO_DIR: string;
export declare const SHARED_DIR: string;
export declare const SHARED_SRC_DIR: string;
export declare const SHARED_POLYFILLS: string;
export declare const SHARED_TOKENS: string;
export declare const SQL_WASM_SOURCE: string;
export declare const SQL_WASM_JS_SOURCE: string;

export declare const DEFAULT_ALIASES: Record<string, string>;
export declare const DEFAULT_DEFINES: Record<string, string>;
export declare const DEFAULT_WORKER_DEFINES: Record<string, string>;
export declare const DEFAULT_EXTERNALS: string[];
export declare const DEFAULT_LOADERS: Record<string, string>;

export interface AssetMapping {
  from: string;
  to: string;
}

export interface AppConfigOptions extends Partial<BuildOptions> {
  entryPoint?: string;
  entryPoints?: string[];
  outfile?: string;
  outdir?: string;
}

export interface WorkerConfigOptions extends Partial<BuildOptions> {
  entryPoint?: string;
  entryPoints?: string[];
  outfile?: string;
}

export interface DemoBuildOptions {
  name?: string;
  targetDir?: string;
  wasm?: boolean;
  tokens?: boolean;
  assets?: AssetMapping[];
  worker?: boolean | WorkerConfigOptions;
  app?: AppConfigOptions;
  apps?: AppConfigOptions[];
  exitOnError?: boolean;
}

export declare function copyAssets(assets?: AssetMapping[]): AssetMapping[];
export declare function copyWasmAssets(targetDir: string): AssetMapping[];
export declare function copyTokens(targetDir: string): AssetMapping[];

export declare function createAppConfig(options?: AppConfigOptions): BuildOptions;
export declare function createWorkerConfig(options?: WorkerConfigOptions): BuildOptions;

export declare function buildApp(options: AppConfigOptions): Promise<BuildResult>;
export declare function buildWorker(options: WorkerConfigOptions): Promise<BuildResult>;
export declare function buildDemoApp(options?: DemoBuildOptions): Promise<boolean>;
