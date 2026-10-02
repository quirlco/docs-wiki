// Hand-written, minimal type surface for the vendored marked.mjs bundle —
// exactly what this package calls, nothing more. The full published .d.ts is
// ~1500 lines of extension-hook types this engine never touches; declaring
// only the used surface keeps the vendored file honest (grow the types the
// day the code grows a call).

export interface MarkedParseOptions {
  /** false forces the synchronous return type. */
  async?: boolean;
  breaks?: boolean;
  gfm?: boolean;
  pedantic?: boolean;
  silent?: boolean;
}

export declare const marked: {
  parse(src: string, options?: MarkedParseOptions): string | Promise<string>;
};
