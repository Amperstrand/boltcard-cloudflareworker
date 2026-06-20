import type {
  CardProvider,
  BurnParams,
  InspectResult,
  TapResult,
  CardInfo,
} from "./provider.js";
import { VirtualProvider } from "./virtual-provider.js";
import { SimProvider } from "./sim-provider.js";
import { UsbProvider } from "./usb-provider.js";

export function createProvider(): CardProvider {
  const provider = process.env.TEST_PROVIDER || "virtual";
  switch (provider) {
    case "usb":
      return new UsbProvider();
    case "virtual":
      return new VirtualProvider();
    case "sim":
      return new SimProvider();
    default:
      throw new Error(`Unknown TEST_PROVIDER: ${provider}. Use "virtual", "sim", or "usb".`);
  }
}

export {
  type CardProvider,
  type BurnParams,
  type InspectResult,
  type TapResult,
  type CardInfo,
} from "./provider.js";
