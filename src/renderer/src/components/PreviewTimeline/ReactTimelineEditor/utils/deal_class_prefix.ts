// @ts-nocheck
import { PREFIX } from "../interface/const";

export function prefix(...classNames: string[]) {
  return classNames
    .filter(Boolean)
    .map((className) => `${PREFIX}-${className}`)
    .join(' ');
}
