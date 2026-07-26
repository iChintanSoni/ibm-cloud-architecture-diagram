import { describe, expect, it } from "vitest";
import { formatConnectorAnnotation } from "./connectorAnnotation.js";

describe("formatConnectorAnnotation", () => {
  it("joins name, security, and port per IBM's worked example (HTTPS TLS1.3:443)", () => {
    expect(
      formatConnectorAnnotation({
        name: "HTTPS",
        security: "TLS1.3",
        port: "443",
      }),
    ).toBe("HTTPS TLS1.3:443");
  });

  it("omits the port suffix when unset", () => {
    expect(
      formatConnectorAnnotation({ name: "HTTPS", security: "TLS1.3" }),
    ).toBe("HTTPS TLS1.3");
  });

  it("omits the security segment when unset, but keeps the port", () => {
    expect(formatConnectorAnnotation({ name: "HTTPS", port: "443" })).toBe(
      "HTTPS:443",
    );
  });

  it("renders the bare name when neither security nor port is set", () => {
    expect(formatConnectorAnnotation({ name: "VXLAN" })).toBe("VXLAN");
  });
});
