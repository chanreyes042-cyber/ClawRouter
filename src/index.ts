/**
 * @blockrun/openclaw-provider
 *
 * OpenClaw plugin that adds BlockRun as an LLM provider with 30+ AI models.
 * Payments are handled automatically via x402 USDC micropayments on Base.
 * Smart routing picks the cheapest capable model for each request.
 *
 * Usage:
 *   # Install the plugin
 *   openclaw plugin install @blockrun/openclaw-provider
 *
 *   # Set wallet key
 *   export BLOCKRUN_WALLET_KEY=0x...
 *
 *   # Or configure via wizard
 *   openclaw provider add blockrun
 *
 *   # Use smart routing (auto-picks cheapest model)
 *   openclaw config set model blockrun/auto
 *
 *   # Or use any specific BlockRun model
 *   openclaw config set model openai/gpt-5.2
 */

import type { OpenClawPluginDefinition, OpenClawPluginApi } from "./types.js";
import { blockrunProvider, setActiveProxy } from "./provider.js";
import { startProxy } from "./proxy.js";
import { resolveOrGenerateWalletKey } from "./auth.js";
import type { RoutingConfig } from "./router/index.js";

const plugin: OpenClawPluginDefinition = {
  id: "claw-router",
  name: "ClawRouter",
  description: "Smart LLM router — 30+ models, x402 micropayments, 63% cost savings",
  version: "0.1.0",

  register(api: OpenClawPluginApi) {
    // Register BlockRun as a provider
    api.registerProvider(blockrunProvider);

    api.logger.info("BlockRun provider registered (30+ models via x402)");
  },

  async activate(api: OpenClawPluginApi) {
    // Resolve wallet key: saved file → env var → auto-generate
    const { key: walletKey, address, source } = await resolveOrGenerateWalletKey();

    // Log wallet source
    if (source === "generated") {
      api.logger.info(`Generated new wallet: ${address}`);
      api.logger.info(`Fund with USDC on Base to start using ClawRouter.`);
    } else if (source === "saved") {
      api.logger.info(`Using saved wallet: ${address}`);
    } else {
      api.logger.info(`Using wallet from BLOCKRUN_WALLET_KEY: ${address}`);
    }

    // Resolve routing config overrides from plugin config
    const routingConfig = api.pluginConfig?.routing as Partial<RoutingConfig> | undefined;

    // Start the local x402 proxy
    try {
      const proxy = await startProxy({
        walletKey,
        routingConfig,
        onReady: (port) => {
          api.logger.info(`BlockRun x402 proxy listening on port ${port}`);
        },
        onError: (error) => {
          api.logger.error(`BlockRun proxy error: ${error.message}`);
        },
        onRouted: (decision) => {
          const savingsPct = (decision.savings * 100).toFixed(1);
          const cost = decision.costEstimate.toFixed(4);
          const baseline = decision.baselineCost.toFixed(4);
          api.logger.info(
            `[routing] ${decision.model} (${decision.tier}, ${decision.method}, confidence=${decision.confidence.toFixed(2)}) ` +
            `cost=$${cost} baseline=$${baseline} saved=${savingsPct}%`,
          );
        },
      });

      setActiveProxy(proxy);
      api.logger.info(`BlockRun provider active — ${proxy.baseUrl}/v1 (smart routing enabled)`);
    } catch (err) {
      api.logger.error(
        `Failed to start BlockRun proxy: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
};


export default plugin;

// Re-export for programmatic use
export { startProxy } from "./proxy.js";
export { blockrunProvider } from "./provider.js";
export { OPENCLAW_MODELS, BLOCKRUN_MODELS, buildProviderModels } from "./models.js";
export { route, DEFAULT_ROUTING_CONFIG } from "./router/index.js";
export type { RoutingDecision, RoutingConfig, Tier } from "./router/index.js";
export { logUsage } from "./logger.js";
export type { UsageEntry } from "./logger.js";
