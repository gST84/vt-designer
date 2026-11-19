// Headless self-test on macOS without Node:
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m tools/run-tests.mjs
import { runTests } from '../src/tests.js';

const out = typeof print === 'function' ? print : console.log;
const fails = runTests(out);
if (fails && typeof quit === 'function') quit(1);
