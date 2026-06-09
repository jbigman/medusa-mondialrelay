import type { Logger } from "@medusajs/framework/types"
import { MondialRelayOptions } from "../../types/index.js"
import MondialRelayClientSoap from "./client-soap"
import MondialRelayClientRest from "./client-rest"

export function createMondialRelayClient(
  options: MondialRelayOptions,
  logger: Logger
): MondialRelayClientSoap | MondialRelayClientRest {
  // If REST credentials provided → REST v2
  if (options.useRestApi) {
    logger.info("[Mondial Relay] Using REST API")
    return new MondialRelayClientRest(options, logger)
  }

  // Else → SOAP v1 (backward compatibility)
  logger.info("[Mondial Relay] Using SOAP API")
  return new MondialRelayClientSoap(options, logger)
}