declare module '@earendil-works/pi-coding-agent' {
  export interface ExtensionAPI {
    on(event: string, handler: (...args: any[]) => any): void;
    registerTool?(options: any): void;
    tool?(options: any): void;
    [key: string]: any;
  }
}
