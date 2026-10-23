export function usdMinorToDecimal(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error("Invalid USD minor units");
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
}

export function parseUsdDecimal(value: string): number {
  if (!/^(0|[1-9]\d{0,8})(\.\d{1,2})?$/.test(value)) throw new Error("Invalid USD decimal");
  const [whole, fractional = ""] = value.split(".");
  const minor = Number(whole) * 100 + Number(fractional.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor)) throw new Error("USD amount exceeds safe range");
  return minor;
}

