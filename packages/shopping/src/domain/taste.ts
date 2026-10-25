// The last signed mandate's preferences. Taste only prefills the next form; it never binds money.
export type Taste = { brands: string[]; avoid: string[]; attributes: Record<string, string> };

export const tasteFrom = (item: {
  brands: string[];
  avoid: string[];
  requiredAttributes: Record<string, string>;
}): Taste => ({
  brands: [...item.brands],
  avoid: [...item.avoid],
  attributes: { ...item.requiredAttributes },
});
