declare module "juice/client" {
  interface JuiceOptions {
    inlinePseudoElements?: boolean;
    preserveImportant?: boolean;
    resolveCSSVariables?: boolean;
  }

  export default function juice(html: string, options?: JuiceOptions): string;
}
