import type { TokenProvider } from "./core/auth/credentials.js";
import type { CoreClientOptions } from "./core/client-options.js";

export type ClientOptions = SdkClientOptions & CoreClientOptions;

type SdkClientOptions = ServerOptions & {
  /**
   * A personal access token, `ent_` followed by 43 base64url characters. An unknown or revoked
   * token is a 401 and never falls back to a session cookie.
   */
  readonly bearer?: TokenProvider | undefined;
};

type ServerOptions = {
  readonly serverOptions?: {
    baseUrl?: string;
  };
};
