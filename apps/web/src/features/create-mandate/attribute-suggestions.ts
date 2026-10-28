// A hand-picked starter list of option names and typical values.
// They only prefill the inputs; the user can type anything.
export const ATTRIBUTE_SUGGESTIONS: Record<string, readonly string[]> = {
  Size: ["6", "7", "8", "9", "10", "11", "12", "XS", "S", "M", "L", "XL"],
  Color: ["Black", "White", "Grey", "Navy", "Blue", "Red", "Green", "Beige"],
  Width: ["Regular", "Wide", "Extra Wide", "Narrow"],
  Material: ["Leather", "Mesh", "Cotton", "Wool", "Canvas"],
  Storage: ["128GB", "256GB", "512GB", "1TB", "2TB"],
  RAM: ["8GB", "16GB", "24GB", "32GB", "48GB", "64GB"],
};

export const ATTRIBUTE_NAMES = Object.keys(ATTRIBUTE_SUGGESTIONS);

/** The suggested values for a typed name, matched case-insensitively. */
export function valuesFor(name: string): readonly string[] {
  const key = ATTRIBUTE_NAMES.find((k) => k.toLowerCase() === name.trim().toLowerCase());
  return (key && ATTRIBUTE_SUGGESTIONS[key]) || [];
}
