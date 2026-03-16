declare module 'radclient' {
  interface RadiusPacket {
    code: string;
    secret: string;
    identifier: number;
    attributes: [string, string][];
  }

  interface RadiusOptions {
    host: string;
    port?: number;
    timeout?: number;
    retries?: number;
  }

  interface RadiusResponse {
    code: string;
    identifier: number;
    attributes: Record<string, any>;
  }

  function radclient(
    packet: RadiusPacket,
    options: RadiusOptions,
    callback: (err: Error | null, response: RadiusResponse) => void,
  ): void;

  export = radclient;
}
