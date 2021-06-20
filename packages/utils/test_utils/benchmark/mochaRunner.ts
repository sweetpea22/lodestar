// eslint-disable-next-line import/no-extraneous-dependencies
import Mocha from "mocha";

import path from "path";
import {mochaHooks} from "./mochaPlugin";
import {lookupFiles} from "./lookupFiles";

const mocha = new Mocha({
  reporter: path.join(__dirname, "./reporter.ts"),
  rootHooks: mochaHooks,
});

// Use non-default Mocha test directory.
const testFiles = process.env.TEST_FILES || "test";

const files = lookupFiles(testFiles, [".js", ".ts"], true);
for (const file of files) {
  mocha.addFile(file);
}

// Run the tests.
mocha.run(function (failures) {
  process.exitCode = failures ? 1 : 0; // exit with non-zero status if there were failures
});
