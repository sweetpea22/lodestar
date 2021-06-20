// eslint-disable-next-line import/no-extraneous-dependencies
import Mocha from "mocha";
import {testResults} from "./mochaPlugin";
import {formatResultRow} from "./runner";

const {
  EVENT_RUN_BEGIN,
  EVENT_RUN_END,
  EVENT_TEST_FAIL,
  EVENT_TEST_PASS,
  EVENT_TEST_PENDING,
  EVENT_SUITE_BEGIN,
  EVENT_SUITE_END,
} = Mocha.Runner.constants;

// this reporter outputs test results, indenting two spaces per suite
class MyReporter extends Mocha.reporters.Base {
  constructor(runner: Mocha.Runner, options?: Mocha.MochaOptions) {
    super(runner, options);

    // eslint-disable-next-line no-console
    const consoleLog = console.log;
    const color = Mocha.reporters.Base.color;
    const symbols = Mocha.reporters.Base.symbols;

    let indents = 0;
    let n = 0;

    function indent(): string {
      return Array(indents).join("  ");
    }

    runner.on(EVENT_RUN_BEGIN, function () {
      consoleLog();
    });

    runner.on(EVENT_SUITE_BEGIN, function (suite) {
      ++indents;
      consoleLog(color("suite", "%s%s"), indent(), suite.title);
    });

    runner.on(EVENT_SUITE_END, function () {
      --indents;
      if (indents === 1) {
        consoleLog();
      }
    });

    runner.on(EVENT_TEST_PENDING, function (test) {
      const fmt = indent() + color("pending", "  - %s");
      consoleLog(fmt, test.title);
    });

    runner.on(EVENT_TEST_PASS, function (test) {
      const result = testResults.get(test);
      if (!result) {
        const err = Error(`No testResult found for test: ${test.title}`);
        // Log error manually since mocha doesn't log errors thrown here
        consoleLog(err);
        throw err;
      }

      const resultRow = formatResultRow(result);
      const fmt = indent() + color("checkmark", "  " + symbols.ok) + " " + resultRow;
      consoleLog(fmt);
    });

    runner.on(EVENT_TEST_FAIL, function (test) {
      consoleLog(indent() + color("fail", "  %d) %s"), ++n, test.title);
    });

    runner.once(EVENT_RUN_END, this.epilogue.bind(this));
  }
}

module.exports = MyReporter;
