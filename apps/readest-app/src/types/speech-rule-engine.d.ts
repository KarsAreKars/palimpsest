declare module 'speech-rule-engine' {
  interface SreSetupOptions {
    modality?: string;
    domain?: string;
    style?: string;
    locale?: string;
  }
  const SRE: {
    setupEngine(options: SreSetupOptions): Promise<unknown>;
    toSpeech(mathml: string): string;
  };
  export default SRE;
}
