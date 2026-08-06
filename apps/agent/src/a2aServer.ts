import { DEFAULT_A2A_PORT, startA2AServer } from "./a2a/index.js";

async function main(): Promise<void> {
  const port = Number(process.env.PORT || DEFAULT_A2A_PORT);
  const handle = await startA2AServer({ port });
  console.log(
    `[icad-agent] A2A server listening on http://localhost:${handle.port}`,
  );
  console.log(`[icad-agent] Agent Card: ${handle.agentCardUrl}`);
}

main().catch((err) => {
  console.error("icad-agent fatal error:", err);
  process.exit(1);
});
