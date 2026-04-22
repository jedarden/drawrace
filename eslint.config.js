import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["packages/engine-core/src/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.object.name=\"Math\"][callee.property.name=\"random\"]",
          message:
            "Math.random() is banned in engine code. Use the seeded PRNG from @drawrace/engine-core/src/prng.js instead.",
        },
        {
          selector: "CallExpression[callee.object.name=\"performance\"][callee.property.name=\"now\"]",
          message:
            "performance.now() is banned in engine code. Use the injected Clock from @drawrace/engine-core/src/clock.js instead.",
        },
        {
          selector: "CallExpression[callee.object.name=\"Date\"][callee.property.name=\"now\"]",
          message:
            "Date.now() is banned in engine code. Use the injected Clock from @drawrace/engine-core/src/clock.js instead.",
        },
      ],
    },
  }
);
