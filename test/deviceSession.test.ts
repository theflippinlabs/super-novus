import { describe, it, expect } from "vitest";
import { delegationMessage } from "../src/net/DeviceSession";

/* The delegation message is a SHARED CONTRACT between the client (DeviceSession)
   and the submit-score Edge Function. If these two ever disagree by a single byte,
   every score save silently fails signature verification. This test freezes the
   exact format; the Edge Function builds the identical string:
     `SUPER NOVUS authorize device ${device} for wallet ${wallet} until ${exp}`
   with both addresses lowercased and exp as an integer of milliseconds. */
describe("delegationMessage", () => {
  const wallet = "0x9A9B6852BFe9CE0e9200467fCA29C0Ab79aD9a00";
  const device = "0xAbC1230000000000000000000000000000000DEF";
  const exp = 1800000000000;

  it("lowercases both addresses and embeds the integer expiry", () => {
    expect(delegationMessage(wallet, device, exp)).toBe(
      `SUPER NOVUS authorize device ${device.toLowerCase()} for wallet ${wallet.toLowerCase()} until ${exp}`,
    );
  });

  it("matches the exact string the Edge Function reconstructs", () => {
    // This literal MUST mirror supabase/functions/submit-score/index.ts.
    const edgeSide =
      `SUPER NOVUS authorize device ${device.toLowerCase()} for wallet ${wallet.toLowerCase()} until ${exp}`;
    expect(delegationMessage(wallet, device, exp)).toBe(edgeSide);
  });

  it("is stable regardless of input casing", () => {
    expect(delegationMessage(wallet.toLowerCase(), device.toLowerCase(), exp))
      .toBe(delegationMessage(wallet.toUpperCase().replace("0X", "0x"), device, exp));
  });
});
