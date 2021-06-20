// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
// eslint-disable-next-line import/no-extraneous-dependencies
import {lookupFiles as lookupFilesMocha} from "mocha/lib/cli";

export const lookupFiles = lookupFilesMocha as (
  filepath: string,
  extensions?: string[],
  recursive?: boolean
) => string[];
