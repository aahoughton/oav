export {
  createStreamValidator,
  MaxTotalBytesError,
  StreamValidator,
  ValidationFailedError,
} from "./stream-validator.js";
export { DEFAULT_MAX_CAPTURE_BYTES } from "./hooks.js";
export type { Bytes, ScopeContext, ScopeEditor, ScopeObserver, ValueEvent } from "./hooks.js";
