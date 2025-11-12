// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';

const isProd = process.env.BUILD === 'production';

export default {
  input: 'main.ts',
  output: {
    dir: '.',
    sourcemap: isProd ? false : 'inline',
    format: 'cjs',
    exports: 'default',
    name: 'ZeddalPlugin',
  },
  external: ['obsidian'],
  plugins: [
    typescript(),
    nodeResolve({
      browser: true,
      preferBuiltins: false,
    }),
    commonjs(),
    json(),
  ],
};
