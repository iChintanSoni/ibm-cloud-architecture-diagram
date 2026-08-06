import { A2A_PROTOCOL_VERSION, type AgentCard } from "@a2a-js/sdk";

/**
 * `apps/agent`'s A2A identity (docs/00-decision-log.md#d32): two skills matching the exact
 * "GenerateArchitectureDiagram" capability already named in docs/08-agent-integration.md, plus
 * the new "ModifyArchitectureDiagram" for editing an existing `.icad`.
 */
export function buildAgentCard(port: number): AgentCard {
  return {
    name: "ICAD Diagram Agent",
    description:
      "Generates and modifies IBM Cloud architecture diagrams (.icad/.svg/.png) from " +
      "natural-language requirements, driving the ICAD MCP authoring toolset end to end.",
    supportedInterfaces: [
      {
        url: `http://localhost:${port}/`,
        protocolBinding: "JSONRPC",
        tenant: "",
        protocolVersion: A2A_PROTOCOL_VERSION,
      },
    ],
    provider: {
      organization: "ICAD",
      url: "https://github.com/iChintanSoni/ibm-cloud-architecture-diagram",
    },
    version: "0.0.0",
    capabilities: {
      streaming: true,
      pushNotifications: false,
      extensions: [],
      extendedAgentCard: false,
    },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "task-status", "application/json"],
    skills: [
      {
        id: "generate_architecture_diagram",
        name: "Generate Architecture Diagram",
        description:
          "Creates a new IBM Cloud architecture diagram from a natural-language requirement " +
          "paragraph, producing a conformant .icad, .svg, and .png.",
        tags: ["diagram", "ibm-cloud", "architecture", "generate"],
        examples: [
          "A Customer actor connects through a Load Balancer to an Application tier of two " +
            "Virtual Server instances, which connect to a PostgreSQL database.",
        ],
        inputModes: ["text/plain"],
        outputModes: ["application/json", "image/svg+xml", "image/png"],
        securityRequirements: [],
      },
      {
        id: "modify_architecture_diagram",
        name: "Modify Architecture Diagram",
        description:
          "Edits an existing .icad diagram from a natural-language instruction. Requires an " +
          "existingIcadPath in the request message's metadata (docs/00-decision-log.md#d35).",
        tags: ["diagram", "ibm-cloud", "architecture", "modify", "edit"],
        examples: ["Add a Redis cache next to the Application tier."],
        inputModes: ["text/plain"],
        outputModes: ["application/json", "image/svg+xml", "image/png"],
        securityRequirements: [],
      },
    ],
    documentationUrl: "",
    signatures: [],
  };
}
