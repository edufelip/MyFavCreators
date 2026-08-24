import { afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// happy-dom must install the DOM globals before Testing Library is loaded:
// its `screen` helpers bind to `document.body` at module evaluation time.
GlobalRegistrator.register();

const { cleanup } = await import("@testing-library/react");

afterEach(() => {
  cleanup();
});
