import styles from "./AttributeRows.module.css";
import { ATTRIBUTE_NAMES, valuesFor } from "./attribute-suggestions";

export type Row = { key: string; value: string };
export const MAX_ATTRS = 5;

type Props = { rows: Row[]; onChange: (rows: Row[]) => void };

/** Required options (Size, Color...) as name and value pairs, with suggestion chips. */
export function AttributeRows({ rows, onChange }: Props) {
  const setRow = (i: number, patch: Partial<Row>) =>
    onChange(rows.map((r, j) => (i === j ? { ...r, ...patch } : r)));
  const full = rows.length >= MAX_ATTRS;
  const unused = ATTRIBUTE_NAMES.filter(
    (n) => !rows.some((r) => r.key.trim().toLowerCase() === n.toLowerCase()),
  );

  return (
    <fieldset className={styles.attrs}>
      <legend>Attributes</legend>
      {rows.map((r, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable id
        <div key={i} className={styles.row}>
          <input
            aria-label={`Attribute ${i + 1} name`}
            list="attr-names"
            placeholder="Size"
            value={r.key}
            onChange={(e) => setRow(i, { key: e.target.value })}
          />
          <input
            aria-label={`Attribute ${i + 1} value`}
            list={`attr-values-${i}`}
            placeholder={valuesFor(r.key)[0] ?? "Value"}
            value={r.value}
            onChange={(e) => setRow(i, { value: e.target.value })}
          />
          <button
            type="button"
            className="btn btn-ghost"
            aria-label={`Remove attribute ${i + 1}`}
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          >
            ×
          </button>
          <datalist id={`attr-values-${i}`}>
            {valuesFor(r.key).map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </div>
      ))}
      <datalist id="attr-names">
        {ATTRIBUTE_NAMES.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <fieldset className={styles.suggest}>
        <legend className={styles.srOnly}>Suggested attributes</legend>
        {unused.map((n) => (
          <button
            key={n}
            type="button"
            className="chip"
            disabled={full}
            onClick={() =>
              onChange([...rows.filter((r) => r.key || r.value), { key: n, value: "" }])
            }
          >
            + {n}
          </button>
        ))}
        <button
          type="button"
          className="btn btn-ghost"
          disabled={full}
          onClick={() => onChange([...rows, { key: "", value: "" }])}
        >
          Add attribute
        </button>
      </fieldset>
    </fieldset>
  );
}
