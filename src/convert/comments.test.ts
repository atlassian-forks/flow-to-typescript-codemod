import dedent from "dedent";
import { transform } from "./utils/testing";

describe("comments", () => {
  it("should preserve file-wide disables", async () => {
    const source = `/* eslint-disable */`;
    expect(await transform(source)).toBe(source);
  });

  it("should preserve file-wide enables", async () => {
    const source = `/* eslint-enable */`;
    expect(await transform(source)).toBe(source);
  });

  it("should remove comment for single usage of removed rule in comment line", async () => {
    const source = dedent`
            // eslint-disable-next-line no-unused-vars
            const first = 1;
        `;
    const expected = dedent`
            const first = 1;
        `;
    expect(await transform(source)).toBe(expected);
  });

  it("should remove comment for single usage of removed rule in comment block", async () => {
    const source = dedent`
            /* eslint-disable-next-line no-unused-vars */
            const first = 1;
        `;
    const expected = dedent`
            const first = 1;
        `;
    expect(await transform(source)).toBe(expected);
  });

  it("should remove comment for single usage of removed rule in comment block (enable)", async () => {
    const source = dedent`
            /* eslint-enable no-unused-vars */
            const first = 1;
        `;
    const expected = dedent`
            const first = 1;
        `;
    expect(await transform(source)).toBe(expected);
  });

  it("should preserve non-removed rules in a comment line with mixed rules", async () => {
    const source = dedent`
            // eslint-disable-next-line no-restricted-syntax, no-unused-vars, no-continue
            const first = 1;
        `;
    const expected = dedent`
            // eslint-disable-next-line no-restricted-syntax, no-continue
            const first = 1;
        `;
    expect(await transform(source)).toBe(expected);
  });

  it("should preserve non-removed rules in a comment line with mixed rules (enable)", async () => {
    const source = dedent`
            /* eslint-enable no-restricted-syntax, no-unused-vars, no-continue */
            const first = 1;
        `;
    const expected = dedent`
            /* eslint-enable no-restricted-syntax, no-continue */
            const first = 1;
        `;
    expect(await transform(source)).toBe(expected);
  });

  it("should preserve non-removed-rules", async () => {
    const source = dedent`
            // eslint-disable-next-line no-restricted-syntax, no-continue
            const first = 1;
        `;
    expect(await transform(source)).toBe(source);
  });

  it("should remove bad rule from single line comment block", async () => {
    const source = dedent`
            /* eslint-disable-next-line no-unused-vars, no-continue, no-restricted-syntax */
            const first = 1;
        `;
    const expected = dedent`
            /* eslint-disable-next-line no-continue, no-restricted-syntax */
            const first = 1;
        `;
    expect(await transform(source)).toBe(expected);
  });

  it("should remove bad rule from multi line comment block", async () => {
    const source = dedent`
            /* eslint-disable-next-line no-unused-vars,
                no-continue,
                no-restricted-syntax */
            const first = 1;
        `;
    const expected = dedent`
            /* eslint-disable-next-line no-continue, no-restricted-syntax */
            const first = 1;
        `;
    expect(await transform(source)).toBe(expected);
  });

  it("should remove bad rule even when directive has extra leading spaces in comment block", async () => {
    const source = dedent`
            /*  eslint-disable-next-line no-unused-vars, no-continue, no-restricted-syntax */
            const first = 1;
        `;
    const expected = dedent`
            /* eslint-disable-next-line no-continue, no-restricted-syntax */
            const first = 1;
        `;
    expect(await transform(source)).toBe(expected);
  });

  it("should update comments for disabling same line", async () => {
    const source = dedent`
            const first = 1; // eslint-disable-line no-unused-vars
        `;
    const expected = dedent`
            const first = 1;
        `;
    expect(await transform(source)).toBe(expected);
  });

  it("should update mixed comments for disabling same line", async () => {
    const source = dedent`
            const first = 1; // eslint-disable-line no-unused-vars, no-continue
        `;
    const expected = dedent`
            const first = 1; // eslint-disable-line no-continue
        `;
    expect(await transform(source)).toBe(expected);
  });

  describe("dash-dash comments", () => {
    it("should preserve comment in directive if present", async () => {
      const source = dedent`
                /* eslint-disable-next-line no-continue, no-restricted-syntax,
                    no-unused-vars -- Hello darkness my old friend */
                const first = 1;
            `;
      const expected = dedent`
                /* eslint-disable-next-line no-continue, no-restricted-syntax -- Hello darkness my old friend */
                const first = 1;
            `;
      expect(await transform(source)).toBe(expected);
    });

    it("should remove directive with comment if all rules are removed", async () => {
      const source = dedent`
            /*  eslint-disable-next-line no-unused-vars -- Papaya? */
                const first = 1;
            `;
      const expected = dedent`
                const first = 1;
            `;
      expect(await transform(source)).toBe(expected);
    });
  });

  describe("jsx", () => {
    it("should update jsx comments removing bad rules", async () => {
      const source = dedent`
                const Component = (
                    <Papaya>
                        {/* eslint-disable-next-line no-continue, no-unused-vars */}
                        {honk}
                    </Papaya>
                );
            `;
      const expected = dedent`
                const Component = (
                    <Papaya>
                        {/* eslint-disable-next-line no-continue */}
                        {honk}
                    </Papaya>
                );
            `;
      expect(await transform(source)).toBe(expected);
    });

    it("should replace directive by empty jsx expression if all rules are disabled", async () => {
      const source = dedent`
                const Component = (
                    <Papaya>
                        {/* eslint-disable-next-line no-unused-vars */}
                        {honk}
                    </Papaya>
                );
            `;
      const expected = dedent`
                const Component = (
                    <Papaya>
                        {}
                        {honk}
                    </Papaya>
                );
            `;
      expect(await transform(source)).toBe(expected);
    });
  });
});
